import { conflict, notFound } from "@/core/errors";
import type { Logger } from "@/core/logger";
import { getAlerter, invalidateRecipients } from "@/lib/alerts";
import {
  createAlertRecipientsRepository,
  type AlertRecipientRow,
} from "./repository";
import type {
  CreateAlertRecipientInput,
  UpdateAlertRecipientInput,
} from "./validator";

export interface AlertRecipientsServiceDeps {
  db: { db: Parameters<typeof createAlertRecipientsRepository>[0]["db"] };
  log: Logger;
  /** The workspace whose recipients are managed. */
  workspaceId: () => Promise<string>;
}

export function createAlertRecipientsService(deps: AlertRecipientsServiceDeps) {
  const repository = createAlertRecipientsRepository({ db: deps.db.db });

  async function requireRow(id: string): Promise<AlertRecipientRow> {
    const row = await repository.byId(await deps.workspaceId(), id);
    if (!row) throw notFound("Alert recipient");
    return row;
  }

  return {
    async list(): Promise<AlertRecipientRow[]> {
      return repository.list(await deps.workspaceId());
    },

    async get(id: string): Promise<AlertRecipientRow> {
      return requireRow(id);
    },

    async create(input: CreateAlertRecipientInput): Promise<AlertRecipientRow> {
      const workspaceId = await deps.workspaceId();

      const existing = await repository
        .list(workspaceId)
        .then((rows) => rows.find((row) => row.email === input.email));

      if (existing) {
        throw conflict("That address is already an alert recipient");
      }

      const row = await repository.create(workspaceId, {
        email: input.email,
        name: input.name ?? null,
        severity: input.severity,
        enabled: input.enabled,
      });

      invalidateRecipients();
      deps.log.info("alert recipient added", { email: row.email });
      return row;
    },

    async update(
      id: string,
      input: UpdateAlertRecipientInput,
    ): Promise<AlertRecipientRow> {
      await requireRow(id);

      const row = await repository.update(await deps.workspaceId(), id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      });

      if (!row) throw notFound("Alert recipient");

      invalidateRecipients();
      deps.log.info("alert recipient updated", { email: row.email });
      return row;
    },

    async remove(id: string): Promise<void> {
      const row = await requireRow(id);
      await repository.remove(await deps.workspaceId(), id);
      invalidateRecipients();
      deps.log.info("alert recipient removed", { email: row.email });
    },

    /**
     * Sends a test alert to one recipient.
     *
     * This is the operator's own address, entered by the operator, so it is
     * the one kind of test send that goes somewhere real — it is how the
     * resend key and the sending domain are proven to work.
     */
    async test(id: string): Promise<{ delivered: boolean }> {
      const row = await requireRow(id);
      const alerter = getAlerter();

      if (!alerter || !alerter.enabled) {
        throw conflict(
          "Alerting is off. Set RESEND_API_KEY and ALERT_ENABLED to send a test.",
        );
      }

      const delivered = await alerter.alertNow({
        key: "alert_recipient.test",
        title: "Mailrung alert test",
        message:
          "This is a test of the alerting path. If you are reading it, the sender, the key and this address all work.",
        severity: "warning",
        service: "api",
        to: [row.email],
      });

      deps.log.info("alert test sent", { email: row.email, delivered });
      return { delivered };
    },
  };
}

export type AlertRecipientsService = ReturnType<
  typeof createAlertRecipientsService
>;
