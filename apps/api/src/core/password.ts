/**
 * Password hashing.
 *
 * Bun ships argon2id natively, so no bcrypt/argon2 package is needed and the
 * defaults below are the OWASP-recommended cost parameters.
 */

const ARGON2_OPTIONS = {
  algorithm: "argon2id" as const,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
};

export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, ARGON2_OPTIONS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  // A malformed stored hash must read as "wrong password", not as a server
  // error: Bun.password.verify throws on input it cannot parse.
  return Bun.password.verify(plain, hash).catch(() => false);
}