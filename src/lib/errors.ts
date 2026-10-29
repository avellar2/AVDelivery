export type ErrorCode =
  "CONFIGURATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "DATABASE" | "UNEXPECTED";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly publicMessage: string;

  constructor(code: ErrorCode, publicMessage: string, options?: { cause?: unknown }) {
    super(publicMessage, options);
    this.name = "AppError";
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export class ConfigurationError extends AppError {
  constructor(message = "O serviço de autenticação ainda não foi configurado. Consulte o README.") {
    super("CONFIGURATION", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Você não tem permissão para executar esta ação.") {
    super("FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Registro não encontrado.") {
    super("NOT_FOUND", message);
  }
}

export class DatabaseError extends AppError {
  constructor(operation: string, cause: unknown) {
    super("DATABASE", "Não foi possível concluir a operação. Tente novamente.", { cause });
    this.name = "DatabaseError";
    this.operation = operation;
  }

  readonly operation: string;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toPublicErrorMessage(error: unknown): string {
  if (isAppError(error)) {
    return error.publicMessage;
  }

  return "Ocorreu um erro inesperado. Tente novamente.";
}

export function reportServerError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : "Erro desconhecido";
  console.error(`[${scope}] ${message}`);
}
