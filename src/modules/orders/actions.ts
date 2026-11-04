"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { zodFieldErrors, type ActionState } from "@/lib/action-state";
import { DatabaseError, reportServerError } from "@/lib/errors";
import { formatCurrency } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canCancelOrders, canManagePayments, canOperateOrders } from "@/modules/memberships/roles";
import { getActiveMembership } from "@/modules/stores/active-store";
import {
  checkoutInputSchema,
  idempotencyKeySchema,
  trackingTokenSchema,
} from "@/modules/orders/validation";
import { canonicalizeCheckout } from "@/modules/orders/payload";
import { hashCheckoutPayload, sha256Hex } from "@/modules/orders/hashing";
import { checkRateLimit } from "@/modules/orders/rate-limit";
import {
  createOrderRecord,
  getOrderDetailForStore,
  getTrackingOrder,
  listOrdersForStore,
} from "@/modules/orders/service";
import { isOrderStatus } from "@/modules/orders/status";
import type {
  CreateOrderResult,
  OrderDetail,
  OrderSummary,
  TrackingOrder,
} from "@/modules/orders/types";
import type { OrderStatus } from "@/types/database";

const storeSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const uuidSchema = z.uuid("Identificador inválido.");

async function clientIp(): Promise<string> {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();

  return first || headerStore.get("x-real-ip")?.trim() || "unknown";
}

function postgresMessage(error: unknown): string {
  if (error instanceof DatabaseError) {
    const cause = error.cause as { message?: unknown } | undefined;
    return typeof cause?.message === "string" ? cause.message : "";
  }

  return "";
}

function mapCheckoutError(error: unknown): CreateOrderResult {
  const raw = postgresMessage(error);
  const [code, detail] = raw.split("|");

  switch (code) {
    case "store_unavailable":
      return { ok: false, code, message: "Esta loja não está disponível para pedidos." };
    case "orders_paused":
      return {
        ok: false,
        code,
        message: "A loja não está aceitando novos pedidos neste momento.",
      };
    case "subscription_inactive":
      return {
        ok: false,
        code,
        message:
          "Esta loja está temporariamente sem novas vendas pelo site. Tente novamente mais tarde.",
      };
    case "product_unavailable":
      return {
        ok: false,
        code,
        message: "Um dos produtos ficou indisponível. Revise o carrinho e tente novamente.",
      };
    case "option_unavailable":
      return {
        ok: false,
        code,
        message: "Um dos adicionais ficou indisponível. Revise o carrinho e tente novamente.",
      };
    case "selection_invalid":
      return {
        ok: false,
        code,
        message: detail
          ? `Revise as seleções do grupo "${detail}".`
          : "Revise as seleções de adicionais do carrinho.",
      };
    case "minimum_not_met": {
      const minimumCents = Number(detail);
      return {
        ok: false,
        code,
        minimumCents: Number.isFinite(minimumCents) ? minimumCents : undefined,
        message: Number.isFinite(minimumCents)
          ? `O pedido mínimo desta loja é ${formatCurrency(minimumCents)}.`
          : "O valor mínimo do pedido não foi atingido.",
      };
    }
    case "payment_unavailable":
      return {
        ok: false,
        code,
        message: "A forma de pagamento escolhida não está disponível.",
      };
    case "fulfillment_unavailable":
      return {
        ok: false,
        code,
        message: "O tipo de entrega escolhido não está disponível.",
      };
    case "idempotency_conflict":
      return {
        ok: false,
        code,
        message: "Esta tentativa de checkout já foi usada com outro conteúdo. Recomece o pedido.",
      };
    case "rate_limited":
      return {
        ok: false,
        code,
        message: "Muitas tentativas em pouco tempo. Aguarde alguns instantes e tente novamente.",
      };
    case "invalid_address":
      return { ok: false, code, message: "Revise o endereço de entrega." };
    case "invalid_customer_name":
      return { ok: false, code, message: "Informe um nome válido." };
    case "invalid_customer_phone":
      return { ok: false, code, message: "Informe um telefone válido com DDD." };
    case "invalid_notes":
    case "invalid_item_notes":
      return { ok: false, code, message: "A observação é muito longa." };
    case "invalid_quantity":
    case "invalid_items":
    case "invalid_options":
    case "invalid_payload":
    case "invalid_fulfillment":
    case "invalid_payment_method":
      return {
        ok: false,
        code,
        message: "Os dados do pedido não são válidos. Revise o carrinho e o formulário.",
      };
    default:
      return {
        ok: false,
        message: "Não foi possível criar o pedido. Tente novamente.",
      };
  }
}

export async function createOrderAction(input: {
  storeSlug: string;
  checkout: unknown;
  idempotencyKey: string;
  trackingToken: string;
}): Promise<CreateOrderResult> {
  const slugParsed = storeSlugSchema.safeParse(input.storeSlug);

  if (!slugParsed.success) {
    return { ok: false, message: "Loja inválida." };
  }

  const checkoutParsed = checkoutInputSchema.safeParse(input.checkout);

  if (!checkoutParsed.success) {
    return {
      ok: false,
      message: "Revise os campos destacados.",
      fieldErrors: zodFieldErrors(checkoutParsed.error),
    };
  }

  const idempotencyParsed = idempotencyKeySchema.safeParse(input.idempotencyKey);
  const tokenParsed = trackingTokenSchema.safeParse(input.trackingToken);

  if (!idempotencyParsed.success || !tokenParsed.success) {
    return {
      ok: false,
      message: "Não foi possível identificar esta tentativa. Recomece o checkout.",
    };
  }

  const ip = await clientIp();
  const limit = checkRateLimit(`checkout:${ip}:${slugParsed.data}`, 10, 60_000);

  if (!limit.allowed) {
    return {
      ok: false,
      code: "rate_limited",
      message: "Muitas tentativas em pouco tempo. Aguarde alguns instantes e tente novamente.",
    };
  }

  const canonical = canonicalizeCheckout(checkoutParsed.data);
  const requestHash = hashCheckoutPayload(canonical);
  const trackingTokenHash = sha256Hex(tokenParsed.data);

  try {
    const data = await createOrderRecord({
      storeSlug: slugParsed.data,
      payload: canonical,
      idempotencyKey: idempotencyParsed.data,
      requestHash,
      trackingTokenHash,
    });

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, message: "Não foi possível criar o pedido. Tente novamente." };
    }

    const record = data as Record<string, unknown>;

    if (
      typeof record.orderId !== "string" ||
      typeof record.orderNumber !== "number" ||
      typeof record.totalCents !== "number" ||
      !isOrderStatus(record.status)
    ) {
      return { ok: false, message: "Não foi possível confirmar o pedido. Tente novamente." };
    }

    revalidatePath("/dashboard/pedidos");

    return {
      ok: true,
      order: {
        orderId: record.orderId,
        orderNumber: record.orderNumber,
        status: record.status,
        subtotalCents: Number(record.subtotalCents ?? 0),
        deliveryFeeCents: Number(record.deliveryFeeCents ?? 0),
        totalCents: record.totalCents,
        paymentMethod:
          record.paymentMethod === "pix" ||
          record.paymentMethod === "cash" ||
          record.paymentMethod === "card_on_delivery"
            ? record.paymentMethod
            : canonical.paymentMethod,
        paymentStatus:
          record.paymentStatus === "paid" || record.paymentStatus === "canceled"
            ? record.paymentStatus
            : "pending",
        fulfillmentType: record.fulfillmentType === "pickup" ? "pickup" : canonical.fulfillmentType,
        created: record.created === true,
      },
    };
  } catch (error) {
    reportServerError("orders.create", error);
    return mapCheckoutError(error);
  }
}

export async function getOrderTrackingAction(input: {
  storeSlug: string;
  orderNumber: number;
  trackingToken: string;
}): Promise<{ ok: true; order: TrackingOrder } | { ok: false; message: string }> {
  const slugParsed = storeSlugSchema.safeParse(input.storeSlug);
  const tokenParsed = trackingTokenSchema.safeParse(input.trackingToken);
  const numberParsed = z.coerce.number().int().min(1).safeParse(input.orderNumber);

  if (!slugParsed.success || !tokenParsed.success || !numberParsed.success) {
    return { ok: false, message: "Link de acompanhamento inválido." };
  }

  const ip = await clientIp();
  const limit = checkRateLimit(`tracking:${ip}`, 60, 60_000);

  if (!limit.allowed) {
    return { ok: false, message: "Muitas consultas em pouco tempo. Aguarde um instante." };
  }

  try {
    const order = await getTrackingOrder({
      storeSlug: slugParsed.data,
      orderNumber: numberParsed.data,
      trackingTokenHash: sha256Hex(tokenParsed.data),
    });

    if (!order) {
      return { ok: false, message: "Pedido não encontrado para este link." };
    }

    return { ok: true, order };
  } catch (error) {
    reportServerError("orders.tracking", error);
    return { ok: false, message: "Não foi possível consultar o pedido agora." };
  }
}

export async function refreshOrdersAction(): Promise<
  { ok: true; orders: OrderSummary[] } | { ok: false; message: string }
> {
  const membership = await getActiveMembership();

  if (!membership || !canOperateOrders(membership.role)) {
    return { ok: false, message: "Você não tem acesso aos pedidos desta loja." };
  }

  try {
    const orders = await listOrdersForStore(membership.storeId, null);
    return { ok: true, orders };
  } catch (error) {
    reportServerError("orders.refresh", error);
    return { ok: false, message: "Não foi possível atualizar os pedidos." };
  }
}

export async function getOrderDetailAction(
  orderId: string,
): Promise<{ ok: true; order: OrderDetail } | { ok: false; message: string }> {
  const membership = await getActiveMembership();

  if (!membership || !canOperateOrders(membership.role)) {
    return { ok: false, message: "Você não tem acesso aos pedidos desta loja." };
  }

  if (!uuidSchema.safeParse(orderId).success) {
    return { ok: false, message: "Pedido inválido." };
  }

  try {
    const order = await getOrderDetailForStore(membership.storeId, orderId);
    return { ok: true, order };
  } catch (error) {
    reportServerError("orders.getDetail", error);
    return { ok: false, message: "Não foi possível carregar o pedido." };
  }
}

export async function updateOrderStatusAction(
  orderId: string,
  nextStatus: OrderStatus,
): Promise<ActionState> {
  const membership = await getActiveMembership();

  if (!membership || !canOperateOrders(membership.role)) {
    return {
      status: "error",
      message: "Você não tem permissão para operar os pedidos desta loja.",
    };
  }

  if (!uuidSchema.safeParse(orderId).success || !isOrderStatus(nextStatus)) {
    return { status: "error", message: "Pedido ou status inválido." };
  }

  if (nextStatus === "canceled" && !canCancelOrders(membership.role)) {
    return {
      status: "error",
      message: "Apenas proprietários e gerentes podem cancelar pedidos.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_order_status", {
    p_order_id: orderId,
    p_new_status: nextStatus,
  });

  if (error) {
    reportServerError("orders.updateStatus", error);

    if (error.message.startsWith("invalid_status_transition")) {
      return {
        status: "error",
        message: "Esta mudança de status não é permitida para o pedido.",
      };
    }

    if (error.message === "forbidden") {
      return { status: "error", message: "Você não tem permissão para esta ação." };
    }

    if (error.message === "order_not_found") {
      return { status: "error", message: "Pedido não encontrado." };
    }

    return {
      status: "error",
      message: "Não foi possível atualizar o pedido. Atualize a página e tente novamente.",
    };
  }

  revalidatePath("/dashboard/pedidos");
  revalidatePath(`/loja/${membership.storeSlug}/pedido`);

  return { status: "success", message: "Status atualizado." };
}

export async function updateOrderPaymentAction(
  orderId: string,
  nextStatus: "pending" | "paid" | "canceled",
): Promise<ActionState> {
  const membership = await getActiveMembership();

  if (!membership || !canManagePayments(membership.role)) {
    return {
      status: "error",
      message: "Apenas proprietários e gerentes podem alterar o pagamento.",
    };
  }

  if (
    !uuidSchema.safeParse(orderId).success ||
    !["pending", "paid", "canceled"].includes(nextStatus)
  ) {
    return { status: "error", message: "Pedido ou situação de pagamento inválida." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_order_payment_status", {
    p_order_id: orderId,
    p_new_status: nextStatus,
  });

  if (error) {
    reportServerError("orders.updatePayment", error);
    return {
      status: "error",
      message: "Não foi possível atualizar o pagamento. Atualize a página e tente novamente.",
    };
  }

  revalidatePath("/dashboard/pedidos");
  revalidatePath(`/loja/${membership.storeSlug}/pedido`);

  return { status: "success", message: "Pagamento atualizado." };
}
