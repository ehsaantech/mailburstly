/**
 * The one-click unsubscribe token.
 *
 * `List-Unsubscribe` has to carry a URL that identifies *which* recipient is
 * unsubscribing — one link per message, not one per campaign. The link is
 * served by mailcore (`/u/{token}`), so mailcore has to be able to read the
 * recipient back out of it when the link is followed.
 *
 * A signed token does that without a database: the email is the payload, and
 * an HMAC over it proves the token was minted here. A token that was not
 * minted here is refused, so nobody can unsubscribe somebody else by
 * guessing their address.
 *
 * The format is `base64url(email).base64url(hmac)`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { secretKey } from "./crypto";

/** The email address a token stands for, or null when the token is not ours. */
export function emailFromToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let email: string;
  try {
    email = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!email.includes("@")) return null;

  const expected = Buffer.from(sign(email));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;

  return email.toLowerCase();
}

/** The token for an email address. */
export function tokenForEmail(email: string): string {
  const payload = Buffer.from(email.toLowerCase(), "utf8").toString("base64url");
  return `${payload}.${sign(email.toLowerCase())}`;
}

function sign(email: string): string {
  return createHmac("sha256", secretKey())
    .update(email.toLowerCase())
    .digest("base64url");
}
