/**
 * Thin typed fetch wrapper.
 *
 * The api does not exist yet — every call currently resolves against the
 * in-memory mock layer in `src/mocks`. Swapping to the real backend means
 * setting VITE_USE_MOCKS=false; no call site changes.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fired when the api rejects a request as unauthenticated.
 *
 * The auth provider listens for this and clears the session, which makes
 * RequireAuth redirect to /login. Without it, an expired session silently
 * renders empty tables instead of telling the user they are signed out.
 */
export const UNAUTHORIZED_EVENT = "mailrung:unauthorized";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

/** Paths that are expected to 401 without the user being signed out. */
const UNAUTH_OK = ["/auth/login", "/auth/me"];

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== "false";

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(
    `${BASE_URL}${path}`,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  );
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.pathname + url.search;
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(buildUrl(path, options.query), {
    method,
    credentials: "include",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    if (response.status === 401 && !UNAUTH_OK.some((p) => path.startsWith(p))) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }

    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `Request failed with ${response.status}`;
    throw new ApiError(response.status, message, payload);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "body">) =>
    request<T>("GET", path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("POST", path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PATCH", path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PUT", path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>("DELETE", path, options),
};
