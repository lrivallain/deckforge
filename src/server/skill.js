// Install the bundled GitHub Copilot skill (skills/deckforge) as a personal
// skill: $COPILOT_HOME/skills/deckforge, or ~/.copilot/skills/deckforge.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PACKAGE_ROOT } from "./registry.js";

export const SKILL_NAME = "deckforge";
export const SKILL_SOURCE_DIR = path.join(PACKAGE_ROOT, "skills", SKILL_NAME);
export const SKILL_MARKER = ".deckforge-skill";
export const LEGACY_SKILL_NAME = "build-presentation";

export function copilotSkillsDir() {
  const home = process.env.COPILOT_HOME ? path.resolve(process.env.COPILOT_HOME) : path.join(os.homedir(), ".copilot");
  return path.join(home, "skills");
}

/**
 * Copy skills/deckforge into <skillsDir>/deckforge.
 * A previous copy installed by deckforge (it has the marker file) is replaced;
 * any other existing folder is kept unless `force` is set.
 * @returns {{ target: string, upgraded: boolean, legacy: string|null, legacyRemoved: boolean }}
 */
export function installCopilotSkill({ skillsDir = copilotSkillsDir(), force = false, replaceLegacy = false, version } = {}) {
  if (!fs.existsSync(path.join(SKILL_SOURCE_DIR, "SKILL.md"))) throw new Error(`The skill is missing from this deckforge install (${SKILL_SOURCE_DIR})`);
  const target = path.join(path.resolve(skillsDir), SKILL_NAME);
  let upgraded = false;
  if (fs.existsSync(target)) {
    const managed = fs.existsSync(path.join(target, SKILL_MARKER));
    if (!managed && !force) throw new Error(`${target} already exists and was not installed by deckforge (use --force to replace it)`);
    upgraded = true;
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(SKILL_SOURCE_DIR, target, { recursive: true, filter: (src) => path.basename(src) !== ".DS_Store" });
  fs.writeFileSync(path.join(target, SKILL_MARKER), `${JSON.stringify({ version, installedAt: new Date().toISOString() }, null, 2)}\n`);

  const legacyPath = path.join(path.dirname(target), LEGACY_SKILL_NAME);
  const legacy = fs.existsSync(legacyPath) ? legacyPath : null;
  let legacyRemoved = false;
  if (legacy && replaceLegacy) {
    fs.rmSync(legacy, { recursive: true, force: true });
    legacyRemoved = true;
  }
  return { target, upgraded, legacy, legacyRemoved };
}
