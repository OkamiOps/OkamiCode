import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { SafeStorage } from "../../connectors/credential-vault";
import {
  ProviderCredentialVault,
  VaultTokenPlanSource,
} from "./provider-credential-vault";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true })),
  );
});

it("stores Token Plan credentials encrypted and exposes no pay-as-you-go alias", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "okami-provider-vault-"));
  directories.push(directory);
  const safeStorage: SafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) =>
      Buffer.from(`encrypted:${Buffer.from(value).toString("base64")}`),
    decryptString: (value) =>
      Buffer.from(
        value.toString("utf8").slice("encrypted:".length),
        "base64",
      ).toString("utf8"),
  };
  const vault = new ProviderCredentialVault(directory, safeStorage);

  await vault.set("mimo", {
    token: "tp-secret-mimo",
    baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
  });

  expect(await vault.get("mimo")).toEqual({
    token: "tp-secret-mimo",
    baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
  });
  expect(
    Buffer.concat(
      await Promise.all(
        (await readdir(directory)).map((file) =>
          readFile(path.join(directory, file)),
        ),
      ),
    ).toString("utf8"),
  ).not.toContain("tp-secret-mimo");
  const source = new VaultTokenPlanSource("mimo", vault);
  await expect(source.get()).resolves.toBe("tp-secret-mimo");
  await expect(source.baseUrl()).resolves.toBe(
    "https://token-plan-ams.xiaomimimo.com/v1",
  );
});

it("requires the provider-specific Token Plan key format", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "okami-provider-vault-"));
  directories.push(directory);
  const safeStorage: SafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString("utf8"),
  };
  const vault = new ProviderCredentialVault(directory, safeStorage);

  await expect(
    vault.set("mimo", {
      token: "sk-payg-is-forbidden",
      baseUrl: "https://api.xiaomimimo.com/v1",
    }),
  ).rejects.toThrow(/Token Plan/u);
  await expect(
    vault.set("minimax", { token: "sk-ordinary-payg" }),
  ).rejects.toThrow(/Token Plan/u);
});
