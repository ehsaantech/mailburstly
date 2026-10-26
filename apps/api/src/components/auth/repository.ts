import { and, eq, gt } from "drizzle-orm";

import {
  sessions,
  users,
  type Database,
} from "@mailrung/db";
import type { AuthUser } from "@mailrung/shared";

/**
 * Auth db layer.
 *
 * No business logic here — SQL only. The service layer is what decides whether
 * a password is correct or a session is expired; this file just fetches and
 * writes rows.
 */

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  passwordHash: string;
}

export interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export type UserRepositoryDeps = { db: Database };

export function createUserRepository({ db }: UserRepositoryDeps) {
  return {
    async findUserByEmail(email: string): Promise<UserRow | null> {
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      return rows[0] ?? null;
    },

    async touchLastLogin(id: string): Promise<void> {
      await db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, id));
    },

    async insertSession(row: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      userAgent?: string;
      ip?: string;
    }): Promise<SessionRow> {
      const [created] = await db
        .insert(sessions)
        .values(row)
        .returning({
          id: sessions.id,
          userId: sessions.userId,
          tokenHash: sessions.tokenHash,
          expiresAt: sessions.expiresAt,
        });
      if (!created) throw new Error("insertSession returned no row");
      return { ...created, expiresAt: created.expiresAt ?? row.expiresAt };
    },

    /**
     * Resolve a valid session. The expiry clause is part of the WHERE so an
     * expired session and a missing session behave identically.
     */
    async findActiveSession(
      tokenHash: string,
    ): Promise<{ session: SessionRow; user: AuthUser } | null> {
      const rows = await db
        .select({
          sessionId: sessions.id,
          userId: sessions.userId,
          tokenHash: sessions.tokenHash,
          expiresAt: sessions.expiresAt,
          user: {
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
          },
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())),
        )
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      return {
        session: {
          id: row.sessionId,
          userId: row.userId,
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
        },
        user: row.user as AuthUser,
      };
    },

    async deleteSession(tokenHash: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
  };
}