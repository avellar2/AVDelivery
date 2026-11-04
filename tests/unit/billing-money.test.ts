import { describe, expect, it } from "vitest";

import {
  asaasValueToCents,
  canonicalAsaasPaymentStatus,
  centsToAsaasValue,
  formatSaoPauloDate,
  invoiceStatusForCanonical,
  isPaidAsaasStatus,
  safeInvoiceUrl,
} from "@/modules/billing/providers/asaas/money";

describe("conversão de valores Asaas", () => {
  it("converte centavos inteiros para reais sem acumular float", () => {
    expect(centsToAsaasValue(5990)).toBe(59.9);
    expect(centsToAsaasValue(1)).toBe(0.01);
    expect(centsToAsaasValue(100_000)).toBe(1000);
  });

  it("rejeita centavos inválidos", () => {
    expect(() => centsToAsaasValue(0)).toThrow();
    expect(() => centsToAsaasValue(-10)).toThrow();
    expect(() => centsToAsaasValue(1.5)).toThrow();
    expect(() => centsToAsaasValue(Number.NaN)).toThrow();
  });

  it("converte valores do provedor para centavos", () => {
    expect(asaasValueToCents(59.9)).toBe(5990);
    expect(asaasValueToCents("59.90")).toBe(5990);
    expect(asaasValueToCents("0.01")).toBe(1);
    expect(asaasValueToCents("1000")).toBe(100_000);
  });

  it("recusa valores malformados em vez de arredondar silenciosamente", () => {
    expect(asaasValueToCents("abc")).toBeNull();
    expect(asaasValueToCents("-59.90")).toBeNull();
    expect(asaasValueToCents("59.999")).toBeNull();
    expect(asaasValueToCents(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("mapeamento de status de pagamento", () => {
  it.each([
    ["CONFIRMED", "CONFIRMED"],
    ["RECEIVED", "CONFIRMED"],
    ["RECEIVED_IN_CASH", "CONFIRMED"],
    ["DUNNING_RECEIVED", "CONFIRMED"],
    ["PENDING", "PENDING"],
    ["AUTHORIZED", "PENDING"],
    ["OVERDUE", "OVERDUE"],
    ["DUNNING_REQUESTED", "OVERDUE"],
    ["REFUNDED", "REFUNDED"],
    ["REFUND_IN_PROGRESS", "REFUNDED"],
    ["AWAITING_PAYMENT_REVERSAL", "REFUNDED"],
    ["CHARGEBACK_REQUESTED", "CHARGEBACK_REQUESTED"],
    ["AWAITING_CHARGEBACK_REVERSAL", "CHARGEBACK_REQUESTED"],
    ["DELETED", "DELETED"],
    ["REPROVED_BY_RISK_ANALYSIS", "DELETED"],
  ])("%s -> %s", (provider, canonical) => {
    expect(canonicalAsaasPaymentStatus(provider)).toBe(canonical);
  });

  it("ignora status desconhecido em vez de presumir pagamento", () => {
    expect(canonicalAsaasPaymentStatus("SOMETHING_NEW")).toBeNull();
    expect(canonicalAsaasPaymentStatus("")).toBeNull();
    expect(isPaidAsaasStatus("SOMETHING_NEW")).toBe(false);
  });

  it("mapeia status canônico para o enum local", () => {
    expect(invoiceStatusForCanonical("CONFIRMED")).toBe("paid");
    expect(invoiceStatusForCanonical("PENDING")).toBe("pending");
    expect(invoiceStatusForCanonical("OVERDUE")).toBe("overdue");
    expect(invoiceStatusForCanonical("REFUNDED")).toBe("refunded");
    expect(invoiceStatusForCanonical("CHARGEBACK_REQUESTED")).toBe("chargeback");
    expect(invoiceStatusForCanonical("DELETED")).toBe("canceled");
  });
});

describe("links e datas", () => {
  it("aceita apenas links HTTPS hospedados pelo Asaas", () => {
    expect(safeInvoiceUrl("https://www.asaas.com/i/abc")).toBe("https://www.asaas.com/i/abc");
    expect(safeInvoiceUrl("https://sandbox.asaas.com/i/abc")).toBe(
      "https://sandbox.asaas.com/i/abc",
    );
    expect(safeInvoiceUrl("http://www.asaas.com/i/abc")).toBeNull();
    expect(safeInvoiceUrl("https://asaas.com.evil.example/i/abc")).toBeNull();
    expect(safeInvoiceUrl("https://evil.example/i/abc")).toBeNull();
    expect(safeInvoiceUrl(null)).toBeNull();
  });

  it("formata a data de São Paulo no padrão aceito pelo Asaas", () => {
    expect(formatSaoPauloDate(new Date("2026-11-04T02:00:00.000Z"))).toBe("2026-11-03");
    expect(formatSaoPauloDate(new Date("2026-11-04T15:00:00.000Z"))).toBe("2026-11-04");
  });
});
