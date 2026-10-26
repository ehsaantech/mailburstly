/**
 * The classifier.
 *
 * The rules are the floor and the LLM is the improvement:
 *
 *   1. **Structural signals win outright.** An out-of-office or an
 *      unsubscribe is decided by the rules, with no model call. A legal
 *      obligation must not depend on a 0.7-confidence guess, and an
 *      autoresponder is a pattern, not an opinion.
 *   2. **Everything else goes to the model** when one is configured.
 *   3. **A low-confidence answer is not acted on.** Below the threshold no
 *      label is applied, so a lead is never silently mislabeled. A
 *      confident rule result rescues a low-confidence model answer; a
 *      low-confidence model answer with no confident rule leaves the reply
 *      for a human.
 *   4. **A failed model call is never fatal.** The rules answer, and the
 *      pipeline carries on.
 */

import type { Logger } from "@/core/logger";
import {
  classifyInterest,
  hasOpportunitySignal,
  isOutOfOffice,
  isUnsubscribeRequest,
} from "@/components/events/classify";
import { createOllamaClient, type OllamaClient } from "./ollama";
import type {
  Classification,
  ClassificationOutcome,
  Interest,
} from "./types";

export interface ClassificationServiceDeps {
  log: Logger;
  /** Ollama's API key. Empty means the rules answer everything. */
  apiKey: string;
  baseUrl: string;
  /** The model to use when the workspace has not chosen one. */
  model: string;
  /** Answers below this confidence are not acted on. */
  minConfidence: number;
  timeoutMs?: number;
  /** The most characters of a reply handed to the model. */
  maxBodyChars?: number;
  /**
   * Reads the workspace's own settings.
   *
   * The operator picks the model and the threshold from the dashboard, so
   * the classifier asks for them per call rather than reading the
   * environment once. The key and the base url stay in the environment:
   * they are deployment secrets, not workspace settings.
   */
  resolveSettings?: () => Promise<{
    model?: string | null;
    minConfidence?: number | null;
    enabled?: boolean | null;
  } | null>;
}

/** How much of a reply the model sees. Replies are short; this is a guard. */
const DEFAULT_MAX_BODY_CHARS = 8_000;

export function createClassificationService(deps: ClassificationServiceDeps) {
  const { log } = deps;


  const maxBodyChars = deps.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;

  /**
   * The model and threshold in force right now.
   *
   * The workspace's choice wins; the environment is the default and the
   * fallback when the settings row is missing or unreadable.
   */
  const currentSettings = async () => {
    if (!deps.resolveSettings) {
      return {
        model: deps.model,
        minConfidence: deps.minConfidence,
        enabled: true,
      };
    }

    try {
      const stored = await deps.resolveSettings();
      return {
        model: stored?.model?.trim() || deps.model,
        minConfidence:
          typeof stored?.minConfidence === "number"
            ? stored.minConfidence
            : deps.minConfidence,
        enabled: stored?.enabled !== false,
      };
    } catch (error) {
      log.warn("could not read the workspace settings — using the defaults", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        model: deps.model,
        minConfidence: deps.minConfidence,
        enabled: true,
      };
    }
  };

  /** The rules' answer, for comparison and as the fallback. */
  function ruleClassification(input: {
    subject: string | null;
    body: string;
  }): Classification {
    const interest = classifyInterest(input.subject, input.body);
    return {
      interest,
      // The rules have no probability, so they are treated as confident
      // only when they matched an explicit signal.
      confidence: interest === "neutral" ? 0.4 : 0.85,
      isOpportunity: hasOpportunitySignal(interest, input.subject, input.body),
      summary: null,
      source: "rules",
    };
  }

  return {
    /** True when a model is configured and can be called. */
    get enabled(): boolean {
      return deps.apiKey.trim().length > 0;
    },

    /**
     * Classifies one reply.
     *
     * Never throws: a model failure falls back to the rules, and a
     * structural signal short-circuits before any network call.
     */
    async classify(input: {
      subject: string | null;
      body: string;
      originalSubject?: string | null;
    }): Promise<ClassificationOutcome> {
      const body = input.body.slice(0, maxBodyChars);

      // --- 1. structural signals: no model call -----------------------
      if (isOutOfOffice(input.subject, body)) {
        return {
          interest: "neutral",
          confidence: 1,
          isOpportunity: false,
          summary: null,
          source: "rules",
          applicable: true,
          reason: "structural",
        };
      }

      if (isUnsubscribeRequest(input.subject, body)) {
        return {
          interest: "negative",
          confidence: 1,
          isOpportunity: false,
          summary: null,
          source: "rules",
          applicable: true,
          reason: "structural",
        };
      }

      const rules = ruleClassification({ subject: input.subject, body });

      const settings = await currentSettings();

      // --- 2. no model configured: the rules answer --------------------
      if (!deps.apiKey.trim() || !settings.enabled) {
        return { ...rules, applicable: true, reason: "no_classifier" };
      }

      const client: OllamaClient = createOllamaClient({
        apiKey: deps.apiKey,
        baseUrl: deps.baseUrl,
        model: settings.model,
        timeoutMs: deps.timeoutMs ?? 15_000,
      });

      // --- 3. ask the model -------------------------------------------
      let llm: Classification | null = null;
      let failure: string | null = null;

      try {
        const result = await client.classify({
          subject: input.subject,
          body,
          originalSubject: input.originalSubject,
        });

        if (result) {
          llm = result.classification;
          log.info("reply classified by the model", {
            model: settings.model,
            interest: llm.interest,
            confidence: llm.confidence,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          });
        } else {
          failure = "unparseable response";
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        log.warn("model classification failed — falling back to the rules", {
          model: settings.model,
          error: failure,
        });
      }

      if (!llm) {
        return {
          ...rules,
          applicable: true,
          reason: failure ? "llm_failed" : "no_classifier",
        };
      }

      // --- 4. the confidence gate -------------------------------------
      if (llm.confidence >= settings.minConfidence) {
        return { ...llm, applicable: true, reason: "confident" };
      }

      // The model was not sure. A confident rule result still stands;
      // otherwise the reply is left for a human.
      if (rules.interest !== "neutral" && rules.confidence >= 0.8) {
        log.info("model was unsure — keeping the rule result", {
          model: deps.model,
          modelInterest: llm.interest,
          modelConfidence: llm.confidence,
          ruleInterest: rules.interest,
        });
        return { ...rules, applicable: true, reason: "confident" };
      }

      log.info("reply left for a human — no label applied", {
        model: deps.model,
        interest: llm.interest,
        confidence: llm.confidence,
        threshold: settings.minConfidence,
      });

      return { ...llm, applicable: false, reason: "below_threshold" };
    },
  };
}

export type ClassificationService = ReturnType<typeof createClassificationService>;
export type { Classification, ClassificationOutcome, Interest };
