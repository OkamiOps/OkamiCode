const credentialMarkers = [
  "token",
  "auth",
  "password",
  "passwd",
  "credential",
  "cookie",
  "signature",
  "secret",
] as const;

export function isSafeCalendarHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password || url.hash) return false;

  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
    if (
      normalized === "sig" ||
      normalized === "key" ||
      normalized.endsWith("key") ||
      credentialMarkers.some((marker) => normalized.includes(marker))
    ) {
      return false;
    }
  }
  return true;
}
