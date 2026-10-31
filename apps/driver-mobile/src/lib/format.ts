import type { DeliveryStatus } from "./types";

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  assigned: "Atribuída",
  picked_up: "Em rota",
  delivered: "Entregue",
  canceled: "Cancelada",
};

export function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatElapsed(from: number | null, now: number): string {
  if (from === null || !Number.isFinite(from)) {
    return "—";
  }

  const seconds = Math.max(0, Math.round((now - from) / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}min`;
  }

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

export function paymentLabel(method: string): string {
  switch (method) {
    case "pix":
      return "Pix";
    case "cash":
      return "Dinheiro";
    case "card_on_delivery":
      return "Cartão na entrega";
    default:
      return method;
  }
}

export function paymentStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pagamento pendente";
    case "paid":
      return "Pago";
    case "canceled":
      return "Pagamento cancelado";
    default:
      return status;
  }
}

export function phoneHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");

  if (digits.length < 8) {
    return null;
  }

  return `tel:${digits.startsWith("55") ? digits : `55${digits}`}`;
}
