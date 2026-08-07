#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ACTIVE_PLAN_STATUSES,
  PROTOCOL_VERSION,
  COMPLIANCE_STATUSES,
  LIFECYCLE_PHASES,
  PHASE_STATUSES,
  auditorCloseoutValid,
  collateralFindingsClosed,
  changeTypeMatches,
  computeEvidenceDigest,
  diffHunkWithinRanges,
  frontmatter,
  findScopeEntry,
  isPathAllowed,
  isIsoTimestamp,
  normalizePhaseStatus,
  parseIncidentDocument,
  parseScopeContract,
  parseStateFields,
  symbolsForDiffHunks,
  TERMINAL_PLAN_STATUSES,
  unexpectedGeneratedOutputs,
} = require('./protocol-contract.cjs');

const root = process.env.SAAS_FACTORY_ROOT
  ? path.resolve(process.env.SAAS_FACTORY_ROOT)
  : path.resolve(__dirname, '..', '..');
const errors = [];
const warnings = [];
const argv = process.argv.slice(2);
const diffMode = argv.includes('--diff');
const requireCloseout = argv.includes('--require-closeout');

function collectMarkdown(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collectMarkdown(full, output);
    if (entry.isFile() && entry.name.endsWith('.md')) output.push(full);
  }
  return output;
}

function read(relative) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) {
    errors.push(`missing required file: ${relative}`);
    return '';
  }
  return fs.readFileSync(full, 'utf8');
}

function requireText(relative, patterns) {
  const content = read(relative);
  for (const pattern of patterns) if (!pattern.test(content)) errors.push(`${relative}: missing ${pattern}`);
  return content;
}

function quickResume(content) {
  return content.match(/^## QUICK_RESUME\s*$([\s\S]*?)(?=^##\s+|(?![\s\S]))/m)?.[1] || '';
}

function git(args, allowFailure = false) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (allowFailure) return '';
    errors.push(`git ${args.join(' ')} failed: ${error.stderr?.trim() || error.message}`);
    return '';
  }
}

function changedEntries(baseRef) {
  const tokens = git(['diff', '--name-status', '-z', '--end-of-options', baseRef, '--']).split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    const oldPath = /^[RC]/.test(status) ? tokens[index++] : null;
    const rawPath = tokens[index++];
    if (!rawPath) { errors.push(`git diff emitted incomplete ${status} entry`); break; }
    if (rawPath.includes('\\') || oldPath?.includes('\\')) errors.push(`ambiguous backslash filename is unsupported: ${rawPath}`);
    entries.push({ status: status[0], path: rawPath.replace(/\\/g, '/'), oldPath: oldPath?.replace(/\\/g, '/') || null });
  }
  for (const rawPath of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
    if (rawPath.includes('\\')) errors.push(`ambiguous backslash filename is unsupported: ${rawPath}`);
    entries.push({ status: 'A', path: rawPath.replace(/\\/g, '/'), oldPath: null });
  }
  return [...new Map(entries.map((entry) => [entry.path, entry])).values()];
}

function diffHunks(baseRef, filePath) {
  const output = git(['diff', '--unified=0', '--no-color', '--end-of-options', baseRef, '--', filePath], true);
  return [...output.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
  }));
}

function anchorLine(lines, anchor) {
  if (anchor === 'frontmatter') return 1;
  if (anchor === 'EOF') return lines.length;
  const index = lines.findIndex((line) => line.includes(anchor));
  return index === -1 ? null : index + 1;
}

function textLines(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function spanWithin(lines, anchor, start, end) {
  const blockStart = anchorLine(lines, anchor.start_anchor);
  const blockEnd = anchorLine(lines, anchor.end_anchor);
  return blockStart !== null && blockEnd !== null && start >= blockStart && end <= blockEnd;
}

function validateDiffScope(baseRef, change, entry) {
  if (change.status === 'A' || !['exact_lines', 'anchored_block'].includes(entry.scope_mode)) return;
  const hunks = diffHunks(baseRef, change.path);
  if (entry.scope_mode === 'exact_lines') {
    if (!hunks.length) errors.push(`${change.path}: non-content change cannot be authorized by line_ranges_allowed`);
    for (const hunk of hunks) {
      if (!diffHunkWithinRanges(hunk, entry.line_ranges_allowed)) {
        const oldEnd = hunk.oldStart + Math.max(hunk.oldCount, 1) - 1;
        const newEnd = hunk.newStart + Math.max(hunk.newCount, 1) - 1;
        errors.push(`${change.path}: diff hunk old=${hunk.oldStart}-${oldEnd} new=${hunk.newStart}-${newEnd} is outside line_ranges_allowed`);
      }
    }
    const current = fs.existsSync(path.join(root, change.path)) ? fs.readFileSync(path.join(root, change.path), 'utf8') : '';
    const base = git(['show', `${baseRef}:${change.path}`], true);
    const outsideSymbols = symbolsForDiffHunks(base, current, hunks)
      .filter((symbol) => !entry.symbols_allowed.includes(symbol));
    if (outsideSymbols.length) errors.push(`${change.path}: changed symbols outside symbols_allowed: ${outsideSymbols.join(', ')}`);
    return;
  }

  const full = path.join(root, change.path);
  if (!fs.existsSync(full)) return;
  const currentLines = textLines(fs.readFileSync(full, 'utf8'));
  const baseLines = textLines(git(['show', `${baseRef}:${change.path}`], true));
  const appendOnly = entry.anchor_blocks.some((anchor) => anchor.start_anchor === 'EOF_APPEND');
  for (const hunk of hunks) {
    const oldStart = hunk.oldStart;
    const oldEnd = hunk.oldStart + Math.max(hunk.oldCount, 1) - 1;
    const newStart = hunk.newStart;
    const newEnd = hunk.newStart + Math.max(hunk.newCount, 1) - 1;
    const covered = entry.anchor_blocks.some((anchor) => {
      if (anchor.start_anchor === 'EOF_APPEND') {
        return hunk.oldCount === 0 && oldStart >= baseLines.length && newEnd === currentLines.length;
      }
      const oldCovered = (anchor.start_anchor === 'frontmatter' && hunk.oldCount === 0 && oldStart === 0)
        || spanWithin(baseLines, anchor, oldStart, oldEnd);
      return oldCovered && spanWithin(currentLines, anchor, newStart, newEnd);
    });
    if (!covered) errors.push(`${change.path}: diff hunk old=${oldStart}-${oldEnd} new=${newStart}-${newEnd} is outside anchors_allowed`);
    for (const forbidden of entry.forbidden_anchors) {
      const oldForbidden = anchorLine(baseLines, forbidden);
      const newForbidden = anchorLine(currentLines, forbidden);
      if ((oldForbidden !== null && oldStart <= oldForbidden && oldEnd >= oldForbidden)
        || (newForbidden !== null && newStart <= newForbidden && newEnd >= newForbidden)) {
        errors.push(`${change.path}: diff hunk touches forbidden anchor ${forbidden}`);
      }
    }
    if (entry.line_ranges_expected.length && !entry.line_ranges_expected.some((range) => newStart >= range.start && newEnd <= range.end)) {
      warnings.push(`${change.path}: diff hunk ${newStart}-${newEnd} moved outside line_ranges_expected but remains anchor-authorized`);
    }
  }
}

const activeFiles = [
  'AGENTS.md',
  'AI_CONTEXT.md',
  'CLAUDE.md',
  'docs/00-system/FLOWLYAPP_SAAS_FACTORY_PROTOCOL.md',
  'docs/00-system/FLOWLYAPP_SESSION_BOOTSTRAP.md',
  'docs/00-system/FLOWLYAPP_SAAS_FACTORY_MEMORY_POINTER.md',
  'docs/07-plans/README.md',
  'docs/00-system/saas-factory/protocols/prompts/ANEXO_AI_NATIVE_v2.6.0.md',
];

for (const relative of activeFiles) {
  const content = requireText(relative, [/2\.7\.0/, /PROTOCOLO_SAAS_FACTORY_v2\.7\.0_CORE/]);
  if (/PROTOCOLO_SAAS_FACTORY_v2\.6\.0_COMPLETO/.test(content)) errors.push(`${relative}: references missing v2.6.0 monolith`);
  if (/PROTOCOLO_SAAS_FACTORY_v2\.6\.4_CORE/.test(content)) errors.push(`${relative}: references superseded v2.6.4 core`);
}
for (const relative of ['AGENTS.md', 'docs/00-system/FLOWLYAPP_SESSION_BOOTSTRAP.md', 'docs/00-system/saas-factory/roles/saas-factory/gatekeeper.md', 'docs/07-plans/_templates/PLAN-template.md']) {
  requireText(relative, [/ADMINISTRATION/, /BOOTSTRAP/]);
}
const gscProjectionFields = [
  'contract_id', 'protocol_version', 'base_ref', 'intent', 'execution_mode', 'plan_ref', 'phase_ref',
  'approved_by', 'risk_tier', 'files_allowed', 'path', 'change_type', 'scope_mode', 'line_ranges_allowed',
  'symbols_allowed', 'anchors_allowed', 'line_ranges_expected', 'forbidden_anchors', 'allowed_contract_changes',
  'forbidden_zones', 'required_tests', 'expected_outputs', 'post_mutation_auditor_required',
];
for (const [relative, marker] of [
  ['docs/00-system/saas-factory/protocols/prompts/PROTOCOLO_SAAS_FACTORY_v2.7.0_CORE.md', '## 7. Gatekeeper Scope Contract'],
  ['docs/07-plans/README.md', 'Bloque obligatorio para fases con mutacion no trivial:'],
  ['docs/00-system/saas-factory/roles/saas-factory/gatekeeper.md', '## Scope Contract'],
  ['docs/07-plans/_templates/PLAN-template.md', '## GATEKEEPER_SCOPE_CONTRACT'],
]) {
  const content = read(relative);
  const markerIndex = content.indexOf(marker);
  const fenceStart = content.indexOf('```yaml', markerIndex);
  const fenceEnd = content.indexOf('```', fenceStart + 7);
  if (markerIndex < 0 || fenceStart <= markerIndex || fenceEnd <= fenceStart) {
    errors.push(`${relative}: missing fenced GSC projection`);
    continue;
  }
  const projection = content.slice(fenceStart + 7, fenceEnd);
  for (const field of gscProjectionFields) {
    if (!new RegExp(`^\\s*(?:-\\s*)?${field}:`, 'm').test(projection)) errors.push(`${relative}: GSC projection missing ${field}`);
  }
}
if (/SaaS-Factory v2\.6\.0/.test(read('docs/00-system/legacy-agent-memory/ai-memory/project_memory.yaml'))) errors.push('project_memory.yaml: stale protocol non-negotiable');

requireText('docs/00-system/saas-factory/protocols/prompts/PROTOCOLO_SAAS_FACTORY_v2.7.0_CORE.md', [
  /READ_ONLY_REPORT/,
  /AUDIT_REGISTRATION/,
  /files_allowed.*vacio/s,
  /EFFECTIVE_REPOSITORY/,
]);
requireText('docs/00-system/saas-factory/protocols/prompts/PROTOCOLO_SAAS_FACTORY_v2.6.4_CORE.md', [/status: superseded/, /rag_index: false/, /superseded_by: PROTOCOLO_SAAS_FACTORY_v2.7.0_CORE\.md/]);
requireText('.github/workflows/zone-validation.yml', [/protocol-validate\.cjs --diff/, /protocol-gates\.test\.cjs/, /Require independent PR approval/]);

for (const role of ['gatekeeper', 'saas', 'auditor', 'contract-validator', 'ag-pm', 'ag-arch', 'ag-be', 'ag-fe', 'ag-sec', 'ag-qa', 'ag-infra']) {
  requireText(`docs/00-system/saas-factory/roles/saas-factory/${role}.md`, [/2\.7\.0/]);
}

for (const relative of [
  'scripts/saas-factory-helpers/state-event.cjs',
  'scripts/saas-factory-helpers/reasoning-bank.cjs',
  'scripts/saas-factory-helpers/log-summarizer.cjs',
  'scripts/saas-memory-init.ps1',
  'scripts/install-saas-factory-agents.ps1',
]) {
  const content = read(relative);
  if (/docs['"],\s*['"]agents['"],\s*['"]memory/.test(content)) errors.push(`${relative}: obsolete state path`);
  if (/docs[\\/]agents[\\/]memory/.test(content)) errors.push(`${relative}: obsolete state path`);
  if (/v2\.6\.0/.test(content)) errors.push(`${relative}: stale active protocol version`);
}

for (const filePath of collectMarkdown(path.join(root, '.claude', 'agents', 'saas-factory'))) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!/v2\.7\.0/.test(content)) errors.push(`${path.relative(root, filePath)}: adapter is not v2.7.0`);
  if (/\$CanonicalPath/.test(content)) errors.push(`${path.relative(root, filePath)}: unresolved adapter path`);
}
for (const relative of unexpectedGeneratedOutputs(root)) errors.push(`unexpected generated Knowledge output: ${relative}`);

const state = quickResume(read('docs/00-system/legacy-agent-memory/ai-memory/session_state.md'));
if (!state) errors.push('session_state.md: QUICK_RESUME missing or empty');
const requiredStateKeys = ['SCHEMA_VERSION', 'CURRENT_WORK', 'LIFECYCLE_PHASE', 'PHASE_STATUS', 'COMPLIANCE_STATUS', 'BLOCKED_ON_USER', 'LAST_VALIDATED', 'NEXT_STEP_EXACT'];
const stateDocument = parseStateFields(state, requiredStateKeys);
const stateField = (key) => stateDocument.values[key] || '';
errors.push(...stateDocument.errors.map((error) => `session_state.md QUICK_RESUME: ${error}`));
if (!LIFECYCLE_PHASES.has(stateField('LIFECYCLE_PHASE'))) errors.push('session_state.md: invalid LIFECYCLE_PHASE');
if (!PHASE_STATUSES.has(normalizePhaseStatus(stateField('PHASE_STATUS')))) errors.push('session_state.md: invalid PHASE_STATUS');
if (!COMPLIANCE_STATUSES.has(stateField('COMPLIANCE_STATUS'))) errors.push('session_state.md: invalid COMPLIANCE_STATUS');
if (stateField('SCHEMA_VERSION') !== '2.7.0') errors.push('session_state.md: SCHEMA_VERSION must be 2.7.0');
if (!/^(?:PLAN|INC)-\d{4}-\d{3,4}$|^(?:OPERATIONS|NONE)$/.test(stateField('CURRENT_WORK'))) errors.push('session_state.md: invalid CURRENT_WORK');
if (!/^(?:true|false)$/.test(stateField('BLOCKED_ON_USER'))) errors.push('session_state.md: BLOCKED_ON_USER must be true or false');
if (!isIsoTimestamp(stateField('LAST_VALIDATED'))) errors.push('session_state.md: LAST_VALIDATED must be ISO-8601');

const incidentDocument = parseIncidentDocument(read('docs/00-system/legacy-agent-memory/ai-memory/incident_state.md'));
const incidents = incidentDocument.records;
errors.push(...incidentDocument.errors.map((error) => `incident_state.md: ${error}`));
if (!incidents.length) warnings.push('incident_state.md contains no parseable incident records');

const protocolPlans = collectMarkdown(path.join(root, 'docs', '07-plans'))
  .map((filePath) => ({ filePath, content: fs.readFileSync(filePath, 'utf8') }))
  .filter(({ content }) => (
    (/^PROTOCOL_VERSION:\s*2\.7\.0$/m.test(content) || /^protocol_version:\s*2\.7\.0$/m.test(content))
    && /^id:\s*PLAN-\d{4}-\d{3,4}$/m.test(content)
  ));
let gscFiles = 0;
const validContracts = [];
for (const { filePath, content } of protocolPlans) {
  const planRef = frontmatter(content, 'id');
  if (!planRef) continue;
  const parsed = parseScopeContract(content, planRef);
  gscFiles += parsed.contract?.files_allowed.length || 0;
  errors.push(...parsed.errors.map((error) => `${path.relative(root, filePath)} GSC: ${error}`));
  if (!parsed.contract || parsed.errors.length) continue;
  const status = frontmatter(content, 'status');
  if (ACTIVE_PLAN_STATUSES.has(status) || TERMINAL_PLAN_STATUSES.has(status)) validContracts.push({ contract: parsed.contract, content, status, filePath });
  for (const entry of parsed.contract.files_allowed.filter((item) => item.scope_mode === 'anchored_block')) {
    const full = path.join(root, entry.path);
    if (!fs.existsSync(full)) continue;
    const target = fs.readFileSync(full, 'utf8');
    let priorIndex = -1;
    for (const value of entry.anchors) {
      if (['EOF', 'EOF_APPEND', 'none'].includes(value)) continue;
      const anchorIndex = value === 'frontmatter' ? (target.startsWith('---') ? 0 : -1) : target.indexOf(value);
      if (anchorIndex === -1) errors.push(`${entry.path}: GSC anchor not found: ${value}`);
      else if (anchorIndex < priorIndex) errors.push(`${entry.path}: GSC anchors are out of order at: ${value}`);
      priorIndex = Math.max(priorIndex, anchorIndex);
    }
  }
}
if (!protocolPlans.length) errors.push('no v2.7.0 plan with GSC found');

let diffFiles = [];
let evidenceDigest = null;
if (diffMode && !validContracts.length) errors.push('diff validation requires an approved/in-progress or closed v2.7 plan');
if (diffMode && validContracts.length) {
  const baseIndex = argv.indexOf('--base');
  const requestedBase = baseIndex >= 0 ? argv[baseIndex + 1] : process.env.PROTOCOL_BASE_REF;
  const eligible = requestedBase ? validContracts.filter((item) => item.contract.base_ref === requestedBase) : validContracts;
  const baseRef = requestedBase || eligible[0]?.contract.base_ref;
  if (requestedBase && !eligible.length) errors.push(`no valid GSC declares requested base_ref ${requestedBase}`);
  if (!baseRef) errors.push('--diff requires --base <ref> or a GSC base_ref');
  else {
    const changes = changedEntries(baseRef);
    diffFiles = changes.map((change) => change.path);
    const owner = eligible.find((item) => changes.every((change) => isPathAllowed(item.contract, change.path) && (!change.oldPath || isPathAllowed(item.contract, change.oldPath))));
    if (!owner) errors.push(`diff is not fully covered by one valid GSC (${diffFiles.length} files from ${baseRef})`);
    else {
      for (const change of changes) {
        const entry = findScopeEntry(owner.contract, change.path);
        if (!changeTypeMatches(entry.change_type, change.status)) errors.push(`${change.path}: actual ${change.status} conflicts with change_type=${entry.change_type}`);
        validateDiffScope(baseRef, change, entry);
        if (change.status === 'R') {
          const sourceEntry = findScopeEntry(owner.contract, change.oldPath);
          if (entry.change_type !== 'move' || sourceEntry?.change_type !== 'move') errors.push(`${change.oldPath} -> ${change.path}: both rename paths require change_type=move`);
        }
      }
      const planRelative = path.relative(root, owner.filePath).replace(/\\/g, '/');
      evidenceDigest = computeEvidenceDigest(root, owner.contract.base_ref, planRelative);
      if (requireCloseout && !auditorCloseoutValid(owner.content, owner.contract, frontmatter(owner.content, 'id'), evidenceDigest)) errors.push('diff owner lacks valid Auditor evidence for its plan/base/GSC/diff');
      if (requireCloseout && !collateralFindingsClosed(owner.content)) errors.push('diff owner lacks canonical closed COLLATERAL_FINDINGS');
    }
  }
}

const settings = read('.claude/settings.json');
if (!/process\.env\.CLAUDE_PROJECT_DIR[^\n]+plan-gate\.cjs/.test(settings)) errors.push('.claude/settings.json: plan gate is not project-root resolved');
if (!/process\.env\.CLAUDE_PROJECT_DIR[^\n]+commit-gate\.cjs/.test(settings)) errors.push('.claude/settings.json: commit gate is not project-root resolved');
if (!/Write\|Edit\|MultiEdit\|NotebookEdit/.test(settings)) errors.push('.claude/settings.json: NotebookEdit is not covered by mutation gates');

console.log(`SaaS-Factory protocol validator v${PROTOCOL_VERSION}`);
console.log(`  Active projections: ${activeFiles.length}`);
console.log(`  Incident records: ${incidents.length}`);
console.log(`  Protocol plans: ${protocolPlans.length}`);
console.log(`  GSC files: ${gscFiles}`);
if (diffMode) console.log(`  Diff files: ${diffFiles.length}`);
if (evidenceDigest) console.log(`  Evidence digest: ${evidenceDigest}`);
for (const warning of warnings) console.warn(`WARN ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exit(1);
}
console.log('Protocol validation PASS');
