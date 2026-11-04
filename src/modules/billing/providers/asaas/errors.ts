export type AsaasErrorCode =
  | "CONFIGURATION"
  | "AUTH"
  | "VALIDATION"
  | "NOT_FOUND"
  | "RATE_LIMIT"
  | "NETWORK"
  | "TIMEOUT"
  | "SERVER"
  | "INVALID_RESPONSE";

/**
 * Provider errors contain only a safe description and provider error codes.
 * Headers, API keys, webhook tokens, card data and full payloads are never
 * attached to this object.
 */
export class AsaasError extends Error {
  readonly code: AsaasErrorCode;
  readonly status: number | null;
  readonly providerCode: string | null;
  readonly retryable: boolean;

  constructor(
    code: AsaasErrorCode,
    message: string,
    options: {
      status?: number | null;
      providerCode?: string | null;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AsaasError";
    this.code = code;
    this.status = options.status ?? null;
    this.providerCode = options.providerCode ?? null;
    this.retryable =
      options.retryable ?? (code === "NETWORK" || code === "TIMEOUT" || code === "RATE_LIMIT");
  }
}

export function isAsaasError(error: unknown): error is AsaasError {
  return error instanceof AsaasError;
}
