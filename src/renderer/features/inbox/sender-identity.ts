import type { CSSProperties } from "react";

export function senderAddress(value: string): string {
  return (value.match(/<([^>]+)>/u)?.[1] ?? value).trim().toLowerCase();
}

export function senderLabel(value: string): string {
  const named = value.replace(/\s*<[^>]+>/u, "").trim();
  if (named && named !== value.trim()) return named;
  const address = senderAddress(value);
  return address.includes("@") ? address.split("@")[0]! : named || value;
}

export function senderDomain(value: string): string | null {
  const address = senderAddress(value);
  const separator = address.lastIndexOf("@");
  return separator > 0 ? `@${address.slice(separator + 1)}` : null;
}

export function senderIdentityStyle(value: string): CSSProperties {
  return { "--sender-hue": `${senderHue(value)}deg` } as CSSProperties;
}

export function senderHue(value: string): number {
  let hash = 2_166_136_261;
  for (const character of senderAddress(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  // Adjacent entries are intentionally far apart on the color wheel. A
  // continuous hash produced technically different but visually identical
  // greens for common mailbox names such as "marcos" and "contato".
  const palette = [190, 28, 270, 135, 330, 55, 220, 15, 160, 300, 90, 245];
  return palette[(hash >>> 0) % palette.length]!;
}
