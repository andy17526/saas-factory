#!/usr/bin/env node
'use strict';

// CLI del linter de skills. Bloquea sobre las skills propias del proyecto e
// inventaria las de terceros por hash, para que un cambio no declarado sea visible.

const fs = require('node:fs');
const path = require('node:path');

const profile = require('./profile.cjs').load();
const { lint } = require('./skill-lint.cjs');

const ownedPrefix = process.env.SAAS_FACTORY_SKILL_PREFIX || 'own-';
const { blocking, inventory } = lint(profile, { ownedPrefix });

const manifestPath = path.join(profile.root, profile.paths.evidence, 'third-party-skills.json');
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;

if (previous) {
  const before = new Map(previous.skills.map((s) => [s.skill, s.sha256]));
  for (const entry of inventory) {
    const known = before.get(entry.skill);
    if (known === undefined) console.warn(`[skill-lint] AVISO skill de terceros nueva sin declarar: ${entry.skill}`);
    else if (known !== entry.sha256) console.warn(`[skill-lint] AVISO skill de terceros modificada: ${entry.skill}`);
  }
  for (const skill of before.keys()) {
    if (!inventory.some((e) => e.skill === skill)) console.warn(`[skill-lint] AVISO skill de terceros desaparecida: ${skill}`);
  }
} else if (inventory.length) {
  console.warn(`[skill-lint] AVISO no existe ${path.relative(profile.root, manifestPath)}; ${inventory.length} skills de terceros sin inventariar`);
}

if (blocking.length) {
  for (const finding of blocking) {
    console.error(`[skill-lint] ${finding.severity} ${finding.rule} ${finding.file}:${finding.line} — ${finding.reason}`);
    if (finding.excerpt) console.error(`             > ${finding.excerpt}`);
  }
  process.exit(1);
}

console.log(`[skill-lint] PASS (${inventory.length} skills de terceros inventariadas)`);
