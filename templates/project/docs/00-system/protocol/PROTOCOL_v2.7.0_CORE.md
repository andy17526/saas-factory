---
id: SYS-SAAS-FACTORY-PROTOCOL-2-7-0
entity_type: protocol
title: Protocolo SaaS-Factory v2.7.0 Core
version: 2.7.0
status: active
canonical: true
rag_index: true
rag_priority: critical
tags:
  - protocol/core
  - status/active
  - rag/critical
---

# Protocolo SaaS-Factory v2.7.0 Core

## 1. Estado Normativo

SaaS-Factory v2.7.0 es el kernel normativo activo del proyecto. Sustituye v2.6.4 para nuevas ejecuciones. Los anexos de versiones anteriores conservan valor como guias de dominio, pero no pueden redefinir enums, estados, Gatekeeper, auditoria, contratos, veto o fuentes de verdad de este core.

Orden de precedencia:

1. Comportamiento verificable del repositorio, CI y runtime.
2. Este core v2.7.0.
3. `AGENTS.md`, como proyeccion ejecutiva de este core.
4. Hubs y protocolos del proyecto bajo `docs/00-system/`.
5. Roles y anexos especializados.
6. Memoria derivada, RAG y grafo.

Si los niveles 1 y 2 chocan, la ejecucion se detiene solo en el punto afectado, se registra el drift y se corrige el protocolo o el repositorio de forma explicita. El conflicto no autoriza un bypass silencioso.

## 2. Principios

1. La conversacion expresa intencion, pero no reemplaza estado persistente ni evidencia.
2. Una mutacion no trivial requiere plan aprobado, GSC escrito y auditor post-mutacion.
3. Un control critico debe ser verificable por script o CI siempre que sea razonable.
4. Los gates fallan cerrados ante scope ausente, invalido o ambiguo.
5. El rigor escala por riesgo; la ceremonia no escala por cantidad de archivos.
6. READ_ONLY nunca escribe. Registrar hallazgos es una operacion posterior y autorizada.
7. Un incidente abierto habilita su propia via de trabajo; no la bloquea.
8. El contrato efectivo del producto se determina por fuentes reales, no por rutas hipoteticas.
9. Estado, evidencia y decisiones tienen owners distintos y no se duplican como SSOT.
10. `BLOCKED_ON_USER` solo es true cuando existe una decision o accion humana real pendiente.

## 3. Modelo De Intencion

La intencion se representa con dimensiones ortogonales. `TYPE` unico queda deprecado.

```yaml
INTENT_DECLARATION:
  session_action: INIT | RESUME | CONTINUE
  execution_mode: READ_ONLY | WRITE
  change_kind: ANALYSIS | IMPLEMENTATION | CHANGE_SCOPE | ARCH_CHANGE | INCIDENT_OPERATION | ADMINISTRATION
  lifecycle_action: START | CONTINUE | CLOSE | BOOTSTRAP | NONE
  description: <string no vacio>
  affected_components: []
  domains: [PRODUCT | ARCHITECTURE | BACKEND | FRONTEND_UI | SECURITY | PAYMENTS | COMPLIANCE | DEPLOY_INFRA | KNOWLEDGE]
  risk_tier: LOW | MEDIUM | HIGH | CRITICAL
  plan_ref: PLAN-YYYY-NNN | NONE
  plan_phase: <fase exacta | NONE>
  execution_requested: true | false
```

Reglas:

- `READ_ONLY` implica `execution_requested: false` y prohibe cualquier escritura.
- `WRITE` implica `execution_requested: true`.
- `IMPLEMENTATION`, `CHANGE_SCOPE` y `ARCH_CHANGE` en WRITE requieren `plan_ref` y `plan_phase`.
- `INCIDENT_OPERATION` requiere `lifecycle_action` y `INCIDENT_ID` en el contexto operativo.
- `ADMINISTRATION` cubre exclusivamente bootstrap de plan, activacion, closeout, archivado, state checkpoint y registro de auditoria. Solo puede ejecutarse mediante comandos allowlisted con scope interno verificable o dentro del GSC activo; no concede permiso sobre runtime.
- Una peticion explicita y suficientemente concreta no necesita una confirmacion ceremonial adicional.
- Si una dimension material es ambigua, se pregunta solo por esa dimension.

## 4. Modelo De Estado

`session_state.md` es el SSOT del punto retomable actual. No es un event store ni un trace completo.

```yaml
SESSION_STATE_V2_7:
  SCHEMA_VERSION: 2.7.0
  CURRENT_WORK: PLAN-YYYY-NNN | INC-YYYY-NNN | OPERATIONS | NONE
  LIFECYCLE_PHASE: DISCOVERY | PLANNING | IMPLEMENTATION | VALIDATION | DEPLOYMENT | OPERATIONS
  PHASE_STATUS: DRAFT | READY | IN_PROGRESS | BLOCKED | CODE_COMPLETE | DEPLOYED_PENDING_VALIDATION | DONE | STALE
  COMPLIANCE_STATUS: NOT_APPLICABLE | PENDING | APPROVED | BLOCKED
  BLOCKED_ON_USER: true | false
  LAST_VALIDATED: <ISO-8601>
  NEXT_STEP_EXACT: <accion concreta>
```

Compatibilidad:

- `CURRENT_PHASE` puede mantenerse temporalmente como alias de `CURRENT_WORK`, pero se trata como string opaco, nunca como entero.
- Los estados legacy se mapean en lectura: `COMPLETED -> DONE`, `implemented_local -> CODE_COMPLETE`, `*_PENDING_FIELD_SMOKE -> DEPLOYED_PENDING_VALIDATION`.
- STALE bloquea solo el componente cuya continuidad no puede verificarse. READ_ONLY permanece permitido.
- La recuperacion no reescribe fase, compliance ni bloqueo. Agrega evidencia de revalidacion o mantiene el estado existente.

## 5. Modelo De Incidente

`incident_state.md` puede contener multiples registros separados por `---`. Cada registro tiene un unico `INCIDENT_ID`.

```yaml
INCIDENT_STATE_V2_7:
  INCIDENT_ID: INC-YYYY-NNN
  SEVERITY: P0 | P1 | P2 | P3
  STATUS: DETECTED | CONTAINED | DIAGNOSED | MITIGATED | FIXED | VERIFIED | CLOSED
  OWNER: <rol o persona>
  IMPACT: <evidencia>
  NEXT_STEP_EXACT: <accion>
```

Estados terminales: `CLOSED`. `VERIFIED` permite cierre administrativo pendiente. `MITIGATED` no equivale a cerrado.

Via Gatekeeper de incidentes:

1. `INCIDENT_OPERATION + START`: permite crear un registro.
2. `INCIDENT_OPERATION + CONTINUE`: exige que el incidente exista y no este CLOSED.
3. `INCIDENT_OPERATION + CLOSE`: exige evidencia de restauracion, validacion QA y SEC si aplica.
4. Un incidente abierto bloquea solo mutaciones no relacionadas que aumenten su riesgo o compitan con su contencion.
5. READ_ONLY y trabajo de contencion/diagnostico del mismo incidente siguen permitidos.

## 6. Gatekeeper Determinista

Orden obligatorio:

1. Validar forma de `INTENT_DECLARATION`.
2. Aplicar excepcion READ_ONLY: autorizar lectura sin artefactos ni cambios de estado.
3. Aplicar via de incidente antes de comprobar incidentes abiertos.
4. Validar state files y frescura solo para los componentes afectados.
5. Resolver riesgo, roles y vetos requeridos.
6. Para WRITE sustantivo, validar plan aprobado, fase activa y DoD Plan-Before-Code. El bootstrap administrativo de un plan nuevo valida su propio scope estrecho antes de crearlo.
7. Validar GSC, TD relacionadas y excepciones.
8. Emitir `APPROVED`, `BLOCKED` o `APPROVED_WITH_CONDITIONS`.

```yaml
GATEKEEPER_DECISION:
  status: APPROVED | APPROVED_WITH_CONDITIONS | BLOCKED
  reason: <evidencia exacta>
  intent_ref: <hash o bloque>
  plan_ref: PLAN-YYYY-NNN | NONE
  phase_ref: <fase | NONE>
  scope_contract_id: <GSC ID | NONE>
  responsible_role: <rol>
  required_validators: []
  next_step_exact: <accion>
  blocked_on_user: true | false
```

`APPROVED` y `APPROVED_WITH_CONDITIONS` usan `blocked_on_user: false`, salvo que una condicion requiera una decision humana antes de ejecutar.

## 7. Gatekeeper Scope Contract

Toda fase WRITE debe persistir el contrato antes de la primera mutacion.

```yaml
GATEKEEPER_SCOPE_CONTRACT:
  contract_id: GSC-PLAN-YYYY-NNN-FN-YYYY-MM-DD
  protocol_version: 2.7.0
  base_ref: <commit>
  intent: IMPLEMENTATION | CHANGE_SCOPE | ARCH_CHANGE | INCIDENT_OPERATION | ADMINISTRATION
  execution_mode: WRITE
  plan_ref: PLAN-YYYY-NNN
  phase_ref: <fase>
  approved_by: <evidencia>
  risk_tier: LOW | MEDIUM | HIGH | CRITICAL
  files_allowed:
    - path: <ruta exacta>
      change_type: create | modify | delete | move | generated
      scope_mode: exact_lines | anchored_block | new_file | generated_file
      line_ranges_allowed: []
      symbols_allowed: []
      anchors_allowed: []
      line_ranges_expected: []
      forbidden_anchors: []
  allowed_contract_changes: []
  forbidden_zones: []
  required_tests: []
  expected_outputs: []
  post_mutation_auditor_required: true
```

Invariantes:

- `files_allowed` vacio o ausente es BLOCKED.
- Solo se parsea el bloque GSC; rutas citadas en contexto, ejemplos o exclusiones no conceden permiso.
- `forbidden_zones` tiene precedencia sobre permiso implicito, pero no sobre una excepcion exacta y explicita en `files_allowed`.
- Runtime existente requiere `exact_lines`; Markdown estructurado requiere `anchored_block`.
- El parser local puede imponer el permiso por archivo. La revision de rangos, anchors, contratos y semantica corresponde al auditor sobre el diff.
- Cambiar el GSC requiere una enmienda identificada y nueva aprobacion; no se reemplaza silenciosamente.
- El carril post-auditoria puede modificar solo estado, evidencia, plan, registro TD e indices ya declarados en `files_allowed`; no puede alterar el runtime auditado.

## 8. Roles, RACI Y Veto

Owners:

| Area | Owner | Validators |
| --- | --- | --- |
| Alcance y acceptance criteria | AG-PM | AG-QA |
| Contratos y arquitectura | AG-ARCH | CONTRACT-VALIDATOR, AG-QA, AG-SEC si aplica |
| Backend e invariantes | AG-BE | AG-QA, AG-SEC si aplica |
| UX y estados cliente | AG-FE | AG-QA, AG-SEC si aplica |
| Riesgo y controles de seguridad | AG-SEC | AG-QA |
| Evidencia y criterio de cierre | AG-QA | AG-SEC/AG-ARCH segun dominio |
| Plataforma, deploy y DR | AG-INFRA | AG-QA, AG-SEC si aplica |
| Conformidad scope/diff | AUDITOR | AG-QA para excepciones |

Veto:

- P0: bloquea inmediatamente.
- P1: bloquea cierre y merge.
- P2: bloquea solo si afecta un DoD obligatorio o riesgo HIGH/CRITICAL; en otro caso exige plan de remediacion.
- P3: no bloquea salvo acumulacion que invalide un contrato o control.
- CONTRACT-VALIDATOR y AUDITOR producen evidencia; AG-QA emite y libera el veto final. AG-SEC conserva veto directo P0/P1 de seguridad.
- Todo veto declara owner, evidencia, condicion de liberacion y expiracion/revision.
- El veto se registra en `docs/00-system/legacy-agent-memory/ai-memory/decisions_log.md` con `veto_level`, `scope_zone` y un veredicto por rol (`status`, `level`, `rationale`). No existe gate mecanico que lo verifique: es una convencion de registro, no un control ejecutable. Los controles ejecutables son CI, el AUDITOR post-mutacion y la aprobacion del usuario.
- `AG-PM` y `VETO-P2` estan definidos en esta seccion pero no se han usado nunca en el registro real. Se conservan como vocabulario disponible, no como evidencia de practica.

## 9. Auditoria

Dos modos separados:

### READ_ONLY_REPORT

- No modifica archivos, state, TD ni planes.
- Produce findings primarios con evidencia, severidad, esfuerzo, incertidumbre y recomendacion si el usuario la solicita.
- Los findings cualificados quedan `REGISTRATION_PENDING`; no se sincronizan dentro de READ_ONLY.
- Su salida incluye `report_id`, `scope`, `base_ref`, `evidence_digest`, `findings` y `registration_status`. Es una respuesta no reanudable: no cambia `session_state.md` ni `CURRENT_WORK`.

### AUDIT_REGISTRATION

- Es una operacion WRITE separada y autorizada.
- Deduplica findings, asigna TD canonica y crea plan draft cuando corresponde.
- Puede ejecutarse inmediatamente despues del reporte si el usuario ya autorizo implementar/registrar la auditoria y existe plan/GSC o comando administrativo allowlisted con scope equivalente.

### POST_MUTATION_READ_ONLY

- Compara base/head/diff contra GSC.
- Requiere `base_ref`, `head_ref`, `plan_ref` y `contract_id`.
- Veredictos: `PASS`, `PASS_WITH_NOTES`, `SCOPE_DRIFT`, `DEBT_INTRODUCED`, `DEBT_AGGRAVATED`, `BLOCKED`.
- No corrige. Una remediacion genera un nuevo diff y una nueva pasada del auditor.

## 10. Collateral Findings Y TD

`COLLATERAL_FINDINGS` es obligatorio al cerrar toda fase WRITE, incluidos docs, scripts y configuracion.

Valores:

- `NONE`: no se observo finding cualificado.
- Lista `CF-*`: cada entrada incluye archivo, lineas/simbolo, patron, severidad y esfuerzo.
- `PENDING_PHASE_CLOSE`: permitido solo mientras la fase siga abierta.

Finding cualificado: P0-P3 con riesgo/coste verificable. `noise` es una clasificacion separada y no usa severidad P0-P3.

Reglas:

- Findings introducidos por el diff deben remediarse antes de PASS o escalarse como excepcion.
- Findings preexistentes cualificados requieren deduplicacion y sincronizacion durante `AUDIT_REGISTRATION` o cierre WRITE.
- `won't_remediate`, excepciones y cambios de prioridad no obvios requieren decision explicita.
- El registro usa `status` como campo canonico; `remediation_status` queda como alias legacy de lectura.
- Los estados canonicos TD son `detected`, `needs_triage`, `planned`, `approved`, `in_progress`, `blocked`, `done`, `won't_remediate`.

## 11. Contratos Efectivos

```yaml
CONTRACT_SOURCE:
  mode: FORMAL_OPENAPI | EFFECTIVE_REPOSITORY
  sources: []
```

El modo y las fuentes exactas los declara `saas-factory.config.json` en
`contract_source`. El kernel no presupone rutas: un proyecto sin OpenAPI canonico
usa `EFFECTIVE_REPOSITORY` y enumera ahi sus fuentes reales.

La existencia de un OpenAPI parcial o de programa de seguridad no lo convierte en SSOT. CONTRACT-VALIDATOR debe declarar el modo y las fuentes exactas antes de emitir drift.

Jerarquia por operacion en `EFFECTIVE_REPOSITORY`:

1. El endpoint, DTO/controller y el esquema de datos gobiernan comportamiento API y persistencia realmente desplegable.
2. El paquete de contratos compartidos gobierna tipos publicados cuando exista una exportacion aplicable.
3. El cliente prueba el contrato consumido, pero no puede redefinir silenciosamente API o datos.
4. Ante contradiccion, AG-ARCH identifica owner y contrato objetivo; hasta resolverla, CONTRACT-VALIDATOR reporta drift y no elige una fuente por conveniencia.

### Indices derivados

Un grafo de conocimiento o indice semantico es `derivado`: sirve para navegar, nunca
para decidir. Sus resultados se verifican contra codigo, state files o memoria canonica
antes de sustentar una mutacion. No puede actuar como SSOT ni redefinir el contrato
efectivo. Su frescura, cuando el perfil lo declara activo, es un gate mecanico.

## 12. Evidencia De Rol

Toda salida de implementacion o validacion relevante incluye:

```yaml
EVIDENCE_ENVELOPE:
  base_ref: <commit>
  head_ref: <commit | WORKTREE>
  plan_ref: PLAN-YYYY-NNN
  phase_ref: <fase>
  commands_run: []
  results: []
  environment: <local | CI | staging | production>
  artifacts: []
  residual_risk: []
  approver: <rol | usuario | NONE>
```

## 13. Enforcement

Controles portables obligatorios:

1. Validator local del kernel y proyecciones activas.
2. Activacion de plan que parsea solo el GSC y falla cerrada.
3. Gate de archivos protegidos con scope no vacio.
4. Validator de conocimiento y enlaces para docs.
5. CI de protocolo sobre el diff completo para todo cambio, no solo archivos de gobierno.
6. Auditor post-mutacion antes de cerrar planes WRITE.

Hooks de un cliente IA son defensa adicional, nunca el unico control. Shell, IDE y otros agentes deben quedar cubiertos por CI y revision del diff.

`approved_by` aporta trazabilidad, no identidad criptografica. En pull requests, la raiz de confianza es una review `APPROVED` independiente exigida por CI/proteccion de rama; el GSC contenido en el propio diff no puede autoaprobar el merge.

Los comandos administrativos allowlisted son:

- `plan-activate.cjs --new`: autoriza una única escritura para crear un plan draft ligado a `BOOTSTRAP_TOKEN`. Tras revisión explícita, `--approve-new` valida GSC/token, retira el token, cambia a approved y activa el contrato; el marcador bootstrap nunca edita una ficha existente.
- `plan-activate.cjs --done`: elimina el marcador despues del commit terminal y solo tras revalidar cierre, archivo, GSC y evidencia Auditor.
- `archive-plan.cjs`: mueve un plan únicamente al destino declarado y vuelve a validar conocimiento.

Toda edición directa equivalente queda sujeta al plan/GSC normal.

## 14. Compatibilidad Y Migracion

- v2.6.4 permanece como historial, no como fuente activa.
- Los roles especializados v2.6.0 se consideran compatibles solo donde no contradigan este core.
- Los adaptadores instalados deben apuntar al rol canonico y no copiar su contenido.
- Planes legacy no se reescriben masivamente. Al reabrirse o entrar en nueva fase adoptan v2.7.0.
- La migracion de state y TD es incremental y no puede borrar evidencia historica.

## 15. Criterio De Cierre

Una fase WRITE termina solo con:

1. DoD satisfecho.
2. Validaciones ejecutadas o bloqueo explicito.
3. Auditor `PASS` o `PASS_WITH_NOTES`.
4. `COLLATERAL_FINDINGS` resuelto.
5. TD sincronizadas cuando existan findings cualificados.
6. State retomable actualizado si cambio el punto operativo.
7. Diff limitado al GSC.

Tras el Auditor, solo se permite el carril de closeout descrito en el GSC. Si ese carril cambia runtime, contratos o tests auditados, el veredicto queda invalidado y se requiere una nueva pasada.

## 16. Changelog

### v2.7.0 - 2026-07-22

- Separa session action, execution mode, change kind y lifecycle action.
- Define estado semantico versionado y elimina comparaciones numericas de fase.
- Corrige la via de incidentes y permite multiples registros.
- Separa READ_ONLY_REPORT de AUDIT_REGISTRATION.
- Hace fail-closed el GSC vacio y limita parsing al bloque canonico.
- Define contrato efectivo de repositorio.
- Unifica veto y `BLOCKED_ON_USER`.
- Exige evidencia portable y enforcement en CI.
