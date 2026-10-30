import { describe, expect, test } from "bun:test";
import { emailFromToken, tokenForEmail } from "./unsubscribe";

describe("unsubscribe tokens", () => {
  test("round-trips the recipient", () => {
    const email = "haroon@yopmail.com";
    expect(emailFromToken(tokenForEmail(email))).toBe(email);
  });

  test("lowercases the address", () => {
    const email = "Haroon@Yopmail.com";
    expect(emailFromToken(tokenForEmail(email))).toBe("haroon@yopmail.com");
  });

  test("refuses a token with a broken signature", () => {
    const token = tokenForEmail("haroon@yopmail.com");
    const [payload, signature] = token.split(".");
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    expect(emailFromToken(`${payload}.${flipped}`)).toBeNull();
  });

  test("refuses a token whose payload was swapped", () => {
    const token = tokenForEmail("haroon@yopmail.com");
    const [, signature] = token.split(".");
    const forged = Buffer.from("someone@else.com").toString("base64url");
    expect(emailFromToken(`${forged}.${signature}`)).toBeNull();
  });

  test("refuses junk", () => {
    expect(emailFromToken("")).toBeNull();
    expect(emailFromToken("nodot")).toBeNull();
    expect(emailFromToken("bm9uZQ.bm90YXNpZ25hdHVyZQ")).toBeNull();
  });
});
