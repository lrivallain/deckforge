// Template/theme discovery with lookup order:
//   1. <deck dir>/templates|themes   (scope "deck")
//   2. ~/.config/deckforge/...       (scope "user")
//   3. built-ins shipped with deckforge (scope "builtin")
// The first definition of a name wins.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTemplate } from "../core/template.js";
import { parseTheme } from "../core/theme.js";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BUILTIN_TEMPLATES_DIR = path.join(PACKAGE_ROOT, "templates");
export const BUILTIN_THEMES_DIR = path.join(PACKAGE_ROOT, "themes");
export const DIST_DIR = path.join(PACKAGE_ROOT, "dist");

export function configDir() {
  if (process.env.DECKFORGE_CONFIG_DIR) return path.resolve(process.env.DECKFORGE_CONFIG_DIR);
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "deckforge");
}

export function lookupDirs(deckDir, kind) {
  const dirs = [];
  if (deckDir) dirs.push({ scope: "deck", dir: path.join(deckDir, kind) });
  dirs.push({ scope: "user", dir: path.join(configDir(), kind) });
  dirs.push({ scope: "builtin", dir: kind === "templates" ? BUILTIN_TEMPLATES_DIR : BUILTIN_THEMES_DIR });
  return dirs;
}

function listFiles(dir, extensions) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext)))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Load all templates. Returns { templates: {name: template}, errors: [{path, message}] } */
export function loadTemplates(deckDir) {
  const templates = {};
  const errors = [];
  for (const { scope, dir } of lookupDirs(deckDir, "templates")) {
    for (const file of listFiles(dir, [".html"])) {
      const name = file.replace(/\.html$/, "");
      if (templates[name]) continue;
      const filePath = path.join(dir, file);
      try {
        const template = parseTemplate(fs.readFileSync(filePath, "utf8"), { name, scope, path: filePath });
        if (template.name !== name) throw new Error(`front-matter name "${template.name}" does not match file name "${name}"`);
        templates[name] = template;
      } catch (err) {
        errors.push({ path: filePath, message: err.message, details: err.details });
      }
    }
  }
  return { templates, errors };
}

export function loadThemes(deckDir) {
  const themes = {};
  const errors = [];
  for (const { scope, dir } of lookupDirs(deckDir, "themes")) {
    for (const file of listFiles(dir, [".yaml", ".yml"])) {
      const name = file.replace(/\.ya?ml$/, "");
      if (themes[name]) continue;
      const filePath = path.join(dir, file);
      try {
        const theme = parseTheme(fs.readFileSync(filePath, "utf8"), { name, scope, path: filePath });
        if (theme.name !== name) throw new Error(`theme name "${theme.name}" does not match file name "${name}"`);
        themes[name] = theme;
      } catch (err) {
        errors.push({ path: filePath, message: err.message, details: err.details });
      }
    }
  }
  return { themes, errors };
}

/** Resolve the directory a template should be saved into for a scope. */
export function templateDirFor(scope, deckDir) {
  if (scope === "deck") return path.join(deckDir, "templates");
  if (scope === "user") return path.join(configDir(), "templates");
  throw new Error(`Cannot write templates with scope "${scope}"`);
}
