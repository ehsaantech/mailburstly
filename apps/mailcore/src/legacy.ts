/**
 * The legacy engine.
 *
 * A mailbox connected before the cutover keeps the account id the old engine
 * gave it, and its tokens live in that engine's vault — not in mailcore's.
 * mailcore cannot send for such an account on its own, so a request for an
 * account it does not own is forwarded to the legacy engine instead of
 * failing.
 *
 * The response is passed back untouched, so a caller (api, worker,
 * dispatcher) cannot tell whether a send was handled by mailcore or by the
 * engine that still holds the account.
 *
 * The fallback is off until `MAILCORE_LEGACY_URL` is set: once every mailbox
 * has been re-consented through mailcore, the legacy engine is removed and
 * the variable goes away with it.
 */
import { env } from "./env";

export async function forwardToLegacy(
  path: string,
  method: string,
  body: unknown,
): Promise<Response | null> {
  if (!env.MAILCORE_LEGACY_URL) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.MAILCORE_LEGACY_TOKEN) {
    headers.Authorization = `Bearer ${env.MAILCORE_LEGACY_TOKEN}`;
  }

  try {
    const res = await fetch(`${env.MAILCORE_LEGACY_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // A 404 means the legacy engine does not own the account either.
    if (res.status === 404) return null;
    return res;
  } catch {
    return null;
  }
}

/** The accounts the legacy engine still holds, in mailcore's own shape. */
export async function legacyAccounts(): Promise<
  {
    account: string;
    email: string;
    name: string | null;
    type: string;
    state: string;
    source: string;
  }[]
> {
  if (!env.MAILCORE_LEGACY_URL) return [];

  try {
    const res = await fetch(`${env.MAILCORE_LEGACY_URL}/v1/accounts`, {
      headers: env.MAILCORE_LEGACY_TOKEN
        ? { Authorization: `Bearer ${env.MAILCORE_LEGACY_TOKEN}` }
        : {},
    });
    if (!res.ok) return [];
    const payload = (await res.json()) as {
      accounts?: {
        account: string;
        email: string;
        name?: string;
        type: string;
        state: string;
      }[];
    };
    return (payload.accounts ?? []).map((a) => ({
      account: a.account,
      email: a.email,
      name: a.name ?? null,
      type: a.type,
      state: a.state,
      source: "legacy",
    }));
  } catch {
    return [];
  }
}
