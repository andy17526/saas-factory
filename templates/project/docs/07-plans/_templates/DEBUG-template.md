---
id: DEBUG-YYYY-NNN
entity_type: debug_session
title: <Debug Title>
status: active
feature: FEATURE-X
related_plan: PLAN-YYYY-NNN
related_incident: INC-YYYY-NNN
canonical: true
rag_index: true
rag_priority: high
tags:
  - debug
  - status/active
---

# DEBUG-YYYY-NNN — <Debug Title>

## Estado Retomable

```yaml
DEBUG_ID: DEBUG-YYYY-NNN
FEATURE: FEATURE-X
STATUS: active
CURRENT_STEP: "Reproducir sintoma"
LAST_VALIDATED: ~
BLOCKED_ON_USER: false
NEXT_STEP_EXACT: "Ejecutar reproduccion minima"
```

## Sintoma

## Evidencia

## Hipotesis

## Root Cause

## Fix Aplicado

## Archivos/Funciones Tocadas

## Validacion

## Hallazgos Colaterales

> Obligatorio al cierre del debug. Valor `NONE` si ningún hallazgo cualificado se observó durante el diagnóstico/fix.

```yaml
COLLATERAL_FINDINGS:
  # - finding_id: CF-INC-YYYY-NNN-001
  #   file: <ruta>
  #   lines: <rango>
  #   pattern: <descripción 1 línea>
  #   severity: P0 | P1 | P2 | P3
  #   effort: S | M | L | XL
  #   related_to_root_cause: true | false
  #   proposed_td_id: TD-MASTER-YYYY-NNN
  NONE
```

## Cierre

## Conexiones Obsidian

- [[07-plans-index]]
- FEATURE-X (reemplazar por wikilink real, por ejemplo `[[FEATURE-PAYMENTS]]`)
