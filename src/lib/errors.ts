export type ErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INVALID"
  | "STALE_VERSION"
  | "NOT_APPROVED"
  | "ALREADY_PAID"
  | "PAYMENT_PENDING"
  | "AMOUNT_MISMATCH"
  | "PAYPAL_ERROR"
  | "SETUP_REQUIRED"
  | "LOCKED";

export class AppError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly status: number = codeToStatus(code)) {
    super(message);
    this.name = "AppError";
  }
}

function codeToStatus(code: ErrorCode): number {
  switch (code) {
    case "NOT_FOUND": return 404;
    case "FORBIDDEN": return 403;
    case "INVALID": return 400;
    case "SETUP_REQUIRED": return 503;
    case "PAYPAL_ERROR": return 502;
    default: return 409;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof Error) return e.message;
  return "Unexpected error";
}
