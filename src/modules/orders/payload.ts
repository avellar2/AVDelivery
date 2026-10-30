import type { CheckoutAddress, CheckoutInput } from "@/modules/orders/types";

function trimAddress(address: CheckoutAddress): CheckoutAddress {
  return {
    street: address.street.trim(),
    number: address.number.trim(),
    complement: address.complement.trim(),
    district: address.district.trim(),
    city: address.city.trim(),
    reference: address.reference.trim(),
    postalCode: address.postalCode.trim(),
  };
}

function optionSignature(options: CheckoutInput["items"][number]["options"]): string {
  return [...options]
    .sort(
      (left, right) =>
        left.groupId.localeCompare(right.groupId) || left.optionId.localeCompare(right.optionId),
    )
    .map((option) => `${option.groupId}:${option.optionId}:${option.quantity}`)
    .join("|");
}

/**
 * Normalizes a validated checkout into a deterministic payload.
 * The same attempt always produces the same payload, which lets the server
 * detect idempotency-key reuse with different content.
 */
export function canonicalizeCheckout(input: CheckoutInput): CheckoutInput {
  return {
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone,
    fulfillmentType: input.fulfillmentType,
    address:
      input.fulfillmentType === "delivery" && input.address ? trimAddress(input.address) : null,
    paymentMethod: input.paymentMethod,
    notes: input.notes.trim(),
    items: input.items
      .map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        notes: item.notes.trim(),
        options: [...item.options]
          .sort(
            (left, right) =>
              left.groupId.localeCompare(right.groupId) ||
              left.optionId.localeCompare(right.optionId),
          )
          .map((option) => ({ ...option })),
      }))
      .sort(
        (left, right) =>
          left.productId.localeCompare(right.productId) ||
          left.notes.localeCompare(right.notes) ||
          optionSignature(left.options).localeCompare(optionSignature(right.options)) ||
          left.quantity - right.quantity,
      ),
  };
}
