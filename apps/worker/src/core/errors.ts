export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message); this.name = "AppError"; this.status = status; this.code = code; this.details = details;
  }
}

export const badRequest = (message = "Invalid request", details?: unknown) => new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") => new AppError(401, "unauthorized", message);
export const notFound = (resource = "Resource") => new AppError(404, "not_found", `${resource} not found`);
export const internal = () => new AppError(500, "internal_error", "Internal server error");
export const notImplemented = (resource: string) => new AppError(501, "not_implemented", `${resource} is not built yet`);