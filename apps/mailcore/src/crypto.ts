/**
 * The token vault.
 *
 * OAuth refresh tokens are long-lived credentials for a mailbox. They are
 * encrypted at rest with AES-256-GCM so a database dump is not a list of
 * live credentials, and they never leave this process except to the
 * provider that issued them.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.MAILCORE_ENCRYPTION_KEY ?? "";
  if (!raw) {
    // Dev fallback: a fixed key, so a restart does not orphan the tokens.
    cachedKey = Buffer.alloc(32, 7);
    return cachedKey;
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    throw new Error(
      `MAILCORE_ENCRYPTION_KEY must decode to 32 bytes, got ${decoded.length}`,
    );
  }
  cachedKey = decoded;
  return cachedKey;
}

/** Encrypt a token. The nonce is stored with the ciphertext. */
export function seal(plaintext: string): string {
  if (!plaintext) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Decrypt a token. Returns "" for an empty input.
 *
 * Two ciphertext layouts are accepted, because a vault written by the first
 * implementation of this service put the auth tag last, and this one puts it
 * before the ciphertext. Both are tried; a value that is not a ciphertext at
 * all (a placeholder for a manual account, say) is returned unchanged.
 */
export function open(blob: string): string {
  if (!blob) return "";
  const raw = Buffer.from(blob, "base64");
  if (raw.length < 28) return blob;

  const iv = raw.subarray(0, 12);
  const layouts: { tag: Buffer; data: Buffer }[] = [
    // tag before the ciphertext (this implementation)
    { tag: raw.subarray(12, 28), data: raw.subarray(28) },
    // tag after the ciphertext (the first implementation)
    { tag: raw.subarray(raw.length - 16), data: raw.subarray(12, raw.length - 16) },
  ];

  for (const layout of layouts) {
    try {
      const decipher = createDecipheriv(ALGO, key(), iv);
      decipher.setAuthTag(layout.tag);
      return Buffer.concat([
        decipher.update(layout.data),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // try the next layout
    }
  }
  return blob;
}
