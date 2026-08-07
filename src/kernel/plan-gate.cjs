#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ACTIVE_PLAN_STATUSES,
  findPlanFile,
  frontmatter,
  isPathAllowed,
  normalizePath,
  parseScopeContract,
} = require('./protocol-contract.cjs');

const repoRoot = process.env.SAAS_FACTORY_ROOT
  ? path.resolve(process.env.SAAS_FACTORY_ROOT)
  : path.resolve(__dirname, '..', '..');
const markerPath = path.join(repoRoot, '.claude', 'active-plan.json');
const realRepoRoot = fs.realpathSync.native(repoRoot);

function allow() {
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function relativePath(filePath) {
  if (!filePath) return null;
  if (path.sep === '/' && filePath.includes('\\')) return null;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  return normalizePath(path.relative(repoRoot, absolute));
}

function escapesRealRepository(filePath) {
  let probe = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  while (path.dirname(probe) !== probe) {
    try { fs.lstatSync(probe); break; } catch { probe = path.dirname(probe); }
  }
  try {
    if (fs.lstatSync(probe).isSymbolicLink()) {
      const target = fs.readlinkSync(probe);
      probe = path.isAbsolute(target) ? target : path.resolve(path.dirname(probe), target);
      while (path.dirname(probe) !== probe) {
        try { fs.lstatSync(probe); break; } catch { probe = path.dirname(probe); }
      }
    }
  } catch {
    return true;
  }
  const realTarget = fs.realpathSync.native(probe);
  const relative = path.relative(realRepoRoot, realTarget);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let filePath;
  try {
    const toolInput = JSON.parse(input)?.tool_input;
    filePath = toolInput?.file_path || toolInput?.notebook_path;
  } catch {
    deny('SaaS-Factory v2.7.0: input de mutacion no parseable; gate fail-closed.');
    return;
  }

  const relative = relativePath(filePath);
  if (!relative) return deny('SaaS-Factory v2.7.0: file_path ausente; gate fail-closed.');
  if (relative.startsWith('..')) return deny(`SaaS-Factory v2.7.0: mutacion fuera del repositorio denegada: "${relative}".`);
  if (escapesRealRepository(filePath)) return deny(`SaaS-Factory v2.7.0: destino real fuera del repositorio: "${relative}".`);

  if (!fs.existsSync(markerPath)) return deny(`SaaS-Factory v2.7.0: no hay plan/GSC activo para mutar "${relative}".`);
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    return deny('SaaS-Factory v2.7.0: active-plan.json invalido; reactiva el plan.');
  }

  if (marker.bootstrap_only === true) {
    const entry = marker.allowed_files?.length === 1 ? marker.allowed_files[0] : null;
    const age = Date.now() - new Date(marker.activated_at).getTime();
    const validRef = /^PLAN-\d{4}-\d{3,4}$/.test(marker.plan_ref || '');
    const validPath = entry && /^docs\/07-plans\/P[0-3]-[^/]+\/PLAN-\d{4}-\d{3,4}-.+\.md$/.test(entry.path)
      && path.basename(entry.path).startsWith(`${marker.plan_ref}-`);
    const validKind = marker.bootstrap_kind === 'new_plan' || marker.bootstrap_kind === 'legacy_migration';
    if (!validRef || !validPath || !validKind || !Number.isFinite(age) || age < 0 || age > 3_600_000) {
      return deny('Marcador bootstrap invalido o expirado; ejecuta plan-activate.cjs de nuevo.');
    }
    const bootstrapPlan = path.join(repoRoot, entry.path);
    if (marker.bootstrap_kind === 'new_plan') {
      if (entry.change_type !== 'create' || entry.scope_mode !== 'new_file' || !/^[0-9a-f-]{36}$/i.test(marker.bootstrap_token || '')) return deny('Marcador new_plan con contrato o token invalido.');
      if (fs.existsSync(bootstrapPlan)) {
        return deny('La creacion bootstrap es de una sola escritura; revisa la ficha y usa plan-activate.cjs --approve-new.');
      }
    } else {
      const legacyPlan = findPlanFile(repoRoot, marker.plan_ref);
      if (entry.change_type !== 'modify' || legacyPlan !== bootstrapPlan || !legacyPlan) return deny('Marcador legacy_migration no corresponde a un plan unico.');
      const legacyContent = fs.readFileSync(legacyPlan, 'utf8');
      if (!ACTIVE_PLAN_STATUSES.has(frontmatter(legacyContent, 'status')) || !parseScopeContract(legacyContent, marker.plan_ref).errors.length) {
        return deny('legacy_migration solo permite completar un plan activo con GSC ausente o invalido.');
      }
    }
    return entry.path === relative ? allow() : deny(`Bootstrap de plan limitado a "${entry.path}".`);
  }

  const planFile = findPlanFile(repoRoot, marker.plan_ref);
  if (!planFile) return deny(`SaaS-Factory v2.7.0: plan ${marker.plan_ref} ausente o duplicado.`);
  const content = fs.readFileSync(planFile, 'utf8');
  if (!ACTIVE_PLAN_STATUSES.has(frontmatter(content, 'status'))) return deny(`${marker.plan_ref} no esta approved/in-progress.`);
  const { contract, errors } = parseScopeContract(content, marker.plan_ref);
  if (errors.length) return deny(`GSC invalido: ${errors.join('; ')}`);
  if (contract.contract_id !== marker.scope_contract_id || contract.contract_sha256 !== marker.contract_sha256) {
    return deny('El GSC cambio desde la activacion; revisa y reactiva el plan.');
  }
  if (!isPathAllowed(contract, relative)) return deny(`"${relative}" no esta permitido por ${contract.contract_id}.`);
  return allow();
});
