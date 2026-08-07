'use strict';

// Instala el protocolo en un proyecto: copia el scaffolding, no pisa nada sin --force
// y deja el proyecto en un estado que pasa `saas-factory doctor` sin edicion manual.

const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE_ROOT = path.resolve(__dirname, '..', '..', 'templates', 'project');

function parseArgs(argv) {
  const out = { dir: process.cwd(), force: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') out.dir = path.resolve(argv[++i]);
    else if (argv[i] === '--force') out.force = true;
  }
  return out;
}

function walk(dir, base = dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, acc);
    else acc.push(path.relative(base, full));
  }
  return acc;
}

function run(argv) {
  const { dir, force } = parseArgs(argv);
  if (!fs.existsSync(TEMPLATE_ROOT)) throw new Error(`plantillas ausentes en ${TEMPLATE_ROOT}`);
  fs.mkdirSync(dir, { recursive: true });

  const written = [];
  const skipped = [];
  for (const relative of walk(TEMPLATE_ROOT)) {
    const target = path.join(dir, relative);
    if (fs.existsSync(target) && !force) { skipped.push(relative); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(TEMPLATE_ROOT, relative), target);
    written.push(relative);
  }

  // El grafo derivado no se versiona: solo su digest. Un blob regenerado por
  // completo en cada update ensucia todos los diffs del proyecto.
  const gitignore = path.join(dir, '.gitignore');
  const ignoreLines = ['graphify-out/', '!graphify-out/graph-digest.json', 'node_modules/'];
  const current = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  const missing = ignoreLines.filter((line) => !current.split(/\r?\n/).includes(line));
  if (missing.length) {
    fs.writeFileSync(gitignore, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
    written.push('.gitignore');
  }

  console.log(`[init] ${written.length} ficheros escritos en ${dir}`);
  for (const relative of written) console.log(`  + ${relative}`);
  if (skipped.length) {
    console.log(`[init] ${skipped.length} ya existian (usa --force para sobrescribir):`);
    for (const relative of skipped) console.log(`  = ${relative}`);
  }
  console.log('\nSiguiente paso: revisa saas-factory.config.json (contract_source y zones)');
  console.log('y despues ejecuta: npx saas-factory doctor');
  return { written, skipped };
}

module.exports = { run, TEMPLATE_ROOT };
