---
id: AUDIT-MITIGATION-PLAN-TEMPLATE
entity_type: plan_template
title: <Audit Mitigation Plan Title>
status: draft
priority: P0
created: YYYY-MM-DD
updated: YYYY-MM-DD
authors: [<autor>]
category: [security | payments | backend | frontend | data | observability | testing | operations]
tags:
  - plan
  - audit-mitigation
  - priority/p0
  - status/draft
canonical: true
rag_index: true
rag_priority: high
related:
  - AUDIT-YYYY-NNN
  - TD-MASTER-YYYY-NNN-NNN
---

# PLAN-YYYY-NNN — <Audit Mitigation Plan Title>

## Estado Actual

```yaml
PLAN_ID: PLAN-YYYY-NNN
STATUS: draft
AUDIT_REF: AUDIT-YYYY-NNN
DEBT_ID: TD-MASTER-YYYY-NNN-NNN
CURRENT_PHASE: 0
TOTAL_PHASES: 0
PHASES_DONE: []
PHASES_PENDING: []
PHASES_BLOCKED: []
LAST_COMMIT: pending
LAST_COMMIT_DATE: ~
LAST_UPDATED: YYYY-MM-DDTHH:MM:00Z
NEXT_STEP_EXACT: "Completar plan y solicitar aprobacion del usuario"
BLOCKED_ON_USER: true
```

Para retomar este plan: leer solo este bloque, luego la primera fase con estado `pending`. No releer fases `DONE` salvo incidente o conflicto directo.

## Contexto

Deuda mitigada: `TD-MASTER-YYYY-NNN-NNN`.

Origen:
- [[TECH_DEBT_MASTER_REGISTER]]
- <SOURCE_REPORT> (reemplazar por wikilink real, por ejemplo `[[SECURITY_DEBT_REPORT]]`)

Problema concreto:
- <Describir causa raiz verificable, no aspiracional.>

Impacto:
- business_impact: <copiar/resumir del master register>
- technical_impact: <copiar/resumir del master register>
- operational_risk: <copiar/resumir del master register>

## Dependencias Y Orden

```yaml
depends_on: []
blocks: []
absorbs_findings: []
does_not_touch: []
deferred_to: []
```

Regla anti-trabajo doble:
- No ejecutar este plan si una dependencia abierta puede cambiar la misma invariante, contrato, modelo o boundary.
- No adelantar cleanup si sera absorbido por una fase P0/P1 posterior.
- No crear abstracciones globales cuando el master register indique una mitigacion por dominio/agregado.

## Opciones Consideradas

| Opcion | Pros | Cons | Coste | Esfuerzo | Veredicto |
| --- | --- | --- | --- | --- | --- |
| A: Mitigacion incremental por fases auditables | Cambios pequenos, verificables y retomables | Requiere disciplina documental | bajo | <S/M/L/XL> | elegida |
| B: Refactor amplio | Puede resolver varios sintomas a la vez | Mezcla riesgos, dificulta rollback y auditoria | medio/alto | <L/XL> | descartada |

## Recomendacion

Ejecutar la opcion A. Cada fase debe cerrar una zona verificable con trazabilidad por archivo, funcion, contrato, test, comando, evidencia y riesgo residual. No se permite ampliar alcance sin registrar `deferred_to` o crear un plan separado.

## Registro De Mitigacion

Cada fase debe actualizar o crear un nodo bajo:

`docs/06-evidence/technical-audits/audits/<AUDIT-ID>/mitigations/<DEBT-ID>-<slug>.md`

Formato obligatorio por fase mitigada:

```md
## <PHASE-ID> — <Nombre>

debt_id: TD-MASTER-YYYY-NNN-NNN
plan_id: PLAN-YYYY-NNN
phase_id: <N>
status: mitigated | partially_mitigated | blocked
source_findings:
- <FINDING-ID>
root_cause: <causa raiz exacta>
solution: <solucion aplicada>
solution_date: YYYY-MM-DD
commit: <hash | pending>
branch: <branch>

files_touched:
- path: <path>
  change_type: created | modified | deleted
  reason: <por que se toco>

functions_changed:
- file: <path>
  symbol: <function | method | class | route | hook>
  change_type: added | modified | removed
  before: <comportamiento anterior>
  after: <comportamiento nuevo>
  reason: <motivo>

contracts_changed:
- none | route | dto | response | prisma | env | workflow

tests_added_or_updated:
- path: <path>
  covers: <caso cubierto>

validation_commands:
- command: <comando literal>
  result: pass | fail | skipped
  evidence: <salida relevante o razon de skip>

runtime_risk: <riesgo durante despliegue>
residual_risk: <riesgo que queda>
rollback_notes: <como revertir seguro>
next_step_exact: <siguiente accion retomable>
```

## Fases De Ejecucion

### Fase 1 — <Titulo Corto>

Objetivo: <resultado observable de la fase>.

Archivos y lineas autorizadas:
- path: `<path>`
  change_type: create | modify | delete
  scope_mode: exact_lines | anchored_block | new_file | generated_file
  line_ranges_allowed:
    - start: <line | new_file>
      end: <line | new_file>
      reason: <motivo exacto por el que estas lineas pueden tocarse>
  anchors_allowed:
    - start_anchor: <heading exacto | none>
      end_anchor: <heading exacto | EOF | none>
      allowed_operations:
        - <operacion permitida>
  line_ranges_expected:
    - start: <line | none>
      end: <line | none>
      reason: <defensa secundaria para Markdown o none>
  forbidden_anchors: []
  symbols_allowed:
    - `<symbol>`

Regla critica: codigo runtime existente con `change_type: modify` debe declarar `scope_mode: exact_lines` y `line_ranges_allowed`. Markdown existente debe declarar `scope_mode: anchored_block` y `anchors_allowed`. Sin scope deterministico el plan no es aprobable y Gatekeeper debe bloquearlo.

Funciones o simbolos esperados:
- `<file>` :: `<symbol>` — <comportamiento a cambiar>

Contratos esperados:
- none | route | dto | response | prisma | env | workflow

Comandos a ejecutar:

```powershell
<comando literal>
```

DoD:
- [ ] Comportamiento vulnerable/deuda queda mitigado en el caso objetivo.
- [ ] Tests focalizados cubren positivo y negativo cuando aplique.
- [ ] Registro de mitigacion contiene `files_touched` y `functions_changed` completos.
- [ ] Comandos de verificacion ejecutados o skip justificado con riesgo residual.
- [ ] Rollback documentado.

Estado:
- [ ] pending
- Commit: `pending`
- Fecha: `pending`
- Branch: `<branch>`
- Notas/desviaciones: ~

Trace Log obligatorio al cerrar la fase:

```md
## Trace Log — Fase 1

debt_id:
plan_id:
phase_id:
status:
commit:
date:
branch:

files_touched:
- path:
  change_type:
  scope_mode:
  line_ranges_allowed:
  - start:
    end:
    reason:
  anchors_allowed:
  - start_anchor:
    end_anchor:
    allowed_operations:
    -
  lines_touched_actual:
  - start:
    end:
    reason:
  anchors_touched_actual:
  - start_anchor:
    end_anchor:
    operation:
  reason:

functions_changed:
- file:
  symbol:
  change_type:
  before:
  after:
  reason:

contracts_changed:
- none

tests_added_or_updated:
- path:
  covers:

validation_commands:
- command:
  result:
  evidence:

collateral_findings:
- NONE  # o lista de CF-PLAN-YYYY-NNN-NNN con archivo+líneas+patrón+severidad

runtime_risk:
residual_risk:
rollback_notes:
next_step_exact:
```

## SSOT Documental

```yaml
DOCUMENTATION_SSOT:
  operational_state: this_plan
  mitigation_evidence: docs/06-evidence/technical-audits/audits/<AUDIT-ID>/mitigations/<DEBT-ID>-<slug>.md
  debt_summary: docs/06-evidence/technical-audits/audits/<AUDIT-ID>/TECH_DEBT_MASTER_REGISTER.md
  resumable_session_state: docs/00-system/legacy-agent-memory/ai-memory/session_state.md
  persistent_decisions: docs/00-system/legacy-agent-memory/ai-memory/decisions_log.md
  trace_log_policy: summary_only
```

## Verificacion End-To-End

1. <comando o paso reproducible>
2. <comando o paso reproducible>

## Lo Que NO Se Toca

- `<debt/module/file>` — <motivo y plan donde se difiere si aplica>

## Decisiones Relacionadas

- [[TECH_DEBT_MASTER_REGISTER]]
- <SOURCE_REPORT> (reemplazar por wikilink real)

## Historico

- YYYY-MM-DD — plan creado como draft desde `AUDIT-MITIGATION-PLAN-template`.
