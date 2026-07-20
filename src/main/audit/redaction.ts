const SENSITIVE_KEY =
  /token|secret|password|authorization|cookie|private[_-]?key/i;
const BEARER_CREDENTIAL = /\bbearer\s+[^\s,;]+/i;
const JWT_CREDENTIAL = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const API_KEY_CREDENTIAL = /\b(?:x-)?api[-_ ]?key\s*(?:=|:)\s*\S+/i;
const API_KEY_PREFIX = /\b(?:sk|pk|rk|AIza)-[A-Za-z0-9_-]{8,}\b/;

export const REDACTED_VALUE = "[REDACTED]";

export interface RedactionOptions {
  filesystemPaths?: readonly string[];
}

/**
 * Produces a redacted clone suitable for a local audit export. Audit payloads
 * are JSON values, so preserving their primitives, arrays, and plain objects
 * is enough while avoiding mutation of the persisted source object.
 */
export function redactAuditValue(
  value: unknown,
  options: RedactionOptions = {},
): unknown {
  const filesystemPaths = [...(options.filesystemPaths ?? [])]
    .filter((path) => path.length > 0)
    .sort((left, right) => right.length - left.length);

  return redact(value, filesystemPaths, new WeakMap<object, unknown>());
}

function redact(
  value: unknown,
  filesystemPaths: readonly string[],
  seen: WeakMap<object, unknown>,
): unknown {
  if (typeof value === "string") return redactString(value, filesystemPaths);
  if (value === null || typeof value !== "object") return value;

  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    for (const item of value) result.push(redact(item, filesystemPaths, seen));
    return result;
  }

  const result: Record<string, unknown> = {};
  seen.set(value, result);
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? REDACTED_VALUE
      : redact(nestedValue, filesystemPaths, seen);
  }
  return result;
}

function redactString(
  value: string,
  filesystemPaths: readonly string[],
): string {
  if (
    BEARER_CREDENTIAL.test(value) ||
    JWT_CREDENTIAL.test(value) ||
    API_KEY_CREDENTIAL.test(value) ||
    API_KEY_PREFIX.test(value)
  ) {
    return REDACTED_VALUE;
  }

  let result = value;
  for (const path of filesystemPaths) {
    result = result.split(path).join(REDACTED_VALUE);
  }
  return result;
}
