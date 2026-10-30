import type { OrderFulfillmentType } from "@/types/database";

export type PricedOption = {
  priceCents: number;
  quantity: number;
};

export type PricedLine = {
  unitPriceCents: number;
  quantity: number;
};

export function optionsTotalCents(options: readonly PricedOption[]): number {
  return options.reduce(
    (total, option) => total + option.priceCents * Math.max(1, option.quantity),
    0,
  );
}

export function itemUnitPriceCents(
  productPriceCents: number,
  options: readonly PricedOption[],
): number {
  return productPriceCents + optionsTotalCents(options);
}

export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  return unitPriceCents * quantity;
}

export type CartTotals = {
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  meetsMinimum: boolean;
  missingForMinimumCents: number;
};

export function computeCartTotals(
  lines: readonly PricedLine[],
  settings: {
    fulfillmentType: OrderFulfillmentType;
    deliveryFeeCents: number;
    minOrderCents: number;
  },
): CartTotals {
  const subtotalCents = lines.reduce(
    (total, line) => total + lineTotalCents(line.unitPriceCents, line.quantity),
    0,
  );
  const deliveryFeeCents =
    settings.fulfillmentType === "delivery" ? Math.max(0, settings.deliveryFeeCents) : 0;
  const missingForMinimumCents = Math.max(0, settings.minOrderCents - subtotalCents);

  return {
    subtotalCents,
    deliveryFeeCents,
    totalCents: subtotalCents + deliveryFeeCents,
    meetsMinimum: missingForMinimumCents === 0,
    missingForMinimumCents,
  };
}
