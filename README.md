# saas-factory

Kernel de gobierno de mutaciones para proyectos asistidos por IA. Extraido de un
repositorio en produccion donde lleva 200+ planes de rodaje.

La idea en una frase: **un agente no puede tocar lo que no esta declarado en un
contrato de alcance aprobado**, y eso se verifica por script, no por convencion.

## Que hace

Antes de la primera escritura de una fase, el plan declara un `GATEKEEPER_SCOPE_CONTRACT`
con `files_allowed` explicito. A partir de ahi:

- `plan-gate` deniega en tiempo de sesion cualquier mutacion fuera del contrato.
- `commit-gate` exige que el estado del indice sea el declarado antes de dejar cerrar.
- `skill-check` exige que las rutas tocadas declaren las skills que las gobiernan.
- `skill-lint` rechaza skills con directivas de override, egress de red o secretos.
- `version-check` exige el bump de version cuando el diff toca codigo desplegable.

Todos fallan cerrados. `files_allowed` vacio o ausente no significa acceso total:
significa `BLOCKED`.

## Instalacion

```bash
npm install --save-dev saas-factory
npx saas-factory init
npx saas-factory doctor
```

`init` escribe el perfil, el vault de conocimiento, las plantillas de plan, los 23
ficheros de rol, el cableado de hooks y el workflow de CI. `doctor` verifica que el
proyecto cableo de verdad sus gates — incluido el caso de que los haya descableado
despues.

## El perfil

Todo lo especifico del proyecto vive en `saas-factory.config.json`. El kernel no
presupone rutas:

```jsonc
{
  "protocol_version": "2.7.0",
  "paths": { "plans": "docs/07-plans", "state": "docs/00-system/state/session_state.md" },
  "contract_source": { "mode": "EFFECTIVE_REPOSITORY", "sources": ["src"] },
  "zones": { "safe": [], "controlled": ["src/**", ".claude/skills/**"], "high_risk": [] },
  "knowledge": { "obsidian": "required", "graph": "optional" }
}
```

## Compatibilidad de version

El kernel acepta el protocolo **actual y el anterior** (2.7.0 y 2.6.4), avisando al
usar el anterior. Sin ese rango, cada bump invalidaria de golpe todos los contratos
del proyecto consumidor.

## Skills por feature

Las skills se **derivan** de `files_allowed`, no se declaran a mano: tocar
`src/payments/**` exige la skill de pagos, y CI falla si el contrato no la declara.

Una skill cubre el *como mutar*, nunca duplica la definicion de producto. Y toda
invariante necesita `evidence:` con ruta:linea, ADR o finding — sin cita verificable
se marca `UNVERIFIED` y no cuenta. Esa regla existe porque en el repositorio de origen
se encontro un sistema de memoria que puntuaba su propio trabajo con valores
hardcodeados de antemano y luego los recuperaba como "patrones de alta calidad".

Las skills tambien son superficie de ataque: son instrucciones que el modelo ejecuta.
El hook de inyeccion pasa **solo el nombre** de la skill, nunca su cuerpo, y el linter
bloquea override, egress, `eval` y referencias a secretos.

## Conocimiento

- **Obsidian: duro.** No es una dependencia sino un formato (wikilinks, frontmatter,
  vault). Se valida en CI y se puede exigir.
- **Grafo derivado: blando.** Depende del harness del agente, asi que exigirlo en CI
  dejaria fuera cualquier proyecto trabajado desde otro entorno. Es indice de
  navegacion: nunca fuente de verdad. Solo se versiona su digest, no el blob.

## Estado

Portado y probado (17 tests): `protocol-contract`, `plan-gate`, `commit-gate`,
`plan-activate`, `skill-router`, `skill-check`, `skill-lint`, `skill-hint`,
`version-check`, `version-bump`, instalador y `doctor`.

**Sin portar:** `protocol-validate.cjs` y sus 1187 LOC de tests siguen arrastrando el
manifiesto del repositorio de origen. `saas-factory validate` lo dice y sale con
codigo 2 en vez de emitir errores enganosos. Ver `src/kernel/unported/README.md`.

**Limite conocido:** los gates de sesion viven en hooks de Claude Code. Otro agente
conserva solo el gate de CI. Es degradacion correcta por diseno —el §13 del protocolo
ya dice que los hooks de un cliente IA nunca son el unico control— pero `doctor` lo
reporta en vez de dar por bueno el silencio.

**Sin validar todavia:** el protocolo solo ha corrido en un repositorio. La genericidad
esta demostrada hasta donde llega el smoke test de `init` sobre directorio vacio; la
prueba real es arrancar un segundo producto.

## Licencia

MIT
