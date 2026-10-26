/**
 * Typed operational errors.
 *
 * Every error the api raises intentionally extends AppError so the handler can
 * map it to a status and a stable machine-readable `code`. Anything that is
 * not an AppError is a bug and gets status 500 with the stack in the logs, never
 * in the response body.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message = "Invalid request", details?: unknown) =>
  new AppError(400, "bad_request", message, details);

export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "unauthorized", message);

export const forbidden = (message = "Not permitted") =>
  new AppError(403, "forbidden", message);

export const notFound = (resource = "Resource") =>
  new AppError(404, "not_found", `${resource} not found`);

export const conflict = (message: string) =>
  new AppError(409, "conflict", message);

export const notImplemented = (resource: string) =>
  new AppError(501, "not_implemented", `${resource} is not built yet`);

export const internal = () =>
  new AppError(500, "internal_error", "Internal server error");

/* -------------------------------------------------------------------------- */
/* Well-known errors returned by Postgres / the application                    */
/* -------------------------------------------------------------------------- */

/** Postgres unique-violation. Map to 409 so callers learn it's a duplicate. */
export const PG_UNIQUE_VIOLATION = "23505";

export function fromPostgresError(error: unknown): AppError {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return internal();
  }

  const { code } = error as { code?: unknown };

  if (code === PG_UNIQUE_VIOLATION) {
    return conflict("That record already exists");
  }

  return internal();
}