import { describe, expect, it } from "vitest";

import {
  formatCurrency,
  formatDateTime,
  formatElapsed,
  paymentLabel,
  paymentStatusLabel,
  phoneHref,
} from "../src/lib/format";

describe("formatCurrency", () => {
  it("renders cents as Brazilian reais", () => {
    expect(formatCurrency(1234).replace(/ /g, " ")).toBe("R$ 12,34");
  });
});

describe("formatDateTime", () => {
  it("returns a dash for missing or invalid values", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });

  it("formats a valid date with day, month, hour and minute", () => {
    expect(formatDateTime("2026-10-30T14:05:00.000Z")).toMatch(/\d{2}\/\d{2}, \d{2}:\d{2}/);
  });
});

describe("formatElapsed", () => {
  it("scales from seconds to minutes to hours", () => {
    expect(formatElapsed(1_000, 46_000)).toBe("45s");
    expect(formatElapsed(1_000, 121_000)).toBe("2min");
    expect(formatElapsed(0, 3_600_000)).toBe("1h00");
  });

  it("uses a dash without a reference", () => {
    expect(formatElapsed(null, Date.now())).toBe("—");
  });
});

describe("labels", () => {
  it("translates payment method and status", () => {
    expect(paymentLabel("pix")).toBe("Pix");
    expect(paymentLabel("cash")).toBe("Dinheiro");
    expect(paymentLabel("card_on_delivery")).toBe("Cartão na entrega");
    expect(paymentStatusLabel("pending")).toBe("Pagamento pendente");
    expect(paymentStatusLabel("paid")).toBe("Pago");
  });
});

describe("phoneHref", () => {
  it("normalizes Brazilian numbers with the country code", () => {
    expect(phoneHref("(11) 99999-9999")).toBe("tel:5511999999999");
    expect(phoneHref("5511999999999")).toBe("tel:5511999999999");
  });

  it("rejects short numbers and empty values", () => {
    expect(phoneHref("1234")).toBeNull();
    expect(phoneHref(null)).toBeNull();
  });
});
