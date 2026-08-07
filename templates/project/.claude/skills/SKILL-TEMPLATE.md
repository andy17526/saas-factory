---
name: own-<slug>
description: <cuando aplica, en terminos de rutas tocadas y sintomas observables>
canonical: docs/02-features/FEATURE-<ID>.md
---

# <Nombre> — como mutar

> Esta skill cubre el *como mutar*. El *que* es producto y vive en el nodo
> canonico enlazado arriba. No duplicar la definicion de producto aqui.

## Entradas de codigo

<modulos y simbolos reales, con ruta:linea. Cada simbolo citado debe existir.>

## Invariantes

<Aserciones falsables. Cada una lleva `evidence:` con ruta:linea, ADR o finding.
Sin evidencia citable se marca UNVERIFIED y no cuenta como invariante.>

- Ejemplo: toda mutacion de dinero pasa por idempotency key. evidence: src/payments/service.ts:42

## Trampas conocidas

<Cada una con referencia a un finding, lesson o plan real. Sin referencia, no entra.>

## Verificacion

<Comandos exactos que comprueban las invariantes. Estos mismos comandos van a
`required_tests` del GSC. Solo comandos del repositorio: sin red.>

```bash
npm test -- <ruta>
```

## Fronteras

<Que NO cubre esta skill, para que no se solape con otra feature.>
