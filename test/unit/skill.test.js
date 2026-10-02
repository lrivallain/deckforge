// The bundled GitHub Copilot skill (skills/deckforge): its install command and
// its consistency with the code (front-matter, links, template names, commands).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { loadTemplates } from "../../src/server/registry.js";
import { ICON_NAMES } from "../../src/core/icons.js";

const root = path.resolve(import.meta.dirname, "../..");
const cli = path.join(root, "bin/deckforge.js");
const skillDir = path.join(root, "skills/deckforge");
const env = { ...process.env, DECKFORGE_CONFIG_DIR: path.join(os.tmpdir(), "deckforge-test-no-config"), CI: "1" };

let dir;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});
const tmp = () => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-skill-")));
const run = (args, extraEnv = {}) => spawnSync(process.execPath, [cli, ...args], { env: { ...env, ...extraEnv }, encoding: "utf8" });

function skillFiles(base = skillDir) {
  return fs.readdirSync(base, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(base, f)).isFile());
}

describe("skill content", () => {
  const markdown = skillFiles().filter((f) => f.endsWith(".md"));

  it("has valid SKILL.md front-matter", () => {
    const source = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
    expect(match).toBeTruthy();
    const meta = YAML.parse(match[1]);
    expect(meta.name).toBe("deckforge");
    expect(meta.description.length).toBeGreaterThan(100);
    expect(meta.description.length).toBeLessThanOrEqual(1024);
  });

  it("only links to files that exist", () => {
    for (const file of markdown) {
      const source = fs.readFileSync(path.join(skillDir, file), "utf8");
      for (const [, target] of source.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const resolved = path.resolve(path.dirname(path.join(skillDir, file)), target.split("#")[0]);
        expect(fs.existsSync(resolved), `${file} → ${target}`).toBe(true);
      }
    }
  });

  it("names only real built-in templates and icons", () => {
    const { templates } = loadTemplates(null);
    const names = Object.keys(templates);
    const authoring = fs.readFileSync(path.join(skillDir, "references/authoring.md"), "utf8");
    const table = authoring.slice(authoring.indexOf("## 4."), authoring.indexOf("## 5."));
    const mentioned = [...table.matchAll(/^\| [^|]+\| ([^|]+)\|/gm)].flatMap(([, cell]) => [...cell.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]));
    expect(mentioned.length).toBeGreaterThan(5);
    for (const name of mentioned) expect(names, `authoring.md template "${name}"`).toContain(name);
    for (const name of names) expect(table, `template "${name}" missing from the authoring.md map`).toContain(`\`${name}\``);
    const iconLine = authoring.split("\n").find((l) => l.startsWith("| `icon` |"));
    const icons = /\(([^)]+)\)/.exec(iconLine)[1].split(/\s+/).filter((w) => /^[a-z]+$/.test(w));
    expect(icons.length).toBeGreaterThan(10);
    for (const icon of icons) expect(ICON_NAMES, `icon "${icon}"`).toContain(icon);
  });

  it("uses CLI commands and options that exist", () => {
    const help = execFileSync(process.execPath, [cli, "--help"], { env, encoding: "utf8" });
    for (const file of markdown) {
      const source = fs.readFileSync(path.join(skillDir, file), "utf8");
      for (const [, command] of source.matchAll(/deckforge (new|build|templates|edit|serve|skill)\b/g)) expect(help).toContain(`deckforge ${command}`);
      for (const [, option] of source.matchAll(/deckforge [a-z]+[^`\n]*?(--[a-z-]+)/g)) expect(help, `${file}: ${option}`).toContain(option);
    }
  });

  it("ships a layout check that parses as an async function body", () => {
    const body = fs.readFileSync(path.join(skillDir, "scripts/layout-check.js"), "utf8");
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    expect(() => new AsyncFunction(body)).not.toThrow();
  });

  it("is part of the npm package", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.files).toContain("skills");
  });
});

describe("deckforge skill install-copilot", () => {
  it("installs into COPILOT_HOME and updates its own copy", () => {
    const home = tmp();
    const first = run(["skill", "install-copilot"], { COPILOT_HOME: home });
    expect(first.status).toBe(0);
    const target = path.join(home, "skills/deckforge");
    expect(first.stdout).toContain(`Installed the deckforge Copilot skill in ${target}`);
    expect(skillFiles(target).filter((f) => f !== ".deckforge-skill").sort()).toEqual(skillFiles().filter((f) => !f.endsWith(".DS_Store")).sort());
    expect(JSON.parse(fs.readFileSync(path.join(target, ".deckforge-skill"), "utf8")).version).toMatch(/^\d+\.\d+\.\d+$/);
    fs.writeFileSync(path.join(target, "stale.md"), "old");
    const second = run(["skill", "install-copilot"], { COPILOT_HOME: home });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Updated");
    expect(fs.existsSync(path.join(target, "stale.md"))).toBe(false);
  });

  it("refuses to overwrite a folder it did not install, unless --force", () => {
    const skills = tmp();
    fs.mkdirSync(path.join(skills, "deckforge"));
    fs.writeFileSync(path.join(skills, "deckforge/SKILL.md"), "mine");
    const refused = run(["skill", "install-copilot", "--dest", skills]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/not installed by deckforge.*--force/);
    expect(fs.readFileSync(path.join(skills, "deckforge/SKILL.md"), "utf8")).toBe("mine");
    expect(run(["skill", "install-copilot", "--dest", skills, "--force"]).status).toBe(0);
    expect(fs.readFileSync(path.join(skills, "deckforge/SKILL.md"), "utf8")).toContain("name: deckforge");
  });

  it("warns about build-presentation and removes it only on request", () => {
    const skills = tmp();
    fs.mkdirSync(path.join(skills, "build-presentation"));
    const warned = run(["skill", "install-copilot", "--dest", skills]);
    expect(warned.stdout).toContain("--replace-build-presentation");
    expect(fs.existsSync(path.join(skills, "build-presentation"))).toBe(true);
    const replaced = run(["skill", "install-copilot", "--dest", skills, "--replace-build-presentation"]);
    expect(replaced.stdout).toContain("Removed the build-presentation skill");
    expect(fs.existsSync(path.join(skills, "build-presentation"))).toBe(false);
  });

  it("rejects unknown skill actions", () => {
    const result = run(["skill", "install"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("install-copilot");
  });
});
