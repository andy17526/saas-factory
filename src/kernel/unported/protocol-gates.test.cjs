#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  auditorVerdict,
  auditorCloseoutValid,
  collateralFindingsClosed,
  changeTypeMatches,
  currentHeadApprovalCount,
  diffHunkWithinRanges,
  frontmatter,
  findScopeEntry,
  isPathAllowed,
  isIsoTimestamp,
  normalizePhaseStatus,
  parseIncidentDocument,
  parseIncidentRecords,
  parseScopeContract,
  parseStateFields,
  symbolsForDiffHunks,
  TERMINAL_PLAN_STATUSES,
  unexpectedGeneratedOutputs,
} = require('./protocol-contract.cjs');
const { validateArchiveDecision, validateArchiveLifecycle } = require('../knowledge/archive-plan.cjs');
const { sha256: inventorySha256 } = require('../knowledge/build-docs-inventory.cjs');

const activateCli = path.join(__dirname, 'plan-activate.cjs');
const planGateCli = path.join(__dirname, 'plan-gate.cjs');
const commitGateCli = path.join(__dirname, 'commit-gate.cjs');
const archiveModule = path.join(__dirname, '../knowledge/archive-plan.cjs');
const versionBumpCli = path.join(__dirname, 'version-bump.cjs');
const versionCheckCli = path.join(__dirname, 'version-check.cjs');
const testBaseRef = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('knowledge inventory hashes normalize text EOL', () => {
  assert.equal(inventorySha256('alpha\r\nbeta\r\n'), inventorySha256('alpha\nbeta\n'));
});

function run(script, args, root, input) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, SAAS_FACTORY_ROOT: root },
    input,
    encoding: 'utf8',
  });
}

function gateDecision(result) {
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : 'allow';
}

function cliPlan(ref, target, phase = 'F1-F4', baseRef = testBaseRef) {
  const plan = `---
id: ${ref}
status: approved
---
PROTOCOL_VERSION: 2.7.0
## GATEKEEPER_SCOPE_CONTRACT

\`\`\`yaml
contract_id: GSC-${ref}
protocol_version: 2.7.0
base_ref: ${baseRef}
intent: IMPLEMENTATION
execution_mode: WRITE
plan_ref: ${ref}
phase_ref: ${phase}
approved_by: user
risk_tier: LOW
files_allowed:
  - path: ${target}
    change_type: create
    scope_mode: new_file
    symbols_allowed: [fixtureFile]
  - path: docs/07-plans/P1-next/${ref}-cli-test.md
    change_type: create
    scope_mode: new_file
    symbols_allowed: [fixturePlan]
allowed_contract_changes: []
forbidden_zones: []
required_tests:
  - node --test
expected_outputs:
  - cli gates enforced
post_mutation_auditor_required: true
\`\`\`

COLLATERAL_FINDINGS: NONE

AUDITOR_POST_MUTATION_REPORT:
  contract_id: GSC-${ref}
  contract_sha256: CONTRACT_SHA
  base_ref: ${baseRef}
  head_ref: WORKTREE
  plan_ref: ${ref}
  evidence_digest: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  auditor_identity: SAAS-FACTORY-AUDITOR/test-reviewer
  audit_timestamp: 2026-07-23T00:00:00Z
  result: PASS
  gatekeeper_scope_contract: present
  files_touched_outside_plan: []
  symbols_changed_outside_plan: []
  contract_changes_unexpected: []
  debt_delta:
    introduced_by_mutation: []
    touched_existing_debt: []
    exposed_existing_debt: []
    not_in_scope_old_debt: []
  line_scope_check:
    lines_touched_within_allowed_ranges: []
    lines_touched_outside_allowed_ranges: []
    missing_line_range_contract: []
  anchor_scope_check:
    anchors_touched_within_allowed_blocks: []
    anchors_touched_outside_allowed_blocks: []
    missing_anchor_contract: []
    forbidden_anchor_touched: []
  documentation_duplication_check:
    ssot_declared: []
    duplicated_without_reason: []
  duplicate_symbols_introduced: []
  escalated_to: []
  registration_status: REGISTRATION_PENDING
`;
  const contract = parseScopeContract(plan, ref).contract;
  return plan.replace('contract_sha256: CONTRACT_SHA', `contract_sha256: ${contract.contract_sha256}`);
}

function planWith(scope) {
  const executableScope = scope.includes('execution_mode:') ? scope : scope.replace(/^(intent:\s*.+)$/m, '$1\nexecution_mode: WRITE');
  return `---\nid: PLAN-2026-999\nstatus: approved\n---\n\n## GATEKEEPER_SCOPE_CONTRACT\n\n\`\`\`yaml\n${executableScope.replace('base_ref: abc123', `base_ref: ${testBaseRef}`)}\n\`\`\`\n\n## Context\n\nForbidden example: \`apps/api/src/forbidden.ts\`.\n`;
}

test('parses only paths declared in the GSC block', () => {
  const { contract, errors } = parseScopeContract(planWith(`contract_id: GSC-TEST\nprotocol_version: 2.7.0\nbase_ref: abc123\nintent: IMPLEMENTATION\nplan_ref: PLAN-2026-999\nphase_ref: F1\napproved_by: user\nrisk_tier: HIGH\nfiles_allowed:\n  - path: scripts/allowed.cjs\n    change_type: modify\n    scope_mode: exact_lines\n    line_ranges_allowed: [{start: 1, end: 2, reason: "test range"}]\n    symbols_allowed: [allowedHandler]\nallowed_contract_changes: []\nforbidden_zones:\n  - apps/**\nrequired_tests:\n  - node --test test.cjs\nexpected_outputs:\n  - exact scope\npost_mutation_auditor_required: true`), 'PLAN-2026-999');
  assert.deepEqual(errors, []);
  assert.equal(contract.files_allowed.length, 1);
  assert.equal(contract.files_allowed[0].path, 'scripts/allowed.cjs');
  assert.deepEqual(contract.files_allowed[0].symbols_allowed, ['allowedHandler']);
  assert.equal(isPathAllowed(contract, 'scripts/allowed.cjs'), true);
  assert.equal(isPathAllowed(contract, 'apps/api/src/forbidden.ts'), false);
});

test('rejects missing and empty scopes', () => {
  assert.match(parseScopeContract('# no contract', 'PLAN-2026-999').errors.join(' '), /missing/);
  const result = parseScopeContract(planWith(`contract_id: GSC-TEST\nprotocol_version: 2.7.0\nbase_ref: abc123\nintent: IMPLEMENTATION\nplan_ref: PLAN-2026-999\nphase_ref: F1\napproved_by: user\nrisk_tier: HIGH\nfiles_allowed:\nallowed_contract_changes: []\nforbidden_zones: []\nrequired_tests:\n  - test\nexpected_outputs:\n  - output\npost_mutation_auditor_required: true`), 'PLAN-2026-999');
  assert.match(result.errors.join(' '), /at least one/);
});

test('rejects READ_ONLY execution mode in executable GSCs', () => {
  const readOnly = cliPlan('PLAN-2026-991', 'allowed.txt', 'F1').replace('execution_mode: WRITE', 'execution_mode: READ_ONLY');
  const result = parseScopeContract(readOnly, 'PLAN-2026-991');
  assert.equal(result.contract.execution_mode, 'READ_ONLY');
  assert.match(result.errors.join(' '), /execution_mode must be WRITE/);
});

test('rejects symbolic and option-like GSC base refs', () => {
  for (const baseRef of ['HEAD^', '--cached']) {
    const result = parseScopeContract(planWith(`contract_id: GSC-TEST\nprotocol_version: 2.7.0\nbase_ref: ${baseRef}\nintent: IMPLEMENTATION\nplan_ref: PLAN-2026-999\nphase_ref: F1\napproved_by: user\nrisk_tier: LOW\nfiles_allowed:\n  - path: new.txt\n    change_type: create\n    scope_mode: new_file\nallowed_contract_changes: []\nforbidden_zones: []\nrequired_tests:\n  - test\nexpected_outputs:\n  - output\npost_mutation_auditor_required: true`), 'PLAN-2026-999');
    assert.match(result.errors.join(' '), /exact 40-character commit SHA/);
  }
});

test('rejects empty per-file ranges and incomplete material fields', () => {
  const result = parseScopeContract(planWith(`contract_id: GSC-TEST\nprotocol_version: 2.7.0\nbase_ref: abc123\nintent: IMPLEMENTATION\nplan_ref: PLAN-2026-999\nphase_ref: F1\nfiles_allowed:\n  - path: scripts/allowed.cjs\n    change_type: modify\n    scope_mode: exact_lines\n    line_ranges_allowed: []\nforbidden_zones: []`), 'PLAN-2026-999');
  assert.match(result.errors.join(' '), /approved_by is required/);
  assert.match(result.errors.join(' '), /exact_lines requires/);
  assert.match(result.errors.join(' '), /required_tests/);
});

test('does not borrow YAML from a later heading', () => {
  const content = `## GATEKEEPER_SCOPE_CONTRACT\n\nNo contract yet.\n\n## Context\n\n\`\`\`yaml\ncontract_id: BORROWED\n\`\`\``;
  assert.match(parseScopeContract(content, 'PLAN-2026-999').errors.join(' '), /missing/);
});

test('reads status only from the leading frontmatter fence', () => {
  assert.equal(frontmatter('---\nstatus: approved\n---\nstatus: draft', 'status'), 'approved');
  assert.equal(frontmatter('# body\nstatus: approved', 'status'), null);
  assert.equal(frontmatter('---\nid: PLAN-2026-999\nid: PLAN-2026-998\n---\n', 'id'), null);
});

test('accepts only canonical collateral closeout and audit verdicts', () => {
  assert.equal(collateralFindingsClosed('COLLATERAL_FINDINGS: NONE'), true);
  assert.equal(collateralFindingsClosed('COLLATERAL_FINDINGS: TODO'), false);
  assert.equal(collateralFindingsClosed('COLLATERAL_FINDINGS: []'), false);
  assert.equal(collateralFindingsClosed('COLLATERAL_FINDINGS:\n  - finding_id: CF-PLAN-2026-001-001\n    file: scripts/a.cjs\n    lines: 1-2\n    pattern: concrete defect\n    severity: P2\n    effort: S'), true);
  assert.equal(collateralFindingsClosed('COLLATERAL_FINDINGS:\n  - finding_id: CF-ONLY-ID'), false);
  assert.equal(collateralFindingsClosed('COLLATERAL_FINDINGS: NONE\n\nCOLLATERAL_FINDINGS: PENDING_PHASE_CLOSE'), false);
  assert.equal(collateralFindingsClosed('COLLATERAL_FINDINGS: PENDING_PHASE_CLOSE\n\n\`\`\`yaml\nCOLLATERAL_FINDINGS: NONE\n\`\`\`'), false);
  assert.equal(collateralFindingsClosed('## Collateral Findings\nCOLLATERAL_FINDINGS: NONE\n\n## Collateral Findings\nCOLLATERAL_FINDINGS: PENDING_PHASE_CLOSE'), false);
  assert.equal(auditorVerdict('AUDITOR_POST_MUTATION_REPORT:\n  result: PASS_WITH_NOTES'), 'PASS_WITH_NOTES');
  assert.equal(auditorVerdict('result: PASS'), null);
  const content = cliPlan('PLAN-2026-993', 'allowed.txt', 'F1');
  const contract = parseScopeContract(content, 'PLAN-2026-993').contract;
  assert.equal(auditorCloseoutValid(content, contract, 'PLAN-2026-993'), true);
  assert.equal(auditorCloseoutValid(content.replace(/^\s*registration_status:.*\r?\n/m, ''), contract, 'PLAN-2026-993'), false);
  assert.equal(auditorCloseoutValid(content.replace(`base_ref: ${testBaseRef}\n  head_ref`, 'base_ref: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n  head_ref'), contract, 'PLAN-2026-993'), false);
  for (const contradictory of [
    content.replace('gatekeeper_scope_contract: present', 'gatekeeper_scope_contract: absent'),
    content.replace('files_touched_outside_plan: []', 'files_touched_outside_plan: [outside.md]'),
    content.replace('contract_changes_unexpected: []', 'contract_changes_unexpected: [breaking_change]'),
    content.replace('introduced_by_mutation: []', 'introduced_by_mutation: [PM-001]'),
    content.replace('registration_status: REGISTRATION_PENDING', 'registration_status: INVALID'),
    content.replace('auditor_identity: SAAS-FACTORY-AUDITOR/test-reviewer', 'auditor_identity: unknown'),
    content.replace('audit_timestamp: 2026-07-23T00:00:00Z', 'audit_timestamp: someday'),
    content.replace('escalated_to: []', 'escalated_to: [AG-SEC]'),
    content.replace('files_touched_outside_plan: []', 'files_touched_outside_plan: []\n  files_touched_outside_plan:\n    - outside.md'),
  ]) assert.equal(auditorCloseoutValid(contradictory, contract, 'PLAN-2026-993'), false);
  const notes = content
    .replace('result: PASS', 'result: PASS_WITH_NOTES')
    .replace('exposed_existing_debt: []', 'exposed_existing_debt: [PM-PREEXISTING-001]');
  assert.equal(auditorCloseoutValid(notes, contract, 'PLAN-2026-993'), true);
  const reportStart = content.indexOf('AUDITOR_POST_MUTATION_REPORT:');
  assert.equal(auditorCloseoutValid(`${content}\n${content.slice(reportStart)}`, contract, 'PLAN-2026-993'), false);
  assert.equal(auditorCloseoutValid(content.replace('    introduced_by_mutation: []', '  introduced_by_mutation: []'), contract, 'PLAN-2026-993'), false);
  const borrowed = `AUDITOR_POST_MUTATION_REPORT:\n  result: PASS\n## Unrelated\n  contract_id: ${contract.contract_id}\n  contract_sha256: ${contract.contract_sha256}\n  base_ref: ${contract.base_ref}\n  head_ref: WORKTREE\n  plan_ref: PLAN-2026-993\n  evidence_digest: ${'a'.repeat(64)}`;
  assert.equal(auditorCloseoutValid(borrowed, contract, 'PLAN-2026-993'), false);
});

test('rejects platform-independent absolute paths', () => {
  const result = parseScopeContract(planWith(`contract_id: GSC-TEST\nprotocol_version: 2.7.0\nbase_ref: abc123\nintent: IMPLEMENTATION\nplan_ref: PLAN-2026-999\nphase_ref: F1\napproved_by: user\nrisk_tier: HIGH\nfiles_allowed:\n  - path: C:/outside/file.cjs\n    change_type: modify\n    scope_mode: exact_lines\n    line_ranges_allowed: [{start: 1, end: 2, reason: "test range"}]\nallowed_contract_changes: []\nforbidden_zones: []\nrequired_tests:\n  - test\nexpected_outputs:\n  - output\npost_mutation_auditor_required: true`), 'PLAN-2026-999');
  assert.match(result.errors.join(' '), /invalid path/);
});

test('matches declared change types to Git status', () => {
  assert.equal(changeTypeMatches('modify', 'M'), true);
  assert.equal(changeTypeMatches('modify', 'D'), false);
  assert.equal(changeTypeMatches('delete', 'D'), true);
  assert.equal(changeTypeMatches('move', 'R100'), true);
  assert.equal(changeTypeMatches('generated', 'A'), true);
});

test('exact line scopes cover both sides of every diff hunk', () => {
  const ranges = [{ start: 1, end: 10 }];
  assert.equal(diffHunkWithinRanges({ oldStart: 2, oldCount: 1, newStart: 9, newCount: 2 }, ranges), true);
  assert.equal(diffHunkWithinRanges({ oldStart: 2, oldCount: 1, newStart: 10, newCount: 2 }, ranges), false);
  assert.equal(diffHunkWithinRanges({ oldStart: 11, oldCount: 0, newStart: 11, newCount: 1 }, ranges), false);
});

test('exact line scopes identify changed top-level symbols on both sides', () => {
  const base = 'const moduleValue = 1;\n\nfunction alpha() {\n  return 1;\n}\n\nfunction removed() {\n  return 2;\n}\n';
  const current = 'const moduleValue = 1;\n\nfunction alpha() {\n  return 3;\n}\n\nfunction added() {\n  return 4;\n}\n';
  const hunks = [
    { oldStart: 4, oldCount: 1, newStart: 4, newCount: 1 },
    { oldStart: 7, oldCount: 3, newStart: 7, newCount: 3 },
  ];
  assert.deepEqual(symbolsForDiffHunks(base, current, hunks), ['added', 'alpha', 'removed']);
  assert.deepEqual(
    symbolsForDiffHunks('export class OldName {}\n', 'export class NewName {}\n', [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 }]),
    ['NewName', 'OldName'],
  );
  assert.deepEqual(
    symbolsForDiffHunks('module.exports.allowed = 1;\n', 'module.exports.outside = 1;\n', [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 }]),
    ['module.exports.allowed', 'module.exports.outside'],
  );
  assert.deepEqual(
    symbolsForDiffHunks('Allowed.prototype.method = fn;\n', 'Outside.prototype.evil = fn;\n', [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 }]),
    ['Allowed.prototype.method', 'Outside.prototype.evil'],
  );
  assert.deepEqual(
    symbolsForDiffHunks("module['exports'].allowed ||= fn;\n", "delete module['exports'].outside;\n", [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 }]),
    ["module['exports'].allowed", "module['exports'].outside"],
  );
  assert.deepEqual(
    symbolsForDiffHunks('function allowed() {}\n', 'function allowed() {}\n(globalThis.evil = 1);\n', [{ oldStart: 2, oldCount: 0, newStart: 2, newCount: 1 }]),
    ['allowed', 'globalThis.evil'],
  );
  assert.deepEqual(
    symbolsForDiffHunks('function allowed() {}\n', 'function allowed() {}\ndangerousCall();\n', [{ oldStart: 2, oldCount: 0, newStart: 2, newCount: 1 }]),
    ['<document>', 'allowed'],
  );
  assert.deepEqual(
    symbolsForDiffHunks('function allowed() {}\n', 'function allowed() {}\n (globalThis.evil = 1);\n', [{ oldStart: 2, oldCount: 0, newStart: 2, newCount: 1 }]),
    ['<document>', 'allowed'],
  );
  for (const declaration of [' function outside() {}', ' const outside = 1;', ' class Outside {}']) {
    assert.deepEqual(
      symbolsForDiffHunks('function allowed() {}\n', `function allowed() {}\n${declaration}\n`, [{ oldStart: 2, oldCount: 0, newStart: 2, newCount: 1 }]),
      ['<document>', 'allowed'],
    );
  }
  assert.deepEqual(
    symbolsForDiffHunks('const { allowed } = source;\n', 'const { outside } = source;\n', [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 }]),
    ['<document>'],
  );
  for (const assignment of [' ({ outside } = source);', ' [outside] = source;']) {
    assert.deepEqual(
      symbolsForDiffHunks('function allowed() {}\n', `function allowed() {}\n${assignment}\n`, [{ oldStart: 2, oldCount: 0, newStart: 2, newCount: 1 }]),
      ['<document>', 'allowed'],
    );
  }
});

test('exact scope entries override broader generated globs', () => {
  const contract = { files_allowed: [
    { path: 'apps/**', change_type: 'generated' },
    { path: 'apps/foo.ts', change_type: 'modify' },
  ], forbidden_zones: [] };
  assert.equal(findScopeEntry(contract, 'apps/foo.ts').change_type, 'modify');
});

test('parses structured Markdown anchors in semantic order', () => {
  const result = parseScopeContract(planWith(`contract_id: GSC-TEST\nprotocol_version: 2.7.0\nbase_ref: abc123\nintent: IMPLEMENTATION\nplan_ref: PLAN-2026-999\nphase_ref: F1\napproved_by: user\nrisk_tier: LOW\nfiles_allowed:\n  - path: docs/test.md\n    change_type: modify\n    scope_mode: anchored_block\n    anchors_allowed:\n      - start_anchor: "## Start"\n        end_anchor: "## End"\n        allowed_operations: [update_test]\n    line_ranges_expected: []\n    forbidden_anchors: []\nallowed_contract_changes: []\nforbidden_zones: []\nrequired_tests:\n  - test\nexpected_outputs:\n  - output\npost_mutation_auditor_required: true`), 'PLAN-2026-999');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.contract.files_allowed[0].anchors, ['## Start', '## End']);
  assert.deepEqual(result.contract.files_allowed[0].anchor_blocks[0].allowed_operations, ['update_test']);
});

test('rejects malformed deterministic range and anchor metadata', () => {
  const exact = `contract_id: GSC-TEST\nprotocol_version: 2.7.0\nbase_ref: abc123\nintent: IMPLEMENTATION\nplan_ref: PLAN-2026-999\nphase_ref: F1\napproved_by: user\nrisk_tier: LOW\nfiles_allowed:\n  - path: scripts/test.cjs\n    change_type: modify\n    scope_mode: exact_lines\n    line_ranges_allowed: [malformed]\nallowed_contract_changes: []\nforbidden_zones: []\nrequired_tests: [test]\nexpected_outputs: [output]\npost_mutation_auditor_required: true`;
  assert.match(parseScopeContract(planWith(exact), 'PLAN-2026-999').errors.join(' '), /valid structured line_ranges_allowed/);
  assert.match(parseScopeContract(planWith(exact.replace('base_ref: abc123', 'base_ref: abc123\nbase_ref: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')), 'PLAN-2026-999').errors.join(' '), /duplicate GSC key: base_ref/);
  assert.match(parseScopeContract(planWith(exact.replace('intent: IMPLEMENTATION', 'intent: IMPLEMENTATION\nunknown_contract_key: nope')), 'PLAN-2026-999').errors.join(' '), /unknown GSC key/);
  assert.match(parseScopeContract(planWith(exact.replace('intent: IMPLEMENTATION', 'intent: IMPLEMENTATION\ndomains: [governance]')), 'PLAN-2026-999').errors.join(' '), /unknown GSC key: domains/);
  const anchored = `contract_id: GSC-TEST\nprotocol_version: 2.7.0\nbase_ref: abc123\nintent: IMPLEMENTATION\nplan_ref: PLAN-2026-999\nphase_ref: F1\napproved_by: user\nrisk_tier: LOW\nfiles_allowed:\n  - path: docs/test.md\n    change_type: modify\n    scope_mode: anchored_block\n    anchors_allowed:\n      - start_anchor: "## Start"\n        end_anchor: "## End"\n        allowed_operations: [update_test]\n    line_ranges_expected: malformed\n    forbidden_anchors: malformed\nallowed_contract_changes: []\nforbidden_zones: []\nrequired_tests: [test]\nexpected_outputs: [output]\npost_mutation_auditor_required: true`;
  const errors = parseScopeContract(planWith(anchored), 'PLAN-2026-999').errors.join(' ');
  assert.match(errors, /valid line_ranges_expected/);
  assert.match(errors, /valid forbidden_anchors/);
});

test('parses every incident record and preserves nonterminal statuses', () => {
  const records = parseIncidentRecords(`INCIDENT_ID: INC-2026-901\nSEVERITY: P1\nSTATUS: MITIGATED\nOWNER: AG-INFRA\nIMPACT: none\nNEXT_STEP_EXACT: verify\n---\nINCIDENT_ID: INC-2026-902\nSEVERITY: P2\nSTATUS: CLOSED\nOWNER: AG-QA\nIMPACT: none\nNEXT_STEP_EXACT: none`);
  assert.deepEqual(records, [
    { id: 'INC-2026-901', status: 'MITIGATED', raw_status: 'MITIGATED', severity: 'P1' },
    { id: 'INC-2026-902', status: 'CLOSED', raw_status: 'CLOSED', severity: 'P2' },
  ]);
  const legacy = parseIncidentDocument('INCIDENT_ID: INC-2026-903\nSEVERITY: P1\nSTATUS: MITIGATED_V1_PENDING_FIELD_SMOKE\nOWNER: AG-INFRA\nIMPACT: none\nNEXT_STEP_EXACT: verify');
  assert.equal(legacy.records.length, 0);
  assert.match(legacy.errors.join(' '), /unsupported STATUS/);
});

test('reports malformed incident records instead of dropping them', () => {
  const result = parseIncidentDocument(`INCIDENT_ID: INC-2026-901\nSEVERITY: P1\n---\nINCIDENT_ID: INC-2026-902\nSEVERITY: P2\nSTATUS: CLOSED\nOWNER: AG-QA\nIMPACT: none\nNEXT_STEP_EXACT: none`);
  assert.equal(result.records.length, 1);
  assert.equal(result.errors.length, 1);
  for (const malformed of [
    'SEVERITY: P1\nSTATUS: DETECTED\nOWNER: AG-SEC\nIMPACT: active\nNEXT_STEP_EXACT: contain',
    'INCIDENT-ID: INC-2026-999\nSEVERITY: P1\nSTATUS: DETECTED\nOWNER: AG-SEC\nIMPACT: active\nNEXT_STEP_EXACT: contain',
    '  SEVERITY: P1\n  STATUS: DETECTED\n  OWNER: AG-SEC\n  IMPACT: active\n  NEXT_STEP_EXACT: contain',
    '  INCIDENT_ID: INC-2026-999\n  SEVERITY: P1\n  STATUS: DETECTED\n  OWNER: AG-SEC\n  IMPACT: active\n  NEXT_STEP_EXACT: contain',
    '- INCIDENT_ID: INC-2026-999\n- SEVERITY: P1\n- STATUS: DETECTED\n- OWNER: AG-SEC\n- IMPACT: active\n- NEXT_STEP_EXACT: contain',
  ]) {
    const identity = parseIncidentDocument(malformed);
    assert.equal(identity.records.length, 0);
    assert.match(identity.errors.join(' '), /missing INCIDENT_ID/);
  }
});

test('rejects contradictory duplicate state and incident fields', () => {
  const state = parseStateFields('- PHASE_STATUS = DONE\n- PHASE_STATUS = BLOCKED\n', ['PHASE_STATUS']);
  assert.match(state.errors.join(' '), /PHASE_STATUS must appear exactly once/);
  const incident = parseIncidentDocument('INCIDENT_ID: INC-2026-901\nSEVERITY: P1\nSTATUS: CLOSED\nSTATUS: DETECTED\nOWNER: AG-QA\nIMPACT: none\nNEXT_STEP_EXACT: none');
  assert.equal(incident.records.length, 0);
  assert.match(incident.errors.join(' '), /STATUS must appear exactly once/);
});

test('normalizes persisted legacy state and enforces ISO timestamps', () => {
  assert.equal(normalizePhaseStatus('COMPLETED'), 'DONE');
  assert.equal(normalizePhaseStatus('implemented_local'), 'CODE_COMPLETE');
  assert.equal(normalizePhaseStatus('DEPLOYED_PENDING_FIELD_SMOKE'), 'DEPLOYED_PENDING_VALIDATION');
  assert.equal(isIsoTimestamp('2026-07-22T00:00:00Z'), true);
  assert.equal(isIsoTimestamp('2024-02-29T00:00:00Z'), true);
  assert.equal(isIsoTimestamp('2026-02-29T00:00:00Z'), false);
  assert.equal(isIsoTimestamp('2026-04-31T00:00:00Z'), false);
  assert.equal(isIsoTimestamp('2026/07/22'), false);
});

test('requires complete canonical archive metadata', () => {
  const plan = fs.readFileSync(path.join(__dirname, '../../docs/07-plans/archive/2026/completed/global/PLAN-2026-195-p1-saas-factory-v2-7-protocol-convergence.md'), 'utf8');
  assert.equal(validateArchiveDecision(plan).ok, true);
  assert.match(
    validateArchiveDecision(plan.replace(
      'archive_path: docs/07-plans/archive/2026/completed/global/PLAN-2026-195-p1-saas-factory-v2-7-protocol-convergence.md',
      'archive_path: docs/07-plans/archive/2026/completed/global/PLAN-2026-999-unrelated.md',
    )).reason,
    /archive filename must match plan identity/,
  );
  const incomplete = '## ARCHIVE_DESTINATION_DECISION\n\n\`\`\`yaml\narchive_path: docs/07-plans/archive/2026/completed/global/test.md\n\`\`\`';
  assert.match(validateArchiveDecision(incomplete).reason, /missing:/);
  assert.match(validateArchiveDecision(plan.replace('archive_path:', 'archive_path: docs/07-plans/archive/2026/completed/global/PLAN-2026-999-conflict.md\narchive_path:')).reason, /duplicate archive fields: archive_path/);
  assert.match(validateArchiveDecision(plan.replace('primary_owner: GLOBAL', 'primary_owner: POTATO')).reason, /invalid primary_owner/);
  const auditReport = cliPlan('PLAN-2026-999', 'allowed.txt', 'F1').slice(cliPlan('PLAN-2026-999', 'allowed.txt', 'F1').indexOf('AUDITOR_POST_MUTATION_REPORT:'));
  const closed = `---\nid: PLAN-2026-999\nstatus: done\n---\n## Estado Actual\n\n\`\`\`yaml\nPLAN_ID: PLAN-2026-999\nCURRENT_PHASE: 0\nTOTAL_PHASES: 2\nPHASES_DONE: [1, 2]\nPHASES_PENDING: []\nPHASES_BLOCKED: []\n\`\`\`\n## Fases De Ejecucion\n\n### Fase 1 - first\n**Status:** [x] DONE\n### Fase 2 - second\n**Estado:**\n- [ ] pending | [ ] in-progress | [x] DONE\n## Hallazgos Colaterales\nCOLLATERAL_FINDINGS: NONE\n${auditReport}`;
  assert.equal(validateArchiveLifecycle(closed).ok, true);
  assert.match(validateArchiveLifecycle(closed.replace(auditReport, 'AUDITOR_POST_MUTATION_REPORT:\n  result: PASS')).reason, /structurally valid/);
  const incompletePhases = closed.replace('PHASES_DONE: [1, 2]', 'PHASES_DONE: [1]').replace('PHASES_BLOCKED: []', 'PHASES_BLOCKED: [2]').replace('[x] DONE\n## Hallazgos', '[x] in-progress\n## Hallazgos');
  assert.match(validateArchiveLifecycle(incompletePhases).reason, /PHASES_BLOCKED/);
  assert.match(validateArchiveLifecycle(closed.replace('PHASES_DONE: [1, 2]', 'PHASES_DONE: [1, 1, 2]')).reason, /unique in-range/);
  assert.match(validateArchiveLifecycle(closed.replace('### Fase 2 - second', '### Fase 1 - duplicate')).reason, /phase headings/);
  assert.equal(validateArchiveLifecycle(closed.replace('status: done', 'status: completed')).ok, true);
  assert.match(validateArchiveLifecycle(closed.replace('status: done', 'status: completed').replace('**Status:** [x] DONE', '**Status:** [ ] in-progress')).reason, /phase marker/);
  assert.match(validateArchiveLifecycle(closed.replace('status: done', 'status: completed').replace('**Status:** [x] DONE', '**Status:** [x] DONE\n**Status:** [ ] in-progress')).reason, /phase marker/);
  assert.match(validateArchiveLifecycle(closed.replace('status: done', 'status: completed').replace('### Fase 2 - second', '### Fase 1 - duplicate')).reason, /phase headings/);
  const discarded = closed.replace('status: done', 'status: discarded').replace('PHASES_DONE: [1, 2]', 'PHASES_DONE: []');
  assert.equal(validateArchiveLifecycle(discarded).ok, true);
  assert.match(validateArchiveLifecycle(discarded.replace('### Fase 2 - second', '### Fase 1 - duplicate')).reason, /phase headings/);
  assert.match(validateArchiveLifecycle(discarded.replace('PHASES_DONE: []', 'PHASES_DONE: [99, 99]')).reason, /unique in-range/);
  assert.match(validateArchiveLifecycle(closed.replace('## Estado Actual', '## Example State')).reason, /canonical Estado Actual/);
  assert.match(validateArchiveLifecycle(closed.replace('PLAN_ID: PLAN-2026-999\n', '')).reason, /state keys/);
  assert.match(validateArchiveLifecycle(closed.replace('PLAN_ID: PLAN-2026-999', 'PLAN_ID: PLAN-2026-999\nPLAN_ID: PLAN-2026-999')).reason, /state keys/);
  assert.match(validateArchiveLifecycle(closed.replace('**Status:** [x] DONE', '**Status:** [ ] in-progress\n- [x] DONE')).reason, /phase marker/);
  assert.match(validateArchiveLifecycle(closed.replace('**Status:** [x] DONE', '**Status:**\n- [x] DONE unrelated task')).reason, /phase marker/);
  assert.match(validateArchiveLifecycle(closed.replace('**Status:** [x] DONE', '**Status:**\n- [x] DONE')).reason, /phase marker/);
  assert.match(validateArchiveLifecycle(closed.replace('**Status:** [x] DONE', '**Status:** [x] in-progress | [x] DONE')).reason, /phase marker/);
  assert.deepEqual([...TERMINAL_PLAN_STATUSES].sort(), ['completed', 'discarded', 'done']);

  const incident = plan
    .replace('primary_scope: global', 'primary_scope: incident')
    .replace('primary_owner: GLOBAL', 'primary_owner: INC-2026-123')
    .replace('archive_path: docs/07-plans/archive/2026/completed/global/', 'archive_path: docs/07-plans/features/FEATURE-ORDERS/archive/debug/')
    .replace('related_features: []', 'related_features: [FEATURE-ORDERS]')
    .replace('related_incidents: []', 'related_incidents: [NOT-INC-2026-123-FAKE]');
  assert.match(validateArchiveDecision(incident).reason, /exact incident relation/);
  assert.equal(validateArchiveDecision(incident.replace('[NOT-INC-2026-123-FAKE]', '[INC-2026-123]')).ok, true);
});

test('canonical plan template projects executable closeout headings and Auditor binding', () => {
  const template = fs.readFileSync(path.join(__dirname, '../../docs/07-plans/_templates/PLAN-template.md'), 'utf8');
  assert.match(template, /^## Estado Actual$/m);
  assert.match(template, /^## Fases De Ejecucion$/m);
  for (const field of [
    'contract_id', 'contract_sha256', 'base_ref', 'plan_ref', 'evidence_digest', 'auditor_identity', 'audit_timestamp', 'result',
    'gatekeeper_scope_contract', 'files_touched_outside_plan', 'symbols_changed_outside_plan',
    'contract_changes_unexpected', 'debt_delta', 'line_scope_check', 'anchor_scope_check',
    'documentation_duplication_check', 'duplicate_symbols_introduced', 'escalated_to', 'registration_status',
  ]) {
    assert.match(template, new RegExp(`^\\s*${field}:`, 'm'));
  }
  assert.match(template, /^\s*head_ref:\s*WORKTREE$/m);
});

test('canonical GSC projections include every executable field', () => {
  const projections = [
    ['docs/00-system/saas-factory/protocols/prompts/PROTOCOLO_SAAS_FACTORY_v2.7.0_CORE.md', '## 7. Gatekeeper Scope Contract'],
    ['docs/07-plans/README.md', 'Bloque obligatorio para fases con mutacion no trivial:'],
    ['docs/00-system/saas-factory/roles/saas-factory/gatekeeper.md', '## Scope Contract'],
    ['docs/07-plans/_templates/PLAN-template.md', '## GATEKEEPER_SCOPE_CONTRACT'],
  ];
  const fields = [
    'contract_id', 'protocol_version', 'base_ref', 'intent', 'execution_mode', 'plan_ref', 'phase_ref',
    'approved_by', 'risk_tier', 'files_allowed', 'path', 'change_type', 'scope_mode',
    'line_ranges_allowed', 'symbols_allowed', 'anchors_allowed', 'line_ranges_expected',
    'forbidden_anchors', 'allowed_contract_changes', 'forbidden_zones', 'required_tests',
    'expected_outputs', 'post_mutation_auditor_required',
  ];
  for (const [relative, marker] of projections) {
    const content = fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
    const markerIndex = content.indexOf(marker);
    const fenceStart = content.indexOf('```yaml', markerIndex);
    const fenceEnd = content.indexOf('```', fenceStart + 7);
    assert.ok(markerIndex >= 0 && fenceStart > markerIndex && fenceEnd > fenceStart, relative);
    const projection = content.slice(fenceStart + 7, fenceEnd);
    for (const field of fields) assert.match(projection, new RegExp(`^\\s*(?:-\\s*)?${field}:`, 'm'), `${relative}: ${field}`);
  }
});

test('plan inventory covers every qualifying protocol helper', () => {
  const plan = fs.readFileSync(path.join(__dirname, '../../docs/07-plans/archive/2026/completed/global/PLAN-2026-195-p1-saas-factory-v2-7-protocol-convergence.md'), 'utf8');
  for (const symbol of [
    'splitTopLevel', 'parseRangeObject', 'parseFileRanges', 'parseFileList', 'scopeStructureErrors',
    'validateDiffScope', 'archiveDirectoryIdentity', 'diffHunkWithinRanges', 'symbolsForDiffHunks', 'parseStateFields', 'cliPlan',
  ]) assert.match(plan, new RegExp(`^\\s*- new_symbol: ${symbol}$`, 'm'), symbol);
  assert.doesNotMatch(plan, /^\s*- new_symbol: hasNonEmptyCollection$/m);
});

test('evidence digest normalizes text EOL through Git attributes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-digest-eol-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Protocol Test'], { cwd: root });
  fs.writeFileSync(path.join(root, '.gitattributes'), '*.txt text\n');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n');
  spawnSync('git', ['add', '.'], { cwd: root });
  spawnSync('git', ['commit', '-m', 'base'], { cwd: root });
  const baseRef = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'changed\r\n');
  const crlf = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'changed\n');
  const lf = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  assert.equal(crlf, lf);
});

// PLAN-2026-218 (CF-PLAN-2026-217-001): un fichero ya commiteado con CRLF preservado
// (el indice real de un repo puede conservar el estilo previo sin --renormalize,
// independientemente de core.autocrlf o .gitattributes) no debe hacer que el digest
// sea inestable ni dependa del estado del indice real del repositorio.
test('evidence digest is stable via a scratch index regardless of prior CRLF committed to the real index', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-digest-scratch-index-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Protocol Test'], { cwd: root });
  // Simula el escenario real: un JSON ya commiteado con CRLF preservado.
  fs.writeFileSync(path.join(root, 'tracked.json'), '{\r\n  "version": "1.0.0"\r\n}\r\n');
  spawnSync('git', ['add', 'tracked.json'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'], { cwd: root });
  const baseRef = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  // Se edita de nuevo, todavia con CRLF (como haria version-bump.cjs en Windows).
  fs.writeFileSync(path.join(root, 'tracked.json'), '{\r\n  "version": "1.0.1"\r\n}\r\n');
  const first = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  const second = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  assert.equal(first, second, 'debe ser deterministico entre llamadas repetidas sobre el mismo estado');
  const leftover = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('flowly-evidence-index-'));
  assert.equal(leftover.length, 0, 'no debe dejar indices scratch huerfanos en el tmpdir');
});

test('evidence digest binds executable mode for untracked files', (t) => {
  if (process.platform === 'win32') { t.skip('POSIX executable modes are unavailable on Windows'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-digest-mode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init'], { cwd: root });
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  spawnSync('git', ['add', 'base.txt'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'], { cwd: root });
  const baseRef = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const script = path.join(root, 'untracked.sh');
  fs.writeFileSync(script, '#!/bin/sh\n');
  fs.chmodSync(script, 0o644);
  const regular = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  fs.chmodSync(script, 0o755);
  const executable = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  assert.notEqual(regular, executable);
});

test('evidence digest binds tracked and untracked dangling symlink targets', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-digest-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init'], { cwd: root });
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  const tracked = path.join(root, 'tracked-link');
  try {
    fs.symlinkSync('missing-one', tracked, 'file');
  } catch (error) {
    t.skip(`file symlink unavailable: ${error.code}`);
    return;
  }
  spawnSync('git', ['add', 'base.txt', 'tracked-link'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'], { cwd: root });
  const baseRef = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  fs.unlinkSync(tracked);
  fs.symlinkSync('missing-two', tracked, 'file');
  const trackedTwo = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  fs.unlinkSync(tracked);
  fs.symlinkSync('missing-three', tracked, 'file');
  const trackedThree = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  assert.notEqual(trackedTwo, trackedThree);

  const untracked = path.join(root, 'untracked-link');
  fs.symlinkSync('missing-four', untracked, 'file');
  const untrackedFour = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  fs.unlinkSync(untracked);
  fs.symlinkSync('missing-five', untracked, 'file');
  const untrackedFive = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  assert.notEqual(untrackedFour, untrackedFive);
});

test('generated evidence binds paths and rejects undeclared outputs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-generated-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init'], { cwd: root });
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  spawnSync('git', ['add', 'base.txt'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'], { cwd: root });
  const baseRef = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const generated = path.join(root, 'docs/06-evidence/generated-knowledge/knowledge-generated');
  fs.mkdirSync(generated, { recursive: true });
  fs.writeFileSync(path.join(generated, 'docs-inventory.json'), '[]\n');
  const expected = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  fs.writeFileSync(path.join(generated, 'unexpected.json'), '{}\n');
  const extra = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'plan.md');
  assert.notEqual(extra, expected);
  assert.deepEqual(unexpectedGeneratedOutputs(root), ['docs/06-evidence/generated-knowledge/knowledge-generated/unexpected.json']);
});

test('state initializer emits a parser-compatible timestamp', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-memory-init-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  const initializer = path.join(scripts, 'saas-memory-init.ps1');
  fs.copyFileSync(path.join(__dirname, '../saas-memory-init.ps1'), initializer);
  const result = spawnSync('pwsh', ['-NoProfile', '-File', initializer, '-ProjectName', 'test'], { cwd: root, encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') { t.skip('pwsh is unavailable'); return; }
  assert.equal(result.status, 0, result.stderr);
  const state = fs.readFileSync(path.join(root, 'docs/00-system/legacy-agent-memory/ai-memory/session_state.md'), 'utf8');
  const timestamp = state.match(/^- LAST_VALIDATED = (.+)$/m)?.[1];
  assert.equal(isIsoTimestamp(timestamp), true, timestamp);
});

test('requires the complete v2.7 incident schema', () => {
  const complete = parseIncidentDocument('INCIDENT_ID: INC-2026-901\nSEVERITY: P1\nSTATUS: CLOSED\nOWNER: AG-QA\nIMPACT:\n  - none\nNEXT_STEP_EXACT: none');
  assert.equal(complete.errors.length, 0);
  const incomplete = parseIncidentDocument('INCIDENT_ID: INC-2026-902\nSEVERITY: P1\nSTATUS: CLOSED\nIMPACT: none');
  assert.match(incomplete.errors.join(' '), /OWNER, NEXT_STEP_EXACT/);
});

test('rejects invalid and duplicate incident identity data', () => {
  const result = parseIncidentDocument(`INCIDENT_ID: invalid\nSEVERITY: BANANA\nSTATUS: CLOSED\nOWNER: AG-QA\nIMPACT: none\nNEXT_STEP_EXACT: none\n---\nINCIDENT_ID: INC-2026-901\nSEVERITY: P1\nSTATUS: CLOSED\nOWNER: AG-QA\nIMPACT: none\nNEXT_STEP_EXACT: none\n---\nINCIDENT_ID: INC-2026-901\nSEVERITY: P1\nSTATUS: CLOSED\nOWNER: AG-QA\nIMPACT: none\nNEXT_STEP_EXACT: none`);
  assert.equal(result.records.length, 1);
  assert.match(result.errors.join(' '), /invalid INCIDENT_ID/);
  assert.match(result.errors.join(' '), /unsupported SEVERITY/);
  assert.match(result.errors.join(' '), /duplicate INCIDENT_ID/);
});

test('plan bootstrap fails closed and only permits its new plan path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-plan-bootstrap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relative = 'docs/07-plans/P1-next/PLAN-2026-998-cli-test.md';
  fs.mkdirSync(path.join(root, 'docs/07-plans/P1-next'), { recursive: true });

  const activated = run(activateCli, ['--new', 'PLAN-2026-998', relative], root);
  assert.equal(activated.status, 0, activated.stderr);
  const missing = run(planGateCli, [], root, JSON.stringify({ tool_input: {} }));
  assert.equal(gateDecision(missing), 'deny');
  const allowed = run(planGateCli, [], root, JSON.stringify({ tool_input: { file_path: path.join(root, relative) } }));
  assert.equal(gateDecision(allowed), 'allow');
  const denied = run(planGateCli, [], root, JSON.stringify({ tool_input: { file_path: path.join(root, 'docs/other.md') } }));
  assert.equal(gateDecision(denied), 'deny');
  const marker = JSON.parse(fs.readFileSync(path.join(root, '.claude/active-plan.json'), 'utf8'));
  const planPath = path.join(root, relative);
  fs.writeFileSync(planPath, `${cliPlan('PLAN-2026-998', 'docs/allowed.md', 'F1').replace('status: approved', 'status: draft')}\nBOOTSTRAP_TOKEN: ${marker.bootstrap_token}\n`);
  const secondWrite = run(planGateCli, [], root, JSON.stringify({ tool_input: { file_path: planPath } }));
  assert.equal(gateDecision(secondWrite), 'deny');
  assert.equal(run(activateCli, ['--approve-new', 'PLAN-2026-998'], root).status, 0);
  assert.equal(frontmatter(fs.readFileSync(planPath, 'utf8'), 'status'), 'approved');
  assert.doesNotMatch(fs.readFileSync(planPath, 'utf8'), /BOOTSTRAP_TOKEN:/);
  const scopedWrite = run(planGateCli, [], root, JSON.stringify({ tool_input: { file_path: 'docs/allowed.md' } }));
  assert.equal(gateDecision(scopedWrite), 'allow');
});

test('plan gate protects git internals and rejects forged bootstrap markers', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-plan-forged-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  let result = run(planGateCli, [], root, JSON.stringify({ tool_input: { file_path: '.git/config' } }));
  assert.equal(gateDecision(result), 'deny');
  fs.writeFileSync(path.join(root, '.claude/active-plan.json'), JSON.stringify({ bootstrap_only: true, plan_ref: 'PLAN-2026-995', allowed_files: [{ path: 'apps/target.ts' }], activated_at: new Date().toISOString() }));
  result = run(planGateCli, [], root, JSON.stringify({ tool_input: { file_path: 'apps/target.ts' } }));
  assert.equal(gateDecision(result), 'deny');
});

test('plan gate rejects allowed lexical paths that resolve outside the repository', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-plan-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-plan-outside-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const planDir = path.join(root, 'docs/07-plans/P1-next');
  fs.mkdirSync(planDir, { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`symlink/junction unavailable: ${error.code}`);
    return;
  }
  fs.writeFileSync(path.join(planDir, 'PLAN-2026-994-cli-test.md'), cliPlan('PLAN-2026-994', 'linked/target.md', 'F1'));
  assert.equal(run(activateCli, ['PLAN-2026-994', '1'], root).status, 0);
  const result = run(planGateCli, [], root, JSON.stringify({ tool_input: { file_path: 'linked/target.md' } }));
  assert.equal(gateDecision(result), 'deny');
});

test('plan gate rejects dangling file symlinks targeting outside', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-plan-dangling-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-plan-dangling-outside-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const planDir = path.join(root, 'docs/07-plans/P1-next');
  fs.mkdirSync(planDir, { recursive: true });
  try {
    fs.symlinkSync(path.join(outside, 'missing.txt'), path.join(root, 'dangling.txt'), 'file');
  } catch (error) {
    t.skip(`file symlink unavailable: ${error.code}`);
    return;
  }
  fs.writeFileSync(path.join(planDir, 'PLAN-2026-992-cli-test.md'), cliPlan('PLAN-2026-992', 'dangling.txt', 'F1'));
  assert.equal(run(activateCli, ['PLAN-2026-992', '1'], root).status, 0);
  const result = run(planGateCli, [], root, JSON.stringify({ tool_input: { file_path: 'dangling.txt' } }));
  assert.equal(gateDecision(result), 'deny');
});

test('plan activation enforces phase ranges and the persisted GSC', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-plan-active-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const planDir = path.join(root, 'docs/07-plans/P1-next');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'PLAN-2026-997-cli-test.md'), cliPlan('PLAN-2026-997', 'docs/allowed.md'));

  assert.equal(run(activateCli, ['PLAN-2026-997', '4'], root).status, 0);
  assert.equal(run(activateCli, ['PLAN-2026-997', '5'], root).status, 1);
  assert.equal(run(activateCli, ['PLAN-2026-997', '2'], root).status, 0);
  const activeMarker = JSON.parse(fs.readFileSync(path.join(root, '.claude/active-plan.json'), 'utf8'));
  assert.deepEqual(activeMarker.allowed_files[0].symbols_allowed, ['fixtureFile']);
  const allowed = run(planGateCli, [], root, JSON.stringify({ tool_input: { file_path: 'docs/allowed.md' } }));
  assert.equal(gateDecision(allowed), 'allow');
  const notebookAllowed = run(planGateCli, [], root, JSON.stringify({ tool_input: { notebook_path: 'docs/allowed.md' } }));
  assert.equal(gateDecision(notebookAllowed), 'allow');
  const denied = run(planGateCli, [], root, JSON.stringify({ tool_input: { file_path: 'docs/other.md' } }));
  assert.equal(gateDecision(denied), 'deny');
  const planRelative = 'docs/07-plans/P1-next/PLAN-2026-997-cli-test.md';
  const activePlanFile = path.join(planDir, 'PLAN-2026-997-cli-test.md');
  const activePlanContent = fs.readFileSync(activePlanFile, 'utf8');
  fs.writeFileSync(activePlanFile, activePlanContent.replace('execution_mode: WRITE', 'execution_mode: READ_ONLY'));
  assert.equal(run(activateCli, ['PLAN-2026-997', '2'], root).status, 1);
  fs.writeFileSync(activePlanFile, activePlanContent);
  fs.writeFileSync(path.join(planDir, 'PLAN-2026-997-cli-test.md'), fs.readFileSync(path.join(planDir, 'PLAN-2026-997-cli-test.md'), 'utf8').replace('status: approved', 'status: draft'));
  fs.writeFileSync(path.join(root, '.claude/active-plan.json'), JSON.stringify({ plan_ref: 'PLAN-2026-997', bootstrap_only: true, bootstrap_kind: 'new_plan', bootstrap_token: '11111111-1111-4111-8111-111111111111', allowed_files: [{ path: planRelative, change_type: 'create', scope_mode: 'new_file' }], activated_at: new Date().toISOString() }));
  const forged = run(planGateCli, [], root, JSON.stringify({ tool_input: { file_path: planRelative } }));
  assert.equal(gateDecision(forged), 'deny');
  assert.equal(run(activateCli, ['--done'], root).status, 1);
});

test('commit gate compares every staged path with the active GSC', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-commit-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const planDir = path.join(root, 'docs/07-plans/P1-next');
  fs.mkdirSync(planDir, { recursive: true });
  spawnSync('git', ['init'], { cwd: root });
  fs.writeFileSync(path.join(root, '.gitignore'), '.claude/active-plan.json\n');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n');
  spawnSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'], { cwd: root });
  const baseRef = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const planPath = path.join(planDir, 'PLAN-2026-996-cli-test.md');
  fs.writeFileSync(planPath, cliPlan('PLAN-2026-996', 'allowed.txt', 'F1', baseRef));
  assert.equal(run(activateCli, ['PLAN-2026-996', '1'], root).status, 0);

  fs.writeFileSync(path.join(root, 'allowed.txt'), 'allowed\n');
  const digest = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, 'docs/07-plans/P1-next/PLAN-2026-996-cli-test.md');
  fs.writeFileSync(planPath, fs.readFileSync(planPath, 'utf8').replace(/evidence_digest: [a-f0-9]{64}/, `evidence_digest: ${digest}`));
  spawnSync('git', ['add', 'allowed.txt', 'docs/07-plans/P1-next/PLAN-2026-996-cli-test.md'], { cwd: root });
  const allowed = run(commitGateCli, [], root, JSON.stringify({ tool_input: { command: 'git --no-pager commit -m test' } }));
  assert.equal(gateDecision(allowed), 'allow');
  fs.writeFileSync(path.join(root, 'allowed.txt'), 'newer worktree content\n');
  assert.equal(gateDecision(run(commitGateCli, [], root, JSON.stringify({ tool_input: { command: 'git commit -m test' } }))), 'deny');
  fs.writeFileSync(path.join(root, 'allowed.txt'), 'allowed\n');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'independent unstaged content\n');
  assert.equal(gateDecision(run(commitGateCli, [], root, JSON.stringify({ tool_input: { command: 'git commit -m test' } }))), 'deny');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n');
  fs.writeFileSync(path.join(root, 'pending.txt'), 'untracked content\n');
  assert.equal(gateDecision(run(commitGateCli, [], root, JSON.stringify({ tool_input: { command: 'git commit -m test' } }))), 'deny');
  const encodedCommit = Buffer.from('git commit -m test', 'utf16le').toString('base64');
  for (const command of [
    'bash -lc "git commit -m test"',
    'bash -lc "exec git commit -m test"',
    'bash -lc "env X=1 git commit -m test"',
    'sh -c "command git commit -m test"',
    'pwsh -NoProfile -Command "git commit -m test"',
    'pwsh -NoProfile -Command "& git commit -m test"',
    'sh -c "g\\it commit -m test"',
    'cmd /c "g^it commit -m test"',
    'sh -c "g\"\"it commit -m test"',
    'sh -c "git co\\mmit -m test"',
    'sh -c "$GIT commit -m test"',
    'sh -c "$(printf git) commit -m test"',
    'pwsh -Command "git add outside \\; git commit -m test"',
    'cmd /c "git add outside \\& git commit -m test"',
    'sh -c "g=git;c=com;$g ${c}mit -m test"',
    'sh -c "echo $HOME"',
    `pwsh -EncodedCommand ${encodedCommit}`,
    'sh -c "eval \'g\'\'it co\'\'mmit -m test\'"',
    'cmd /c "for %G in (git) do %G commit -m test"',
    'pwsh -Command "& ([string]::Concat(\'g\',\'it\')) commit -m test"',
  ]) {
    assert.equal(gateDecision(run(commitGateCli, [], root, JSON.stringify({ tool_input: { command } }))), 'deny', command);
  }
  for (const command of [
    '& ([string]::Concat("g","it")) ([string]::Concat("com","mit")) -m test',
    '$g=[string]::Concat("g","it");$c=[string]::Concat("com","mit");& $g $c -m test',
    '&([string]::Concat("g","it")) commit -m test',
    '&("git") commit -m test',
    "&'git' commit -m test",
    '&{git commit -m test}',
    '& { git commit -m test }',
    "&{&'git' commit -m test}",
    'Invoke-Command {git commit -m test}',
    'icm {git commit -m test}',
    '1 | % {git commit -m test}',
  ]) {
    assert.equal(gateDecision(run(commitGateCli, [], root, JSON.stringify({ tool_name: 'PowerShell', tool_input: { command } }))), 'deny', command);
  }
  fs.rmSync(path.join(root, 'pending.txt'));
  for (const command of ['& git commit -m test', 'cmd /c git commit -m test', 'env X=1 git commit -m test', 'cmd /c "git commit -m test"', 'powershell -Command "git commit -m test"', 'sh -c "git commit -m test"', '& "C:\\Program Files\\Git\\cmd\\git.exe" commit -m test', 'git commit -m "message | literal"', 'bash -lc "git commit -m \'message | literal\'"']) {
    assert.equal(gateDecision(run(commitGateCli, [], root, JSON.stringify({ tool_input: { command } }))), 'allow', command);
  }
  for (const command of ['echo "git commit -m test"', 'sh -c "echo plain"', 'sh -c "echo one \\; echo two"', 'git merge --abort', 'git cherry-pick --abort', 'git revert --abort', 'git am --abort']) {
    assert.equal(gateDecision(run(commitGateCli, [], root, JSON.stringify({ tool_input: { command } }))), 'allow', command);
  }
  spawnSync('git', ['update-index', '--chmod=+x', 'allowed.txt'], { cwd: root });
  assert.equal(gateDecision(run(commitGateCli, [], root, JSON.stringify({ tool_input: { command: 'git commit -m test' } }))), 'deny');
  spawnSync('git', ['update-index', '--chmod=-x', 'allowed.txt'], { cwd: root });
  for (const command of ['git -C. commit -m test', 'git --git-dir=.git --work-tree=. commit -m test', 'GIT_INDEX_FILE=other git commit -m test', 'git -c alias.ci=commit ci -m test', 'git --paginate commit -m test', 'git commit --only allowed.txt -m test', 'git commit --include allowed.txt -m test', 'git commit --interactive', 'git commit --patch', 'git commit --pathspec-from-file=paths.txt -m test', 'git commit allowed.txt -m test', 'git commit --amend -m test', 'git commit --ame -m test', 'git commit --no-verify -m test', 'git commit --no-verif -m test', 'git commit -nmtest', 'git commit --allow-empty -m test', 'git commit --pathspec-from-fi=paths.txt -m test', 'git add allowed.txt && git commit -m test', 'git add allowed.txt & git commit -m test', 'git add allowed.txt\ngit commit -m test', 'git merge --no-ff feature', 'git cherry-pick deadbeef', 'git revert deadbeef', 'git am patch.mbox']) {
    assert.equal(gateDecision(run(commitGateCli, [], root, JSON.stringify({ tool_input: { command } }))), 'deny', command);
  }
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'changed\n');
  assert.equal(gateDecision(run(commitGateCli, [], root, JSON.stringify({ tool_input: { command: 'git commit -am test' } }))), 'deny');

  fs.writeFileSync(path.join(root, 'outside.txt'), 'outside\n');
  spawnSync('git', ['add', 'outside.txt'], { cwd: root });
  const denied = run(commitGateCli, [], root, JSON.stringify({ tool_input: { command: `git -C "${root}" commit -m test` } }));
  assert.equal(gateDecision(denied), 'deny');
});

test('terminal archived plans pass commit and deactivation gates', async (t) => {
  const cases = [
    ['done', 'completed/global', '990'],
    ['completed', 'completed/global', '991'],
    ['discarded', 'discarded/global', '992'],
  ];
  for (const [status, archiveClass, suffix] of cases) {
    await t.test(status, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `flowly-terminal-${status}-`));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const ref = `PLAN-2026-${suffix}`;
      const activeRelative = `docs/07-plans/P1-next/${ref}-cli-test.md`;
      const archiveRelative = `docs/07-plans/archive/2026/${archiveClass}/${ref}-cli-test.md`;
      fs.mkdirSync(path.join(root, path.dirname(activeRelative)), { recursive: true });
      spawnSync('git', ['init'], { cwd: root });
      fs.writeFileSync(path.join(root, '.gitignore'), '.claude/active-plan.json\n');
      fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n');
      spawnSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: root });
      spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'], { cwd: root });
      const baseRef = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
      const activePlan = cliPlan(ref, archiveRelative, 'F1', baseRef);
      fs.writeFileSync(path.join(root, activeRelative), activePlan);
      assert.equal(run(activateCli, [ref, '1'], root).status, 0);

      fs.rmSync(path.join(root, activeRelative));
      fs.mkdirSync(path.join(root, path.dirname(archiveRelative)), { recursive: true });
      const archivePath = path.join(root, archiveRelative);
      fs.writeFileSync(archivePath, activePlan.replace('status: approved', `status: ${status}`));
      const digest = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, archiveRelative);
      fs.writeFileSync(archivePath, fs.readFileSync(archivePath, 'utf8').replace(/evidence_digest: [a-f0-9]{64}/, `evidence_digest: ${digest}`));
      spawnSync('git', ['add', archiveRelative], { cwd: root });

      const commit = run(commitGateCli, [], root, JSON.stringify({ tool_input: { command: 'git commit -m test' } }));
      assert.equal(gateDecision(commit), 'allow');
      assert.equal(run(activateCli, ['--done'], root).status, 1);
      assert.equal(fs.existsSync(path.join(root, '.claude/active-plan.json')), true);
      const committed = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'terminal closeout'], { cwd: root, encoding: 'utf8' });
      assert.equal(committed.status, 0, committed.stderr);
      assert.equal(run(activateCli, ['--done'], root).status, 0);
      assert.equal(fs.existsSync(path.join(root, '.claude/active-plan.json')), false);
    });
  }
});

test('feature archive preserves its audited index and digest through terminal commit', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-feature-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ref = 'PLAN-2026-989';
  const basename = `${ref}-cli-test.md`;
  const activeRelative = `docs/07-plans/P1-next/${basename}`;
  const archiveRelative = `docs/07-plans/features/FEATURE-ORDERS/archive/${basename}`;
  const readmeRelative = 'docs/07-plans/features/FEATURE-ORDERS/README.md';
  fs.mkdirSync(path.join(root, path.dirname(activeRelative)), { recursive: true });
  fs.mkdirSync(path.join(root, path.dirname(readmeRelative)), { recursive: true });
  spawnSync('git', ['init'], { cwd: root });
  fs.writeFileSync(path.join(root, '.gitignore'), '.claude/active-plan.json\n');
  const baseIndex = '# Orders\n\n## Archivados\n';
  const auditedIndex = `# Orders\n\n## Archivados\n\n- [${ref}-cli-test](archive/${basename})\n`;
  fs.writeFileSync(path.join(root, readmeRelative), baseIndex);
  spawnSync('git', ['add', '.gitignore', readmeRelative], { cwd: root });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'], { cwd: root });
  const baseRef = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const lifecycle = `\n## Estado Actual\n\n\`\`\`yaml\nPLAN_ID: ${ref}\nCURRENT_PHASE: 0\nTOTAL_PHASES: 1\nPHASES_DONE: [1]\nPHASES_PENDING: []\nPHASES_BLOCKED: []\n\`\`\`\n## Fases De Ejecucion\n\n### Fase 1 - close\n**Status:** [x] DONE\n## ARCHIVE_DESTINATION_DECISION\n\n\`\`\`yaml\nprimary_scope: feature\nprimary_owner: FEATURE-ORDERS\narchive_path: ${archiveRelative}\nreason: "Feature owner."\nrelated_features: [FEATURE-ORDERS]\nrelated_audits: []\nrelated_master_debts: []\nrelated_findings: []\nrelated_incidents: []\nrelated_commits: []\nmitigation_node: ~\ndepends_on: []\nblocks: []\nresidual_risk: NONE\nrollback_notes: "Revert."\nsecondary_indexes_to_update: [${readmeRelative}]\n\`\`\`\n`;
  let activePlan = `${cliPlan(ref, archiveRelative, 'F1', baseRef)}${lifecycle}`
    .replace('allowed_contract_changes: []', `  - path: ${readmeRelative}\n    change_type: modify\n    scope_mode: anchored_block\n    anchors_allowed:\n      - start_anchor: "# Orders"\n        end_anchor: EOF\n        allowed_operations: [update_archive_index]\n    line_ranges_expected: []\n    forbidden_anchors: []\nallowed_contract_changes: []`);
  const featureContract = parseScopeContract(activePlan, ref).contract;
  activePlan = activePlan.replace(/contract_sha256: [a-f0-9]{64}/, `contract_sha256: ${featureContract.contract_sha256}`);
  fs.writeFileSync(path.join(root, activeRelative), activePlan);
  assert.equal(run(activateCli, [ref, '1'], root).status, 0);
  fs.writeFileSync(path.join(root, readmeRelative), auditedIndex);
  const closedPath = path.join(root, activeRelative);
  fs.writeFileSync(closedPath, activePlan.replace('status: approved', 'status: done'));
  let digest = null;
  const refreshEvidenceDigest = () => {
    digest = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, activeRelative);
    fs.writeFileSync(closedPath, fs.readFileSync(closedPath, 'utf8').replace(/evidence_digest: [a-f0-9]{64}/, `evidence_digest: ${digest}`));
    return digest;
  };
  refreshEvidenceDigest();

  fs.mkdirSync(path.dirname(path.join(root, archiveRelative)), { recursive: true });
  fs.writeFileSync(path.join(root, archiveRelative), 'existing archive evidence\n');
  const collisionRun = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(archiveModule)}).archivePlan(${JSON.stringify(closedPath)}, false)))`], {
    cwd: root,
    env: { ...process.env, SAAS_FACTORY_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(collisionRun.status, 0, collisionRun.stderr);
  const collision = JSON.parse(collisionRun.stdout);
  assert.equal(collision.status, 'error');
  assert.match(collision.reason, /destination already exists/);
  assert.equal(fs.readFileSync(path.join(root, archiveRelative), 'utf8'), 'existing archive evidence\n');
  fs.rmSync(path.join(root, archiveRelative));

  const raceRun = spawnSync(process.execPath, ['-e', `const fs=require('node:fs');const original=fs.linkSync;fs.linkSync=(source,destination)=>{fs.writeFileSync(destination,'racing archive evidence\\n');return original(source,destination)};console.log(JSON.stringify(require(${JSON.stringify(archiveModule)}).archivePlan(${JSON.stringify(closedPath)}, false)))`], {
    cwd: root,
    env: { ...process.env, SAAS_FACTORY_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(raceRun.status, 0, raceRun.stderr);
  const raced = JSON.parse(raceRun.stdout);
  assert.equal(raced.status, 'error');
  assert.equal(fs.readFileSync(path.join(root, archiveRelative), 'utf8'), 'racing archive evidence\n');
  assert.equal(fs.existsSync(closedPath), true);
  fs.rmSync(path.join(root, archiveRelative));

  const archiveDirectory = path.dirname(path.join(root, archiveRelative));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-archive-outside-'));
  fs.rmSync(archiveDirectory, { recursive: true, force: true });
  let linkedParent = false;
  try {
    fs.symlinkSync(outside, archiveDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    linkedParent = true;
    refreshEvidenceDigest();
    const escaped = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(archiveModule)}).archivePlan(${JSON.stringify(closedPath)}, false)))`], {
      cwd: root,
      env: { ...process.env, SAAS_FACTORY_ROOT: root },
      encoding: 'utf8',
    });
    assert.equal(escaped.status, 0, escaped.stderr);
    assert.match(JSON.parse(escaped.stdout).reason, /destination parent must/);
    assert.equal(fs.existsSync(closedPath), true);
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
  } finally {
    if (linkedParent) fs.rmSync(archiveDirectory, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
  fs.mkdirSync(archiveDirectory, { recursive: true });
  refreshEvidenceDigest();
  if (linkedParent) {
    const swapOutside = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-archive-swap-'));
    const backupDirectory = `${archiveDirectory}-backup`;
    const swapRun = spawnSync(process.execPath, ['-e', `const fs=require('node:fs');const path=require('node:path');const archiveDirectory=${JSON.stringify(archiveDirectory)};const backupDirectory=${JSON.stringify(backupDirectory)};const outside=${JSON.stringify(swapOutside)};const source=${JSON.stringify(closedPath)};const destination=${JSON.stringify(path.join(root, archiveRelative))};const original=fs.linkSync;fs.linkSync=(src,dest)=>{fs.renameSync(archiveDirectory,backupDirectory);fs.symlinkSync(outside,archiveDirectory,process.platform==='win32'?'junction':'dir');return original(src,dest)};const result=require(${JSON.stringify(archiveModule)}).archivePlan(source,false);const evidence={result,sourceExists:fs.existsSync(source),outsideCopyExists:fs.existsSync(path.join(outside,path.basename(destination)))};fs.rmSync(archiveDirectory,{recursive:true,force:true});fs.renameSync(backupDirectory,archiveDirectory);console.log(JSON.stringify(evidence));`], {
      cwd: root,
      env: { ...process.env, SAAS_FACTORY_ROOT: root },
      encoding: 'utf8',
    });
    assert.equal(swapRun.status, 0, swapRun.stderr);
    const swapEvidence = JSON.parse(swapRun.stdout);
    assert.equal(swapEvidence.result.status, 'error');
    assert.equal(swapEvidence.sourceExists, true);
    assert.equal(swapEvidence.outsideCopyExists, false);
    fs.rmSync(swapOutside, { recursive: true, force: true });
  }

  const replacementBackup = `${closedPath}.validated-backup`;
  const replacedSourceRun = spawnSync(process.execPath, ['-e', `const fs=require('node:fs');const source=${JSON.stringify(closedPath)};const destination=${JSON.stringify(path.join(root, archiveRelative))};const backup=${JSON.stringify(replacementBackup)};const original=fs.linkSync;fs.linkSync=(src,dest)=>{fs.renameSync(src,backup);fs.writeFileSync(src,'replacement evidence\\n');return original(src,dest)};const result=require(${JSON.stringify(archiveModule)}).archivePlan(source,false);const evidence={result,sourceContent:fs.readFileSync(source,'utf8'),destinationExists:fs.existsSync(destination),validatedBackupExists:fs.existsSync(backup)};fs.rmSync(source,{force:true});fs.renameSync(backup,source);console.log(JSON.stringify(evidence));`], {
    cwd: root,
    env: { ...process.env, SAAS_FACTORY_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(replacedSourceRun.status, 0, replacedSourceRun.stderr);
  const replacedSource = JSON.parse(replacedSourceRun.stdout);
  assert.equal(replacedSource.result.status, 'error');
  assert.match(replacedSource.result.reason, /linked source|validated evidence/);
  assert.equal(replacedSource.sourceContent, 'replacement evidence\n');
  assert.equal(replacedSource.destinationExists, false);
  assert.equal(replacedSource.validatedBackupExists, true);

  const lateFailureRun = spawnSync(process.execPath, ['-e', `const fs=require('node:fs');const source=${JSON.stringify(closedPath)};const destination=${JSON.stringify(path.join(root, archiveRelative))};const original=fs.lstatSync;let tripped=false;fs.lstatSync=(target)=>{if(target===destination&&!fs.existsSync(source)&&!tripped){tripped=true;const error=new Error('simulated late verification failure');error.code='EIO';throw error}return original(target)};const result=require(${JSON.stringify(archiveModule)}).archivePlan(source,false);console.log(JSON.stringify({result,sourceExists:fs.existsSync(source),destinationExists:fs.existsSync(destination)}));`], {
    cwd: root,
    env: { ...process.env, SAAS_FACTORY_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(lateFailureRun.status, 0, lateFailureRun.stderr);
  const lateFailure = JSON.parse(lateFailureRun.stdout);
  assert.equal(lateFailure.result.status, 'error');
  assert.match(lateFailure.result.reason, /simulated late verification failure/);
  assert.equal(lateFailure.sourceExists, true);
  assert.equal(lateFailure.destinationExists, false);

  const restorationFailureRun = spawnSync(process.execPath, ['-e', `const fs=require('node:fs');const source=${JSON.stringify(closedPath)};const destination=${JSON.stringify(path.join(root, archiveRelative))};const originalLstat=fs.lstatSync;const originalLink=fs.linkSync;let tripped=false;fs.lstatSync=(target)=>{if(target===destination&&!fs.existsSync(source)&&!tripped){tripped=true;const error=new Error('simulated late verification failure');error.code='EIO';throw error}return originalLstat(target)};fs.linkSync=(from,to)=>{if(from===destination&&to===source){const error=new Error('simulated restoration failure');error.code='EIO';throw error}return originalLink(from,to)};const result=require(${JSON.stringify(archiveModule)}).archivePlan(source,false);console.log(JSON.stringify({result,sourceExists:fs.existsSync(source),destinationExists:fs.existsSync(destination)}));`], {
    cwd: root,
    env: { ...process.env, SAAS_FACTORY_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(restorationFailureRun.status, 0, restorationFailureRun.stderr);
  const restorationFailure = JSON.parse(restorationFailureRun.stdout);
  assert.equal(restorationFailure.result.status, 'error');
  assert.match(restorationFailure.result.reason, /recovery incomplete: simulated restoration failure/);
  assert.equal(restorationFailure.sourceExists, false);
  assert.equal(restorationFailure.destinationExists, true);
  fs.linkSync(path.join(root, archiveRelative), closedPath);
  fs.unlinkSync(path.join(root, archiveRelative));

  const interrupted = spawnSync(process.execPath, ['-e', `const fs=require('node:fs');const original=fs.linkSync;fs.linkSync=(source,destination)=>{original(source,destination);process.exit(86)};require(${JSON.stringify(archiveModule)}).archivePlan(${JSON.stringify(closedPath)}, false);`], {
    cwd: root,
    env: { ...process.env, SAAS_FACTORY_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(interrupted.status, 86, interrupted.stderr);
  assert.equal(fs.existsSync(closedPath), true);
  assert.equal(fs.existsSync(path.join(root, archiveRelative)), true);

  const archived = spawnSync(process.execPath, ['-e', `const result=require(${JSON.stringify(archiveModule)}).archivePlan(${JSON.stringify(closedPath)}, false); console.log(JSON.stringify(result)); if(result.status!=='moved') process.exit(1);`], {
    cwd: root,
    env: { ...process.env, SAAS_FACTORY_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(archived.status, 0, `${archived.stdout}\n${archived.stderr}`);
  assert.equal(fs.readFileSync(path.join(root, readmeRelative), 'utf8'), auditedIndex);
  assert.equal(fs.existsSync(path.join(root, archiveRelative)), true);
  const postArchiveDigest = require('./protocol-contract.cjs').computeEvidenceDigest(root, baseRef, archiveRelative);
  assert.equal(postArchiveDigest, digest);
  spawnSync('git', ['add', archiveRelative, readmeRelative], { cwd: root });
  assert.equal(gateDecision(run(commitGateCli, [], root, JSON.stringify({ tool_input: { command: 'git commit -m test' } }))), 'allow');
  const committed = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'feature closeout'], { cwd: root, encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  assert.equal(run(activateCli, ['--done'], root).status, 0);
});

test('archive CLI requires one exact active plan ID', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-archive-resolver-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const folder of ['P1-next', 'P2-later']) {
    const dir = path.join(root, 'docs/07-plans', folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `PLAN-2026-988-${folder}.md`), '---\nid: PLAN-2026-988\nstatus: approved\n---\n');
  }
  let result = run(archiveModule, ['--plan', 'PLAN-2026-988', '--dry-run'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No unique active plan with exact ID/);
  fs.rmSync(path.join(root, 'docs/07-plans/P2-later'), { recursive: true });
  result = run(archiveModule, ['--plan', 'PLAN-2026-98', '--dry-run'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No unique active plan with exact ID/);
  const remaining = path.join(root, 'docs/07-plans/P1-next/PLAN-2026-988-P1-next.md');
  fs.writeFileSync(remaining, '---\nid: PLAN-2026-987\nstatus: approved\n---\n');
  result = run(archiveModule, ['--plan', 'PLAN-2026-988', '--dry-run'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No unique active plan with exact ID/);
  fs.writeFileSync(remaining, '---\nid: PLAN-2026-987\nid: PLAN-2026-988\nstatus: approved\n---\n');
  result = run(archiveModule, ['--plan', 'PLAN-2026-988', '--dry-run'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No unique active plan with exact ID/);
  fs.rmSync(remaining);
  fs.writeFileSync(path.join(root, 'docs/07-plans/P1-next/PLAN-2026-1234-P1-next.md'), '---\nid: PLAN-2026-1234\nstatus: approved\n---\n');
  result = run(archiveModule, ['--plan', 'PLAN-2026-1234', '--dry-run'], root);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /No unique active plan with exact ID/);
  assert.match(result.stderr, /plan status must be done/);
});

test('CI accepts only the latest independent approval for the current head', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/zone-validation.yml'), 'utf8');
  assert.match(workflow, /types:\s*\[submitted, dismissed\]/);
  assert.match(workflow, /HEAD_SHA:.*pull_request\.head\.sha/);
  assert.match(workflow, /currentHeadApprovalCount/);
  assert.match(workflow, /safe:[\s\S]*- 'scripts\/knowledge\/\*\*'/);
  assert.match(workflow, /build-docs-inventory\.cjs[\s\S]*git diff --exit-code -- docs\/06-evidence\/generated-knowledge\/ docs\/06-evidence\/timelines\/knowledge-timelines\//);

  const reviews = [
    { user: { id: 1, login: 'reviewer' }, state: 'APPROVED', commit_id: 'head', submitted_at: '2026-07-22T10:00:00Z' },
    { user: { id: 1, login: 'reviewer' }, state: 'DISMISSED', commit_id: 'head', submitted_at: '2026-07-22T11:00:00Z' },
    { user: { id: 2, login: 'stale' }, state: 'APPROVED', commit_id: 'old', submitted_at: '2026-07-22T12:00:00Z' },
    { user: { id: 3, login: 'author' }, state: 'APPROVED', commit_id: 'head', submitted_at: '2026-07-22T12:00:00Z' },
  ];
  assert.equal(currentHeadApprovalCount(reviews, 'head', 'author'), 0);
  reviews.push({ user: { id: 4, login: 'independent' }, state: 'APPROVED', commit_id: 'head', submitted_at: '2026-07-22T13:00:00Z' });
  assert.equal(currentHeadApprovalCount(reviews, 'head', 'author'), 1);
});

test('configured plan hook resolves from project root after the shell CWD changes', () => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const settings = JSON.parse(fs.readFileSync(path.join(projectRoot, '.claude/settings.json'), 'utf8'));
  const command = settings.hooks.PreToolUse.find((entry) => entry.matcher.includes('NotebookEdit') && entry.hooks[0].command.includes('plan-gate.cjs')).hooks[0].command;
  const result = spawnSync(command, {
    shell: true,
    cwd: os.tmpdir(),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
    input: JSON.stringify({ tool_input: {} }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(gateDecision(result), 'deny');
});

// PLAN-2026-216: version-bump.cjs / version-check.cjs (estandar de versionado
// semver, ver docs/00-system/FLOWLYAPP_VERSIONING_STANDARD.md).

function writeAppPackage(root, app, version) {
  const dir = path.join(root, 'apps', app);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: app, version }, null, 2) + '\n');
}

test('version-bump.cjs bumps patch/minor/major and resets lower segments', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-version-bump-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeAppPackage(root, 'api', '1.2.3');

  let result = run(versionBumpCli, ['--app', 'api', '--level', 'patch', '--summary', 'patch test'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'apps/api/package.json'), 'utf8')).version, '1.2.4');

  result = run(versionBumpCli, ['--app', 'api', '--level', 'minor', '--summary', 'minor test'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'apps/api/package.json'), 'utf8')).version, '1.3.0');

  result = run(versionBumpCli, ['--app', 'api', '--level', 'major', '--summary', 'major test'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'apps/api/package.json'), 'utf8')).version, '2.0.0');

  const changelog = fs.readFileSync(path.join(root, 'apps/api/CHANGELOG.md'), 'utf8');
  assert.match(changelog, /^# Changelog — api/);
  assert.match(changelog, /## 2\.0\.0 - \d{4}-\d{2}-\d{2}/);
  assert.match(changelog, /major test/);
  // La entrada mas reciente queda primero.
  assert.ok(changelog.indexOf('2.0.0') < changelog.indexOf('1.3.0'));
  assert.ok(changelog.indexOf('1.3.0') < changelog.indexOf('1.2.4'));
});

test('version-bump.cjs autodetects level from the risk_tier of the active plan', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-version-bump-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeAppPackage(root, 'web', '1.0.0');
  const planDir = path.join(root, 'docs/07-plans/P1-next');
  fs.mkdirSync(planDir, { recursive: true });
  const planContent = cliPlan('PLAN-2026-993', 'docs/allowed.md', 'F1').replace('risk_tier: LOW', 'risk_tier: MEDIUM');
  fs.writeFileSync(path.join(planDir, 'PLAN-2026-993-cli-test.md'), planContent);
  assert.equal(run(activateCli, ['PLAN-2026-993', '1'], root).status, 0);

  const result = run(versionBumpCli, ['--app', 'web'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'apps/web/package.json'), 'utf8')).version, '1.1.0');
  assert.match(fs.readFileSync(path.join(root, 'apps/web/CHANGELOG.md'), 'utf8'), /PLAN-2026-993/);
});

test('version-bump.cjs fails closed without --level and without an active plan', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-version-bump-noplan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeAppPackage(root, 'api', '1.0.0');
  const result = run(versionBumpCli, ['--app', 'api'], root);
  assert.notEqual(result.status, 0);
});

function initVersionCheckRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-version-check-'));
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Protocol Test'], { cwd: root });
  writeAppPackage(root, 'api', '1.0.0');
  writeAppPackage(root, 'web', '1.0.0');
  fs.mkdirSync(path.join(root, 'apps/api/src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/api/src/foo.ts'), 'export const foo = 1;\n');
  spawnSync('git', ['add', '.'], { cwd: root });
  spawnSync('git', ['commit', '-m', 'base'], { cwd: root });
  const baseRef = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  return { root, baseRef };
}

test('version-check.cjs fails when apps/api/src changes without a version bump', (t) => {
  const { root, baseRef } = initVersionCheckRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'apps/api/src/foo.ts'), 'export const foo = 2;\n');
  const result = run(versionCheckCli, ['--base', baseRef], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /apps\/api/);
});

test('version-check.cjs passes when the version bump is present', (t) => {
  const { root, baseRef } = initVersionCheckRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'apps/api/src/foo.ts'), 'export const foo = 2;\n');
  writeAppPackage(root, 'api', '1.0.1');
  const result = run(versionCheckCli, ['--base', baseRef], root);
  assert.equal(result.status, 0, result.stderr);
});

test('version-check.cjs ignores changes outside apps/api and apps/web', (t) => {
  const { root, baseRef } = initVersionCheckRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/note.md'), 'note\n');
  const result = run(versionCheckCli, ['--base', baseRef], root);
  assert.equal(result.status, 0, result.stderr);
});
