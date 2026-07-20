import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { MemorySource } from "./config";

const MAX_BYTES = 2 * 1024 * 1024;
const SENSITIVE_LINE =
  /private[_ -]?key|-----BEGIN [A-Z ]*PRIVATE KEY-----|token|password|secret|credential|api[_ -]?key/iu;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/giu;

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

export function scanFile(
  source: MemorySource,
  filePath: string,
): ScannedDocument | null {
  const root = realpathSync(source.scopePath);
  return scanCandidate(root, path.resolve(filePath));
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
    const document = scanCandidate(root, candidate, stat);
    if (document) documents.push(document);
  }
}

function scanCandidate(
  root: string,
  candidate: string,
  knownStat?: Stats,
): ScannedDocument | null {
  const relative = path.relative(root, candidate);
  if (!isWithin(root, candidate) || hasHiddenSegment(relative)) return null;
  let stat: Stats;
  try {
    stat = knownStat ?? lstatSync(candidate);
  } catch {
    return null;
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    path.extname(candidate).toLowerCase() !== ".md" ||
    stat.size > MAX_BYTES
  )
    return null;
  const canonical = realpathSync(candidate);
  if (!isWithin(root, canonical)) return null;
  const content = readFileSync(canonical);
  if (content.includes(0)) return null;
  return toDocument(canonical, content.toString("utf8"), stat);
}

function toDocument(
  filePath: string,
  source: string,
  stat: Stats,
): ScannedDocument {
  // Parse valid YAML first, then sanitize the resulting structure. Removing a
  // parent key before parsing can leave indented children behind and corrupt
  // otherwise valid frontmatter.
  const parsed = matter(source);
  const frontmatter = sanitizeFrontmatter(parsed.data);
  const redactedContent = redactSensitiveContent(parsed.content);
  const plainText = stripMarkdown(redactedContent)
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const heading =
    redactedContent.match(/^#{1,6}\s+(.+)$/mu)?.[1]?.trim() ?? null;
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

function hasHiddenSegment(relative: string): boolean {
  return relative
    .split(path.sep)
    .some((segment) => segment.startsWith(".") || segment === ".trash");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function redactSensitiveContent(source: string): string {
  return source
    .replace(PRIVATE_KEY_BLOCK, "")
    .split(/\r?\n/u)
    .filter((line) => !SENSITIVE_LINE.test(line))
    .join("\n");
}

function sanitizeFrontmatter(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, nested]) =>
          !SENSITIVE_LINE.test(key) && !containsSensitive(nested),
      )
      .map(([key, nested]) => [key, sanitizeValue(nested)]),
  );
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") return sanitizeFrontmatter(value);
  return value;
}

function containsSensitive(value: unknown): boolean {
  if (typeof value === "string") return SENSITIVE_LINE.test(value);
  if (Array.isArray(value)) return value.some(containsSensitive);
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, nested]) => SENSITIVE_LINE.test(key) || containsSensitive(nested),
    );
  }
  return false;
}
