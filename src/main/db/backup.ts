import SqliteDatabase from "better-sqlite3-multiple-ciphers";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import path from "node:path";

type DatabaseConnection = InstanceType<typeof SqliteDatabase>;

export interface DatabaseBackupResult {
  file: string;
  integrity: "ok";
  sizeBytes: number;
  createdAt: string;
}

export interface DatabaseRestoreResult {
  integrity: "ok";
  safetyCopy?: string;
  restoredAt: string;
}

function timestampForFile(value: Date): string {
  return value.toISOString().replaceAll(":", "-");
}

function configureCipher(database: DatabaseConnection, key: Buffer): void {
  database.pragma(`cipher='sqlcipher'`);
  database.pragma(`key="x'${key.toString("hex")}'"`);
}

function verifyEncryptedDatabase(file: string, key: Buffer): "ok" {
  const candidate = new SqliteDatabase(file, { readonly: true });
  try {
    configureCipher(candidate, key);
    candidate.prepare("SELECT count(*) FROM sqlite_master").get();
    const integrity = candidate.pragma("integrity_check", {
      simple: true,
    }) as string;
    if (integrity !== "ok") {
      throw new Error(`Database integrity check failed: ${integrity}`);
    }
    return "ok";
  } finally {
    candidate.close();
  }
}

export function createVerifiedDatabaseBackup(options: {
  database: DatabaseConnection;
  databaseFile: string;
  backupDirectory: string;
  key: Buffer;
  now?: Date;
}): DatabaseBackupResult {
  const now = options.now ?? new Date();
  mkdirSync(options.backupDirectory, { recursive: true });
  const baseName = path.basename(
    options.databaseFile,
    path.extname(options.databaseFile),
  );
  const file = path.join(
    options.backupDirectory,
    `${baseName}-${timestampForFile(now)}.db`,
  );

  options.database.prepare("VACUUM INTO ?").run(file);
  const integrity = verifyEncryptedDatabase(file, options.key);
  return {
    file,
    integrity,
    sizeBytes: statSync(file).size,
    createdAt: now.toISOString(),
  };
}

export function restoreVerifiedDatabaseBackup(options: {
  backupFile: string;
  databaseFile: string;
  key: Buffer;
  now?: Date;
}): DatabaseRestoreResult {
  const now = options.now ?? new Date();
  verifyEncryptedDatabase(options.backupFile, options.key);

  const destinationDirectory = path.dirname(options.databaseFile);
  mkdirSync(destinationDirectory, { recursive: true });
  const stagingFile = path.join(
    destinationDirectory,
    `.${path.basename(options.databaseFile)}.restore-${timestampForFile(now)}`,
  );
  copyFileSync(options.backupFile, stagingFile);
  verifyEncryptedDatabase(stagingFile, options.key);

  let safetyCopy: string | undefined;
  if (existsSync(options.databaseFile)) {
    safetyCopy = `${options.databaseFile}.pre-restore-${timestampForFile(now)}`;
    renameSync(options.databaseFile, safetyCopy);
  }

  try {
    renameSync(stagingFile, options.databaseFile);
  } catch (error) {
    if (safetyCopy && !existsSync(options.databaseFile)) {
      renameSync(safetyCopy, options.databaseFile);
    }
    throw error;
  }

  return {
    integrity: verifyEncryptedDatabase(options.databaseFile, options.key),
    safetyCopy,
    restoredAt: now.toISOString(),
  };
}
