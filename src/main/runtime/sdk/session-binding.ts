import type { RuntimeKind } from "../../../shared/contracts/lane";

const SESSION_PREFIX = "okami:v1:";

const RETIRED_TRANSPORT_ALIASES = {
  claude: [],
  codex: [],
  cursor: [],
  agy: [],
  grok: [],
  mimo: ["mimo-cli"],
  minimax: ["minimax-cli"],
  opencode: [],
} as const satisfies Record<RuntimeKind, readonly string[]>;

export interface DecodedTransportSessionBinding {
  transportId: string;
  nativeSessionId: string;
}

export function encodeTransportSessionBinding(
  transportId: string,
  nativeSessionId: string,
): string {
  return `${SESSION_PREFIX}${transportId}:${Buffer.from(nativeSessionId).toString("base64url")}`;
}

export function decodeTransportSessionBinding(
  value: string,
): DecodedTransportSessionBinding | undefined {
  if (!value.startsWith(SESSION_PREFIX)) return undefined;
  const binding = value.slice(SESSION_PREFIX.length);
  const separator = binding.indexOf(":");
  if (separator <= 0 || separator === binding.length - 1) {
    throw new Error("Invalid Okami transport session binding");
  }
  const transportId = binding.slice(0, separator);
  const nativeSessionId = Buffer.from(
    binding.slice(separator + 1),
    "base64url",
  ).toString("utf8");
  if (!nativeSessionId) throw new Error("Empty native session binding");
  return { transportId, nativeSessionId };
}

export function isRetiredTransportAlias(
  runtimeKind: RuntimeKind,
  transportId: string,
): boolean {
  const aliases = RETIRED_TRANSPORT_ALIASES[runtimeKind] as readonly string[];
  return aliases.includes(transportId);
}

export function isRetiredTransportBinding(
  runtimeKind: RuntimeKind,
  nativeSessionId: string,
): boolean {
  const decoded = decodeTransportSessionBinding(nativeSessionId);
  return Boolean(
    decoded && isRetiredTransportAlias(runtimeKind, decoded.transportId),
  );
}
