import { describe, expect, test } from "bun:test";

import {
  buildDecisionState,
  isDecisionModel,
  parseChatResponse,
  parseSystemOneResponse,
} from "./ollama";

/* -------------------------------------------------------------------------- */
/* Model routing                                                               */
/* -------------------------------------------------------------------------- */

describe("isDecisionModel", () => {
  test("recognises the decision models", () => {
    expect(isDecisionModel("clef:27b")).toBe(true);
    expect(isDecisionModel("clef")).toBe(true);
    expect(isDecisionModel("clef-flash")).toBe(true);
    expect(isDecisionModel("nimble")).toBe(true);
    expect(isDecisionModel("tev")).toBe(true);
  });

  test("a chat model is not a decision model", () => {
    expect(isDecisionModel("gpt-oss:20b")).toBe(false);
    expect(isDecisionModel("nemotron-3-super")).toBe(false);
    expect(isDecisionModel("gemma4:31b")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The decision path                                                           */
/* -------------------------------------------------------------------------- */

describe("parseSystemOneResponse", () => {
  const good = {
    model: "clef:27b",
    answers: {
      interest: {
        type: "choice",
        choice: "positive",
        probabilities: {
          positive: 0.91,
          negative: 0.02,
          neutral: 0.05,
          question: 0.02,
        },
        confidence: 0.86,
      },
      opportunity: { type: "noul", noul: 0.88 },
    },
    usage: { input_tokens: 412, output_tokens: 1 },
  };

  test("reads the choice and the confidence", () => {
    const parsed = parseSystemOneResponse(good as never);
    expect(parsed).not.toBeNull();
    expect(parsed!.interest).toBe("positive");
    expect(parsed!.confidence).toBeCloseTo(0.86, 5);
  });

  test("an opportunity probability of 0.5 or more is an opportunity", () => {
    expect(parseSystemOneResponse(good as never)!.isOpportunity).toBe(true);
  });

  test("a low opportunity probability is not an opportunity", () => {
    const body = {
      ...good,
      answers: { ...good.answers, opportunity: { type: "noul", noul: 0.2 } },
    };
    expect(parseSystemOneResponse(body as never)!.isOpportunity).toBe(false);
  });

  test("a missing opportunity answer is not an opportunity", () => {
    const body = { ...good, answers: { interest: good.answers.interest } };
    expect(parseSystemOneResponse(body as never)!.isOpportunity).toBe(false);
  });

  test("an unknown label is rejected", () => {
    const body = {
      ...good,
      answers: {
        ...good.answers,
        interest: { ...good.answers.interest, choice: "enthusiastic" },
      },
    };
    expect(parseSystemOneResponse(body as never)).toBeNull();
  });

  test("a missing answer is rejected", () => {
    expect(parseSystemOneResponse({} as never)).toBeNull();
    expect(parseSystemOneResponse({ answers: {} } as never)).toBeNull();
  });

  test("the confidence is clamped to 0-1", () => {
    const body = {
      ...good,
      answers: {
        ...good.answers,
        interest: { ...good.answers.interest, confidence: 4.2 },
      },
    };
    expect(parseSystemOneResponse(body as never)!.confidence).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The chat path                                                               */
/* -------------------------------------------------------------------------- */

describe("parseChatResponse", () => {
  test("reads a clean json answer", () => {
    const parsed = parseChatResponse(
      '{"interest":"positive","confidence":0.82,"isOpportunity":true,"summary":"Wants pricing for 50 seats"}',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.interest).toBe("positive");
    expect(parsed!.confidence).toBeCloseTo(0.82, 5);
    expect(parsed!.isOpportunity).toBe(true);
    expect(parsed!.summary).toBe("Wants pricing for 50 seats");
  });

  test("reads json wrapped in prose", () => {
    const parsed = parseChatResponse(
      'Sure! Here you go:\n{"interest":"negative","confidence":0.9,"isOpportunity":false,"summary":"Declined"}\nHope that helps.',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.interest).toBe("negative");
  });

  test("reads json with nested braces", () => {
    const parsed = parseChatResponse(
      '{"interest":"neutral","confidence":0.5,"isOpportunity":false,"summary":"Said \\"hi\\"","meta":{"a":1}}',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.interest).toBe("neutral");
  });

  test("an unknown interest is rejected", () => {
    expect(
      parseChatResponse('{"interest":"excited","confidence":0.9}'),
    ).toBeNull();
  });

  test("prose with no json is rejected", () => {
    expect(parseChatResponse("I am not sure about this one.")).toBeNull();
  });

  test("malformed json is rejected", () => {
    expect(parseChatResponse('{"interest":')).toBeNull();
  });

  test("a missing confidence defaults to a middling one", () => {
    const parsed = parseChatResponse('{"interest":"positive","isOpportunity":false}');
    expect(parsed!.confidence).toBe(0.5);
  });

  test("a boolean-ish isOpportunity is accepted", () => {
    const parsed = parseChatResponse(
      '{"interest":"positive","confidence":0.8,"isOpportunity":"true"}',
    );
    expect(parsed!.isOpportunity).toBe(true);
  });

  test("a missing summary becomes null", () => {
    const parsed = parseChatResponse('{"interest":"neutral","confidence":0.5}');
    expect(parsed!.summary).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The state                                                                   */
/* -------------------------------------------------------------------------- */

describe("buildDecisionState", () => {
  test("includes the subject and the body", () => {
    const state = buildDecisionState({
      subject: "Re: pricing",
      body: "How much is it?",
    });
    expect(state).toContain("Re: pricing");
    expect(state).toContain("How much is it?");
  });

  test("includes the subject we sent, when there is one", () => {
    const state = buildDecisionState({
      subject: "Re: pricing",
      body: "How much is it?",
      originalSubject: "Quick question about pricing",
    });
    expect(state).toContain("Quick question about pricing");
  });

  test("works without a subject", () => {
    const state = buildDecisionState({ subject: null, body: "Hello" });
    expect(state).toContain("Hello");
  });
});
