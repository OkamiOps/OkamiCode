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

// eslint-disable-next-line no-empty-pattern
test("Code project controls persist and remain visually stable", async ({}, testInfo) => {
  const app = await launchIsolatedApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(async () => {
      await window.okami.invoke["task:create"]({
        title: "Visual QA",
        objective: "Validar a experiência do painel Code",
        workspacePath: "/Users/marcos/Documents/Git/Chat-Panel",
        useWorktree: false,
      });
    });
    await page.reload();
    await page.getByRole("link", { name: "Code" }).click();

    const seededProject = page.locator(".chat-session", {
      hasText: "Primeira tarefa",
    });
    await seededProject.locator(".chat-session__open").click();
    const laneHealth = page.getByLabel("Saúde da lane");
    await expect(laneHealth).toContainText(/Claude|Codex/);
    await expect(laneHealth).toContainText("Contexto");
    await expectNoPageOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("lane-health-1440.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 760, height: 900 });
    await expect(laneHealth).toBeVisible();
    await expectNoPageOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("lane-health-760.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });

    const project = page.locator(".chat-session", { hasText: "Visual QA" });
    await expect(project).toBeVisible();

    await project.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Fixar projeto" }).click();
    await expect(page.getByLabel("Projeto fixado: Visual QA")).toBeVisible();

    await project.click({ button: "right" });
    await page.getByRole("menuitemradio", { name: "Usar cor violeta" }).click();
    await expect(project).toHaveAttribute("data-color", "violet");

    const unreadTask = await page.evaluate(async () => {
      const [lanes, tasks] = await Promise.all([
        window.okami.invoke["lane:list"]({}),
        window.okami.invoke["task:list"]({}),
      ]);
      const lane = lanes[0];
      const task = lane
        ? tasks.find((candidate) => candidate.id === lane.taskId)
        : null;
      if (!lane || !task) return null;
      localStorage.setItem(
        "okami.code.project-activity",
        JSON.stringify({ unreadByLane: { [lane.laneId]: 1 } }),
      );
      return task.title;
    });
    expect(unreadTask).not.toBeNull();
    await page.reload();
    await page.getByRole("link", { name: "Code" }).click();
    await expect(page.getByLabel("1 resultado não lido")).toBeVisible();

    await expectNoPageOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("code-project-controls.png"),
      fullPage: true,
    });
  } finally {
    app.process().kill("SIGTERM");
  }
});
