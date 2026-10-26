import { fromPostgresError, notFound } from "@/core/errors";
import type { DbHandle } from "@/db";
import type { MailboxSummary } from "@mailrung/shared";
import {
  createMailboxRepository,
  toSummary,
  type MailboxRow,
} from "./repository";
import type { CreateMailboxInput, UpdateMailboxInput } from "./validator";
import {
  generateAuthForm,
  getAccount,
  healthFromState,
  isHealthyState,
  providerFromAccountType,
} from "@/lib/emailengine";
import { env } from "@/env";

export interface MailboxServiceDeps {
  db: DbHandle;
  /** Single-tenant for now: one workspace id, resolved at boot. */
  workspaceId: string | (() => Promise<string>);
}

export function createMailboxService(deps: MailboxServiceDeps) {
  const repository = createMailboxRepository({ db: deps.db.db });

  const workspaceId = async (): Promise<string> =>
    typeof deps.workspaceId === "function"
      ? deps.workspaceId()
      : deps.workspaceId;

  const requireRow = async (
    workspaceId: string,
    id: string,
  ): Promise<MailboxRow> => {
    const row = await repository.byId(workspaceId, id);
    if (!row) throw notFound("Mailbox");
    return row;
  };

  return {
    async list(): Promise<MailboxSummary[]> {
      const rows = await repository.list(await workspaceId());
      return rows.map(toSummary);
    },

    async get(id: string): Promise<MailboxSummary> {
      const row = await requireRow(await workspaceId(), id);
      return toSummary(row);
    },

    /**
     * Creating a mailbox via this route registers a hand-rolled SMTP/IMAP
     * account. The OAuth flows land in their own commit and will call into
     * EmailEngine to mint `emailengineId`; until then it is a placeholder.
     */
    async create(input: CreateMailboxInput): Promise<MailboxSummary> {
      let row;
      try {
        row = await repository.create({
          workspaceId: await workspaceId(),
          email: input.email.toLowerCase(),
          displayName: input.displayName ?? null,
          provider: input.provider,
          // Real EmailEngine registration replaces this; a stub keeps the
          // NOT NULL constraint satisfied so the schema does not lie.
          emailengineId: "pending",
          dailyCap: input.dailyCap,
          tags: input.tags,
        });
      } catch (error) {
        throw fromPostgresError(error);
      }
      return toSummary(row);
    },

    async update(id: string, patch: UpdateMailboxInput): Promise<MailboxSummary> {
      const current = await requireRow(await workspaceId(), id);
      const updated = await repository.update(await workspaceId(), current.id, {
        displayName: patch.displayName,
        dailyCap: patch.dailyCap,
        replyTo: patch.replyTo,
        tags: patch.tags,
      });
      if (!updated) throw notFound("Mailbox");
      return toSummary(updated);
    },

    async remove(id: string): Promise<void> {
      const current = await requireRow(await workspaceId(), id);
      await repository.remove(await workspaceId(), current.id);
    },

    /**
     * Start a hosted OAuth flow via EmailEngine.
     *
     * We generate our own UUID up front and reuse it as EmailEngine's
     * account id, so the two systems always agree on who owns a mailbox.
     * Nothing is persisted yet — the mailbox row is created in `callback`,
     * once the user has actually consented. Abandoned flows simply expire
     * (EmailEngine's form URLs are single-use and valid for 24h).
     */
    async connect(input: ConnectMailboxInput): Promise<ConnectResult> {
      const accountId = crypto.randomUUID();

      const oauthAppId =
        input.provider === "google"
          ? env.GOOGLE_OAUTH_APP_ID
          : input.provider === "microsoft"
            ? env.MICROSOFT_OAUTH_APP_ID
            : "";

      const redirectUrl = `${env.PUBLIC_URL}/mailboxes/callback`;

      const form = await generateAuthForm({
        account: accountId,
        email: input.email,
        expectedEmail: input.email,
        name: input.displayName,
        type: oauthAppId || undefined,
        redirectUrl,
      });

      return { url: form.url, accountId };
    },

    /**
     * Finalise a hosted auth flow.
     *
     * EmailEngine redirects to our frontend with `?account=...&state=new`,
     * which forwards the params here. We fetch the account from EmailEngine,
     * create (or update) our mailbox row, and compute an initial health score
     * from the connection state.
     */
    async callback(input: CallbackInput): Promise<MailboxSummary> {
      const account = await getAccount(input.account);

      const provider = providerFromAccountType(account.type);
      const healthScore = healthFromState(account.state);
      const status = isHealthyState(account.state) ? "connected" : "failed";

      const existing = await repository.byEmailengineId(input.account);

      if (existing) {
        const wsId = await workspaceId();
        const updated = await repository.update(wsId, existing.id, {
          displayName: account.name ?? existing.displayName,
          tags: existing.tags,
          status: status as MailboxRow["status"],
          healthScore,
        });
        if (!updated) throw notFound("Mailbox");
        const refreshed = await repository.byEmailengineId(input.account);
        if (!refreshed) throw notFound("Mailbox");
        return toSummary(refreshed);
      }

      const wsId = await workspaceId();

      let row: MailboxRow;
      try {
        row = await repository.create({
          workspaceId: wsId,
          email: account.email.toLowerCase(),
          displayName: account.name ?? null,
          provider,
          emailengineId: input.account,
          dailyCap: 30,
          tags: [],
        });
      } catch (error) {
        throw fromPostgresError(error);
      }

      // Persist the computed health + status. The repository's create does not
      // take these, so we update immediately — a tiny window where a row exists
      // with default values, which is acceptable for a single-tenant M1.
      const updated = await repository.update(wsId, row.id, {
        displayName: account.name ?? row.displayName,
        status: status as MailboxRow["status"],
        healthScore,
      });
      const finalRow = updated ?? row;

      return toSummary(finalRow);
    },
  };
}

export type MailboxService = ReturnType<typeof createMailboxService>;

export interface ConnectMailboxInput {
  provider: "google" | "microsoft" | "imap_smtp";
  email?: string;
  displayName?: string;
}

export interface ConnectResult {
  /** EmailEngine hosted auth URL. Redirect the browser here. */
  url: string;
  /** Our account id, reused as EmailEngine's account id. */
  accountId: string;
}

export interface CallbackInput {
  account: string;
  state: "new" | "existing";
}