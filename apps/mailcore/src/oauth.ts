/**
 * OAuth2: the consent flow and the token refresh.
 *
 * Both providers use the same authorization-code flow with PKCE. The state
 * row is what ties the callback back to the account it belongs to, and it is
 * single-use: a replayed code is rejected.
 */
import { createHash, randomBytes } from "node:crypto";

export interface OAuthProvider {
  id: "google" | "microsoft";
  clientId: string;
  clientSecret: string;
  /** Redirect URI, which must match the provider's registration exactly. */
  redirectUri: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  tenant?: string;
}

export function googleProvider(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): OAuthProvider {
  return {
    id: "google",
    clientId,
    clientSecret,
    redirectUri,
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
  };
}

export function microsoftProvider(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  tenant: string,
): OAuthProvider {
  const t = tenant && tenant !== "" ? tenant : "common";
  return {
    id: "microsoft",
    clientId,
    clientSecret,
    redirectUri,
    scopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "User.Read",
      "https://graph.microsoft.com/Mail.ReadWrite",
      "https://graph.microsoft.com/Mail.Send",
    ],
    authorizeUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
    tenant: t,
  };
}

export function newState(): string {
  return randomBytes(16).toString("base64url");
}

export function newVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** The URL the browser is sent to. */
export function authorizeUrl(
  provider: OAuthProvider,
  state: string,
  verifier: string,
): string {
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: provider.redirectUri,
    response_type: "code",
    scope: provider.scopes.join(" "),
    state,
    code_challenge: challengeFor(verifier),
    code_challenge_method: "S256",
  });
  if (provider.id === "google") {
    // `offline` is what makes Google issue a refresh token; `consent` makes
    // it issue one even when the account has consented before.
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  return `${provider.authorizeUrl}?${params.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  verifier: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    redirect_uri: provider.redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  return await tokenRequest(provider.tokenUrl, body);
}

export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return await tokenRequest(provider.tokenUrl, body);
}

async function tokenRequest(
  url: string,
  body: URLSearchParams,
): Promise<TokenSet> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`token request ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token ?? "",
    refreshToken: json.refresh_token ?? "",
    expiresIn: json.expires_in ?? 3600,
  };
}

/** The address the account signs in with. */
export async function fetchIdentity(
  provider: OAuthProvider,
  accessToken: string,
): Promise<string> {
  if (provider.id === "google") {
    const res = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const json = (await res.json()) as { email?: string };
    if (!json.email) throw new Error("google userinfo had no email");
    return json.email;
  }
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as { mail?: string; userPrincipalName?: string };
  const email = json.mail ?? json.userPrincipalName;
  if (!email) throw new Error("graph /me had no mail address");
  return email;
}
