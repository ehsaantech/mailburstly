import { createHash, randomBytes } from "node:crypto";

import type { AuthUser, SessionRecord } from "@mailrung/shared";

import { fromPostgresError, unauthorized } from "@/core/errors";
import { verifyPassword } from "@/core/password";
import { env } from "@/env";
import { type LoginInput } from "./validator";

export interface AuthServiceDeps {
  repository: ReturnType<typeof import("./repository").createUserRepository>;
  /** Injectable so tests can assert or freeze the clock. */
  now?: () => Date;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

interface AuthResult {
  user: AuthUser;
  session: SessionRecord;
  /** Raw token. Only ever leaves this file, to be set as a cookie. */
  token: string;
}

export function createAuthService({ repository, now }: AuthServiceDeps) {
  const at = now ?? (() => new Date());

  const service = {
    /**
     * Verify credentials, mint a session, and return everything the
     * controller needs to set the cookie.
     *
     * Note the timing discipline: an unknown email and a wrong password both
     * spend the same amount of work, so the two cases are not distinguishable
     * by latency.
     */
    async login(input: LoginInput): Promise<AuthResult> {
      const user = await repository.findUserByEmail(input.email);

      // Always hash once, even when the user does not exist, so a missing
      // address costs the same as a wrong password. This must be a real
      // argon2id hash: Bun.password.verify throws on malformed input, which
      // would turn a typo'd email into a 500 instead of a 401.
      const stored =
        user?.passwordHash ??
        "$argon2id$v=19$m=19456,t=2,p=1$+yo+MCugMhKFSU8Ki5SXfYhNdq+jcAdFhyDavgodSVw$PSHBdd3M6A6s0bIkefLICuoN/3kRUoJvGM3ck5KSY2s";
      const valid = await verifyPassword(input.password, stored);

      if (!user || !valid) {
        throw unauthorized("Incorrect email or password");
      }

      const expiresAt = new Date(
        at().getTime() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
      );

      const token = generateSessionToken();

      let session;
      try {
        session = await repository.insertSession({
          userId: user.id,
          tokenHash: hashSessionToken(token),
          expiresAt,
        });
      } catch (error) {
        throw fromPostgresError(error);
      }

      await repository.touchLastLogin(user.id);

      return {
        user: { id: user.id, email: user.email, name: user.name, role: user.role as AuthUser["role"] },
        session: {
          id: session.id,
          userId: session.userId,
          expiresAt: session.expiresAt.toISOString(),
        },
        token,
      };
    },

    async logout(token: string): Promise<void> {
      await repository.deleteSession(hashSessionToken(token));
    },

    /** Return the user for a token, or null. Used by `requireAuth`. */
    async authenticate(
      token: string,
    ): Promise<{ user: AuthUser; session: SessionRecord } | null> {
      const found = await repository.findActiveSession(hashSessionToken(token));
      if (!found) return null;

      return {
        user: found.user,
        session: {
          id: found.session.id,
          userId: found.session.userId,
          expiresAt: found.session.expiresAt.toISOString(),
        },
      };
    },
  };

  return service;
}

export type AuthService = ReturnType<typeof createAuthService>;