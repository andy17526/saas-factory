'use strict';

// Hook PreToolUse que inyecta la skill aplicable al editar una ruta ruteada.
//
// Dos reglas de diseno deliberadas:
//   1. NUNCA deniega. plan-gate.cjs es el unico que deniega en este matcher;
//      dos hooks denegando la misma herramienta es indepurable.
//   2. Inyecta SOLO el nombre de la skill y el nodo canonico, nunca el cuerpo
//      de la skill. Si una skill estuviese comprometida, el hook no la propaga
//      automaticamente: la carga queda visible y explicita en la transcripcion.

const fs = require('node:fs');
const path = require('node:path');

function emit(context) {
  if (context) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context },
    }));
  }
  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let filePath;
  try {
    const toolInput = JSON.parse(input)?.tool_input;
    filePath = toolInput?.file_path || toolInput?.notebook_path;
  } catch {
    emit(null);
    return;
  }
  if (!filePath) emit(null);

  let profile;
  try {
    profile = require('./profile.cjs').load();
  } catch {
    emit(null);
    return;
  }

  const relative = path.relative(profile.root, path.resolve(profile.root, filePath)).replaceAll('\\', '/');
  if (relative.startsWith('..')) emit(null);

  let resolved;
  try {
    resolved = require('./skill-router.cjs').resolveSkills([relative], profile);
  } catch {
    emit(null);
    return;
  }
  if (!resolved.skills.length) emit(null);

  const lines = [`Skills aplicables a ${relative}:`];
  for (const skill of resolved.skills) lines.push(`  - ${skill}`);
  for (const feature of resolved.features) {
    const node = path.join(profile.paths.features, `${feature}.md`);
    const exists = fs.existsSync(path.join(profile.root, node));
    lines.push(`  feature: ${feature}${exists ? ` -> ${node}` : ''}`);
  }
  lines.push('Cargalas antes de editar; sus comandos de Verificacion son los required_tests de esta fase.');
  emit(lines.join('\n'));
});
