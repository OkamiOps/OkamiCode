import type { AuditEntry, AuditRepository } from "../db/repositories/audit";
import { redactAuditValue, type RedactionOptions } from "./redaction";

export interface AuditExportWriter {
  append(path: string, contents: string): Promise<void> | void;
}

export interface AuditExportOptions {
  path: string;
  writer: AuditExportWriter;
  redaction?: RedactionOptions;
}

export interface AuditExportResult {
  entryCount: number;
}

/**
 * Redacts every row before serializing, then issues exactly one append to the
 * injected writer. The caller owns the selected path and its authorization.
 */
export async function exportAuditEntries(
  entries: readonly AuditEntry[],
  options: AuditExportOptions,
): Promise<AuditExportResult> {
  const contents = entries
    .slice()
    .sort(compareAuditEntries)
    .map(
      (entry) =>
        `${stableJsonStringify(redactAuditValue(entry, options.redaction))}\n`,
    )
    .join("");

  await options.writer.append(options.path, contents);
  return { entryCount: entries.length };
}

export async function exportAuditRepository(
  audit: Pick<AuditRepository, "list">,
  options: AuditExportOptions,
): Promise<AuditExportResult> {
  return exportAuditEntries(audit.list(), options);
}

function compareAuditEntries(left: AuditEntry, right: AuditEntry): number {
  return (
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.id.localeCompare(right.id)
  );
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
  );
}
