#!/usr/bin/env node
'use strict';

// Enforcement de CI para el estandar de versionado del proyecto.
// Ver docs/VERSIONING.md del proyecto consumidor.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const profile = require('./profile.cjs').load();
const repoRoot = profile.root;

// Las apps versionadas las declara el perfil del proyecto (versioning.apps),
// no el kernel. Cada entrada: { name, triggerPrefixes[], packagePath }.
const APPS = profile.versioning.apps;

function die(message) {
  console.error(`[version-check] ${message}`);
  console.error('[version-check] Ver docs/VERSIONING.md');
  process.exit(1);
}

function parseArgs(argv) {
  const out = { base: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') out.base = argv[++i];
  }
  return out;
}

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

function changedFiles(baseRef) {
  const output = git(['diff', '--name-only', baseRef]);
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

function versionAt(relativePath, ref) {
  try {
    const content = git(['show', `${ref}:${relativePath}`]);
    return JSON.parse(content).version;
  } catch {
    return null;
  }
}

function versionNow(relativePath) {
  const full = path.join(repoRoot, relativePath);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, 'utf8')).version;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.base) die('Uso: version-check.cjs --base <ref>');

  const touched = changedFiles(args.base);
  const failures = [];

  for (const app of APPS) {
    const touchesTrigger = touched.some((file) =>
      app.triggerPrefixes.some((prefix) => file.startsWith(prefix)),
    );
    if (!touchesTrigger) continue;

    const before = versionAt(app.packagePath, args.base);
    const after = versionNow(app.packagePath);
    if (before === null) continue; // sin version previa que comparar (caso defensivo)
    if (before === after) {
      failures.push(
        `apps/${app.name}: el diff toca ${app.triggerPrefixes.join(' o ')} pero ${app.packagePath} sigue en ${after}. ` +
          `Corre: node scripts/saas-factory-helpers/version-bump.cjs --app ${app.name}`,
      );
    }
  }

  if (failures.length) {
    failures.forEach((message) => console.error(`[version-check] ${message}`));
    console.error('[version-check] Ver docs/VERSIONING.md');
    process.exit(1);
  }

  console.log('[version-check] PASS');
}

main();
