/**
 * Registers the Outlook (Microsoft 365) OAuth2 application with EmailEngine.
 *
 * Microsoft hands out no client id and secret on its own — an app registration
 * in the Entra admin center does — and the redirect URI registered there has
 * to be the one EmailEngine sends the browser back to. This script takes those
 * credentials, registers the app with EmailEngine, and writes the app id
 * EmailEngine returns into .env as MICROSOFT_OAUTH_APP_ID.
 *
 *   bun run scripts/setup-microsoft-oauth.ts
 *   bun run scripts/setup-microsoft-oauth.ts --dry-run
 *
 * Credentials come from .env (MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET)
 * or from --client-id / --client-secret. Nothing is written to .env on a
 * dry run, and the client secret is never printed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const ENV_FILE = resolve(ROOT, ".env");

/* -------------------------------------------------------------------------- */
/* Arguments and environment                                                  */
/* -------------------------------------------------------------------------- */

interface Options {
  clientId: string;
  clientSecret: string;
  /** Microsoft tenant: "common" for both work and personal accounts. */
  authority: string;
  /** "imap" (IMAP/SMTP over OAuth) or "api" (Microsoft Graph). */
  baseScopes: "imap" | "api";
  /** Where Microsoft sends the browser back after consent. */
  redirectUrl: string;
  name: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Partial<Options> & { help?: boolean } {
  const out: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? (argv[i + 1]?.startsWith("--") ? "true" : argv[++i]);

    switch (key) {
      case "client-id":
        out.clientId = value;
        break;
      case "client-secret":
        out.clientSecret = value;
        break;
      case "authority":
        out.authority = value;
        break;
      case "base-scopes":
        out.baseScopes = value;
        break;
      case "redirect-url":
        out.redirectUrl = value;
        break;
      case "name":
        out.name = value;
        break;
      case "dry-run":
        out.dryRun = true;
        break;
      case "help":
        out.help = true;
        break;
      default:
        console.error(`Unknown flag: --${key}`);
        process.exit(1);
    }
  }

  return out as Partial<Options> & { help?: boolean };
}

/**
 * Reads .env into a map. Bun loads .env into the environment on its own, but
 * this script also has to work when it is run by something that does not, and
 * it needs the file's raw text later to update a single line in place.
 */
function readEnvFile(path: string): { values: Map<string, string>; text: string } {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { values: new Map(), text: "" };
  }

  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    values.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }

  return { values, text };
}

/** Writes a key into the .env text, replacing the line if it is already there. */
function upsertEnvValue(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(text)) {
    return text.replace(pattern, line);
  }

  const separator = text.endsWith("\n") || text === "" ? "" : "\n";
  return `${text}${separator}${line}\n`;
}

/* -------------------------------------------------------------------------- */
/* EmailEngine api                                                            */
/* -------------------------------------------------------------------------- */

interface OAuth2App {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  clientId: string;
  redirectUrl: string;
  baseScopes?: string;
  authority?: string;
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  baseUrl?: string,
  token?: string,
): Promise<T> {
  const base = (baseUrl ?? "http://localhost:3003").replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `EmailEngine returned ${response.status}`;
    throw new Error(`EmailEngine ${method} ${path} failed: ${message}`);
  }

  return payload as T;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`
Registers the Outlook OAuth2 app with EmailEngine and writes
MICROSOFT_OAUTH_APP_ID into .env.

  --client-id       Entra application (client) id
  --client-secret   Entra client secret value
  --authority       Microsoft tenant (default: common)
  --base-scopes     imap | api (default: imap)
                    "imap" works anywhere but polls; "api" uses Microsoft
                    Graph and needs EmailEngine on a public HTTPS URL
  --redirect-url    Must match the redirect URI in Entra
                    (default: <EMAILENGINE_PUBLIC_URL>/oauth)
  --name            Display name in EmailEngine (default: Microsoft OAuth2)
  --dry-run         Show what would be sent, change nothing
`);
    return;
  }

  const { values } = readEnvFile(ENV_FILE);
  const env = (key: string): string | undefined =>
    process.env[key] ?? values.get(key) ?? undefined;

  const clientId = args.clientId ?? env("MICROSOFT_CLIENT_ID") ?? "";
  const clientSecret = args.clientSecret ?? env("MICROSOFT_CLIENT_SECRET") ?? "";

  if (!clientId || !clientSecret) {
    console.error(
      "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are required.\n" +
        "Create an app registration in the Entra admin center, add a client\n" +
        "secret, then put both values in .env (or pass --client-id / --client-secret).",
    );
    process.exit(1);
  }

  const emailEngineUrl = env("EMAILENGINE_PUBLIC_URL") ?? "http://localhost:3003";
  const emailEngineApiUrl = env("EMAILENGINE_API_URL") ?? emailEngineUrl;
  const token = env("EMAILENGINE_API_TOKEN") ?? env("EMAILENGINE_SECRET") ?? "";

  const options: Options = {
    clientId,
    clientSecret,
    authority: args.authority ?? env("MICROSOFT_AUTHORITY") ?? "common",
    baseScopes: (args.baseScopes ?? env("MICROSOFT_BASE_SCOPES") ?? "imap") as
      | "imap"
      | "api",
    redirectUrl:
      args.redirectUrl ?? env("MICROSOFT_REDIRECT_URL") ?? `${emailEngineUrl}/oauth`,
    name: args.name ?? env("MICROSOFT_OAUTH_APP_NAME") ?? "Microsoft OAuth2",
    dryRun: args.dryRun === true,
  };

  if (!token) {
    console.error(
      "EMAILENGINE_API_TOKEN is not set. Issue one with:\n" +
        "  docker exec mailrung-emailengine-1 node /emailengine/bin/emailengine.js tokens issue -d \"mailrung\" -s \"*\" --dbs.redis=\"redis://redis:6379\"",
    );
    process.exit(1);
  }

  const payload = {
    name: options.name,
    provider: "outlook",
    enabled: true,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    baseScopes: options.baseScopes,
    authority: options.authority,
    cloud: "global",
    redirectUrl: options.redirectUrl,
  };

  console.log("Registering the Outlook OAuth2 app with EmailEngine:");
  console.log(`  api            ${emailEngineApiUrl}`);
  console.log(`  provider       outlook`);
  console.log(`  client id      ${options.clientId}`);
  console.log(`  client secret  ********`);
  console.log(`  authority      ${options.authority}`);
  console.log(`  base scopes    ${options.baseScopes}`);
  console.log(`  redirect url   ${options.redirectUrl}`);

  if (options.dryRun) {
    console.log("\nDry run — nothing was sent and .env was not changed.");
    return;
  }

  // An Outlook app that already exists is updated in place. Two Outlook apps
  // would both show up in EmailEngine's provider picker, and picking the
  // wrong one fails in a way that looks like a Microsoft problem.
  const listing = await apiRequest<{ apps: OAuth2App[] }>(
    "GET",
    "/v1/oauth2",
    undefined,
    emailEngineApiUrl,
    token,
  );
  const existing = listing.apps?.find((app) => app.provider === "outlook");

  let appId: string;

  if (existing) {
    console.log(`\nOutlook app ${existing.id} already exists — updating it.`);
    const updated = await apiRequest<{ id: string }>(
      "PUT",
      `/v1/oauth2/${encodeURIComponent(existing.id)}`,
      { app: existing.id, ...payload },
      emailEngineApiUrl,
      token,
    );
    appId = updated.id ?? existing.id;
  } else {
    const created = await apiRequest<{ id: string }>(
      "POST",
      "/v1/oauth2",
      payload,
      emailEngineApiUrl,
      token,
    );
    appId = created.id;
    console.log(`\nCreated Outlook app ${appId}.`);
  }

  const { text } = readEnvFile(ENV_FILE);
  writeFileSync(ENV_FILE, upsertEnvValue(text, "MICROSOFT_OAUTH_APP_ID", appId));
  console.log(`MICROSOFT_OAUTH_APP_ID=${appId} written to .env`);

  console.log(`
Next:
  1. The redirect URI ${options.redirectUrl} must be registered on the Entra
     app, under "Authentication > Platform configurations > Web".
  2. Restart the api so it picks up the app id:
       docker compose up -d api
  3. Connect the mailbox: Mailboxes > Connect mailbox > Microsoft (Outlook / M365).
`);
}

await main();
