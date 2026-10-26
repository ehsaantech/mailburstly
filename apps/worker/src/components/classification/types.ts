/**
 * The classification contract.
 *
 * The rules and the LLM produce the same shape, so the caller never has to
 * know which one answered. That is the whole point: the LLM is an
 * improvement, not a dependency. With no API key the rules answer, and
 * nothing downstream changes.
 */

/** How interested the sender seems. Mirrors the rules classifier. */
export type Interest = "positive" | "negative" | "neutral" | "question";

export interface Classification {
  interest: Interest;
  /**
   * How sure the classifier is, 0–1.
   *
   * The decision API returns a real concentration score. The chat path asks
   * the model for its own confidence, which is not calibrated the same way —
   * the service treats a chat-path confidence as a weaker signal.
   */
  confidence: number;
  /** A buying signal worth following up on: pricing, a demo, a meeting. */
  isOpportunity: boolean;
  /** One line describing what the sender wants. */
  summary: string | null;
  /** Which classifier produced this. */
  source: "rules" | "llm";
}

/** The signal the caller needs, after the confidence gate has been applied. */
export interface ClassificationOutcome extends Classification {
  /**
   * True when the result is good enough to act on.
   *
   * False means "leave it for a human": no label is applied, so a lead is
   * never silently mislabeled.
   */
  applicable: boolean;
  /** Why it was not applicable, for the log and the api. */
  reason:
    | "confident"
    | "below_threshold"
    | "no_classifier"
    | "llm_failed"
    | "structural";
}
