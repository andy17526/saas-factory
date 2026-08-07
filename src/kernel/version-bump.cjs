#!/usr/bin/env node
'use strict';

// Bump determinista de version para las apps declaradas en el perfil.
// El nivel se deriva del risk_tier del GSC del plan activo.

const fs = require('node:fs');
const path = require('node:path');
const { parseScopeContract, frontmatter, findPlanFile } = require('./protocol-contract.cjs');

const repoRoot = process.env.SAAS_FACTORY_ROOT || path.resolve(__dirname, '../..');
const markerPath = path.join(repoRoot, '.claude/active-plan.json');

function die(message) {
  console.error(`[version-bump] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { app: null, level: null, summary: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--app') out.app = argv[++i];
    else if (token === '--level') out.level = argv[++i];
    else if (token === '--summary') out.summary = argv[++i];
  }
  return out;
}

function levelFromContract(contract) {
  const hasContractChanges = (contract.allowed_contract_changes || []).length > 0;
  if (hasContractChanges) return 'major';
  const tier = contract.risk_tier;
  if (tier === 'HIGH' || tier === 'CRITICAL') return 'major';
  if (tier === 'MEDIUM') return 'minor';
  if (tier === 'LOW') return 'patch';
  return null;
}

function resolveFromActivePlan() {
  if (!fs.existsSync(markerPath)) return null;
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    return null;
  }
  if (!marker.plan_ref) return null;
  const planFile = findPlanFile(repoRoot, marker.plan_ref);
  if (!planFile) return null;
  const content = fs.readFileSync(planFile, 'utf8');
  const { contract } = parseScopeContract(content, marker.plan_ref);
  const level = contract ? levelFromContract(contract) : null;
  const title = frontmatter(content, 'title');
  const summary = title ? `${marker.plan_ref}: ${title}` : marker.plan_ref;
  return { level, summary, planRef: marker.plan_ref };
}

function bumpSemver(version, level) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) die(`version actual "${version}" no es semver estricto (X.Y.Z)`);
  let [, major, minor, patch] = match.map((value, index) => (index === 0 ? value : Number(value)));
  if (level === 'major') { major += 1; minor = 0; patch = 0; }
  else if (level === 'minor') { minor += 1; patch = 0; }
  else if (level === 'patch') { patch += 1; }
  else die(`level invalido: ${level}`);
  return `${major}.${minor}.${patch}`;
}

function writePackageVersion(packagePath, nextVersion) {
  const content = fs.readFileSync(packagePath, 'utf8');
  const lineRegex = /^(\s*"version"\s*:\s*")[^"]*(")/m;
  if (!lineRegex.test(content)) die(`${packagePath}: no se encontro un campo "version" de nivel superior`);
  const updated = content.replace(lineRegex, `$1${nextVersion}$2`);
  fs.writeFileSync(packagePath, updated);
}

function prependChangelog(changelogPath, appName, version, summary) {
  const date = new Date().toISOString().slice(0, 10);
  const entry = `## ${version} - ${date}\n\n- ${summary}\n\n`;
  if (!fs.existsSync(changelogPath)) {
    const header = `# Changelog — ${appName}\n\nVer [VERSIONING.md](../../docs/VERSIONING.md).\n\n`;
    fs.writeFileSync(changelogPath, header + entry);
    return;
  }
  const existing = fs.readFileSync(changelogPath, 'utf8');
  const headerMatch = /^# Changelog[^\n]*\n\n(?:Ver \[[^\]]*\]\([^)]*\)\.\n\n)?/.exec(existing);
  if (headerMatch) {
    const insertAt = headerMatch[0].length;
    fs.writeFileSync(changelogPath, existing.slice(0, insertAt) + entry + existing.slice(insertAt));
  } else {
    fs.writeFileSync(changelogPath, entry + existing);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.app || !['api', 'web'].includes(args.app)) {
    die('Uso: version-bump.cjs --app api|web [--level patch|minor|major] [--summary "..."]');
  }

  let level = args.level;
  let summary = args.summary;
  if (level && !['patch', 'minor', 'major'].includes(level)) die(`--level invalido: ${level}`);

  if (!level || !summary) {
    const fromPlan = resolveFromActivePlan();
    if (!level) {
      if (!fromPlan || !fromPlan.level) {
        die('No se pudo autodetectar --level (sin plan activo valido o risk_tier no reconocido); pasalo explicito.');
      }
      level = fromPlan.level;
    }
    if (!summary) {
      if (!fromPlan) die('No se pudo autodetectar --summary (sin plan activo); pasalo explicito.');
      summary = fromPlan.summary;
    }
  }

  const packagePath = path.join(repoRoot, 'apps', args.app, 'package.json');
  if (!fs.existsSync(packagePath)) die(`No existe ${packagePath}`);
  const currentVersion = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
  const nextVersion = bumpSemver(currentVersion, level);

  writePackageVersion(packagePath, nextVersion);
  const changelogPath = path.join(repoRoot, 'apps', args.app, 'CHANGELOG.md');
  prependChangelog(changelogPath, args.app, nextVersion, summary);

  console.log(`[version-bump] apps/${args.app}: ${currentVersion} -> ${nextVersion} (${level})`);
  console.log(`[version-bump] tag: v${nextVersion}-${args.app}`);
}

main();
