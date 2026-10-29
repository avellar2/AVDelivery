import { describe, expect, it } from "vitest";

import {
  AppError,
  ConfigurationError,
  DatabaseError,
  ForbiddenError,
  isAppError,
  toPublicErrorMessage,
} from "@/lib/errors";

describe("tratamento de erros", () => {
  it("expõe apenas a mensagem pública de AppError", () => {
    const error = new ForbiddenError("Acesso negado pela política.");

    expect(error.code).toBe("FORBIDDEN");
    expect(toPublicErrorMessage(error)).toBe("Acesso negado pela política.");
  });

  it("não vaza detalhes internos de erros desconhecidos", () => {
    const error = new Error("connection string postgres://user:secret@host/db");
    const message = toPublicErrorMessage(error);

    expect(message).toBe("Ocorreu um erro inesperado. Tente novamente.");
    expect(message).not.toContain("secret");
  });

  it("identifica AppError", () => {
    expect(isAppError(new ConfigurationError())).toBe(true);
    expect(isAppError(new Error("comum"))).toBe(false);
  });

  it("mantém o erro original como causa em falhas de banco", () => {
    const cause = new Error("duplicate key");
    const error = new DatabaseError("stores.insert", cause);

    expect(error).toBeInstanceOf(AppError);
    expect(error.cause).toBe(cause);
    expect(error.publicMessage).toBe("Não foi possível concluir a operação. Tente novamente.");
  });
});
