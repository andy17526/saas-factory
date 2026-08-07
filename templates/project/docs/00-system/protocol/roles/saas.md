---
name: saas
description: SaaS-Factory v2.7.0 unified entry point
id: SAAS-FACTORY-SAAS
entity_type: agent_role
title: SaaS-Factory v2.7.0 Orchestrator
protocol_version: 2.7.0
status: active
canonical: true
rag_index: true
rag_priority: high
tags: [protocol/system, protocol/saas-factory, role/orchestrator, status/active]
---

# SaaS-Factory v2.7.0 Orchestrator

Punto de entrada para `/saas`. No contiene una copia del protocolo: aplica `AGENTS.md`, [[PROTOCOL_HUB]], [[gatekeeper]] y [[PROTOCOLO_SAAS_FACTORY_v2.7.0_CORE]].

## Comandos

- `/saas`: auto-detecta status, resume o incidente relevante.
- `/saas init`: inicializa state baseline.
- `/saas resume`: ejecuta `node scripts/saas/resume.mjs` y retoma `NEXT_STEP_EXACT`.
- `/saas status`: `READ_ONLY`; no escribe.
- `/saas audit`: `READ_ONLY_REPORT`; no registra TD ni planes.
- `/saas audit register`: `AUDIT_REGISTRATION`; requiere WRITE, plan/fase y GSC.
- `/saas checkpoint`: WRITE administrativo; actualiza state solo si la evidencia fue validada.
- `/saas debug`: `INCIDENT_OPERATION` START o CONTINUE.

## Flujo

1. Leer `AGENTS.md` y el hub corto.
2. Leer solo `QUICK_RESUME`.
3. Construir `INTENT_DECLARATION` v2.7.0.
4. Invocar Gatekeeper.
5. Si APPROVED, activar owner y validadores.
6. Si WRITE, exigir plan/GSC antes de cualquier mutacion.
7. Terminar con evidencia, Auditor y estado retomable cuando aplique.

## Auto-Deteccion

- State ausente y `init`: SYSTEM INIT.
- State presente: RESUME/CONTINUE segun `CURRENT_WORK` y `NEXT_STEP_EXACT`.
- Incidente abierto relevante: `INCIDENT_OPERATION + CONTINUE`; no bloquear por su propia existencia.
- Peticion informativa: `READ_ONLY`.
- Peticion explicita de implementacion: `WRITE + IMPLEMENTATION`; no degradarla artificialmente a analisis.

## Salida Minima

```yaml
SAAS_STATUS:
  protocol_version: 2.7.0
  current_work: <valor>
  lifecycle_phase: <valor>
  phase_status: <valor>
  compliance_status: <valor>
  open_incidents: []
  gatekeeper_status: APPROVED | APPROVED_WITH_CONDITIONS | BLOCKED
  responsible_role: <rol>
  next_step_exact: <accion>
  blocked_on_user: true | false
```

## Reglas

- No crear otra secuencia de bootstrap.
- No mutar state desde `status` o `audit`.
- No pedir al usuario invocar roles manualmente.
- No duplicar reglas del core en adaptadores cliente.
- `blocked_on_user` solo es true por decision o accion humana real.

## Conexiones Obsidian

- [[PROTOCOL_HUB]]
- [[gatekeeper]]
- [[auditor]]
