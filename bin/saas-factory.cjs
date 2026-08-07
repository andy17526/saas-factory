#!/usr/bin/env node
'use strict';

const path = require('node:path');

const COMMANDS = {
  init: 'Instala el protocolo en el proyecto actual (perfil, vault, plantillas, gates, CI).',
  doctor: 'Verifica una instalacion existente y reporta lo que falta o esta mal cableado.',
  validate: '(no disponible en 0.1.0 — ver src/kernel/unported/README.md)',
  version: 'Imprime la version del kernel y el rango de protocolo soportado.',
};

function usage() {
  const { PROTOCOL_VERSION, PROTOCOL_VERSION_PREVIOUS } = require('../src/kernel/profile.cjs');
  console.log(`saas-factory — protocolo ${PROTOCOL_VERSION} (acepta tambien ${PROTOCOL_VERSION_PREVIOUS})\n`);
  console.log('Uso: npx saas-factory <comando> [opciones]\n');
  for (const [name, description] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(10)} ${description}`);
  }
  console.log('\nOpciones de init:');
  console.log('  --dir <ruta>     Directorio destino (por defecto: cwd)');
  console.log('  --force          Sobrescribe ficheros existentes del scaffolding');
  console.log('');
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') return usage();

  switch (command) {
    case 'init':
      return require('../src/install/init.cjs').run(args);
    case 'doctor':
      return require('../src/install/doctor.cjs').run(args);
    case 'validate': {
      // El validador completo aun no esta portado: arrastra el manifiesto del
      // repositorio de origen. Decirlo es mas util que emitir errores sobre
      // ficheros que este proyecto nunca tuvo. Ver src/kernel/unported/README.md.
      console.error('[saas-factory] "validate" no disponible en 0.1.0: el validador sigue sin portar.');
      console.error('[saas-factory] Gates disponibles: plan-gate, commit-gate, skill-check, skill-lint, version-check.');
      console.error('[saas-factory] Detalle: src/kernel/unported/README.md');
      process.exit(2);
    }

    case 'version': {
      const { PROTOCOL_VERSION, PROTOCOL_VERSION_PREVIOUS } = require('../src/kernel/profile.cjs');
      const pkg = require('../package.json');
      console.log(`saas-factory ${pkg.version} — protocolo ${PROTOCOL_VERSION} (acepta ${PROTOCOL_VERSION_PREVIOUS})`);
      return undefined;
    }
    default:
      console.error(`Comando desconocido: ${command}\n`);
      usage();
      process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`[saas-factory] ${error.message}`);
  process.exit(1);
}
