import { describe, expect, test } from "bun:test";

import { createClassificationService } from "./service";
import type { Logger } from "@/core/logger";

const silent: Logger = {
  child: () => silent,
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A service with no API key: the rules answer everything. */
function rulesService() {
  return createClassificationService({
    log: silent,
    apiKey: "",
    baseUrl: "https://ollama.com",
    model: "clef:27b",
    minConfidence: 0.7,
  });
}

/* -------------------------------------------------------------------------- */
/* No model configured                                                         */
/* -------------------------------------------------------------------------- */

describe("with no model configured", () => {
  test("the rules answer", async () => {
    const service = rulesService();
    expect(service.enabled).toBe(false);

    const result = await service.classify({
      subject: "Re: your email",
      body: "I'm interested, send me pricing",
    });

    expect(result.source).toBe("rules");
    expect(result.interest).toBe("positive");
    expect(result.applicable).toBe(true);
  });

  test("a rejection is caught by the rules", async () => {
    const result = await rulesService().classify({
      subject: "Re: your email",
      body: "Not interested, thanks",
    });
    expect(result.interest).toBe("negative");
  });
});

/* -------------------------------------------------------------------------- */
/* Structural signals                                                          */
/* -------------------------------------------------------------------------- */

describe("structural signals", () => {
  test("an out-of-office is decided without a model", async () => {
    const result = await rulesService().classify({
      subject: "Out of Office",
      body: "I am away until next month",
    });
    expect(result.reason).toBe("structural");
    expect(result.interest).toBe("neutral");
    expect(result.applicable).toBe(true);
  });

  test("an unsubscribe is decided without a model", async () => {
    const result = await rulesService().classify({
      subject: "Re: your email",
      body: "Please unsubscribe me from this list.",
    });
    expect(result.reason).toBe("structural");
    expect(result.interest).toBe("negative");
    expect(result.applicable).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* A model that fails                                                         */
/* -------------------------------------------------------------------------- */

describe("when the model fails", () => {
  test("the rules answer and the reply is still usable", async () => {
    const service = createClassificationService({
      log: silent,
      // A key that cannot reach anything.
      apiKey: "not-a-real-key",
      baseUrl: "http://127.0.0.1:1",
      model: "clef:27b",
      minConfidence: 0.7,
      timeoutMs: 1000,
    });

    const result = await service.classify({
      subject: "Re: your email",
      body: "I'm interested, send me pricing",
    });

    expect(result.source).toBe("rules");
    expect(result.interest).toBe("positive");
    expect(result.applicable).toBe(true);
  });
});
