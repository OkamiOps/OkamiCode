import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSkills } from "./readers";

function writeSkill(
  root: string,
  relative: string,
  name: string,
  description: string,
): void {
  const directory = path.join(root, relative);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n`,
  );
}

describe("readSkills", () => {
  it("discovers project, shared and plugin skills with honest runtime support", () => {
    const root = mkdtempSync(path.join(tmpdir(), "okami-skills-"));
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    writeSkill(
      home,
      ".agents/skills/frontend-design",
      "frontend-design",
      "Premium UI and UX design.",
    );
    writeSkill(
      home,
      ".codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/systematic-debugging",
      "systematic-debugging",
      "Debug code methodically.",
    );
    writeSkill(
      workspace,
      ".claude/skills/project-research",
      "project-research",
      "Research this workspace.",
    );

    const skills = readSkills(workspace, 100, home);

    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          invocation: "frontend-design",
          category: "Design",
          runtimes: ["claude", "codex"],
          source: "pessoal · compartilhada",
        }),
        expect.objectContaining({
          invocation: "systematic-debugging",
          category: "Code review",
          runtimes: ["codex"],
          source: expect.stringContaining("Superpowers"),
        }),
        expect.objectContaining({
          invocation: "project-research",
          runtimes: ["claude"],
          source: "projeto · Claude",
        }),
      ]),
    );
  });
});
