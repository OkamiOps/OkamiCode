import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { launchIsolatedApp } from "./launch";

test("Token Plan models remain visible from the last provider-discovered catalog", async () => {
  const app = await launchIsolatedApp(async (userData) => {
    const catalog = (models: Array<{ id: string; label: string }>) =>
      JSON.stringify({
        cliPath: "provider /models",
        fetchedAt: "2026-07-24T12:00:00.000Z",
        models,
      });
    await Promise.all([
      writeFile(
        path.join(userData, "mimo-models.json"),
        catalog([{ id: "mimo-provider-live", label: "MiMo Provider Live" }]),
      ),
      writeFile(
        path.join(userData, "minimax-models.json"),
        catalog([
          {
            id: "MiniMax-Provider-Live",
            label: "MiniMax Provider Live",
          },
        ]),
      ),
    ]);
  });
  try {
    const page = await app.firstWindow();
    const catalog = await page.evaluate(() =>
      window.okami.invoke["models:list"]({}),
    );
    expect(
      catalog.find((entry) => entry.runtimeKind === "mimo")?.models,
    ).toContainEqual(expect.objectContaining({ id: "mimo-provider-live" }));
    expect(
      catalog.find((entry) => entry.runtimeKind === "minimax")?.models,
    ).toContainEqual(expect.objectContaining({ id: "MiniMax-Provider-Live" }));

    await page.getByRole("link", { name: "Code" }).click();
    await page
      .locator(".chat-session", { hasText: "Primeira tarefa" })
      .locator(".chat-session__open")
      .click();
    await page.getByRole("button", { name: "Selecionar modelo" }).click();
    await page.getByRole("tab", { name: /MiMo/u }).click();
    await expect(
      page.getByRole("option", { name: /MiMo Provider Live/u }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /MiniMax/u }).click();
    await expect(
      page.getByRole("option", { name: /MiniMax Provider Live/u }),
    ).toBeVisible();
  } finally {
    app.process().kill("SIGTERM");
  }
});
