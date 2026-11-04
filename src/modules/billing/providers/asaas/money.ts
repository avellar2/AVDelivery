import type { InvoiceStatus } from "@/types/database";

/**
 * Asaas uses decimal reais; AVDelivery uses integer cents. The conversion is
 * done once, on the server, and never with floating-point accumulation.
 */
export function centsToAsaasValue(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Valor em centavos inválido.");
  }

  return cents / 100;
}

export function asaasValueToCents(value: number | string): number | null {
  const raw = typeof value === "number" ? value.toFixed(2) : value.trim();
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(raw);

  if (!match) {
    return null;
  }

  const reais = Number(match[1]);
  const centavos = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = reais * 100 + centavos;

  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatSaoPauloDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Accepted statuses are only those the database can map safely. */
export type CanonicalAsaasPaymentStatus =
  "PENDING" | "CONFIRMED" | "OVERDUE" | "REFUNDED" | "CHARGEBACK_REQUESTED" | "DELETED";

const PENDING_STATUSES = new Set([
  "PENDING",
  "AWAITING_RISK_ANALYSIS",
  "APPROVED_BY_RISK_ANALYSIS",
  "AUTHORIZED",
  "AWAITING_CAPTURE",
]);

const PAID_STATUSES = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"]);

const REFUNDED_STATUSES = new Set([
  "REFUNDED",
  "REFUND_REQUESTED",
  "REFUND_IN_PROGRESS",
  "RECEIVED_IN_CASH_UNDONE",
  "AWAITING_PAYMENT_REVERSAL",
]);

const CHARGEBACK_STATUSES = new Set([
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
]);

/**
 * Maps every documented Asaas payment status onto the small set understood by
 * the billing RPC. Unknown statuses return null and are ignored, never
 * guessed into "paid".
 */
export function canonicalAsaasPaymentStatus(
  status: string | null | undefined,
): CanonicalAsaasPaymentStatus | null {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  if (!normalized) {
    return null;
  }

  if (PAID_STATUSES.has(normalized)) {
    return "CONFIRMED";
  }

  if (normalized === "OVERDUE" || normalized === "DUNNING_REQUESTED") {
    return "OVERDUE";
  }

  if (REFUNDED_STATUSES.has(normalized)) {
    return "REFUNDED";
  }

  if (CHARGEBACK_STATUSES.has(normalized)) {
    return "CHARGEBACK_REQUESTED";
  }

  if (normalized === "DELETED") {
    return "DELETED";
  }

  if (normalized === "REPROVED_BY_RISK_ANALYSIS") {
    return "DELETED";
  }

  if (PENDING_STATUSES.has(normalized)) {
    return "PENDING";
  }

  return null;
}

export function invoiceStatusForCanonical(status: CanonicalAsaasPaymentStatus): InvoiceStatus {
  switch (status) {
    case "CONFIRMED":
      return "paid";
    case "OVERDUE":
      return "overdue";
    case "REFUNDED":
      return "refunded";
    case "CHARGEBACK_REQUESTED":
      return "chargeback";
    case "DELETED":
      return "canceled";
    case "PENDING":
    default:
      return "pending";
  }
}

export function isPaidAsaasStatus(status: string | null | undefined): boolean {
  return canonicalAsaasPaymentStatus(status) === "CONFIRMED";
}

export function safeInvoiceUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      return null;
    }

    if (url.hostname !== "asaas.com" && !url.hostname.endsWith(".asaas.com")) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
