/**
 * Reply classification.
 *
 * These are heuristics, not an LLM. They are deliberately conservative: the
 * cost of a false "positive" is that a lead is marked interested when they
 * are not, and the cost of a false "negative" is that a warm lead is missed.
 * A missing API key must not silently turn every reply into "neutral", so
 * the rules do the work and an LLM can be layered on top later.
 *
 * Every function is pure and takes plain strings, so each rule can be tested
 * on its own.
 */

/** How interested the sender seems. Defined once, in the classifier. */
import type { Interest } from "@/components/classification/types";

export type { Interest };

/* -------------------------------------------------------------------------- */
/* Out of office                                                               */
/* -------------------------------------------------------------------------- */

const OUT_OF_OFFICE_SUBJECTS = [
  /^auto(?:matic)?[ _-]?(?:reply|response)/i,
  /^out of (?:the )?office/i,
  /^ooo\b/i,
  /^oof\b/i,
  /^away from (?:my )?(?:e-?mail|mailbox)/i,
  /^re:.*\[auto[_\- ]?reply\]/i,
];

/**
 * Detects an out-of-office autoreply.
 *
 * The subject is the strongest signal; the body is checked second because
 * many autoresponders put "I am currently out of the office" in the body
 * with a completely unrelated subject line.
 */
export function isOutOfOffice(
  subject: string | null | undefined,
  body: string | null | undefined,
): boolean {
  const s = (subject ?? "").trim();
  if (OUT_OF_OFFICE_SUBJECTS.some((re) => re.test(s))) return true;

  const b = (body ?? "").slice(0, 2000);
  return /out of (?:the )?office/i.test(b) || /\bi(?:'m| am) currently (?:away|out of the office)/i.test(b);
}

/**
 * Extracts the date a contact says they will be back.
 *
 * Returns null when the message does not say. A missing date means the lead
 * is resumed on the next scheduler tick rather than being parked forever.
 */
export function extractResumeDate(
  subject: string | null | undefined,
  body: string | null | undefined,
  now: Date = new Date(),
): Date | null {
  const text = `${subject ?? ""}\n${body ?? ""}`;

  // ISO date: "2026-01-30" or "2026/01/30".
  const iso = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(text);
  if (iso) {
    const date = new Date(
      Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 9, 0, 0),
    );
    if (!Number.isNaN(date.getTime()) && date > now) return date;
  }

  // "January 5", "5 January", "Jan 5" — the year is assumed to be the next
  // one when the date has already passed this year.
  const monthNames =
    "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

  // Day first: "5 January", "5 January 2026".
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})\\s+(${monthNames})\\.?(?:\\s+(\\d{4}))?\\b`,
    "i",
  ).exec(text);

  // Month first: "January 5", "January 5, 2026".
  const monthFirst = new RegExp(
    `\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?\\b`,
    "i",
  ).exec(text);

  let day: number | null = null;
  let monthName: string | null = null;
  let rawYear: number | null = null;

  if (dayFirst) {
    day = Number(dayFirst[1]);
    monthName = dayFirst[2]!.toLowerCase();
    rawYear = dayFirst[3] ? Number(dayFirst[3]) : null;
  } else if (monthFirst) {
    monthName = monthFirst[1]!.toLowerCase();
    day = Number(monthFirst[2]);
    rawYear = monthFirst[3] ? Number(monthFirst[3]) : null;
  }

  if (monthName !== null && day !== null) {
    const month = MONTHS.indexOf(monthName);
    if (month >= 0 && day >= 1 && day <= 31) {
      const year =
        rawYear === null
          ? now.getUTCFullYear()
          : rawYear < 100
            ? 2000 + rawYear
            : rawYear;

      let date = new Date(Date.UTC(year, month, day, 9, 0, 0));
      if (rawYear === null && date <= now) {
        // No year given and the date has passed — assume next year.
        date = new Date(Date.UTC(year + 1, month, day, 9, 0, 0));
      }
      if (date > now) return date;
    }
  }

  // "back on 5th", "until next Monday" — too vague to date reliably, so the
  // lead is resumed on the next tick instead of being parked.
  return null;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/* -------------------------------------------------------------------------- */
/* Unsubscribe                                                                 */
/* -------------------------------------------------------------------------- */

const UNSUBSCRIBE_PATTERNS = [
  /unsubscrib/i,
  /opt[ -]?out/i,
  /remove me from (?:this|your|all)/i,
  /stop (?:sending|emailing|contacting)/i,
  /do not (?:contact|email) me (?:again|anymore)/i,
  /don't (?:contact|email) me (?:again|anymore)/i,
];

/** True when the message asks to stop being contacted. */
export function isUnsubscribeRequest(
  subject: string | null | undefined,
  body: string | null | undefined,
): boolean {
  const text = `${subject ?? ""}\n${body ?? ""}`;
  return UNSUBSCRIBE_PATTERNS.some((re) => re.test(text));
}

/* -------------------------------------------------------------------------- */
/* Interest                                                                    */
/* -------------------------------------------------------------------------- */

const NEGATIVE_PATTERNS = [
  /\bnot interested\b/i,
  /\bno thank[sn]?\b/i,
  /\bnot relevant\b/i,
  /\bwe (?:don'?t|do not) (?:use|need)\b/i,
  /\bunsubscribe\b/i,
  /\bstop (?:contacting|emailing)\b/i,
  /\bnot a good fit\b/i,
  /\bwrong (?:person|address)\b/i,
  /\btoo expensive\b/i,
  /\bwe already (?:use|have)\b/i,
];

const POSITIVE_PATTERNS = [
  /\binterested\b/i,
  /\bsounds good\b/i,
  /\blooks good\b/i,
  /\blet'?s (?:talk|chat|discuss|book|schedule|do)\b/i,
  /\bcan (?:i|we) (?:book|schedule|set up)\b/i,
  /\bsend (?:me |us )?(?:more|the|your) (?:info|details|information|pricing|quote)\b/i,
  /\bhow much (?:does|is|are|did|would)\b/i,
  /\bwhat does it cost\b/i,
  /\bpricing\b/i,
  /\bquote\b/i,
  /\bdemo\b/i,
  /\bavailable (?:for|to) (?:a )?(?:call|chat|meeting)\b/i,
  /\bkeep me posted\b/i,
  /\bsign(?:ed)? up\b/i,
];

const QUESTION_PATTERNS = [
  /\?/,
  /\bhow (?:does|do|can|much)\b/i,
  /\bwhat (?:is|are|does)\b/i,
  /\bwhen (?:is|can|do)\b/i,
  /\bcan you (?:tell|explain|send)\b/i,
  /\bdo you (?:support|offer|have)\b/i,
];

/**
 * Classifies how interested the sender is.
 *
 * Negative wins over positive: a message that says "not interested, but
 * please send pricing" is not a positive lead. A question is not a positive
 * lead either — it is engagement, which the inbox surfaces but the campaign
 * should not treat as a buying signal.
 */
export function classifyInterest(
  subject: string | null | undefined,
  body: string | null | undefined,
): Interest {
  const text = `${subject ?? ""}\n${body ?? ""}`;

  if (NEGATIVE_PATTERNS.some((re) => re.test(text))) return "negative";
  if (POSITIVE_PATTERNS.some((re) => re.test(text))) return "positive";
  if (QUESTION_PATTERNS.some((re) => re.test(text))) return "question";
  return "neutral";
}

/* -------------------------------------------------------------------------- */
/* Opportunities                                                               */
/* -------------------------------------------------------------------------- */

const OPPORTUNITY_PATTERNS = [
  /\bpricing\b/i,
  /\bquote\b/i,
  /\bhow much\b/i,
  /\bdemo\b/i,
  /\bbook a (?:call|meeting)\b/i,
  /\bavailable (?:for|to) (?:a )?(?:call|chat|meeting)\b/i,
  /\bbudget\b/i,
  /\bcontract\b/i,
  /\bprocurement\b/i,
];

/**
 * True when the message carries a buying signal worth a follow-up.
 *
 * Only positive-interest messages qualify: a pricing question from someone
 * who said they are not interested is not an opportunity.
 */
export function hasOpportunitySignal(
  interest: Interest,
  subject: string | null | undefined,
  body: string | null | undefined,
): boolean {
  if (interest !== "positive") return false;
  const text = `${subject ?? ""}\n${body ?? ""}`;
  return OPPORTUNITY_PATTERNS.some((re) => re.test(text));
}

/* -------------------------------------------------------------------------- */
/* Snippet                                                                     */
/* -------------------------------------------------------------------------- */

/** A short, single-line preview of a message body. */
export function buildSnippet(
  body: string | null | undefined,
  length = 200,
): string {
  if (!body) return "";
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
}

/* -------------------------------------------------------------------------- */
/* Keywords                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The keyword a reply is answering with.
 *
 * A reply like "yes" or "interested" contains the word a keyword sequence
 * is waiting for. Only single words are considered — a phrase in a sentence
 * is a topic, not an answer.
 */
export function extractKeyword(
  subject: string | null | undefined,
  body: string | null | undefined,
): string | null {
  const text = `${subject ?? ""}\n${body ?? ""}`.toLowerCase();

  // A short reply that is essentially one word.
  const trimmed = text.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (trimmed.length > 0 && trimmed.split(" ").length <= 3) {
    const first = trimmed.split(" ")[0]!;
    if (first.length >= 2 && first.length <= 20) return first;
  }

  return null;
}
