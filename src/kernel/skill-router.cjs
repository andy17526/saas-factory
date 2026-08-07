'use strict';

// Resuelve rutas tocadas -> features -> skills requeridas.
// Reusa patternMatches() del kernel: mismo matcher de globs que el GSC, para que
// el ruteo y el permiso de fichero no puedan divergir en su interpretacion.

const fs = require('node:fs');
const path = require('node:path');
const { normalizePath, patternMatches } = require('./protocol-contract.cjs');

// La tabla es JSON, no YAML: el kernel es zero-dep y un parser YAML parcial
// escrito a mano es una fuente de fallos silenciosos en un fichero que gobierna
// permisos. JSON falla ruidosamente o no falla.
function loadRouting(profile) {
  const routingPath = path.join(profile.root, profile.paths.skill_routing);
  if (!fs.existsSync(routingPath)) return { features: [], domains: [] };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
  } catch (error) {
    throw new Error(`${profile.paths.skill_routing} con JSON invalido: ${error.message}`);
  }
  return { features: parsed.features || [], domains: parsed.domains || [] };
}

function entryMatches(entry, filePath) {
  return (entry.code_paths || []).some((pattern) => patternMatches(filePath, normalizePath(pattern)));
}

function skillsOf(entry) {
  const own = entry.skill ? [entry.skill] : [];
  return [...own, ...(entry.also_require || [])];
}

// Devuelve el conjunto de skills exigidas por un conjunto de rutas, mas trazas
// de por que se exigen (para que el mensaje de error sea accionable).
function resolveSkills(paths, profile, routing = null) {
  const table = routing || loadRouting(profile);
  const entries = [...table.features, ...table.domains];
  const skills = new Set();
  const features = new Set();
  const reasons = [];
  const unrouted = [];

  for (const raw of paths) {
    const filePath = normalizePath(raw);
    const hits = entries.filter((entry) => entryMatches(entry, filePath));
    if (!hits.length) {
      unrouted.push(filePath);
      continue;
    }
    for (const hit of hits) {
      if (hit.feature) features.add(hit.feature);
      for (const skill of skillsOf(hit)) {
        skills.add(skill);
        reasons.push({ path: filePath, skill, via: hit.feature || hit.domain });
      }
    }
  }

  return {
    skills: [...skills].sort(),
    features: [...features].sort(),
    reasons,
    unrouted,
  };
}

module.exports = { loadRouting, resolveSkills };
