import { badRequest, fromPostgresError, notFound } from "@/core/errors";
import type { DbHandle } from "@/db";
import type { MailboxSummary } from "@mailrung/shared";
import {
  createMailboxRepository,
  toSummary,
  type MailboxRow,
} from "./repository";
import type { CreateMailboxInput, UpdateMailboxInput } from "./validator";
import {
  createManualAccount,
  generateAuthForm,
  getAccount,
  healthFromState,
  isHealthyState,
  providerFromAccountType,
  submitMessage,
  verifyAccount,
} from "@/lib/mailcore";
import { env } from "@/env";
import { raiseAlert } from "@/lib/alerts";

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
     * mailcore to mint `mailcoreAccountId`; until then it is a placeholder.
     */
    async create(input: CreateMailboxInput): Promise<MailboxSummary> {
      const wsId = await workspaceId();
      // Manual IMAP/SMTP mailbox: verify first, then register with mailcore.
      if (input.provider === "imap_smtp") {
        if (!input.imap || !input.smtp) throw badRequest("IMAP and SMTP settings required");
        const accountId = crypto.randomUUID();
        const verification = await verifyAccount({
          imap: input.imap as any,
          smtp: input.smtp as any,
        });
        if (!verification.imap || !verification.smtp) {
          throw badRequest(
            `Verification failed (imap=${verification.imap}, smtp=${verification.smtp})`,
          );
        }
        await createManualAccount({
          account: accountId,
          email: input.email,
          name: input.displayName,
          imap: input.imap as Record<string, unknown>,
          smtp: input.smtp as Record<string, unknown>,
        });
        let row;
        try {
          row = await repository.create({
            workspaceId: wsId,
            email: input.email.toLowerCase(),
            displayName: input.displayName ?? null,
            provider: "imap_smtp",
            mailcoreAccountId: accountId,
            dailyCap: input.dailyCap,
            tags: input.tags,
          });
        } catch (error) {
          throw fromPostgresError(error);
        }
        const updated = await repository.update(wsId, row.id, {
          status: "connected" as MailboxRow["status"],
          healthScore: 95,
        });
        return toSummary(updated ?? row);
      }
      let row;
      try {
        row = await repository.create({
          workspaceId: wsId,
          email: input.email.toLowerCase(),
          displayName: input.displayName ?? null,
          provider: input.provider,
          mailcoreAccountId: "pending",
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
     * Start a hosted OAuth flow via mailcore.
     *
     * We generate our own UUID up front and reuse it as mailcore's
     * account id, so the two systems always agree on who owns a mailbox.
     * Nothing is persisted yet — the mailbox row is created in `callback`,
     * once the user has actually consented. Abandoned flows simply expire
     * (mailcore's form URLs are single-use and valid for 24h).
     */
    async connect(input: ConnectMailboxInput): Promise<ConnectResult> {
      const accountId = crypto.randomUUID();

      const redirectUrl = `${env.PUBLIC_URL}/mailboxes/callback`;

      const form = await generateAuthForm({
        account: accountId,
        email: input.email,
        expectedEmail: input.email,
        name: input.displayName,
        provider: input.provider,
        redirectUrl,
      });

      return { url: form.url, accountId };
    },

    /**
     * Finalise a hosted auth flow.
     *
     * mailcore redirects to our frontend with `?account=...&state=new`,
     * which forwards the params here. We fetch the account from mailcore,
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
          mailcoreAccountId: input.account,
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

    async testSend(
      id: string,
      input: { to: string; subject: string; text?: string; html?: string },
    ): Promise<{ messageId: string; queueId?: string }> {
      const current = await requireRow(await workspaceId(), id);

      try {
        const result = await submitMessage(current.mailcoreAccountId, {
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
        });
        return result;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);

        void raiseAlert({
          key: "api.mailbox_test_send_failed",
          title: "A mailbox test send failed",
          message: detail,
          severity: "error",
          service: "api",
          context: { mailbox: current.email, to: input.to, error: detail },
        });

        throw error;
      }
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
  /** mailcore hosted auth URL. Redirect the browser here. */
  url: string;
  /** Our account id, reused as mailcore's account id. */
  accountId: string;
}

export interface CallbackInput {
  account: string;
  state: "new" | "existing";
}