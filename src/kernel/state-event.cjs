#!/usr/bin/env node
/**
 * state-event.cjs - Append-only operational events for SaaS-Factory v2.7.0
 *
 * Appends un evento inmutable al log de estado del proyecto.
 * state_events.yaml is supporting historical evidence.
 * session_state.md remains the canonical resumable current state.
 *
 * Uso:
 *   node state-event.cjs <actor> <event_type> <description> [severity]
 *
 * Ejemplos:
 *   node state-event.cjs AG-ARCH PHASE_TRANSITION "FASE2 → FASE3: Stack elegido"
 *   node state-event.cjs AG-QA VETO_ISSUED "VETO-P1: falta idempotency_key" P1
 *   node state-event.cjs AG-BE TASK_COMPLETE "Módulo de pagos implementado"
 *   node state-event.cjs GATEKEEPER SESSION_START "Sesión iniciada desde session_state.md"
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Configuración ──────────────────────────────────────────────────────────────
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR
  || path.resolve(__dirname, '..', '..');

const STATE_DIR = path.join(PROJECT_ROOT, 'docs', '00-system', 'legacy-agent-memory', 'ai-memory');
const EVENTS_FILE  = path.join(STATE_DIR, 'state_events.yaml');
const SESSION_FILE = path.join(STATE_DIR, 'session_state.md');

// ── Tipos de evento válidos ────────────────────────────────────────────────────
const VALID_EVENTS = new Set([
  'SESSION_START', 'SESSION_END', 'SESSION_RESUME',
  'PHASE_TRANSITION', 'PHASE_COMPLETED', 'PHASE_ROLLBACK',
  'CHECKPOINT_EMITTED', 'STATE_STALE_DETECTED', 'STATE_REVALIDATED',
  'VETO_ISSUED', 'VETO_RESOLVED',
  'TASK_START', 'TASK_COMPLETE', 'TASK_BLOCKED',
  'DECISION_RECORDED', 'CONTRACT_CHANGE', 'CHANGE_CONTROL',
  'INCIDENT_DETECTED', 'INCIDENT_CONTAINED', 'INCIDENT_RESOLVED',
  'MEMORY_STORED', 'CONTEXT_LOADED',
  'AGENT_ACTIVATED', 'AGENT_COMPLETED',
  'COMPLIANCE_APPROVED', 'COMPLIANCE_REJECTED',
]);

// ── Helpers ────────────────────────────────────────────────────────────────────
function isoNow() {
  return new Date().toISOString();
}

function generateEventId(actor, type) {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `EVT-${actor.slice(0,4)}-${ts}-${rand}`;
}

function escapeYaml(str) {
  if (!str) return '""';
  const s = String(str);
  if (s.includes('\n') || s.includes('"') || s.includes("'") || s.includes(':')) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Leer fase actual desde session_state.md ───────────────────────────────────
function readCurrentPhase() {
  try {
    const content = fs.readFileSync(SESSION_FILE, 'utf8');
    const m = content.match(/CURRENT_PHASE\s*[=:]\s*(\S+)/);
    return m ? m[1] : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

function readCurrentStatus() {
  try {
    const content = fs.readFileSync(SESSION_FILE, 'utf8');
    const m = content.match(/PHASE_STATUS\s*[=:]\s*(\S+)/);
    return m ? m[1] : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

// ── Construir entrada YAML del evento ─────────────────────────────────────────
function buildEventEntry(actor, eventType, description, severity) {
  const id      = generateEventId(actor, eventType);
  const ts      = isoNow();
  const phase   = readCurrentPhase();
  const status  = readCurrentStatus();

  let entry = `\n- event_id: ${id}\n`;
  entry    += `  timestamp: "${ts}"\n`;
  entry    += `  actor: ${escapeYaml(actor)}\n`;
  entry    += `  event_type: ${escapeYaml(eventType)}\n`;
  entry    += `  description: ${escapeYaml(description)}\n`;
  entry    += `  current_phase: ${escapeYaml(phase)}\n`;
  entry    += `  phase_status: ${escapeYaml(status)}\n`;

  if (severity) {
    entry  += `  severity: ${escapeYaml(severity)}\n`;
  }

  entry    += `  pii: false\n`;

  return { entry, id, ts };
}

// ── Inicializar archivo si no existe ──────────────────────────────────────────
function initEventsFile() {
  if (!fs.existsSync(EVENTS_FILE)) {
    const header = [
      '# state_events.yaml - Supporting event log (SaaS-Factory v2.7.0)',
      '# APPEND-ONLY. No modificar entradas existentes.',
      '# session_state.md es el SSOT del estado retomable actual.',
      '# Formato: cada entrada es un evento de dominio inmutable.',
      '',
      'events:',
    ].join('\n');
    ensureDir(EVENTS_FILE);
    fs.writeFileSync(EVENTS_FILE, header, 'utf8');
  }
}

// ── Verificar si el archivo tiene el header o solo entradas ──────────────────
function appendEvent(entry) {
  const content = fs.readFileSync(EVENTS_FILE, 'utf8');

  // Si tiene el header con "events:", appendamos como lista bajo él
  if (content.includes('events:') && !content.trim().endsWith('events:')) {
    fs.appendFileSync(EVENTS_FILE, entry, 'utf8');
  } else if (content.trim().endsWith('events:')) {
    fs.appendFileSync(EVENTS_FILE, entry, 'utf8');
  } else {
    // Archivo existe pero sin header: añadir directamente
    fs.appendFileSync(EVENTS_FILE, entry, 'utf8');
  }
}

// ── Estadísticas del log ───────────────────────────────────────────────────────
function countEvents() {
  try {
    const content = fs.readFileSync(EVENTS_FILE, 'utf8');
    return (content.match(/^- event_id:/gm) || []).length;
  } catch {
    return 0;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const [,, actor, eventType, description, severity] = process.argv;

  if (!actor || !eventType || !description) {
    console.error('Uso: node state-event.cjs <actor> <event_type> <description> [severity]');
    console.error('Eventos válidos:', [...VALID_EVENTS].join(', '));
    process.exit(1);
  }

  // Normalizar event type
  const normalizedType = eventType.toUpperCase();

  if (!VALID_EVENTS.has(normalizedType)) {
    // No fallar — registrar con tipo custom prefijado
    console.warn(`⚠ Tipo de evento no estándar: ${normalizedType} — registrando como CUSTOM_${normalizedType}`);
  }

  try {
    initEventsFile();
    const { entry, id, ts } = buildEventEntry(actor, normalizedType, description, severity);
    appendEvent(entry);

    const total = countEvents();
    console.log(`✅ Evento registrado: ${id}`);
    console.log(`   Actor: ${actor} | Tipo: ${normalizedType}`);
    console.log(`   Timestamp: ${ts}`);
    console.log(`   Total eventos en log: ${total}`);
  } catch (err) {
    console.error('❌ Error al registrar evento:', err.message);
    process.exit(1);
  }
}

main();
