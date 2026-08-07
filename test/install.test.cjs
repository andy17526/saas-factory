'use strict';

// La prueba que importa: el protocolo debe instalarse y validarse sobre un
// directorio vacio, sin edicion manual. Es la unica evidencia de que el kernel
// es generico y no un molde del repositorio donde nacio.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test } = require('node:test');

const CLI = path.resolve(__dirname, '..', 'bin', 'saas-factory.cjs');

function freshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-factory-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('node', [CLI, 'init', '--dir', dir], { stdio: 'ignore' });
  return dir;
}

function run(args, cwd, env = {}) {
  // spawnSync y no execFileSync: los avisos van a stderr tambien cuando el
  // proceso sale con codigo 0, y esos avisos son parte de lo que se verifica.
  const result = spawnSync('node', args, {
    cwd, encoding: 'utf8', env: { ...process.env, SAAS_FACTORY_ROOT: cwd, ...env },
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

test('init deja un proyecto que pasa doctor sin tocar nada', () => {
  const dir = freshProject();
  const result = run([CLI, 'doctor'], dir);
  assert.strictEqual(result.code, 0, `doctor fallo:\n${result.stderr}`);
  assert.match(result.stdout, /PASS/);
});

test('init escribe el perfil, los gates y el workflow de CI', () => {
  const dir = freshProject();
  for (const relative of [
    'saas-factory.config.json',
    '.claude/settings.json',
    '.github/workflows/protocol.yml',
    'docs/00-system/protocol/PROTOCOL_v2.7.0_CORE.md',
    'docs/07-plans/_templates/PLAN-template.md',
  ]) {
    assert.ok(fs.existsSync(path.join(dir, relative)), `falta ${relative}`);
  }
});

test('init no pisa ficheros existentes sin --force', () => {
  const dir = freshProject();
  const config = path.join(dir, 'saas-factory.config.json');
  fs.writeFileSync(config, JSON.stringify({ marca: 'del usuario' }));
  execFileSync('node', [CLI, 'init', '--dir', dir], { stdio: 'ignore' });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(config, 'utf8')), { marca: 'del usuario' });
});

test('doctor falla si el proyecto descablea un gate', () => {
  const dir = freshProject();
  const settingsPath = path.join(dir, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.hooks.PreToolUse[0].hooks = settings.hooks.PreToolUse[0].hooks
    .filter((hook) => !hook.command.includes('plan-gate'));
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  const result = run([CLI, 'doctor'], dir);
  assert.strictEqual(result.code, 1);
  assert.match(result.stderr, /no cablea plan-gate/);
});

test('doctor falla si el proyecto no tiene CI', () => {
  const dir = freshProject();
  fs.rmSync(path.join(dir, '.github'), { recursive: true, force: true });
  const result = run([CLI, 'doctor'], dir);
  assert.strictEqual(result.code, 1);
  assert.match(result.stderr, /sin workflows de CI/);
});

test('el perfil acepta la version anterior con aviso y rechaza una desconocida', () => {
  const dir = freshProject();
  const configPath = path.join(dir, 'saas-factory.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  config.protocol_version = '2.6.4';
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  const previous = run([CLI, 'doctor'], dir);
  assert.strictEqual(previous.code, 0, 'la version N-1 debe seguir validando');
  assert.match(previous.stderr, /anterior/);

  config.protocol_version = '1.0.0';
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  const unknown = run([CLI, 'doctor'], dir);
  assert.strictEqual(unknown.code, 1);
  assert.match(unknown.stderr, /no soportado/);
});
