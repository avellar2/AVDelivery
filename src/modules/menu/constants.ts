export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export const MAX_PRODUCT_PRICE_CENTS = 10_000_000;
export const MAX_OPTION_PRICE_CENTS = 1_000_000;
export const MAX_SORT_ORDER = 1_000_000;
export const MAX_SELECTION = 20;
