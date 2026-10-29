import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildProductImagePath,
  detectImageMime,
  getProductImageUrl,
  isProductImagePath,
} from "@/modules/menu/images";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("detectImageMime", () => {
  it("detecta JPEG, PNG e WebP pelos bytes", () => {
    expect(detectImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("image/jpeg");
    expect(
      detectImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
    ).toBe("image/png");
    expect(
      detectImageMime(
        Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe("image/webp");
  });

  it("rejeita conteúdo que não é imagem", () => {
    expect(detectImageMime(Uint8Array.from([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
    expect(detectImageMime(Uint8Array.from([0x00]))).toBeNull();
    expect(detectImageMime(new Uint8Array())).toBeNull();
  });
});

describe("buildProductImagePath", () => {
  it("gera caminho por loja, produto e UUID aleatório", () => {
    const path = buildProductImagePath(STORE_ID, PRODUCT_ID);

    expect(path).toMatch(
      new RegExp(
        `^${STORE_ID}/products/${PRODUCT_ID}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webp$`,
      ),
    );
    expect(buildProductImagePath(STORE_ID, PRODUCT_ID)).not.toBe(path);
  });

  it("rejeita identificadores inválidos", () => {
    expect(() => buildProductImagePath("loja", PRODUCT_ID)).toThrow();
    expect(() => buildProductImagePath(STORE_ID, "../produto")).toThrow();
  });
});

describe("isProductImagePath", () => {
  it("aceita somente caminhos do próprio produto", () => {
    const path = buildProductImagePath(STORE_ID, PRODUCT_ID);

    expect(isProductImagePath(path, STORE_ID, PRODUCT_ID)).toBe(true);
    expect(isProductImagePath(path, STORE_ID, OTHER_ID)).toBe(false);
    expect(isProductImagePath(path, OTHER_ID, PRODUCT_ID)).toBe(false);
    expect(
      isProductImagePath(`${STORE_ID}/products/${PRODUCT_ID}/../../x.webp`, STORE_ID, PRODUCT_ID),
    ).toBe(false);
    expect(
      isProductImagePath(`${STORE_ID}/products/${PRODUCT_ID}/file.png`, STORE_ID, PRODUCT_ID),
    ).toBe(false);
  });
});

describe("getProductImageUrl", () => {
  it("monta a URL pública do bucket", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co/");

    const path = buildProductImagePath(STORE_ID, PRODUCT_ID);
    const url = getProductImageUrl(path);

    expect(url).toBe(`https://example.supabase.co/storage/v1/object/public/product-images/${path}`);
    expect(getProductImageUrl(null)).toBeNull();
  });

  it("retorna null sem configuração", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    expect(getProductImageUrl(`${STORE_ID}/products/${PRODUCT_ID}/file.webp`)).toBeNull();
  });
});
