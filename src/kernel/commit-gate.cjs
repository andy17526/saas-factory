#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ACTIVE_PLAN_STATUSES,
  auditorCloseoutValid,
  collateralFindingsClosed,
  computeEvidenceDigest,
  findPlanFile,
  frontmatter,
  isPathAllowed,
  parseScopeContract,
  TERMINAL_PLAN_STATUSES,
} = require('./protocol-contract.cjs');

const repoRoot = process.env.SAAS_FACTORY_ROOT
  ? path.resolve(process.env.SAAS_FACTORY_ROOT)
  : path.resolve(__dirname, '..', '..');
const markerPath = path.join(repoRoot, '.claude', 'active-plan.json');

function allow() { process.exit(0); }
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}

function analyzeCommitCommand(command, dialect = 'neutral') {
  const splitCommands = (value) => {
    const segments = [];
    let current = '';
    let quote = null;
    let escaped = false;
    for (let cursor = 0; cursor < value.length; cursor += 1) {
      const character = value[cursor];
      if (escaped) { current += character; escaped = false; continue; }
      const escapeCharacter = dialect === 'posix' ? '\\' : dialect === 'powershell' ? '`' : dialect === 'cmd' ? '^' : null;
      if (character === escapeCharacter && !(dialect === 'posix' && quote === "'")) { escaped = true; continue; }
      if (quote) {
        current += character;
        if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || (character === "'" && dialect !== 'cmd')) { quote = character; current += character; continue; }
      const singleAmpersandSeparator = character === '&' && value[cursor + 1] !== '&' && Boolean(current.trim());
      const semicolonSeparator = character === ';' && dialect !== 'cmd';
      if (character === '\r' || character === '\n' || semicolonSeparator || character === '|' || singleAmpersandSeparator || (character === '&' && value[cursor + 1] === '&')) {
        if (current.trim()) segments.push(current.trim());
        current = '';
        if ((character === '|' && value[cursor + 1] === '|') || (character === '&' && value[cursor + 1] === '&')) cursor += 1;
        continue;
      }
      current += character;
    }
    if (current.trim()) segments.push(current.trim());
    return { segments, malformed: Boolean(quote || escaped) };
  };
  const tokenize = (value) => {
    const tokens = [];
    let current = '';
    let quote = null;
    let escaped = false;
    let dynamic = false;
    const finish = () => { if (current) tokens.push(current); current = ''; };
    for (const character of value) {
      if (escaped) { current += character; escaped = false; continue; }
      const escapeCharacter = dialect === 'posix' ? '\\' : dialect === 'powershell' ? '`' : dialect === 'cmd' ? '^' : null;
      if (character === escapeCharacter && !(dialect === 'posix' && quote === "'")) {
        if (character === '`') dynamic = true;
        escaped = true;
        continue;
      }
      if (dialect === 'neutral' && character === '\\') { current += character; continue; }
      if (dialect === 'posix' && character === '`') dynamic = true;
      if (quote) {
        if (character === quote) { quote = null; continue; }
        if (character === '$') dynamic = true;
        current += character;
        continue;
      }
      if (dialect === 'powershell' && character === '&' && !current) { tokens.push('&'); continue; }
      if (character === '"' || (character === "'" && dialect !== 'cmd')) { quote = character; continue; }
      if (/\s/.test(character)) { finish(); continue; }
      if (character === '$') dynamic = true;
      current += character;
    }
    finish();
    if (dialect === 'cmd' && tokens.some((token) => /%[^%]+%|![^!]+!/.test(token))) dynamic = true;
    return { tokens, dynamic, malformed: Boolean(quote || escaped) };
  };
  const parsedCommand = splitCommands(String(command || ''));
  const segments = parsedCommand.segments;
  let result = { isCommit: false, chained: false, unsafeContext: false, alias: false, pathspec: false, all: false, historyRewrite: false, skipVerify: false, unsupportedOption: false, dangerousPorcelain: false, ambiguousEvaluator: false };
  for (const segment of segments) {
    const parsedSegment = tokenize(segment);
    const rawTokens = parsedSegment.tokens;
    const tokens = rawTokens.map((token) => (dialect !== 'neutral' || /^(?:[A-Za-z]:\\|\\\\)/.test(token)
      ? token : token.replace(/[\\^`](.)/g, '$1')));
    result.ambiguousEvaluator ||= parsedSegment.dynamic || parsedSegment.malformed || parsedCommand.malformed;
    const scriptBlock = dialect === 'powershell' ? segment.match(/\{([\s\S]*)\}/) : null;
    const executesScriptBlock = scriptBlock && tokens.some((token) => /^(?:&|Invoke-Command|icm|ForEach-Object|%)$/i.test(token));
    if (executesScriptBlock) {
      const nested = analyzeCommitCommand(scriptBlock[1], 'powershell');
      for (const key of Object.keys(result)) result[key] ||= nested[key];
      if (nested.isCommit || parsedSegment.dynamic || nested.ambiguousEvaluator) {
        result.isCommit = true;
        result.unsupportedOption = true;
        continue;
      }
    }
    const computedPowerShellInvocation = dialect === 'powershell' && (
      (tokens[0] === '&' && /^(?:\(|\{|\$)/.test(tokens[1] || ''))
      || /^\$/.test(tokens[0] || '')
      || (tokens[0] === '&' && tokens.some((token) => token.includes('::')))
    );
    if (computedPowerShellInvocation) {
      result.isCommit = true;
      result.unsupportedOption = true;
      continue;
    }
    const shell = path.win32.basename(path.basename(tokens[0] || '')).replace(/\.exe$/, '').toLowerCase();
    const evaluatorIndex = tokens.findIndex((token, index) => index > 0 && (
      (shell === 'cmd' && token.toLowerCase() === '/c')
      || (['powershell', 'pwsh'].includes(shell) && ['-command', '-c'].includes(token.toLowerCase()))
      || (['sh', 'bash', 'zsh', 'ksh'].includes(shell) && /^-[^-]*c/.test(token))
    ));
    if (['powershell', 'pwsh'].includes(shell) && tokens.some((token) => /^-e(?:nc(?:odedcommand)?)?$/i.test(token))) {
      result.isCommit = true;
      result.unsupportedOption = true;
      continue;
    }
    if (evaluatorIndex !== -1) {
      const nestedDialect = shell === 'cmd' ? 'cmd' : ['powershell', 'pwsh'].includes(shell) ? 'powershell' : 'posix';
      const payload = rawTokens.slice(evaluatorIndex + 1).join(' ');
      const opaqueEvaluator = nestedDialect === 'posix'
        ? /(?:^|[;&|]\s*|\s)(?:eval|source)\s/i.test(payload)
        : nestedDialect === 'cmd'
          ? /(?:^|[&|]\s*)(?:for|call)\s/i.test(payload)
          : /(?:^|[;|]\s*)(?:iex|invoke-expression)\b|::|&\s*\(/i.test(payload);
      const nested = analyzeCommitCommand(payload, nestedDialect);
      for (const key of Object.keys(result)) result[key] ||= nested[key];
      if (nested.isCommit || opaqueEvaluator || parsedSegment.dynamic || parsedSegment.malformed || nested.ambiguousEvaluator) {
        result.isCommit = true;
        result.chained ||= segments.length > 1;
        result.unsupportedOption ||= opaqueEvaluator || parsedSegment.dynamic || parsedSegment.malformed || nested.ambiguousEvaluator;
      }
      continue;
    }
    let index = tokens.findIndex((token) => [path.basename(token), path.win32.basename(token)].some((name) => /^git(?:\.exe)?$/i.test(name)));
    if (index === -1) {
      if ((parsedSegment.dynamic || parsedSegment.malformed || parsedCommand.malformed) && tokens.some((token) => /(?:^|\W)commit(?:\W|$)/i.test(token))) {
        result.isCommit = true;
        result.unsupportedOption = true;
        result.chained ||= segments.length > 1;
      }
      continue;
    }
    if (tokens.some((token) => /^GIT_(?:INDEX_FILE|DIR|WORK_TREE)=/i.test(token))) result.unsafeContext = true;
    index += 1;
    const commandAliases = [];
    while (index < tokens.length) {
      const token = tokens[index];
      if (['-C', '--git-dir', '--work-tree', '--namespace'].includes(token) || /^(?:-C.+|--(?:git-dir|work-tree|namespace)=.+)$/.test(token)) {
        result.unsafeContext = true;
        index += ['-C', '--git-dir', '--work-tree', '--namespace'].includes(token) ? 2 : 1;
        continue;
      }
      if (token === '-c') { commandAliases.push(tokens[index + 1] || ''); index += 2; continue; }
      if (/^-c.+/.test(token)) { commandAliases.push(token.slice(2)); index += 1; continue; }
      if (/^--(?:no-pager|no-replace-objects|literal-pathspecs)$/.test(token)) { index += 1; continue; }
      break;
    }
    const subcommand = tokens[index] || '';
    if ((parsedSegment.dynamic || parsedSegment.malformed || parsedCommand.malformed) && subcommand !== 'commit') {
      result.isCommit = true;
      result.unsupportedOption = true;
      result.chained ||= segments.length > 1;
      continue;
    }
    if (subcommand.startsWith('-') && tokens.slice(index + 1).includes('commit')) {
      result.isCommit = true;
      result.unsupportedOption = true;
      result.chained = segments.length > 1;
      continue;
    }
    if (['merge', 'cherry-pick', 'revert', 'am'].includes(subcommand) && !tokens.slice(index + 1).some((token) => ['--abort', '--quit'].includes(token))) {
      result.isCommit = true;
      result.dangerousPorcelain = true;
      result.chained = segments.length > 1;
      continue;
    }
    let aliasValue = commandAliases.find((value) => value.startsWith(`alias.${subcommand}=`))?.split('=').slice(1).join('=') || '';
    if (!aliasValue && subcommand && subcommand !== 'commit') {
      try { aliasValue = execFileSync('git', ['config', '--get', `alias.${subcommand}`], { cwd: repoRoot, encoding: 'utf8' }).trim(); } catch { aliasValue = ''; }
    }
    const isAliasCommit = /(?:^|\s)commit(?:\s|$)/.test(aliasValue.replace(/^!/, ''));
    if (subcommand !== 'commit' && !isAliasCommit) continue;
    result.isCommit = true;
    result.alias = isAliasCommit;
    result.chained = segments.length > 1;
    const args = tokens.slice(index + 1);
    if (args.includes('--help') || args.includes('--dry-run')) return { ...result, isCommit: false };
    result.all = args.includes('--all') || args.some((token) => /^-[^-]*a/.test(token));
    result.historyRewrite = args.includes('--amend');
    result.skipVerify = args.includes('--no-verify') || args.includes('-n');
    const valueOptions = new Set(['-m', '--message']);
    const flagOptions = new Set(['-q', '--quiet', '-v', '--verbose']);
    for (let cursor = 0; cursor < args.length; cursor += 1) {
      const token = args[cursor];
      if (['--only', '-o', '--include', '-i', '--interactive', '--patch', '-p', '--pathspec-from-file'].includes(token) || /^--pathspec-from-file=/.test(token) || token === '--') { result.pathspec = true; break; }
      if (valueOptions.has(token)) { cursor += 1; continue; }
      if (/^(?:-m.+|--message=.+)$/.test(token) || flagOptions.has(token)) continue;
      if (token.startsWith('-')) { result.unsupportedOption = true; break; }
      result.pathspec = true;
      break;
    }
  }
  return result;
}

function stagedFiles() {
  return execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: repoRoot })
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, '/'));
}

function unstagedFiles() {
  return execFileSync('git', ['diff', '--name-only', '-z'], { cwd: repoRoot })
    .toString().split('\0').filter(Boolean).map((file) => file.replace(/\\/g, '/'));
}

function untrackedFiles() {
  return execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repoRoot })
    .toString().split('\0').filter(Boolean).map((file) => file.replace(/\\/g, '/'));
}

function needsArchive(content, planFile) {
  const relative = path.relative(repoRoot, planFile).replace(/\\/g, '/');
  if (relative.includes('/archive/') || relative.includes('/discarded/')) return false;
  return TERMINAL_PLAN_STATUSES.has(frontmatter(content, 'status')) || (/PHASES_PENDING:\s*\[\s*\]/.test(content) && /PHASES_DONE:\s*\[[^\]]+\]/.test(content));
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let command;
  let toolName;
  try {
    const hookInput = JSON.parse(input);
    command = hookInput?.tool_input?.command;
    toolName = hookInput?.tool_name;
  } catch {
    return deny('SaaS-Factory v2.7.0: comando de shell no parseable; commit gate fail-closed.');
  }
  const dialect = toolName === 'PowerShell' ? 'powershell' : toolName === 'Bash' ? 'posix' : 'neutral';
  const analysis = analyzeCommitCommand(command, dialect);
  if (!analysis.isCommit) return allow();
  if (analysis.chained) return deny('Separa staging/mutaciones y git commit en llamadas distintas para validar el indice final.');
  if (analysis.dangerousPorcelain) return deny('merge/cherry-pick/revert/am pueden crear commits fuera del indice auditado; ejecutalos solo mediante un flujo dedicado y reauditoria.');
  if (analysis.unsafeContext) return deny('Commit con indice, git-dir, work-tree o CWD alternativo no permitido; usa el repositorio activo.');
  if (analysis.alias) return deny('Alias de git commit no permitido por el gate; usa git commit literal.');
  if (analysis.pathspec) return deny('Commit con pathspec/--only no permitido; usa git add y luego git commit en llamadas separadas.');
  if (analysis.all) return deny('Commit con --all/-a no permitido; separa git add del commit para auditar el indice exacto.');
  if (analysis.historyRewrite) return deny('Commit --amend no permitido por el gate; crea un commit terminal nuevo.');
  if (analysis.skipVerify) return deny('Commit --no-verify/-n no permitido; conserva todas las verificaciones locales.');
  if (analysis.unsupportedOption) return deny('Opcion de git commit no permitida; usa solo -m/--message y, opcionalmente, -q/--quiet o -v/--verbose.');

  const staged = [...new Set(stagedFiles())];
  const pending = [...new Set([...unstagedFiles(), ...untrackedFiles()])];
  if (pending.length) return deny(`El indice no representa el worktree auditado completo: ${pending.join(', ')}`);
  if (!staged.length) return allow();
  if (!fs.existsSync(markerPath)) return deny(`Commit con ${staged.length} archivo(s) staged sin plan/GSC activo.`);

  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    return deny('active-plan.json invalido; reactiva el plan.');
  }
  if (marker.bootstrap_only) return deny('El marcador bootstrap solo permite crear/migrar la ficha; activa su GSC antes de commit.');

  const planFile = findPlanFile(repoRoot, marker.plan_ref);
  if (!planFile) return deny(`Plan ${marker.plan_ref} ausente o duplicado.`);
  const content = fs.readFileSync(planFile, 'utf8');
  const planStatus = frontmatter(content, 'status');
  const planRelative = path.relative(repoRoot, planFile).replace(/\\/g, '/');
  const terminalArchived = TERMINAL_PLAN_STATUSES.has(planStatus) && (planRelative.includes('/archive/') || planRelative.includes('/discarded/'));
  if (!ACTIVE_PLAN_STATUSES.has(planStatus) && !terminalArchived) return deny(`${marker.plan_ref} no esta activo ni en cierre terminal archivado.`);
  const { contract, errors } = parseScopeContract(content, marker.plan_ref);
  if (errors.length) return deny(`GSC invalido: ${errors.join('; ')}`);
  if (contract.contract_id !== marker.scope_contract_id || contract.contract_sha256 !== marker.contract_sha256) return deny('El GSC cambio; reactiva el plan.');

  const outside = staged.filter((file) => !isPathAllowed(contract, file));
  if (outside.length) return deny(`Staged fuera de ${contract.contract_id}: ${outside.join(', ')}`);
  if (!collateralFindingsClosed(content)) return deny(`${marker.plan_ref}: COLLATERAL_FINDINGS debe ser NONE o una lista CF canonica.`);
  const digest = computeEvidenceDigest(repoRoot, contract.base_ref, planRelative);
  if (!auditorCloseoutValid(content, contract, marker.plan_ref, digest)) return deny(`${marker.plan_ref}: falta Auditor post-mutacion valido para este plan/base/GSC/diff.`);
  if (needsArchive(content, planFile)) return deny(`${marker.plan_ref} esta cerrado pero no archivado.`);
  return allow();
});
