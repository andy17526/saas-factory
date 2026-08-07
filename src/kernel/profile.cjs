'use strict';

// Cargador del perfil de proyecto. Todo lo que en el repo de origen estaba
// hardcodeado como rutas (protocol-validate.cjs:183-346, protocol-contract.cjs:799-801)
// vive aqui como datos declarados por el proyecto consumidor.

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_NAME = 'saas-factory.config.json';

// El kernel envia la version actual y acepta tambien la anterior con aviso.
// Sin este rango, un bump del protocolo invalidaria de golpe todos los GSC del
// proyecto consumidor, que es justo lo que el §14 del core prohibe hacer en masa.
const PROTOCOL_VERSION = '2.7.0';
const PROTOCOL_VERSION_PREVIOUS = '2.6.4';

const DEFAULTS = {
  protocol_version: PROTOCOL_VERSION,
  paths: {
    plans: 'docs/07-plans',
    plan_templates: 'docs/07-plans/_templates',
    protocol: 'docs/00-system/protocol',
    roles: 'docs/00-system/protocol/roles',
    state: 'docs/00-system/state/session_state.md',
    state_history: 'docs/00-system/state/session_state_history.md',
    decisions: 'docs/00-system/state/decisions_log.md',
    incidents: 'docs/00-system/state/incident_state.md',
    evidence: 'docs/06-evidence',
    features: 'docs/02-features',
    feature_registry: 'docs/00-system/knowledge-registry/features.yaml',
    skill_routing: 'docs/00-system/knowledge-registry/skill-routing.json',
    skills: '.claude/skills',
    skill_dossiers: 'docs/06-evidence/skills',
  },
  contract_source: { mode: 'EFFECTIVE_REPOSITORY', sources: [] },
  zones: { safe: [], controlled: [], high_risk: [] },
  knowledge: { obsidian: 'required', graph: 'optional' },
  versioning: { apps: [] },
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

// Sube desde startDir hasta encontrar el fichero de perfil. Permite invocar los
// gates desde cualquier subdirectorio del proyecto consumidor.
function findRoot(startDir) {
  const explicit = process.env.SAAS_FACTORY_ROOT;
  if (explicit) return path.resolve(explicit);
  let current = path.resolve(startDir || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, CONFIG_NAME))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function validate(profile) {
  const errors = [];
  const declared = profile.protocol_version;
  if (declared !== PROTOCOL_VERSION && declared !== PROTOCOL_VERSION_PREVIOUS) {
    errors.push(
      `protocol_version "${declared}" no soportado por este kernel; admite ${PROTOCOL_VERSION} y ${PROTOCOL_VERSION_PREVIOUS}`,
    );
  }
  for (const key of ['plans', 'state', 'protocol', 'roles']) {
    if (!profile.paths?.[key]) errors.push(`paths.${key} es obligatorio`);
  }
  if (!['FORMAL_OPENAPI', 'EFFECTIVE_REPOSITORY'].includes(profile.contract_source?.mode)) {
    errors.push('contract_source.mode debe ser FORMAL_OPENAPI o EFFECTIVE_REPOSITORY');
  }
  if (profile.contract_source?.mode === 'EFFECTIVE_REPOSITORY' && !profile.contract_source.sources?.length) {
    errors.push('contract_source.sources no puede estar vacio en modo EFFECTIVE_REPOSITORY');
  }
  if (!['required', 'optional', 'off'].includes(profile.knowledge?.obsidian)) {
    errors.push('knowledge.obsidian debe ser required, optional u off');
  }
  if (!['required', 'optional', 'off'].includes(profile.knowledge?.graph)) {
    errors.push('knowledge.graph debe ser required, optional u off');
  }
  return errors;
}

function load(root) {
  const resolvedRoot = root || findRoot();
  if (!resolvedRoot) {
    throw new Error(`No se encontro ${CONFIG_NAME}. Ejecuta "npx saas-factory init" en la raiz del proyecto.`);
  }
  const configPath = path.join(resolvedRoot, CONFIG_NAME);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`${CONFIG_NAME} ilegible o con JSON invalido: ${error.message}`);
  }
  const profile = deepMerge(DEFAULTS, raw);
  const errors = validate(profile);
  if (errors.length) throw new Error(`${CONFIG_NAME} invalido:\n  - ${errors.join('\n  - ')}`);
  profile.root = resolvedRoot;
  profile.deprecated_version = profile.protocol_version === PROTOCOL_VERSION_PREVIOUS;
  return profile;
}

// Rutas excluidas del digest de evidencia: el carril de estado no forma parte del
// diff auditado. En el repo de origen estaban inlineadas en protocol-contract.cjs.
function stateExcludedPaths(profile) {
  return [profile.paths.state, profile.paths.state_history, profile.paths.decisions].filter(Boolean);
}

module.exports = {
  CONFIG_NAME,
  DEFAULTS,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_PREVIOUS,
  deepMerge,
  findRoot,
  load,
  stateExcludedPaths,
  validate,
};
