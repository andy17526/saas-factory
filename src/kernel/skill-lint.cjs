'use strict';

// Linter de skills. Una SKILL.md es instruccion que el modelo ejecuta, no
// documentacion: su cadena de suministro es superficie de ataque.
//
// Politica: fail-closed sobre las skills propias del proyecto (las que declara
// el perfil como owned_prefix). Las de terceros no se bloquean —romperia CI el
// primer dia por usos legitimos de red— sino que se inventarian por hash, de modo
// que un cambio no declarado sea visible.
//
// La estructura de regla (id / severidad / patron / motivo) replica la del motor
// de reglas de seguridad ya probado en el proyecto de origen.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RULES = [
  {
    id: 'SKL-001',
    severity: 'P0',
    name: 'override_directive',
    patterns: [
      /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
      /disregard\s+(all\s+)?(previous|prior|above|your)/i,
      /override\s+your\s+(instructions?|system|rules?)/i,
      /you\s+are\s+now\s+(a|an|the)\b/i,
      /new\s+instructions?\s*:/i,
    ],
    reason: 'Directiva de override: intenta redirigir al agente en lugar de instruir sobre el codigo.',
  },
  {
    id: 'SKL-002',
    severity: 'P0',
    name: 'network_egress',
    patterns: [/\bcurl\s+-/i, /\bwget\s+/i, /\bnc\s+-/i, /https?:\/\/[^\s`)]*\$\{/, /https?:\/\/[^\s`)]*\$\(/],
    reason: 'Comando de red en una skill: permite exfiltracion o ejecucion de contenido remoto.',
  },
  {
    id: 'SKL-003',
    severity: 'P0',
    name: 'dynamic_eval',
    patterns: [/\beval\s*\(/, /new\s+Function\s*\(/],
    reason: 'Evaluacion dinamica de codigo dentro de una skill.',
  },
  {
    id: 'SKL-004',
    severity: 'P0',
    name: 'secret_reference',
    patterns: [/\.env(\.[a-z]+)?\b/, /\b(api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*\S/i],
    reason: 'Referencia a secretos o credenciales en una skill.',
  },
  {
    id: 'SKL-005',
    severity: 'P1',
    name: 'path_escape',
    patterns: [/(^|[\s`"'(])\/(etc|root|home|var|usr)\//, /\.\.\/\.\.\/\.\./],
    reason: 'Ruta fuera del repositorio: una skill solo describe el proyecto que gobierna.',
  },
];

// Toda invariante debe traer evidencia citable. Es la leccion del incidente de
// evidencia fabricada convertida en regla mecanica: sin ruta:linea, ADR o finding,
// la afirmacion no entra.
const EVIDENCE_RE = /evidence:\s*\S+/i;
const UNVERIFIED_RE = /\bUNVERIFIED\b/;

function scanContent(content, relativePath) {
  const findings = [];
  const lines = content.split(/\r?\n/);
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      lines.forEach((line, index) => {
        if (pattern.test(line)) {
          findings.push({
            rule: rule.id,
            severity: rule.severity,
            name: rule.name,
            file: relativePath,
            line: index + 1,
            reason: rule.reason,
            excerpt: line.trim().slice(0, 120),
          });
        }
      });
    }
  }
  return findings;
}

// Cada afirmacion bajo "## Invariantes" necesita evidencia o marca explicita.
function scanInvariants(content, relativePath) {
  const findings = [];
  const section = content.split(/^##\s+/m).find((block) => /^Invariantes/i.test(block));
  if (!section) {
    findings.push({
      rule: 'SKL-010', severity: 'P1', name: 'missing_invariants', file: relativePath, line: 1,
      reason: 'La skill no declara "## Invariantes": sin aserciones falsables no es auditable.', excerpt: '',
    });
    return findings;
  }
  section.split(/\r?\n/).forEach((line, index) => {
    const isAssertion = /^\s*[-*]\s+\S/.test(line);
    if (!isAssertion) return;
    if (!EVIDENCE_RE.test(line) && !UNVERIFIED_RE.test(line)) {
      findings.push({
        rule: 'SKL-011', severity: 'P1', name: 'unevidenced_invariant', file: relativePath, line: index + 1,
        reason: 'Invariante sin "evidence:" verificable ni marca UNVERIFIED.', excerpt: line.trim().slice(0, 120),
      });
    }
  });
  return findings;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function listSkillFiles(skillsRoot) {
  if (!fs.existsSync(skillsRoot)) return [];
  const out = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (fs.existsSync(skillFile)) out.push({ name: entry.name, file: skillFile });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function lint(profile, { ownedPrefix = 'own-' } = {}) {
  const skillsRoot = path.join(profile.root, profile.paths.skills);
  const blocking = [];
  const inventory = [];

  for (const skill of listSkillFiles(skillsRoot)) {
    const content = fs.readFileSync(skill.file, 'utf8');
    const relative = path.relative(profile.root, skill.file).replaceAll('\\', '/');
    const owned = skill.name.startsWith(ownedPrefix);
    if (owned) {
      blocking.push(...scanContent(content, relative), ...scanInvariants(content, relative));
    } else {
      inventory.push({ skill: skill.name, file: relative, sha256: sha256(content) });
    }
  }

  return { blocking, inventory };
}

module.exports = { RULES, lint, listSkillFiles, scanContent, scanInvariants, sha256 };
