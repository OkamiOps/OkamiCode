import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import path from "node:path";
import type { MemorySource } from "./config";

const MAX_BYTES = 2 * 1024 * 1024;
const SENSITIVE_LINE =
  /private\s*key|-----BEGIN [A-Z ]*PRIVATE KEY-----|token|password|secret|credential|api[_ -]?key/iu;

export type ScannedDocument = {
  path: string;
  title: string;
  heading: string | null;
  frontmatter: Record<string, unknown>;
  plainText: string;
  contentHash: string;
  modifiedAt: string;
};

export function scanSource(source: MemorySource): ScannedDocument[] {
  const root = realpathSync(source.scopePath);
  const documents: ScannedDocument[] = [];
  visit(root, root, documents);
  return documents.sort((left, right) => left.path.localeCompare(right.path));
}

function visit(
  root: string,
  directory: string,
  documents: ScannedDocument[],
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name.startsWith(".") ||
      entry.name === ".git" ||
      entry.name === ".trash"
    )
      continue;
    const candidate = path.join(directory, entry.name);
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      visit(root, candidate, documents);
      continue;
    }
    if (!stat.isFile() || path.extname(entry.name).toLowerCase() !== ".md")
      continue;
    if (stat.size > MAX_BYTES) continue;
    const canonical = realpathSync(candidate);
    if (!isWithin(root, canonical)) continue;
    const content = readFileSync(canonical);
    if (content.includes(0)) continue;
    documents.push(toDocument(canonical, content.toString("utf8"), stat));
  }
}

function toDocument(
  filePath: string,
  source: string,
  stat: Stats,
): ScannedDocument {
  const parsed = parseFrontmatter(source);
  const frontmatter = parsed.data;
  const plainText = stripMarkdown(parsed.content)
    .split("\n")
    .filter((line) => !SENSITIVE_LINE.test(line))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const heading =
    parsed.content.match(/^#{1,6}\s+(.+)$/mu)?.[1]?.trim() ?? null;
  const title =
    stringValue(frontmatter.title) ?? heading ?? path.basename(filePath, ".md");
  return {
    path: filePath,
    title,
    heading,
    frontmatter,
    plainText,
    contentHash: createHash("sha256").update(plainText).digest("hex"),
    modifiedAt: stat.mtime.toISOString(),
  };
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/!?(?:\[([^\]]*)\]\([^)]*\))/gu, "$1")
    .replace(/[*_`>]/gu, "")
    .replace(/^[-+*]\s+/gmu, "");
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseFrontmatter(source: string): {
  content: string;
  data: Record<string, unknown>;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(source);
  if (!match) return { content: source, data: {} };
  const data: Record<string, unknown> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/u)) {
    if (SENSITIVE_LINE.test(line)) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!key || SENSITIVE_LINE.test(`${key}: ${rawValue}`)) continue;
    data[key] = parseFrontmatterValue(rawValue);
  }
  return { content: source.slice(match[0].length), data };
}

function parseFrontmatterValue(value: string): unknown {
  if (/^\[.*\]$/u.test(value)) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (value === "true" || value === "false") return value === "true";
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  return value.replace(/^['"]|['"]$/gu, "");
}
