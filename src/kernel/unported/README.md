# Sin portar todavia

Estos dos ficheros vienen del repositorio de origen y **aun contienen su manifiesto
hardcodeado**. No forman parte de la superficie soportada del paquete.

| Fichero | Refs al repo de origen | Que falta |
|---|---|---|
| `protocol-validate.cjs` | 7 | Partir en dos: la maquinaria (`collectMarkdown`, `diffHunks`, `validateDiffScope`, `anchorLine`, `spanWithin`) es generica y va a `src/validate/`; el manifiesto de ficheros, roles, anclas y campos de estado es **dato inlineado como codigo** y pasa al esquema del perfil. |
| `protocol-gates.test.cjs` | 40 | 1187 LOC de tests apuntando a rutas del repo de origen. Hay que reapuntarlos a `test/fixtures/` con un proyecto sintetico. |

Hasta entonces `saas-factory validate` no esta disponible: el comando lo dice
explicitamente en vez de emitir errores enganosos sobre ficheros que el proyecto
consumidor nunca tuvo.

Gates **portados y probados**: `plan-gate`, `commit-gate`, `plan-activate`,
`protocol-contract`, `skill-router`, `skill-check`, `skill-lint`, `skill-hint`,
`version-check`, `version-bump`.
