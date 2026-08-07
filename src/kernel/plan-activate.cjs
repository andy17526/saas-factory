#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  ACTIVE_PLAN_STATUSES,
  auditorCloseoutValid,
  collateralFindingsClosed,
  computeEvidenceDigest,
  findPlanFile,
  frontmatter,
  parseScopeContract,
  TERMINAL_PLAN_STATUSES,
} = require('./protocol-contract.cjs');

const repoRoot = process.env.SAAS_FACTORY_ROOT
  ? path.resolve(process.env.SAAS_FACTORY_ROOT)
  : path.resolve(__dirname, '..', '..');
const markerPath = path.join(repoRoot, '.claude', 'active-plan.json');

function writeMarker(marker) {
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
}

function phaseMatches(phaseRef, requested) {
  if (!requested) return true;
  const target = Number(String(requested).replace(/^F/i, ''));
  if (!Number.isInteger(target)) return false;
  return String(phaseRef).split(',').some((part) => {
    const range = part.trim().match(/^F?(\d+)(?:-F?(\d+))?$/i);
    if (!range) return false;
    const start = Number(range[1]);
    const end = Number(range[2] || range[1]);
    return target >= Math.min(start, end) && target <= Math.max(start, end);
  });
}

function die(message) {
  console.error(`[plan-gate] ${message}`);
  process.exit(1);
}

function hasPendingCloseoutChanges() {
  try { execFileSync('git', ['diff', '--quiet'], { cwd: repoRoot, stdio: 'ignore' }); }
  catch { return true; }
  try { execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: repoRoot, stdio: 'ignore' }); }
  catch { return true; }
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repoRoot })
    .toString().split('\0').filter(Boolean).map((value) => value.replace(/\\/g, '/'));
  return untracked.some((value) => value !== '.claude/active-plan.json');
}

const arg = process.argv[2];

if (arg === '--new') {
  const planRef = process.argv[3];
  const relative = String(process.argv[4] || '').replace(/\\/g, '/');
  if (!/^PLAN-\d{4}-\d{3,4}$/.test(planRef || '')) die('Uso: plan-activate.cjs --new PLAN-YYYY-NNN docs/07-plans/P<N>-<tier>/PLAN-...md');
  if (!/^docs\/07-plans\/P[0-3]-[^/]+\/PLAN-\d{4}-\d{3,4}-.+\.md$/.test(relative) || !path.basename(relative).startsWith(`${planRef}-`)) {
    die('La ruta del plan nuevo no es una ruta activa valida o no coincide con el PLAN_REF.');
  }
  if (fs.existsSync(markerPath)) die('Ya existe un plan o bootstrap activo; cierralo antes de crear otro.');
  if (fs.existsSync(path.join(repoRoot, relative))) die(`El archivo ya existe: ${relative}`);
  const bootstrapToken = crypto.randomUUID();
  writeMarker({ plan_ref: planRef, bootstrap_only: true, bootstrap_kind: 'new_plan', bootstrap_token: bootstrapToken, allowed_files: [{ path: relative, change_type: 'create', scope_mode: 'new_file' }], activated_at: new Date().toISOString() });
  console.log(`[plan-gate] Bootstrap autorizado solo para ${relative}; incluye BOOTSTRAP_TOKEN: ${bootstrapToken} en la ficha draft.`);
  process.exit(0);
}

if (arg === '--approve-new') {
  const planRef = process.argv[3];
  if (!fs.existsSync(markerPath)) die('No hay bootstrap activo para aprobar.');
  const bootstrap = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  const entry = bootstrap.allowed_files?.length === 1 ? bootstrap.allowed_files[0] : null;
  if (bootstrap.bootstrap_only !== true || bootstrap.bootstrap_kind !== 'new_plan' || bootstrap.plan_ref !== planRef || !entry) die('El marcador no corresponde al plan nuevo solicitado.');
  const planFile = path.join(repoRoot, entry.path);
  if (!fs.existsSync(planFile)) die('La ficha draft aun no existe.');
  const markerBirth = fs.statSync(markerPath).birthtimeMs;
  const planBirth = fs.statSync(planFile).birthtimeMs;
  const activatedAt = new Date(bootstrap.activated_at).getTime();
  if (!Number.isFinite(activatedAt) || Math.abs(markerBirth - activatedAt) > 2_000 || planBirth < markerBirth) {
    die('La ficha no fue creada despues del marcador emitido por --new.');
  }
  let content = fs.readFileSync(planFile, 'utf8');
  if (frontmatter(content, 'id') !== planRef || frontmatter(content, 'status') !== 'draft') die('La ficha debe tener id coincidente y status draft.');
  if (!new RegExp(`^BOOTSTRAP_TOKEN:\\s*${bootstrap.bootstrap_token}$`, 'm').test(content)) die('BOOTSTRAP_TOKEN ausente o no coincidente.');
  const parsed = parseScopeContract(content, planRef);
  if (parsed.errors.length || !parsed.contract) die(`GSC invalido:\n- ${parsed.errors.join('\n- ')}`);
  const frontmatterEnd = content.indexOf('\n---', 4);
  const approvedFrontmatter = content.slice(0, frontmatterEnd).replace(/^status:\s*draft$/m, 'status: approved');
  content = `${approvedFrontmatter}${content.slice(frontmatterEnd)}`.replace(/^BOOTSTRAP_TOKEN:.*\r?\n?/m, '');
  fs.writeFileSync(planFile, content);
  writeMarker({ plan_ref: planRef, phase_ref: parsed.contract.phase_ref, scope_contract_id: parsed.contract.contract_id, contract_sha256: parsed.contract.contract_sha256, allowed_files: parsed.contract.files_allowed.map(({ path: filePath, change_type, scope_mode, symbols_allowed }) => ({ path: filePath, change_type, scope_mode, symbols_allowed })), forbidden_zones: parsed.contract.forbidden_zones, activated_at: new Date().toISOString() });
  console.log(`[plan-gate] Plan nuevo aprobado y activo: ${planRef}; GSC=${parsed.contract.contract_id}.`);
  process.exit(0);
}

if (arg === '--status') {
  console.log(fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8') : 'No hay plan activo.');
  process.exit(0);
}

if (arg === '--done') {
  if (!fs.existsSync(markerPath)) die('No hay plan activo que cerrar.');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (marker.bootstrap_only) die('El bootstrap no puede cerrarse; completa y activa el GSC primero.');
  const planFile = findPlanFile(repoRoot, marker.plan_ref);
  if (!planFile) die(`No existe una unica ficha para ${marker.plan_ref}.`);
  const relative = path.relative(repoRoot, planFile).replace(/\\/g, '/');
  const content = fs.readFileSync(planFile, 'utf8');
  const status = frontmatter(content, 'status');
  if (!TERMINAL_PLAN_STATUSES.has(status)) die(`${marker.plan_ref} tiene status="${status}"; se requiere done, completed o discarded.`);
  if (!relative.includes('/archive/') && !relative.includes('/discarded/')) die(`${marker.plan_ref} esta cerrado pero no archivado: ${relative}`);
  if (!collateralFindingsClosed(content)) die(`${marker.plan_ref} no tiene COLLATERAL_FINDINGS cerrado.`);
  const { contract, errors } = parseScopeContract(content, marker.plan_ref);
  if (errors.length || !contract) die(`${marker.plan_ref} no tiene un GSC valido para cierre.`);
  if (contract.contract_id !== marker.scope_contract_id || contract.contract_sha256 !== marker.contract_sha256) die('El GSC cambio; reactiva el plan antes del cierre.');
  const digest = computeEvidenceDigest(repoRoot, contract.base_ref, relative);
  if (!auditorCloseoutValid(content, contract, marker.plan_ref, digest)) die(`${marker.plan_ref} no tiene Auditor post-mutacion valido para este plan/base/GSC/diff.`);
  if (hasPendingCloseoutChanges()) die('El cierre terminal aun tiene cambios staged, unstaged o untracked; commitea el cierre antes de --done.');
  fs.unlinkSync(markerPath);
  console.log(`[plan-gate] Plan activo cerrado (${marker.plan_ref}).`);
  process.exit(0);
}

if (!arg || !/^PLAN-\d{4}-\d{3,4}$/.test(arg)) die('Uso: plan-activate.cjs PLAN-YYYY-NNN [fase] | --new PLAN-YYYY-NNN ruta | --approve-new PLAN-YYYY-NNN | --done | --status');

const planFile = findPlanFile(repoRoot, arg);
if (!planFile) die(`No existe una unica ficha para ${arg} en docs/07-plans/.`);
const content = fs.readFileSync(planFile, 'utf8');
const status = frontmatter(content, 'status');
if (!ACTIVE_PLAN_STATUSES.has(status)) die(`${arg} tiene status="${status}"; se requiere approved/in-progress.`);

const { contract, errors } = parseScopeContract(content, arg);
if (!contract) {
  const relative = path.relative(repoRoot, planFile).replace(/\\/g, '/');
  writeMarker({ plan_ref: arg, bootstrap_only: true, bootstrap_kind: 'legacy_migration', allowed_files: [{ path: relative, change_type: 'modify', scope_mode: 'anchored_block' }], activated_at: new Date().toISOString() });
  console.log(`[plan-gate] ${arg} es legacy: bootstrap autorizado solo para migrar su propia ficha a GSC v2.7.0.`);
  process.exit(0);
}
if (errors.length) die(`GSC invalido:\n- ${errors.join('\n- ')}`);

const requestedPhase = process.argv[3] || null;
if (!phaseMatches(contract.phase_ref, requestedPhase)) {
  die(`La fase solicitada ${requestedPhase} no coincide con phase_ref=${contract.phase_ref}.`);
}

const marker = {
  plan_ref: arg,
  phase_ref: contract.phase_ref,
  scope_contract_id: contract.contract_id,
  contract_sha256: contract.contract_sha256,
  allowed_files: contract.files_allowed.map(({ path: filePath, change_type, scope_mode, symbols_allowed }) => ({ path: filePath, change_type, scope_mode, symbols_allowed })),
  forbidden_zones: contract.forbidden_zones,
  activated_at: new Date().toISOString(),
};
writeMarker(marker);
console.log(`[plan-gate] Plan activo: ${arg}; GSC=${contract.contract_id}; scope=${marker.allowed_files.length}.`);
