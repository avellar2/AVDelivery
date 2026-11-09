import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for opaque tokens. Both sides are hashed first so
 * differing lengths do not leak through the comparison itself.
 */
export function timingSafeTokenMatches(
  providedToken: string | null | undefined,
  expectedToken: string | null | undefined,
): boolean {
  if (!providedToken || !expectedToken) {
    return false;
  }

  const provided = createHash("sha256").update(providedToken, "utf8").digest();
  const expected = createHash("sha256").update(expectedToken, "utf8").digest();

  return timingSafeEqual(provided, expected);
}
