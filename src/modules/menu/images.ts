import {
  ALLOWED_IMAGE_MIME_TYPES,
  PRODUCT_IMAGE_BUCKET,
  type AllowedImageMimeType,
} from "@/modules/menu/constants";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMAGE_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export function detectImageMime(bytes: Uint8Array): AllowedImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export function isAllowedImageMime(value: string): value is AllowedImageMimeType {
  return ALLOWED_IMAGE_MIME_TYPES.includes(value as AllowedImageMimeType);
}

export function buildProductImagePath(storeId: string, productId: string): string {
  if (!UUID_PATTERN.test(storeId) || !UUID_PATTERN.test(productId)) {
    throw new Error("Identificador inválido para o caminho da imagem.");
  }

  return `${storeId}/products/${productId}/${crypto.randomUUID()}.webp`;
}

export function isProductImagePath(path: string, storeId: string, productId: string): boolean {
  if (!UUID_PATTERN.test(storeId) || !UUID_PATTERN.test(productId)) {
    return false;
  }

  const prefix = `${storeId}/products/${productId}/`;

  if (!path.startsWith(prefix)) {
    return false;
  }

  return IMAGE_FILENAME_PATTERN.test(path.slice(prefix.length));
}

export function getProductImageUrl(path: string | null): string | null {
  if (!path) {
    return null;
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");

  if (!baseUrl) {
    return null;
  }

  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${baseUrl}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${encodedPath}`;
}
