/**
 * Exercises the model-backed classifier against the live Ollama api.
 *
 * Needs LLM_API_KEY in the environment. It sends a handful of replies and
 * checks that the classifier answers the way it should — and that the cost
 * of doing so is what we expect.
 *
 *   bun run scripts/verify-llm.ts
 */

const API_KEY = process.env.LLM_API_KEY ?? "";
const BASE_URL = process.env.LLM_BASE_URL ?? "https://ollama.com";
const MODEL = process.env.LLM_MODEL ?? "clef:27b";
const MIN_CONFIDENCE = Number(
  process.env.LLM_CLASSIFY_MIN_CONFIDENCE ?? "0.7",
);

if (!API_KEY) {
  console.error(
    "LLM_API_KEY is not set. Add it to .env and run with the env loaded.",
  );
  process.exit(1);
}

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
    if (detail !== undefined) {
      console.log(`       ${JSON.stringify(detail)}`);
    }
  }
}

type Interest = "positive" | "negative" | "neutral" | "question";

interface Classification {
  interest: Interest;
  confidence: number;
  isOpportunity: boolean;
  summary: string | null;
  source: "rules" | "llm";
}

const INTEREST_CRITERIA: Record<Interest, string> = {
  positive:
    "The sender wants to hear more, is asking about price, a demo, a trial or a meeting, or says the offer sounds good.",
  negative:
    "The sender declines, says they are not interested, no longer need this, or asks to stop being contacted.",
  neutral:
    "The sender acknowledges the message without expressing interest or declining, or the message is about something else entirely.",
  question:
    "The sender asks for information or clarification but has not shown any intent to buy or to decline.",
};

const isDecisionModel = ["clef", "nimble", "tev", "clef-flash"].includes(
  MODEL.toLowerCase().split(":")[0]!,
);

async function classify(
  subject: string | null,
  body: string,
): Promise<{ result: Classification; inputTokens: number; outputTokens: number; ms: number }> {
  const started = Date.now();

  const state = [
    subject ? `Their reply has the subject: ${subject}` : "",
    "",
    body,
  ].join("\n");

  if (isDecisionModel) {
    const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/v1/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        state,
        questions: {
          interest: {
            type: "choice",
            instructions: "How interested is the sender in what we offered?",
            criteria: INTEREST_CRITERIA,
          },
          opportunity: {
            type: "noul",
            instructions:
              "Does the sender show a buying signal worth following up on?",
            criteria: {
              false: "No buying intent.",
              true:
                "Asked about pricing, a quote, a demo, a trial, a meeting, a contract, a budget, or procurement.",
            },
          },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(
        `systemone ${res.status}: ${(await res.text()).slice(0, 400)}`,
      );
    }

    const json: any = await res.json();
    const answer = json.answers?.interest;
    const opportunity = json.answers?.opportunity;

    return {
      result: {
        interest: answer?.choice ?? "neutral",
        confidence: answer?.confidence ?? 0,
        isOpportunity: (opportunity?.noul ?? 0) >= 0.5,
        summary: null,
        source: "llm",
      },
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
      ms: Date.now() - started,
    };
  }

  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You classify replies to cold sales emails. Reply with one JSON object: {"interest":"positive|negative|neutral|question","confidence":0.0-1.0,"isOpportunity":true|false,"summary":"one short sentence"}',
        },
        { role: "user", content: state },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }

  const json: any = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  const parsed = start >= 0 && end > start ? JSON.parse(content.slice(start, end + 1)) : {};

  return {
    result: {
      interest: parsed.interest ?? "neutral",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      isOpportunity: parsed.isOpportunity === true,
      summary: parsed.summary ?? null,
      source: "llm",
    },
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
    ms: Date.now() - started,
  };
}

const CASES: Array<{
  name: string;
  subject: string | null;
  body: string;
  expect: Interest | null;
  expectOpportunity?: boolean;
}> = [
  {
    name: "a buying signal",
    subject: "Re: quick question about pricing",
    body: "Hi,\n\nThat sounds interesting. Could you send me pricing for 50 seats and what the onboarding looks like?\n\nPriya",
    expect: "positive",
    expectOpportunity: true,
  },
  {
    name: "a clear rejection",
    subject: "Re: quick question",
    body: "Thanks for reaching out, but we are not interested at this time.\n\nBest",
    expect: "negative",
    expectOpportunity: false,
  },
  {
    name: "a meeting request",
    subject: "Re: your email",
    body: "Hey — yes let's talk. Are you free Thursday afternoon?",
    expect: "positive",
    expectOpportunity: true,
  },
  {
    name: "a plain question",
    subject: "Re: your email",
    body: "Do you support on-premise deployments?",
    expect: null,
  },
  {
    name: "an acknowledgement",
    subject: "Re: your email",
    body: "Got it, thanks. Will take a look and get back to you.",
    expect: null,
  },
];

async function main() {
  console.log(`\nmodel: ${MODEL}`);
  console.log(`api:   ${BASE_URL}`);
  console.log(`mode:  ${isDecisionModel ? "decision (/v1/systemone)" : "chat (/v1/chat/completions)"}`);

  let totalIn = 0;
  let totalOut = 0;

  for (const testCase of CASES) {
    console.log(`\n${testCase.name}`);

    let outcome: Awaited<ReturnType<typeof classify>>;
    try {
      outcome = await classify(testCase.subject, testCase.body);
    } catch (error) {
      check(
        "the model answered",
        false,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    totalIn += outcome.inputTokens;
    totalOut += outcome.outputTokens;

    console.log(
      `  → ${outcome.result.interest} (confidence ${outcome.result.confidence.toFixed(2)})` +
        `, opportunity=${outcome.result.isOpportunity}` +
        `, ${outcome.inputTokens} in / ${outcome.outputTokens} out` +
        `, ${outcome.ms}ms`,
    );

    if (testCase.expect) {
      check(
        `classified as ${testCase.expect}`,
        outcome.result.interest === testCase.expect,
        outcome.result.interest,
      );
    }

    if (testCase.expectOpportunity !== undefined) {
      check(
        `opportunity = ${testCase.expectOpportunity}`,
        outcome.result.isOpportunity === testCase.expectOpportunity,
        outcome.result.isOpportunity,
      );
    }

    check(
      "the confidence is in range",
      outcome.result.confidence >= 0 && outcome.result.confidence <= 1,
      outcome.result.confidence,
    );
  }

  console.log(`\ntotal: ${totalIn} input tokens, ${totalOut} output tokens`);
  console.log(
    `threshold: ${MIN_CONFIDENCE} — an answer below it is not acted on, and the reply is left for a human`,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
