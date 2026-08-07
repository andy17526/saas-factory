---
id: PLAN-YYYY-NNN
entity_type: plan
title: <Título descriptivo>
status: draft
priority: P0
created: YYYY-MM-DD
updated: YYYY-MM-DD
authors: [<autor>]
category: [knowledge | learning | infra | architecture | security | ux | ops | product]
tags: [plan, priority/p0, status/draft, category/area]
estimated_effort: <Xh | Xd | Xw>
estimated_cost: <none | low | medium | high>
related: []
canonical: true
rag_index: true
rag_priority: medium
---

# PLAN-YYYY-NNN — <Título>

## Estado Actual

```yaml
PLAN_ID: PLAN-YYYY-NNN
PROTOCOL_VERSION: 2.7.0
CURRENT_PHASE: 0           # fase interna del plan, no macrofase global
TOTAL_PHASES: 0            # rellenar al diseñar fases
PHASES_DONE: []
PHASES_PENDING: []         # [1,2,3,...] lista de fases pendientes
PHASES_BLOCKED: []         # añadir N si una fase queda bloqueada
LAST_COMMIT: ~
LAST_COMMIT_DATE: ~
LAST_UPDATED: YYYY-MM-DDTHH:MM:00Z
NEXT_STEP_EXACT: "Completar especificación y solicitar aprobación del usuario"
BLOCKED_ON_USER: true
```

> **Para retomar este plan**: lee solo el bloque YAML de arriba + la siguiente fase con `[ ] pending`.
> Las fases `[x] DONE` ya están commiteadas — no las releas.

---

## GATEKEEPER_SCOPE_CONTRACT

> Obligatorio antes de la primera escritura. `files_allowed` vacio o ausente bloquea; solo este bloque concede permisos.
> Una ficha nueva nace mediante `ADMINISTRATION + BOOTSTRAP`: `plan-activate.cjs --new` permite una sola escritura y `--approve-new` valida token, GSC y aprobación.

```yaml
contract_id: GSC-PLAN-YYYY-NNN-FN-YYYY-MM-DD
protocol_version: 2.7.0
base_ref: <commit>
intent: IMPLEMENTATION | CHANGE_SCOPE | ARCH_CHANGE | INCIDENT_OPERATION | ADMINISTRATION
execution_mode: WRITE
plan_ref: PLAN-YYYY-NNN
phase_ref: <fase exacta>
approved_by: <evidencia>
risk_tier: LOW | MEDIUM | HIGH | CRITICAL
files_allowed:
  - path: <ruta exacta>
    change_type: create | modify | delete | move | generated
    scope_mode: exact_lines | anchored_block | new_file | generated_file
    line_ranges_allowed: []
    anchors_allowed: []
    symbols_allowed: []
    line_ranges_expected: []
    forbidden_anchors: []
allowed_contract_changes: []
forbidden_zones: []
required_skills: []   # derivado de files_allowed por el kernel; no editar a mano
required_tests: []
expected_outputs: []
post_mutation_auditor_required: true
```

---

## Context

¿Por qué existe este plan? Describe el problema, la evidencia observada y el prompt original que lo originó. (1-2 párrafos concretos, no aspiracionales)

---

## Opciones consideradas

| Opción | Pros | Cons | Coste | Esfuerzo | Veredicto |
|--------|------|------|-------|----------|-----------|
| A: <nombre> | ... | ... | ... | ... | ✅ elegida |
| B: <nombre> | ... | ... | ... | ... | ❌ descartada |

> Si solo hay una opción viable, justificar explícitamente por qué no hay alternativas.

## Recomendación

Cuál opción se elige y por qué. Trade-offs honestos en 1 párrafo. Sin promesas sin evidencia.

---

## Fases De Ejecucion

> Cada fase es atómica: objetivo claro, archivos exactos, `scope_mode` por archivo, comandos literales, DoD verificable, marcador de ejecución.

### Fase 1 — <Título corto>

**Objetivo**: <una línea que describa el resultado concreto>

**Archivos y lineas autorizadas**:
- path: `path/to/new-file.ts`
  change_type: create
  scope_mode: new_file
  line_ranges_allowed:
    - start: new_file
      end: new_file
      reason: "Archivo nuevo requerido por la fase"
  symbols_allowed: []
- path: `path/to/existing-file.tsx`
  change_type: modify
  scope_mode: exact_lines
  line_ranges_allowed:
    - start: <linea_inicio>
      end: <linea_fin>
      reason: "Motivo exacto por el que estas lineas pueden tocarse"
  symbols_allowed:
    - `<symbol>`
- path: `docs/07-plans/P0-now/PLAN-YYYY-NNN-example.md`
  change_type: modify
  scope_mode: anchored_block
  anchors_allowed:
    - start_anchor: "### Fase 1 — <Título corto>"
      end_anchor: "### Fase 2 — <Título corto>"
      allowed_operations:
        - update_phase_status
        - fill_trace_log
        - append_auditor_report
  line_ranges_expected:
    - start: <linea_inicio_aproximada>
      end: <linea_fin_aproximada>
      reason: "Defensa secundaria; el anchor es el scope semantico"
  forbidden_anchors:
    - "### Fase 2 — <Título corto>"

> Regla critica: codigo runtime existente con `change_type: modify` debe usar `scope_mode: exact_lines` y `line_ranges_allowed`. Markdown existente debe usar `scope_mode: anchored_block` y `anchors_allowed`. Sin scope deterministico el plan no es aprobable.

**Comandos a ejecutar**:

```powershell
pnpm install
pnpm build
pnpm test
```

**DoD (criterio verificable)**:
- [ ] Build verde sin errores TS
- [ ] Tests passing
- [ ] <criterio específico y observable>

**Estado**:
- [ ] pending | [ ] in-progress | [ ] DONE
- **Commit**: `<hash>` ← rellenar al ejecutar
- **Fecha**: `<YYYY-MM-DDTHH:MM:00Z>` ← rellenar al ejecutar
- **Branch**: `<branch>` ← rellenar al ejecutar
- **Notas/desviaciones**: ~

---

### Fase 2 — <Título corto>

**Objetivo**: <una línea>

**Archivos y lineas autorizadas**:
- path: `path/to/file.ts`
  change_type: create | modify | delete | move | generated
  scope_mode: exact_lines | anchored_block | new_file | generated_file
  line_ranges_allowed:
    - start: <line | new_file>
      end: <line | new_file>
      reason: "Motivo exacto"
  anchors_allowed: []
  line_ranges_expected: []
  forbidden_anchors: []
  symbols_allowed:
    - `<symbol>`

**Comandos a ejecutar**:

```powershell
pnpm test
```

**DoD (criterio verificable)**:
- [ ] <criterio específico>

**Estado**:
- [ ] pending | [ ] in-progress | [ ] DONE
- **Commit**: `<hash>`
- **Fecha**: `<ISO>`
- **Branch**: `<branch>`
- **Notas/desviaciones**: ~

---

### Fase N — <Título corto>

*(misma estructura que Fase 1)*

---

## Verificación end-to-end

Pasos para validar que el plan completo funciona después de TODAS las fases:

1. <paso concreto y reproducible>
2. <paso concreto y reproducible>

---

## Symbol Reuse Inventory

> **Criterio DoD #7** (aplica a planes creados desde v2.6.3). Declara por cada símbolo nuevo **exportable o helper privado >10 LOC** los candidatos existentes y el veredicto. Variables locales y helpers ≤10 LOC quedan excluidos.

```yaml
SYMBOL_REUSE_INVENTORY:
  # - new_symbol: <nombre.firma>
  #   scope: exported | private_helper_gt_10_loc
  #   responsibility: <una línea>
  #   existing_candidates:
  #     - path: <ruta>
  #       symbol: <nombre>
  #       coverage: full | partial | none
  #   verdict: reuse | extend | create_new
  #   reason: "..."
  NONE
```

---

## Behavior Spec Coverage

> **Criterio DoD #8** (aplica a planes creados desde v2.6.3). Cubre el 100% del comportamiento esperado. Excepciones automáticas: (a) todos los `files_allowed` en `docs/**` (excluido `docs/07-plans/`); (b) plan con `mitigation_node` previo que ya documenta observabilidad y rollback. Categoría vacía fuera de excepción → declarar `none-justified: "<razón>"`.

```yaml
BEHAVIOR_SPEC_COVERAGE:
  happy_paths:
    # - id: HP-1
    #   description: "..."
    #   covered_by_phase: N
    #   test_ref: <path::test_name | TBD-phase-N>
  edge_cases: []
  error_paths: []
  intermediate_states: []
  observability:
    # - signal: log | metric | trace
    #   emitted_at: <símbolo>
    #   covered_by_phase: N
  rollback:
    strategy: ~
    covered_by_phase: ~
```

---

## Necessity Justification

> **Criterio DoD #6** (aplica a planes creados desde v2.6.3). Justifica por qué cada archivo en `files_allowed` es estrictamente necesario.

```yaml
NECESSITY_JUSTIFICATION:
  # - path: <ruta>
  #   reason: "Por qué este archivo es estrictamente necesario para el outcome"
  #   could_be_avoided_if: "<condición que evitaría tocarlo | none>"
  NONE
```

---

## SSOT Documental

Declarar la fuente canonica por tipo de dato para evitar duplicidad:

```yaml
DOCUMENTATION_SSOT:
  operational_state: this_plan
  mitigation_evidence: <MITIGATION_NODE | none>
  debt_summary: <TECH_DEBT_MASTER_REGISTER | none>
  resumable_session_state: session_state.md
  persistent_decisions: decisions_log.md
  trace_log_policy: summary_only | full_trace_required
```

---

## Hallazgos Colaterales

> Obligatorio al cerrar cada fase WRITE. Valor `NONE` si ningun hallazgo cualificado se observo. `PENDING_PHASE_CLOSE` solo vale mientras la fase siga abierta.

```yaml
COLLATERAL_FINDINGS:
  # - finding_id: CF-PLAN-YYYY-NNN-001
  #   file: <ruta>
  #   lines: <rango>
  #   pattern: <descripción 1 línea>
  #   severity: P0 | P1 | P2 | P3
  #   effort: S | M | L | XL
  #   related_to_root_cause: true | false
  #   proposed_td_id: TD-MASTER-YYYY-NNN
  PENDING_PHASE_CLOSE
```

---

## Auditor Post Mutation

> Obligatorio antes del cierre de cualquier fase WRITE. Los valores deben corresponder al GSC y al digest del worktree auditado.

```yaml
AUDITOR_POST_MUTATION_REPORT:
  contract_id: GSC-PLAN-YYYY-NNN-FN-YYYY-MM-DD
  contract_sha256: <sha256 del GSC canonico>
  base_ref: <commit exacto de 40 caracteres>
  head_ref: WORKTREE
  plan_ref: PLAN-YYYY-NNN
  evidence_digest: <sha256 del diff portable>
  auditor_identity: SAAS-FACTORY-AUDITOR/<reviewer-id>
  audit_timestamp: <ISO-8601>
  result: PASS | PASS_WITH_NOTES | SCOPE_DRIFT | DEBT_INTRODUCED | DEBT_AGGRAVATED | BLOCKED
  gatekeeper_scope_contract: present
  files_touched_outside_plan: []
  symbols_changed_outside_plan: []
  contract_changes_unexpected: []
  debt_delta:
    introduced_by_mutation: []
    touched_existing_debt: []
    exposed_existing_debt: []
    not_in_scope_old_debt: []
  line_scope_check:
    lines_touched_within_allowed_ranges: []
    lines_touched_outside_allowed_ranges: []
    missing_line_range_contract: []
  anchor_scope_check:
    anchors_touched_within_allowed_blocks: []
    anchors_touched_outside_allowed_blocks: []
    missing_anchor_contract: []
    forbidden_anchor_touched: []
  documentation_duplication_check:
    ssot_declared: []
    duplicated_without_reason: []
  duplicate_symbols_introduced: []
  escalated_to: []
  registration_status: REGISTRATION_PENDING | SYNCHRONIZED
```

---

## Lo que NO se toca

> **Criterio DoD #9** (aplica a planes creados desde v2.6.3). Declara perímetro a nivel archivo **y** perímetro semántico.

Lista explícita del perímetro: qué archivos, módulos o comportamientos quedan fuera del alcance de este plan. Sin esto el plan no cumple el DoD de plan aprobado.

**Archivos / módulos**:
- `<ruta/archivo>` — motivo
- `<módulo>` — motivo

**Perímetro semántico (no solo archivos)**:
- Símbolos fuera de scope: `<lista>`
- Contratos públicos fuera de scope: `<lista>`
- Estados / máquinas de estado intactas: `<lista>`
- Invariantes que NO se relajan: `<lista>`

---

## Decisiones relacionadas

- [[ADR-NNN]]
- [[FEATURE-X]]
- [[LESSON-YYYY-NNN]]

---

## ARCHIVE_DESTINATION_DECISION

> Obligatorio al cerrar la ultima fase. Si `PHASES_PENDING: []`, este plan debe moverse en el mismo cierre documental a su archivo canonico y quedar enlazado desde el indice correspondiente.

```yaml
primary_scope: feature
primary_owner: FEATURE-<NAME>
archive_path: "docs/07-plans/features/<FEATURE>/archive/<este-archivo>.md"
reason: "La feature es el owner primario del cambio."
related_features: [FEATURE-<NAME>]
related_audits: []
related_master_debts: []
related_findings: []
related_incidents: []
related_commits: []
mitigation_node: ~
depends_on: []
blocks: []
residual_risk: "<riesgo residual o NONE>"
rollback_notes: "<rollback seguro>"
secondary_indexes_to_update: [docs/07-plans/features/<FEATURE>/README.md]
```

---

## Histórico

- YYYY-MM-DD — creado como draft en `P<N>-<nivel>/`
- YYYY-MM-DD — aprobado por usuario (`decisions_log.md` PLAN_REF registrado)
- YYYY-MM-DD — Fase 1 ejecutada en commit `<hash>`
- YYYY-MM-DD — ultima fase DONE, `PHASES_PENDING: []`, movido a archivo canonico con status=done y RAG regenerado
