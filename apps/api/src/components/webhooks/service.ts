import { createHash, randomBytes } from "node:crypto";

import { notFound } from "@/core/errors";
import type { DbHandle } from "@/db";
import { createWebhookRepository } from "./repository";
import type {
  CreateApiKeyInput,
  CreateWebhookInput,
  DeliveriesQuery,
  UpdateWebhookInput,
} from "./validator";

export interface WebhookServiceDeps {
  db: DbHandle;
  workspaceId: string | (() => Promise<string>);
}

/** How many api keys a workspace may have. */
const MAX_API_KEYS = 20;

export function createWebhookService(deps: WebhookServiceDeps) {
  const repository = createWebhookRepository({ db: deps.db.db });

  const ws = async () =>
    typeof deps.workspaceId === "function" ? deps.workspaceId() : deps.workspaceId;

  /**
   * The secret is returned once, at creation, and never again. The list
   * shows a masked version so a key can be recognised without being usable.
   */
  const mask = (secret: string) => `${secret.slice(0, 6)}…${secret.slice(-4)}`;

  return {
    async list() {
      const rows = await repository.list(await ws());
      return rows.map((row) => ({ ...row, secret: mask(row.secret) }));
    },

    async get(id: string) {
      const row = await repository.byId(await ws(), id);
      if (!row) throw notFound("Webhook");
      return { ...row, secret: mask(row.secret) };
    },

    async create(input: CreateWebhookInput) {
      const secret = randomBytes(32).toString("base64url");
      const row = await repository.create({
        workspaceId: await ws(),
        name: input.name,
        url: input.url,
        secret,
        events: input.events,
        active: input.active,
      });
      // The full secret is shown once so it can be copied.
      return { ...row, secret };
    },

    async update(id: string, input: UpdateWebhookInput) {
      const existing = await repository.byId(await ws(), id);
      if (!existing) throw notFound("Webhook");

      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.url !== undefined) patch.url = input.url;
      if (input.events !== undefined) patch.events = input.events;
      if (input.active !== undefined) patch.active = input.active ? 1 : 0;

      const row = await repository.update(id, patch);
      return { ...row!, secret: mask(row!.secret) };
    },

    async remove(id: string) {
      const existing = await repository.byId(await ws(), id);
      if (!existing) throw notFound("Webhook");
      await repository.remove(id);
    },

    async deliveries(query: DeliveriesQuery) {
      return repository.deliveries(await ws(), query.limit);
    },

    /* ----------------------------- api keys ----------------------------- */

    async listApiKeys() {
      return repository.listApiKeys(await ws());
    },

    /**
     * Creates an api key.
     *
     * Only a hash is stored, so a lost key cannot be recovered — it has to
     * be replaced. The raw key is returned exactly once.
     */
    async createApiKey(input: CreateApiKeyInput) {
      const workspaceId = await ws();

      if ((await repository.countApiKeys(workspaceId)) >= MAX_API_KEYS) {
        throw new Error(
          `This workspace already has the maximum of ${MAX_API_KEYS} api keys`,
        );
      }

      const raw = `mrk_${randomBytes(24).toString("base64url")}`;
      const row = await repository.createApiKey({
        workspaceId,
        name: input.name,
        prefix: raw.slice(0, 12),
        keyHash: createHash("sha256").update(raw).digest("hex"),
      });

      return { ...row, key: raw };
    },

    async revokeApiKey(id: string) {
      await repository.revokeApiKey(id);
    },

    /** Resolves a raw api key to its workspace. */
    async resolveApiKey(raw: string) {
      const keyHash = createHash("sha256").update(raw).digest("hex");
      const row = await repository.apiKeyByHash(keyHash);
      if (!row) return null;
      await repository.touchApiKey(row.id);
      return row;
    },
  };
}

export type WebhookService = ReturnType<typeof createWebhookService>;
