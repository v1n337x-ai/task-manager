/**
 * Typed application errors (brief section 46).
 * Production UI shows safe messages; stack traces live only in dev logs.
 */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "DATABASE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly userMessage: string;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, status: number, userMessage: string, details?: unknown) {
    super(userMessage);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.userMessage = userMessage;
    this.details = details;
  }
}

export const UnauthorizedError = (detail = "You must sign in to continue.") =>
  new AppError("UNAUTHORIZED", 401, detail);
export const ForbiddenError = (detail = "You do not have permission for this action.") =>
  new AppError("FORBIDDEN", 403, detail);
export const ValidationError = (detail: string, issues?: unknown) =>
  new AppError("VALIDATION_ERROR", 422, detail, issues);
export const NotFoundError = (entity = "Record") => new AppError("NOT_FOUND", 404, `${entity} not found.`);
export const ConflictError = (detail: string) => new AppError("CONFLICT", 409, detail);
export const RateLimitedError = (retryAfterSeconds: number) =>
  new AppError("RATE_LIMITED", 429, `Too many attempts. Try again in ${retryAfterSeconds}s.`);
export const DatabaseUnavailableError = () =>
  new AppError("DATABASE_UNAVAILABLE", 503, "The database is not reachable. Contact the platform team.");
export const InternalError = () => new AppError("INTERNAL_ERROR", 500, "Something went wrong. The error has been logged.");
