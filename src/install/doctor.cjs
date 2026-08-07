'use strict';

// Verifica una instalacion existente. Es el equivalente portable de las
// aserciones que en el repo de origen estaban inlineadas en el validador:
// comprueba que el proyecto cableo de verdad sus propios gates.

const fs = require('node:fs');
const path = require('node:path');

const profileModule = require('../kernel/profile.cjs');

const REQUIRED_HOOKS = [
  { file: 'plan-gate.cjs', why: 'gate de mutacion por GSC' },
  { file: 'commit-gate.cjs', why: 'gate de commit/push' },
];

function run() {
  const errors = [];
  const warnings = [];

  let profile;
  try {
    profile = profileModule.load();
  } catch (error) {
    console.error(`[doctor] ${error.message}`);
    process.exit(1);
  }

  if (profile.deprecated_version) {
    warnings.push(`el perfil declara protocolo ${profile.protocol_version} (anterior); el kernel envia ${profileModule.PROTOCOL_VERSION}`);
  }

  // Rutas declaradas que deben existir.
  for (const key of ['plans', 'protocol', 'roles', 'state']) {
    const target = path.join(profile.root, profile.paths[key]);
    if (!fs.existsSync(target)) errors.push(`paths.${key} apunta a "${profile.paths[key]}", que no existe`);
  }

  // Cableado real de los gates de sesion.
  const settingsPath = path.join(profile.root, '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    warnings.push('.claude/settings.json ausente: sin gates de sesion, solo queda el gate de CI');
  } else {
    const settings = fs.readFileSync(settingsPath, 'utf8');
    for (const hook of REQUIRED_HOOKS) {
      if (!settings.includes(hook.file)) errors.push(`.claude/settings.json no cablea ${hook.file} (${hook.why})`);
    }
    if (!/Write\|Edit\|MultiEdit\|NotebookEdit/.test(settings)) {
      errors.push('.claude/settings.json: el matcher de mutacion no cubre NotebookEdit');
    }
  }

  // Conocimiento segun politica declarada.
  if (profile.knowledge.obsidian === 'required') {
    const featuresDir = path.join(profile.root, profile.paths.features);
    if (!fs.existsSync(featuresDir)) errors.push(`knowledge.obsidian=required pero falta ${profile.paths.features}`);
  }
  if (profile.knowledge.graph === 'required') {
    warnings.push('knowledge.graph=required depende del harness del agente: CI no puede garantizarlo, solo verificar frescura del digest');
  }

  // CI: el gate de sesion nunca puede ser el unico control.
  const workflows = path.join(profile.root, '.github', 'workflows');
  if (!fs.existsSync(workflows) || !fs.readdirSync(workflows).length) {
    errors.push('sin workflows de CI: los hooks de un cliente IA son defensa adicional, nunca el unico control');
  }

  for (const warning of warnings) console.warn(`[doctor] AVISO ${warning}`);
  if (errors.length) {
    for (const error of errors) console.error(`[doctor] ERROR ${error}`);
    process.exit(1);
  }
  console.log(`[doctor] PASS — protocolo ${profile.protocol_version} en ${profile.root}`);
  return { errors, warnings };
}

module.exports = { run };
