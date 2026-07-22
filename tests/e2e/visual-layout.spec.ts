import { expect, test, type Page } from "@playwright/test";
import { launchIsolatedApp } from "./launch";

const destinations = [
  "Início",
  "Agentes",
  "Modelos",
  "Memória",
  "Uso e limites",
  "Conexões",
  "Configurações",
  "Nova conversa",
] as const;

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    horizontal:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    bodyHorizontal: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  expect(overflow.bodyHorizontal).toBeLessThanOrEqual(1);
}

// Playwright requires a destructured fixture argument even though Electron
// tests launch their own application process.
// eslint-disable-next-line no-empty-pattern
test("core surfaces render in the real Electron shell without page overflow", async ({}, testInfo) => {
  const app = await launchIsolatedApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(
      page.getByRole("navigation", { name: "Navegação principal" }),
    ).toBeVisible();

    for (const destination of destinations) {
      await page
        .getByRole(destination === "Nova conversa" ? "button" : "link", {
          name: destination,
        })
        .click();
      await page.waitForTimeout(250);
      await expect(
        page.locator(".chat-main, .inbox-shell__main").first(),
      ).toBeVisible();
      await expectNoPageOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(
          `${destination.toLowerCase().replaceAll(" ", "-")}.png`,
        ),
        fullPage: true,
      });
    }
  } finally {
    app.process().kill("SIGTERM");
  }
});

test("renderer keeps Node isolated and the preload bridge available", async () => {
  const app = await launchIsolatedApp();
  try {
    const page = await app.firstWindow();
    expect(
      await page.evaluate(
        () => typeof (window as unknown as { require?: unknown }).require,
      ),
    ).toBe("undefined");
    expect(await page.evaluate(() => typeof window.okami)).toBe("object");
  } finally {
    app.process().kill("SIGTERM");
  }
});
