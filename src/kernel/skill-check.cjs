#!/usr/bin/env node
'use strict';

// Gate de CI para el ruteo de skills. Calcado de version-check.cjs: deriva la
// obligacion de las rutas realmente tocadas por el diff y falla cerrado.
//
// Tres comprobaciones:
//   1. El diff toca rutas ruteadas -> el GSC del plan declara esas skills.
//   2. Toda feature registrada tiene entrada de ruteo y directorio de skill.
//   3. Todo glob ruteado hace match con al menos una ruta real (mata globs muertos).

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const profileModule = require('./profile.cjs');
const { loadRouting, resolveSkills } = require('./skill-router.cjs');
const { findPlanFile, parseScopeContract, normalizePath } = require('./protocol-contract.cjs');

function parseArgs(argv) {
  const out = { base: null };
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === '--base') out.base = argv[++i];
  return out;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function changedFiles(root, baseRef) {
  return git(root, ['diff', '--name-only', baseRef]).split('\n').map((l) => l.trim()).filter(Boolean);
}

function trackedFiles(root) {
  return git(root, ['ls-files']).split('\n').map((l) => l.trim()).filter(Boolean);
}

// 1) Skills exigidas por el diff frente a las declaradas en el GSC activo.
function checkDeclared(profile, routing, touched) {
  const failures = [];
  const required = resolveSkills(touched, profile, routing);
  if (!required.skills.length) return failures;

  const markerPath = path.join(profile.root, '.claude', 'active-plan.json');
  if (!fs.existsSync(markerPath)) {
    failures.push(
      `el diff toca rutas ruteadas (${required.features.join(', ') || 'dominio transversal'}) pero no hay plan activo que declare required_skills`,
    );
    return failures;
  }
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  const planFile = findPlanFile(profile.root, marker.plan_ref);
  if (!planFile) {
    failures.push(`plan ${marker.plan_ref} ausente o duplicado`);
    return failures;
  }
  const { contract, errors } = parseScopeContract(fs.readFileSync(planFile, 'utf8'), marker.plan_ref);
  if (errors.length || !contract) {
    failures.push(`GSC invalido en ${marker.plan_ref}: ${errors.join('; ')}`);
    return failures;
  }
  const declared = new Set(contract.required_skills || []);
  for (const skill of required.skills) {
    if (declared.has(skill)) continue;
    const why = required.reasons.filter((r) => r.skill === skill).map((r) => `${r.path} (${r.via})`);
    failures.push(`el GSC no declara la skill "${skill}", exigida por: ${why.join(', ')}`);
  }
  return failures;
}

// 2) Sincronia registro de features <-> tabla de ruteo <-> skills en disco.
function checkCoverage(profile, routing) {
  const failures = [];
  const registryPath = path.join(profile.root, profile.paths.feature_registry);
  if (!fs.existsSync(registryPath)) return failures;

  const registry = fs.readFileSync(registryPath, 'utf8');
  const featureIds = [...registry.matchAll(/^\s*-?\s*id:\s*([A-Z][A-Z0-9-]+)/gm)].map((m) => m[1]);
  const routed = new Map(routing.features.map((entry) => [entry.feature, entry]));

  for (const id of featureIds) {
    const entry = routed.get(id);
    if (!entry) {
      failures.push(`la feature ${id} esta registrada pero no tiene entrada en ${profile.paths.skill_routing}`);
      continue;
    }
    if (!entry.skill) continue;
    const skillDir = path.join(profile.root, profile.paths.skills, entry.skill);
    if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
      failures.push(`la feature ${id} rutea a "${entry.skill}" pero no existe ${entry.skill}/SKILL.md`);
    }
  }
  return failures;
}

// 3) Globs muertos: una tabla que apunta a rutas inexistentes decae en silencio.
function checkLiveGlobs(profile, routing, tracked) {
  const failures = [];
  const { patternMatches } = require('./protocol-contract.cjs');
  for (const entry of [...routing.features, ...routing.domains]) {
    for (const pattern of entry.code_paths || []) {
      const normalized = normalizePath(pattern);
      if (!tracked.some((file) => patternMatches(file, normalized))) {
        failures.push(`glob muerto en ${entry.feature || entry.domain}: "${pattern}" no coincide con ningun fichero`);
      }
    }
  }
  return failures;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = profileModule.load();
  const routing = loadRouting(profile);

  const failures = [];
  if (args.base) {
    failures.push(...checkDeclared(profile, routing, changedFiles(profile.root, args.base)));
  }
  failures.push(...checkCoverage(profile, routing));
  failures.push(...checkLiveGlobs(profile, routing, trackedFiles(profile.root)));

  if (failures.length) {
    for (const failure of failures) console.error(`[skill-check] ${failure}`);
    console.error('[skill-check] Ver docs/SKILLS.md');
    process.exit(1);
  }
  console.log('[skill-check] PASS');
}

if (require.main === module) main();
module.exports = { checkCoverage, checkDeclared, checkLiveGlobs };
