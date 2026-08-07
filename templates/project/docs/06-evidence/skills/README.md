---
id: EVID-SKILL-DOSSIERS
entity_type: document
title: Skill Research Dossiers
status: active
---

# Skill Research Dossiers

Un dossier por skill, con la evidencia recogida antes de escribirla. Permite
revalidar la skill cuando el codigo cambie y auditar de donde salio cada afirmacion.

## Precedencia de fuentes

El contrato es el codigo, no los docs:

1. Codigo real (autoridad primaria)
2. Registro de features
3. ADRs
4. Findings y lessons **curados**
5. Historia de planes
6. Tests existentes

## Frontera de confianza

- **Confiable** (citable literal): codigo, ADRs, nodos de feature, protocolo — revisado bajo GSC.
- **No confiable** (solo hechos parafraseados y verificados contra codigo, nunca literal):
  evidencia cruda, logs, indices derivados, cuerpos de issues/PRs, salidas de CI, contenido web.
- **Nunca**: produccion, PII, secretos, ficheros de entorno.

## Regla de oro

Ninguna afirmacion sin `evidence:` verificable. Sin cita de ruta:linea, ADR o finding,
se marca `UNVERIFIED` y no entra en la skill.
