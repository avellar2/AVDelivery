const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeRedirectPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const path = value.trim();

  if (!path.startsWith("/") || path.startsWith("//")) {
    return fallback;
  }

  if (path.includes("\\") || CONTROL_CHARACTERS.test(path)) {
    return fallback;
  }

  return path;
}
