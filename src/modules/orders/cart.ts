import type { PublicMenuCategory } from "@/modules/menu/types";
import {
  CART_STORAGE_PREFIX,
  MAX_ITEM_QUANTITY,
  MAX_ORDER_ITEMS,
  TRACKING_STORAGE_KEY,
} from "@/modules/orders/constants";
import { computeCartTotals, itemUnitPriceCents, lineTotalCents } from "@/modules/orders/pricing";
import type { CartLine, CheckoutInput, CheckoutItem } from "@/modules/orders/types";
import type { OrderFulfillmentType } from "@/types/database";

export function cartLineUnitPriceCents(line: CartLine): number {
  return itemUnitPriceCents(
    line.basePriceCents,
    line.options.map((option) => ({
      priceCents: option.priceCents,
      quantity: option.quantity,
    })),
  );
}

export function cartLineTotal(line: CartLine): number {
  return lineTotalCents(cartLineUnitPriceCents(line), line.quantity);
}

export function cartSubtotalCents(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => total + cartLineTotal(line), 0);
}

export function cartTotals(
  lines: readonly CartLine[],
  fulfillmentType: OrderFulfillmentType,
  store: { deliveryFeeCents: number; minOrderCents: number },
) {
  return computeCartTotals(
    lines.map((line) => ({
      unitPriceCents: cartLineUnitPriceCents(line),
      quantity: line.quantity,
    })),
    {
      fulfillmentType,
      deliveryFeeCents: store.deliveryFeeCents,
      minOrderCents: store.minOrderCents,
    },
  );
}

export function cartToCheckoutItems(lines: readonly CartLine[]): CheckoutItem[] {
  return lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    notes: line.notes,
    options: line.options.map((option) => ({
      groupId: option.groupId,
      optionId: option.optionId,
      quantity: option.quantity,
    })),
  }));
}

export function buildCheckoutInput(params: {
  lines: readonly CartLine[];
  customerName: string;
  customerPhone: string;
  fulfillmentType: OrderFulfillmentType;
  address: CheckoutInput["address"];
  paymentMethod: CheckoutInput["paymentMethod"];
  notes: string;
}): CheckoutInput {
  return {
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    fulfillmentType: params.fulfillmentType,
    address: params.fulfillmentType === "delivery" ? params.address : null,
    paymentMethod: params.paymentMethod,
    notes: params.notes,
    items: cartToCheckoutItems(params.lines),
  };
}

/**
 * Aligns a locally stored cart with the current public menu. Prices, names and
 * options always come from the menu the customer is seeing now; the server
 * still recomputes everything on checkout.
 */
export function reconcileCart(
  lines: readonly CartLine[],
  categories: readonly PublicMenuCategory[],
): { lines: CartLine[]; changed: boolean; removed: number } {
  const products = new Map(
    categories.flatMap((category) => category.products.map((product) => [product.id, product])),
  );

  let changed = false;
  let removed = 0;

  const nextLines: CartLine[] = [];

  for (const line of lines) {
    const product = products.get(line.productId);

    if (!product) {
      removed += 1;
      changed = true;
      continue;
    }

    const reconciledOptions: CartLine["options"] = [];

    for (const option of line.options) {
      const group = product.optionGroups.find((entry) => entry.id === option.groupId);
      const current = group?.options.find((entry) => entry.id === option.optionId);

      if (!group || !current) {
        changed = true;
        reconciledOptions.length = 0;
        break;
      }

      if (
        current.name !== option.name ||
        current.additionalPriceCents !== option.priceCents ||
        group.name !== option.groupName
      ) {
        changed = true;
      }

      reconciledOptions.push({
        groupId: group.id,
        groupName: group.name,
        optionId: current.id,
        name: current.name,
        priceCents: current.additionalPriceCents,
        quantity: Math.min(Math.max(1, option.quantity), MAX_ITEM_QUANTITY),
      });
    }

    // An option disappeared: the line can no longer be sold exactly as it was.
    if (line.options.length > 0 && reconciledOptions.length === 0) {
      removed += 1;
      changed = true;
      continue;
    }

    if (line.basePriceCents !== product.priceCents || line.productName !== product.name) {
      changed = true;
    }

    const quantity = Math.min(Math.max(1, line.quantity), MAX_ITEM_QUANTITY);

    if (quantity !== line.quantity) {
      changed = true;
    }

    nextLines.push({
      ...line,
      productName: product.name,
      basePriceCents: product.priceCents,
      quantity,
      options: reconciledOptions,
    });
  }

  return {
    lines: nextLines.slice(0, MAX_ORDER_ITEMS),
    changed,
    removed,
  };
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createTrackingToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredLine(value: unknown): CartLine | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.key !== "string" ||
    typeof value.productId !== "string" ||
    typeof value.productName !== "string" ||
    typeof value.basePriceCents !== "number" ||
    !Number.isInteger(value.basePriceCents) ||
    value.basePriceCents < 0 ||
    typeof value.quantity !== "number" ||
    !Number.isInteger(value.quantity) ||
    value.quantity < 1 ||
    value.quantity > MAX_ITEM_QUANTITY ||
    typeof value.notes !== "string" ||
    !Array.isArray(value.options)
  ) {
    return null;
  }

  const options: CartLine["options"] = [];

  for (const option of value.options) {
    if (
      !isRecord(option) ||
      typeof option.groupId !== "string" ||
      typeof option.groupName !== "string" ||
      typeof option.optionId !== "string" ||
      typeof option.name !== "string" ||
      typeof option.priceCents !== "number" ||
      !Number.isInteger(option.priceCents) ||
      option.priceCents < 0 ||
      typeof option.quantity !== "number" ||
      !Number.isInteger(option.quantity) ||
      option.quantity < 1 ||
      option.quantity > MAX_ITEM_QUANTITY
    ) {
      return null;
    }

    options.push({
      groupId: option.groupId,
      groupName: option.groupName,
      optionId: option.optionId,
      name: option.name,
      priceCents: option.priceCents,
      quantity: option.quantity,
    });
  }

  return {
    key: value.key,
    productId: value.productId,
    productName: value.productName,
    basePriceCents: value.basePriceCents,
    quantity: value.quantity,
    notes: value.notes.slice(0, 300),
    options,
  };
}

export function readStoredCart(storeId: string): CartLine[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(`${CART_STORAGE_PREFIX}${storeId}`);

    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(parseStoredLine)
      .filter((line): line is CartLine => Boolean(line))
      .slice(0, MAX_ORDER_ITEMS);
  } catch {
    return [];
  }
}

export function writeStoredCart(storeId: string, lines: readonly CartLine[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(`${CART_STORAGE_PREFIX}${storeId}`, JSON.stringify(lines));
  } catch {
    // Storage can be unavailable (private mode). The cart still works in memory.
  }
}

type TrackingTokens = Record<string, Record<string, string>>;

function readTrackingTokens(): TrackingTokens {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(TRACKING_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return {};
    }

    const tokens: TrackingTokens = {};

    for (const [slug, entries] of Object.entries(parsed)) {
      if (!isRecord(entries)) {
        continue;
      }

      const valid: Record<string, string> = {};

      for (const [number, token] of Object.entries(entries)) {
        if (typeof token === "string" && /^[0-9a-f]{64}$/.test(token)) {
          valid[number] = token;
        }
      }

      tokens[slug] = valid;
    }

    return tokens;
  } catch {
    return {};
  }
}

export function writeTrackingToken(storeSlug: string, orderNumber: number, token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const tokens = readTrackingTokens();
    tokens[storeSlug] = { ...(tokens[storeSlug] ?? {}), [String(orderNumber)]: token };
    window.localStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // Tracking still works through the confirmation link.
  }
}

export function readTrackingToken(storeSlug: string, orderNumber: number): string | null {
  return readTrackingTokens()[storeSlug]?.[String(orderNumber)] ?? null;
}
