#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { PROTOCOL_VERSION, PROTOCOL_VERSION_PREVIOUS } = require('./profile.cjs');
const ACTIVE_PLAN_STATUSES = new Set(['approved', 'in-progress', 'in_progress']);
const TERMINAL_PLAN_STATUSES = new Set(['done', 'completed', 'discarded']);
const TERMINAL_INCIDENT_STATUSES = new Set(['CLOSED']);
const LIFECYCLE_PHASES = new Set(['DISCOVERY', 'PLANNING', 'IMPLEMENTATION', 'VALIDATION', 'DEPLOYMENT', 'OPERATIONS']);
const PHASE_STATUSES = new Set(['DRAFT', 'READY', 'IN_PROGRESS', 'BLOCKED', 'CODE_COMPLETE', 'DEPLOYED_PENDING_VALIDATION', 'DONE', 'STALE']);
const COMPLIANCE_STATUSES = new Set(['NOT_APPLICABLE', 'PENDING', 'APPROVED', 'BLOCKED']);
const SCOPE_MODES = new Set(['exact_lines', 'anchored_block', 'new_file', 'generated_file']);
const CHANGE_TYPES = new Set(['create', 'modify', 'delete', 'move', 'generated']);
const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const GENERATED_KNOWLEDGE_OUTPUTS = new Set([
  'docs/06-evidence/generated-knowledge/knowledge-generated/docs-inventory.json',
  'docs/06-evidence/generated-knowledge/knowledge-generated/duplicates-report.md',
  'docs/06-evidence/generated-knowledge/knowledge-generated/orphan-docs-report.md',
  'docs/06-evidence/generated-knowledge/knowledge-generated/rag-manifest.json',
  'docs/06-evidence/timelines/knowledge-timelines/feature-timeline.md',
  'docs/06-evidence/timelines/knowledge-timelines/recent-changes.md',
  'docs/06-evidence/timelines/knowledge-timelines/security-timeline.md',
]);

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function unexpectedGeneratedOutputs(repoRoot) {
  const directories = ['docs/06-evidence/generated-knowledge/knowledge-generated', 'docs/06-evidence/timelines/knowledge-timelines'];
  return directories.flatMap((relative) => {
    const full = path.join(repoRoot, relative);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true })
      .map((entry) => `${relative}/${entry.name}${entry.isDirectory() ? '/' : ''}`);
  }).filter((relative) => !GENERATED_KNOWLEDGE_OUTPUTS.has(relative)).sort();
}

function parseFrontmatterDocument(content) {
  const block = content.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)?.[1];
  if (block === undefined) return { data: {}, errors: ['leading frontmatter is missing'] };
  const data = {};
  const errors = [];
  let currentList = null;
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = line.match(/^\s{2}-\s+(.+)$/)?.[1];
    if (item && currentList) { data[currentList].push(item.trim().replace(/^["']|["']$/g, '')); continue; }
    const field = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!field) { errors.push(`malformed frontmatter line: ${line.trim()}`); currentList = null; continue; }
    const [, key, raw] = field;
    if (Object.hasOwn(data, key)) { errors.push(`duplicate frontmatter key: ${key}`); currentList = null; continue; }
    if (!raw.trim()) { data[key] = []; currentList = key; continue; }
    data[key] = raw.trim() === '[]' ? [] : raw.trim().replace(/^["']|["']$/g, '');
    currentList = null;
  }
  return { data, errors };
}

function frontmatter(content, key) {
  const parsed = parseFrontmatterDocument(content);
  return parsed.errors.length || typeof parsed.data[key] !== 'string' ? null : parsed.data[key];
}

function scalar(block, key) {
  const match = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

function findPlanFile(repoRoot, ref) {
  const stack = [path.join(repoRoot, 'docs', '07-plans')];
  const matches = [];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && (entry.name.startsWith(`${ref}-`) || entry.name === `${ref}.md`)) matches.push(full);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function extractScopeBlock(content) {
  const heading = content.match(/^## GATEKEEPER_SCOPE_CONTRACT\s*$/m);
  if (!heading) return null;
  const tail = content.slice(heading.index + heading[0].length);
  const nextHeading = tail.search(/^##\s+/m);
  const section = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
  const fence = section.match(/```ya?ml\s*\r?\n([\s\S]*?)\r?\n```/i);
  return fence ? fence[1] : null;
}

function parseInlineList(value) {
  const match = String(value || '').trim().match(/^\[([^\]]*)\]$/);
  if (!match) return null;
  return match[1].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function splitTopLevel(value) {
  const result = [];
  let current = '';
  let depth = 0;
  let quote = null;
  for (const character of String(value || '')) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; current += character; continue; }
    if (character === '{' || character === '[') depth += 1;
    if (character === '}' || character === ']') depth -= 1;
    if (character === ',' && depth === 0) { result.push(current.trim()); current = ''; continue; }
    current += character;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function parseRangeObject(value) {
  const match = String(value || '').trim().match(/^\{([\s\S]*)\}$/);
  if (!match) return null;
  const fields = {};
  for (const item of splitTopLevel(match[1])) {
    const separator = item.indexOf(':');
    if (separator === -1) return null;
    const key = item.slice(0, separator).trim();
    if (!['start', 'end', 'reason'].includes(key) || Object.hasOwn(fields, key)) return null;
    fields[key] = item.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
  }
  if (!fields.start || !fields.end || !fields.reason || !/^\d+$/.test(fields.start) || !/^\d+$/.test(fields.end)) return null;
  const start = Number(fields.start);
  const end = Number(fields.end);
  return start > 0 && end >= start ? { start, end, reason: fields.reason } : null;
}

function fileField(raw, key) {
  const lines = raw.split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^ {4}${key}:`).test(line));
  if (index === -1) return { declared: false, inline: null, lines: [] };
  const inline = lines[index].slice(lines[index].indexOf(':') + 1).trim();
  const children = [];
  for (let current = index + 1; current < lines.length && !/^ {4}[\w-]+:/.test(lines[current]); current += 1) children.push(lines[current]);
  return { declared: true, inline, lines: children };
}

function parseFileRanges(raw, key) {
  const field = fileField(raw, key);
  if (!field.declared) return { declared: false, valid: false, ranges: [] };
  if (field.inline) {
    const match = field.inline.match(/^\[([\s\S]*)\]$/);
    if (!match) return { declared: true, valid: false, ranges: [] };
    if (!match[1].trim()) return { declared: true, valid: true, ranges: [] };
    const ranges = splitTopLevel(match[1]).map(parseRangeObject);
    return { declared: true, valid: ranges.length > 0 && ranges.every(Boolean), ranges: ranges.filter(Boolean) };
  }
  const ranges = [];
  let current = null;
  for (const line of field.lines) {
    const start = line.match(/^ {6}- start:\s*(\d+)\s*$/)?.[1];
    if (start) {
      if (current) ranges.push(current);
      current = { start: Number(start), end: null, reason: null };
      continue;
    }
    if (!current) continue;
    const end = line.match(/^ {8}end:\s*(\d+)\s*$/)?.[1];
    if (end) { current.end = Number(end); continue; }
    const reason = line.match(/^ {8}reason:\s*(.+)$/)?.[1];
    if (reason) current.reason = reason.trim().replace(/^["']|["']$/g, '');
  }
  if (current) ranges.push(current);
  const valid = ranges.length > 0 && ranges.every((range) => (
    Number.isInteger(range.start) && Number.isInteger(range.end) && range.start > 0 && range.end >= range.start && Boolean(range.reason)
  ));
  return { declared: true, valid, ranges };
}

function parseFileList(raw, key) {
  const field = fileField(raw, key);
  if (!field.declared) return { declared: false, valid: false, values: [] };
  if (field.inline) {
    const values = parseInlineList(field.inline);
    return { declared: true, valid: values !== null, values: values || [] };
  }
  const values = field.lines.map((line) => line.match(/^ {6}-\s+(.+)$/)?.[1])
    .filter(Boolean).map((value) => value.trim().replace(/^["']|["']$/g, ''));
  return { declared: true, valid: values.length > 0, values };
}

function parseAnchors(raw) {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s{4}anchors_allowed:/.test(line));
  if (start === -1) return [];
  const anchors = [];
  let current = null;
  for (let index = start + 1; index < lines.length && !/^\s{4}[\w-]+:/.test(lines[index]); index += 1) {
    const startMatch = lines[index].match(/^\s{6}-\s+start_anchor:\s*(.+)$/);
    if (startMatch) {
      if (current) anchors.push(current);
      current = { start_anchor: startMatch[1].trim().replace(/^['"]|['"]$/g, ''), end_anchor: null, allowed_operations: [] };
      continue;
    }
    if (!current) continue;
    const endMatch = lines[index].match(/^\s{8}end_anchor:\s*(.+)$/);
    if (endMatch) {
      current.end_anchor = endMatch[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    const operationsMatch = lines[index].match(/^\s{8}allowed_operations:\s*(.*)$/);
    if (operationsMatch) {
      const inline = parseInlineList(operationsMatch[1]);
      if (inline) current.allowed_operations.push(...inline);
      continue;
    }
    const operation = lines[index].match(/^\s{10}-\s+(.+)$/)?.[1];
    if (operation) current.allowed_operations.push(operation.trim().replace(/^['"]|['"]$/g, ''));
  }
  if (current) anchors.push(current);
  return anchors;
}

function sectionLines(block, key) {
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start === -1) return [];
  const result = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z_][\w-]*:\s*/.test(line)) break;
    result.push(line);
  }
  return result;
}

function parseFiles(block) {
  const lines = sectionLines(block, 'files_allowed');
  const files = [];
  let current = null;
  for (const line of lines) {
    const pathMatch = line.match(/^\s{2}- path:\s*(.+)$/);
    if (pathMatch) {
      if (current) files.push(current);
      current = { path: normalizePath(pathMatch[1].replace(/^['"]|['"]$/g, '')), raw: '' };
      continue;
    }
    if (!current) continue;
    current.raw += `${line}\n`;
    const fieldMatch = line.match(/^\s{4}(change_type|scope_mode):\s*(.+)$/);
    if (fieldMatch) current[fieldMatch[1]] = fieldMatch[2].trim();
  }
  if (current) files.push(current);
  return files.map((file) => {
    const anchorBlocks = parseAnchors(file.raw);
    const allowedRanges = parseFileRanges(file.raw, 'line_ranges_allowed');
    const expectedRanges = parseFileRanges(file.raw, 'line_ranges_expected');
    const forbiddenAnchors = parseFileList(file.raw, 'forbidden_anchors');
    const allowedSymbols = parseFileList(file.raw, 'symbols_allowed');
    return {
      path: file.path,
      change_type: file.change_type || null,
      scope_mode: file.scope_mode || null,
      line_ranges_allowed: allowedRanges.ranges,
      line_ranges_allowed_declared: allowedRanges.declared,
      line_ranges_allowed_valid: allowedRanges.valid,
      has_anchors: anchorBlocks.length > 0,
      line_ranges_expected: expectedRanges.ranges,
      line_ranges_expected_declared: expectedRanges.declared,
      line_ranges_expected_valid: expectedRanges.valid,
      forbidden_anchors: forbiddenAnchors.values,
      forbidden_anchors_declared: forbiddenAnchors.declared,
      forbidden_anchors_valid: forbiddenAnchors.valid,
      symbols_allowed: allowedSymbols.values,
      symbols_allowed_declared: allowedSymbols.declared,
      symbols_allowed_valid: allowedSymbols.valid,
      anchor_blocks: anchorBlocks,
      anchors: anchorBlocks.flatMap((anchor) => [anchor.start_anchor, anchor.end_anchor].filter(Boolean)),
    };
  });
}

function parseStringList(block, key) {
  const inline = block.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm'));
  if (inline) return inline[1].split(',').map((item) => normalizePath(item)).filter(Boolean);
  return sectionLines(block, key)
    .map((line) => line.match(/^\s{2}-\s*(.+)$/)?.[1])
    .filter(Boolean)
    .map((item) => normalizePath(item.replace(/^['"]|['"]$/g, '')));
}

function hasTopLevelKey(block, key) {
  return new RegExp(`^${key}:`, 'm').test(block);
}

function scopeStructureErrors(block) {
  const errors = [];
  const topKeys = new Set([
    'contract_id', 'protocol_version', 'base_ref', 'intent', 'execution_mode', 'plan_ref', 'phase_ref',
    'approved_by', 'risk_tier', 'files_allowed', 'allowed_contract_changes', 'forbidden_zones',
    'required_tests', 'expected_outputs', 'post_mutation_auditor_required', 'required_skills',
  ]);
  const seenTop = new Set();
  for (const line of block.split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z_][\w-]*):/)?.[1];
    if (!key) continue;
    if (!topKeys.has(key)) errors.push(`unknown GSC key: ${key}`);
    if (seenTop.has(key)) errors.push(`duplicate GSC key: ${key}`);
    seenTop.add(key);
  }

  const fileKeys = new Set(['change_type', 'scope_mode', 'line_ranges_allowed', 'anchors_allowed', 'line_ranges_expected', 'forbidden_anchors', 'symbols_allowed']);
  let currentFile = null;
  let seenFileKeys = new Set();
  let seenNestedKeys = new Set();
  let parent = null;
  for (const line of sectionLines(block, 'files_allowed')) {
    const pathValue = line.match(/^ {2}- path:\s*(.+)$/)?.[1];
    if (pathValue) {
      currentFile = normalizePath(pathValue.replace(/^["']|["']$/g, ''));
      seenFileKeys = new Set();
      seenNestedKeys = new Set();
      parent = null;
      continue;
    }
    if (!currentFile) continue;
    const fileKey = line.match(/^ {4}([a-z_]+):/)?.[1];
    if (fileKey) {
      if (!fileKeys.has(fileKey)) errors.push(`${currentFile}: unknown file scope key ${fileKey}`);
      if (seenFileKeys.has(fileKey)) errors.push(`${currentFile}: duplicate file scope key ${fileKey}`);
      seenFileKeys.add(fileKey);
      seenNestedKeys = new Set();
      parent = fileKey;
      continue;
    }
    const anyNestedStart = line.match(/^ {6}- ([a-z_]+):/)?.[1];
    const expectedNestedStart = parent === 'anchors_allowed' ? 'start_anchor'
      : (['line_ranges_allowed', 'line_ranges_expected'].includes(parent) ? 'start' : null);
    if (anyNestedStart && expectedNestedStart && anyNestedStart !== expectedNestedStart) {
      errors.push(`${currentFile}: unknown ${parent} item key ${anyNestedStart}`);
    }
    const nestedStart = anyNestedStart === expectedNestedStart ? anyNestedStart : null;
    if (nestedStart) {
      seenNestedKeys = new Set([nestedStart]);
      continue;
    }
    const nestedKey = line.match(/^ {8}([a-z_]+):/)?.[1];
    if (nestedKey && seenNestedKeys.has(nestedKey)) errors.push(`${currentFile}: duplicate nested scope key ${nestedKey}`);
    if (nestedKey) seenNestedKeys.add(nestedKey);
    if (nestedKey && parent === 'anchors_allowed' && !['end_anchor', 'allowed_operations'].includes(nestedKey)) {
      errors.push(`${currentFile}: unknown anchor scope key ${nestedKey}`);
    }
    if (nestedKey && ['line_ranges_allowed', 'line_ranges_expected'].includes(parent) && !['end', 'reason'].includes(nestedKey)) {
      errors.push(`${currentFile}: unknown range scope key ${nestedKey}`);
    }
  }
  return errors;
}

function validateScopeContract(contract, expectedPlanRef) {
  const errors = [];
  if (!contract) return ['GATEKEEPER_SCOPE_CONTRACT missing or not fenced as YAML'];
  if (!contract.contract_id) errors.push('contract_id is required');
  if (contract.protocol_version !== PROTOCOL_VERSION && contract.protocol_version !== PROTOCOL_VERSION_PREVIOUS) {
    errors.push(`protocol_version must be ${PROTOCOL_VERSION} or ${PROTOCOL_VERSION_PREVIOUS}`);
  }
  if (!/^[a-f0-9]{40}$/i.test(contract.base_ref || '')) errors.push('base_ref must be an exact 40-character commit SHA');
  if (!contract.plan_ref) errors.push('plan_ref is required');
  if (expectedPlanRef && contract.plan_ref !== expectedPlanRef) errors.push(`plan_ref must match ${expectedPlanRef}`);
  if (!contract.phase_ref) errors.push('phase_ref is required');
  if (!['IMPLEMENTATION', 'CHANGE_SCOPE', 'ARCH_CHANGE', 'INCIDENT_OPERATION', 'ADMINISTRATION'].includes(contract.intent)) errors.push('intent is required and must be canonical');
  if (contract.execution_mode !== 'WRITE') errors.push('execution_mode must be WRITE for an executable GSC');
  if (!contract.approved_by) errors.push('approved_by is required');
  if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(contract.risk_tier)) errors.push('risk_tier is required and must be canonical');
  if (!contract.declarations.allowed_contract_changes) errors.push('allowed_contract_changes must be declared');
  if (!contract.declarations.forbidden_zones) errors.push('forbidden_zones must be declared');
  if (!contract.required_tests.length) errors.push('required_tests must contain at least one command');
  if (!contract.expected_outputs.length) errors.push('expected_outputs must contain at least one output');
  if (contract.post_mutation_auditor_required !== 'true') errors.push('post_mutation_auditor_required must be true');
  if (!contract.files_allowed.length) errors.push('files_allowed must contain at least one explicit path');
  const seenPaths = new Set();
  for (const file of contract.files_allowed) {
    if (seenPaths.has(file.path)) errors.push(`${file.path}: duplicate files_allowed entry`);
    seenPaths.add(file.path);
    if (!file.path || path.isAbsolute(file.path) || /^[A-Za-z]:\//.test(file.path) || file.path.split('/').includes('..')) errors.push(`invalid path: ${file.path || '<empty>'}`);
    if (!CHANGE_TYPES.has(file.change_type)) errors.push(`${file.path}: invalid change_type`);
    if (!SCOPE_MODES.has(file.scope_mode)) errors.push(`${file.path}: invalid scope_mode`);
    if (file.change_type === 'create' && file.scope_mode !== 'new_file') errors.push(`${file.path}: create requires new_file`);
    if (file.change_type === 'generated' && file.scope_mode !== 'generated_file') errors.push(`${file.path}: generated requires generated_file`);
    if (file.change_type === 'modify' && file.scope_mode === 'new_file') errors.push(`${file.path}: modify cannot use new_file`);
    if (file.change_type === 'modify' && file.path.endsWith('.md') && file.scope_mode !== 'anchored_block') {
      errors.push(`${file.path}: existing docs Markdown must use anchored_block`);
    }
    if (file.change_type === 'modify' && file.scope_mode === 'exact_lines'
      && (!file.line_ranges_allowed_declared || !file.line_ranges_allowed_valid || !file.line_ranges_allowed.length)) {
      errors.push(`${file.path}: exact_lines requires valid structured line_ranges_allowed with reasons`);
    }
    if (file.change_type === 'modify' && file.scope_mode === 'exact_lines'
      && (!file.symbols_allowed_declared || !file.symbols_allowed_valid || !file.symbols_allowed.length)) {
      errors.push(`${file.path}: exact_lines requires a non-empty symbols_allowed list`);
    }
    if (file.change_type === 'modify' && file.scope_mode === 'anchored_block') {
      if (!file.has_anchors) errors.push(`${file.path}: anchored_block requires structured anchors_allowed`);
      if (file.anchor_blocks.some((anchor) => !anchor.start_anchor || !anchor.end_anchor || !anchor.allowed_operations.length)) {
        errors.push(`${file.path}: every anchored block requires start_anchor, end_anchor and allowed_operations`);
      }
      if (!file.line_ranges_expected_declared || !file.line_ranges_expected_valid) errors.push(`${file.path}: anchored_block requires valid line_ranges_expected`);
      if (!file.forbidden_anchors_declared || !file.forbidden_anchors_valid) errors.push(`${file.path}: anchored_block requires a valid forbidden_anchors list`);
    }
  }
  return errors;
}

function parseScopeContract(content, expectedPlanRef) {
  const block = extractScopeBlock(content);
  if (!block) return { contract: null, errors: validateScopeContract(null, expectedPlanRef) };
  const structureErrors = scopeStructureErrors(block);
  const contract = {
    contract_id: scalar(block, 'contract_id'),
    protocol_version: scalar(block, 'protocol_version'),
    base_ref: scalar(block, 'base_ref'),
    intent: scalar(block, 'intent'),
    execution_mode: scalar(block, 'execution_mode'),
    plan_ref: scalar(block, 'plan_ref'),
    phase_ref: scalar(block, 'phase_ref'),
    approved_by: scalar(block, 'approved_by'),
    risk_tier: scalar(block, 'risk_tier'),
    files_allowed: parseFiles(block),
    forbidden_zones: parseStringList(block, 'forbidden_zones'),
    allowed_contract_changes: parseStringList(block, 'allowed_contract_changes'),
    required_tests: parseStringList(block, 'required_tests'),
    required_skills: parseStringList(block, 'required_skills'),
    expected_outputs: parseStringList(block, 'expected_outputs'),
    post_mutation_auditor_required: scalar(block, 'post_mutation_auditor_required'),
    declarations: {
      allowed_contract_changes: hasTopLevelKey(block, 'allowed_contract_changes'),
      forbidden_zones: hasTopLevelKey(block, 'forbidden_zones'),
    },
    contract_sha256: crypto.createHash('sha256').update(block).digest('hex'),
  };
  return { contract, errors: [...structureErrors, ...validateScopeContract(contract, expectedPlanRef)] };
}

function patternMatches(filePath, pattern) {
  const normalized = normalizePath(pattern);
  if (normalized.endsWith('/**')) return filePath === normalized.slice(0, -3) || filePath.startsWith(normalized.slice(0, -2));
  if (normalized.endsWith('/')) return filePath.startsWith(normalized);
  return filePath === normalized;
}

function changeTypeMatches(changeType, status) {
  const expected = { create: ['A'], modify: ['M', 'T'], delete: ['D'], move: ['R'], generated: ['A', 'M', 'T'] }[changeType] || [];
  return expected.includes(String(status || '')[0]);
}

function diffHunkWithinRanges(hunk, ranges) {
  const within = (start, count) => {
    const end = start + Math.max(count, 1) - 1;
    return ranges.some((range) => start >= range.start && end <= range.end);
  };
  return within(hunk.oldStart, hunk.oldCount) && within(hunk.newStart, hunk.newCount);
}

function symbolsForDiffHunks(baseContent, currentContent, hunks) {
  const declarations = (content) => String(content || '').replace(/\r\n/g, '\n').split('\n').flatMap((line, index) => {
    if (/^[ \t]+(?:export\s+)?(?:(?:async\s+)?function|const|let|var|class|interface|type|enum)\b/.test(line)) {
      return [{ line: index + 1, symbol: '<document>' }];
    }
    if (/^[ \t]+(?:\(+[ \t]*)?[\[{][^\]}]*[\]}][ \t]*=/.test(line)) {
      return [{ line: index + 1, symbol: '<document>' }];
    }
    const assignment = line.match(/^([ \t]*)(?:\(+[ \t]*)?([A-Za-z_$][\w$]*(?:(?:\.[A-Za-z_$][\w$]*)|\[[^\]\r\n]+\])+?)\s*(?:\|\|=|&&=|\?\?=|[+\-*/%]?=)/)
      || line.match(/^([ \t]*)(?:\(+[ \t]*)?delete\s+([A-Za-z_$][\w$]*(?:(?:\.[A-Za-z_$][\w$]*)|\[[^\]\r\n]+\])+)/);
    if (assignment) return [{ line: index + 1, symbol: assignment[1] ? '<document>' : assignment[2] }];
    const match = line.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$-]*)/)
      || line.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/)
      || line.match(/^(?:export\s+)?(?:class|interface|type|enum)\s+([A-Za-z_$][\w$-]*)/)
      || line.match(/^function\s+([A-Za-z_][\w-]*)/i)
      || line.match(/^\$([A-Za-z_][\w-]*)\s*=/)
      || line.match(/^ {2}([A-Za-z][\w-]*):\s*$/);
    if (match) return [{ line: index + 1, symbol: match[1] }];
    if (/^(?:export\s+)?(?:const|let|var)\s*[\[{]/.test(line)
      || /^export\s+default\b/.test(line)
      || /^(?:Object\.(?:assign|definePropert(?:y|ies))|Reflect\.(?:defineProperty|set))\s*\(/.test(line)) {
      return [{ line: index + 1, symbol: '<document>' }];
    }
    return [];
  });
  const collect = (content, start, count) => {
    if (!String(content || '')) return [];
    const lines = String(content).replace(/\r\n/g, '\n').split('\n');
    const all = declarations(content);
    const end = start + Math.max(count, 1) - 1;
    const inside = all.filter((entry) => entry.line >= start && entry.line <= end);
    const knownLines = new Set(all.map((entry) => entry.line));
    const unclassifiedStatement = count > 0 && lines.slice(Math.max(start, 1) - 1, end).some((line, offset) => {
      const lineNumber = Math.max(start, 1) + offset;
      const value = line.trim();
      if (!value || knownLines.has(lineNumber) || /^(?:#!|\/\/|\/\*|\*|#|['"]use strict['"];?|[}\]),;]+)$/.test(value)) return false;
      if (!/^\s/.test(line)) return true;
      return /^(?:\(+\s*)?(?:new\s+|delete\s+)?[A-Za-z_$][\w$]*(?:(?:\.[A-Za-z_$][\w$]*)|\[[^\]]+\])*(?:\s*(?:\(|(?:\|\|=|&&=|\?\?=|[+\-*/%]?=)))/.test(value);
    });
    const preceding = all.filter((entry) => entry.line <= start).at(-1);
    const symbols = [...inside.map((entry) => entry.symbol), ...(unclassifiedStatement ? ['<document>'] : []), ...(preceding ? [preceding.symbol] : [])];
    return symbols.length ? symbols : ['<document>'];
  };
  const result = new Set();
  for (const hunk of hunks) {
    for (const symbol of collect(baseContent, hunk.oldStart, hunk.oldCount)) result.add(symbol);
    for (const symbol of collect(currentContent, hunk.newStart, hunk.newCount)) result.add(symbol);
  }
  return [...result].sort();
}

function findScopeEntry(contract, filePath) {
  const target = normalizePath(filePath);
  return [...contract.files_allowed]
    .filter((file) => patternMatches(target, file.path))
    .sort((left, right) => {
      const leftExact = normalizePath(left.path) === target ? 1 : 0;
      const rightExact = normalizePath(right.path) === target ? 1 : 0;
      return rightExact - leftExact || normalizePath(right.path).length - normalizePath(left.path).length;
    })[0] || null;
}

function isPathAllowed(contract, filePath) {
  const target = normalizePath(filePath);
  const explicit = findScopeEntry(contract, target);
  if (!explicit) return false;
  return !contract.forbidden_zones.some((zone) => patternMatches(target, zone) && !contract.files_allowed.some((file) => file.path === target));
}

function normalizeIncidentStatus(status) {
  return String(status || '').toUpperCase();
}

function normalizePhaseStatus(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'COMPLETED') return 'DONE';
  if (value === 'IMPLEMENTED_LOCAL') return 'CODE_COMPLETE';
  if (value === 'DEPLOYED_PENDING_FIELD_SMOKE') return 'DEPLOYED_PENDING_VALIDATION';
  return value;
}

function isIsoTimestamp(value) {
  const match = String(value || '').match(ISO_8601);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, offsetHour = '0', offsetMinute = '0'] = match.map(Number);
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return false;
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return calendarDate.getUTCFullYear() === year && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day && !Number.isNaN(new Date(value).getTime());
}

function parseStateFields(content, keys) {
  const values = {};
  const errors = [];
  for (const key of keys) {
    const matches = [...String(content || '').matchAll(new RegExp(`^\\s*-?\\s*${key}\\s*[=:]\\s*(.+)$`, 'gm'))];
    if (matches.length !== 1) errors.push(`${key} must appear exactly once`);
    else values[key] = matches[0][1].trim();
  }
  return { values, errors };
}

function incidentField(content, key) {
  const match = content.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!match) return null;
  const inline = match[1].trim();
  if (inline && inline !== '|' && inline !== '>') return inline;
  const tail = content.slice(match.index + match[0].length).split(/^\S[A-Z0-9_-]*:\s*/m)[0];
  return tail.trim() || null;
}

function currentHeadApprovalCount(reviews, headSha, author) {
  const latestByReviewer = new Map();
  for (const review of reviews) {
    if (!review?.user?.id || !review.submitted_at) continue;
    const previous = latestByReviewer.get(review.user.id);
    if (!previous || review.submitted_at > previous.submitted_at) latestByReviewer.set(review.user.id, review);
  }
  return [...latestByReviewer.values()].filter((review) => (
    review.state === 'APPROVED'
    && review.commit_id === headSha
    && review.user.login !== author
  )).length;
}

function parseIncidentDocument(content) {
  const records = [];
  const errors = [];
  const seenIds = new Set();
  const required = ['INCIDENT_ID', 'SEVERITY', 'STATUS', 'OWNER', 'IMPACT', 'NEXT_STEP_EXACT'];
  for (const [index, part] of content.split(/^---\s*$/m).entries()) {
    if (!/^INCIDENT_ID:/m.test(part)) {
      if (/^[ \t]*(?:-\s*)?(?:INCIDENT[-_]ID|SEVERITY|STATUS|OWNER|IMPACT|NEXT_STEP_EXACT):/m.test(part)) {
        errors.push(`incident record ${index + 1} is missing INCIDENT_ID`);
      }
      continue;
    }
    const duplicateFields = required.filter((key) => [...part.matchAll(new RegExp(`^${key}:`, 'gm'))].length > 1);
    if (duplicateFields.length) {
      errors.push(`incident record ${index + 1}: ${duplicateFields.join(', ')} must appear exactly once`);
      continue;
    }
    const values = Object.fromEntries(required.map((key) => [key, incidentField(part, key)]));
    const missing = required.filter((key) => !values[key]);
    if (missing.length) {
      errors.push(`incident record ${index + 1} is missing ${missing.join(', ')}`);
      continue;
    }
    const id = values.INCIDENT_ID;
    const rawStatus = values.STATUS;
    const severity = values.SEVERITY;
    if (!/^INC-\d{4}-\d{3,4}$/.test(id)) errors.push(`${id}: invalid INCIDENT_ID`);
    if (!/^P[0-3]$/.test(severity)) errors.push(`${id}: unsupported SEVERITY=${severity}`);
    if (seenIds.has(id)) errors.push(`${id}: duplicate INCIDENT_ID`);
    seenIds.add(id);
    const status = normalizeIncidentStatus(rawStatus);
    if (!['DETECTED', 'CONTAINED', 'DIAGNOSED', 'MITIGATED', 'FIXED', 'VERIFIED', 'CLOSED'].includes(status)) {
      errors.push(`${id}: unsupported STATUS=${rawStatus}`);
      continue;
    }
    if (/^INC-\d{4}-\d{3,4}$/.test(id) && /^P[0-3]$/.test(severity) && !records.some((record) => record.id === id)) {
      records.push({ id, status, raw_status: rawStatus, severity });
    }
  }
  return { records, errors };
}

function parseIncidentRecords(content) {
  return parseIncidentDocument(content).records;
}

function collateralFindingsClosed(content) {
  const headings = [...content.matchAll(/^##\s+(?:Hallazgos Colaterales|Collateral Findings)\s*$/gmi)];
  const lastHeading = headings.at(-1);
  const canonicalSection = lastHeading
    ? content.slice(lastHeading.index + lastHeading[0].length).split(/^##\s+/m)[0]
    : null;
  const source = canonicalSection || content.replace(/```[\s\S]*?```/g, '');
  const matches = [...source.matchAll(/^\s*COLLATERAL_FINDINGS:[ \t]*(.*)$/gm)];
  const match = matches.at(-1);
  if (!match) return false;
  const inline = match[1].trim();
  if (inline === 'NONE') return true;
  if (inline && inline !== 'PENDING_PHASE_CLOSE') return false;
  const tail = source.slice(match.index + match[0].length);
  const block = tail.split(/^\S|^##\s|^```/m)[0];
  if (/PENDING_PHASE_CLOSE/.test(block)) return false;
  const findings = block.split(/^\s*-\s+finding_id:\s*/m).slice(1);
  return findings.length > 0 && findings.every((finding) => (
    /^CF-[A-Z0-9-]+/m.test(finding)
    && /^\s+file:\s*\S+/m.test(finding)
    && /^\s+(?:lines|symbol|lines_or_symbol):\s*\S+/m.test(finding)
    && /^\s+pattern:\s*.+/m.test(finding)
    && /^\s+severity:\s*P[0-3]\s*$/m.test(finding)
    && /^\s+effort:\s*(?:S|M|L|XL)\s*$/m.test(finding)
  ));
}

function auditorVerdict(content) {
  return auditorReport(content)?.result || null;
}

function auditorReport(content) {
  const markers = [...content.matchAll(/^AUDITOR_POST_MUTATION_REPORT:\s*$/gm)];
  if (markers.length !== 1) return null;
  const report = content.slice(markers[0].index + markers[0][0].length)
    .split(/^#{1,6}\s+/m)[0].split(/^\s*```\s*$/m)[0].split(/^---\s*$/m)[0];
  const scalarFields = [
    'contract_id', 'contract_sha256', 'base_ref', 'head_ref', 'plan_ref', 'evidence_digest', 'result',
    'auditor_identity', 'audit_timestamp', 'gatekeeper_scope_contract', 'registration_status',
  ];
  const topListFields = [
    'files_touched_outside_plan', 'symbols_changed_outside_plan', 'contract_changes_unexpected',
    'duplicate_symbols_introduced', 'escalated_to',
  ];
  const childFields = {
    debt_delta: ['introduced_by_mutation', 'touched_existing_debt', 'exposed_existing_debt', 'not_in_scope_old_debt'],
    line_scope_check: ['lines_touched_within_allowed_ranges', 'lines_touched_outside_allowed_ranges', 'missing_line_range_contract'],
    anchor_scope_check: ['anchors_touched_within_allowed_blocks', 'anchors_touched_outside_allowed_blocks', 'missing_anchor_contract', 'forbidden_anchor_touched'],
    documentation_duplication_check: ['ssot_declared', 'duplicated_without_reason'],
  };
  const values = {};
  const lists = {};
  const maps = new Set();
  let currentMap = null;
  let structureValid = true;
  for (const line of report.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const child = line.match(/^ {4}([a-z0-9_]+):\s*(.*)$/);
    if (child) {
      const [, key, raw] = child;
      if (!currentMap || !childFields[currentMap]?.includes(key) || Object.hasOwn(lists, key)) { structureValid = false; continue; }
      const parsed = parseInlineList(raw);
      if (parsed === null) structureValid = false;
      else lists[key] = parsed;
      continue;
    }
    const top = line.match(/^ {2}([a-z0-9_]+):\s*(.*)$/);
    if (!top) { structureValid = false; currentMap = null; continue; }
    const [, key, raw] = top;
    currentMap = null;
    if (Object.hasOwn(values, key) || Object.hasOwn(lists, key) || maps.has(key)) { structureValid = false; continue; }
    if (Object.hasOwn(childFields, key)) {
      if (raw.trim()) structureValid = false;
      maps.add(key);
      currentMap = key;
      continue;
    }
    if (topListFields.includes(key)) {
      const parsed = parseInlineList(raw);
      if (parsed === null) structureValid = false;
      else lists[key] = parsed;
      continue;
    }
    if (!scalarFields.includes(key) || !raw.trim()) { structureValid = false; continue; }
    values[key] = raw.trim().replace(/^["']|["']$/g, '');
  }
  const nestedFields = Object.values(childFields).flat();
  const complete = structureValid
    && scalarFields.every((key) => Object.hasOwn(values, key))
    && topListFields.every((key) => Object.hasOwn(lists, key))
    && Object.keys(childFields).every((key) => maps.has(key))
    && nestedFields.every((key) => Object.hasOwn(lists, key));
  const result = /^(?:PASS_WITH_NOTES|PASS|SCOPE_DRIFT|DEBT_INTRODUCED|DEBT_AGGRAVATED|BLOCKED)$/.test(values.result || '')
    ? values.result : null;
  const empty = (key) => lists[key]?.length === 0;
  const blockingLists = [
    'files_touched_outside_plan', 'symbols_changed_outside_plan', 'contract_changes_unexpected',
    'introduced_by_mutation', 'touched_existing_debt', 'lines_touched_outside_allowed_ranges',
    'missing_line_range_contract', 'anchors_touched_outside_allowed_blocks', 'missing_anchor_contract',
    'forbidden_anchor_touched', 'duplicated_without_reason', 'duplicate_symbols_introduced', 'escalated_to',
  ];
  const semanticValid = complete
    && values.gatekeeper_scope_contract === 'present'
    && /^SAAS-FACTORY-AUDITOR\/[A-Za-z0-9._-]+$/.test(values.auditor_identity || '')
    && isIsoTimestamp(values.audit_timestamp)
    && ['REGISTRATION_PENDING', 'SYNCHRONIZED'].includes(values.registration_status)
    && blockingLists.every(empty)
    && (result !== 'PASS' || (empty('exposed_existing_debt') && empty('not_in_scope_old_debt')));
  return {
    result,
    complete,
    semanticValid,
    auditor_identity: values.auditor_identity || null,
    audit_timestamp: values.audit_timestamp || null,
    contract_id: values.contract_id || null,
    contract_sha256: values.contract_sha256 || null,
    base_ref: values.base_ref || null,
    head_ref: values.head_ref || null,
    plan_ref: values.plan_ref || null,
    evidence_digest: values.evidence_digest || null,
  };
}

function auditorCloseoutValid(content, contract, planRef, expectedDigest = null) {
  const report = auditorReport(content);
  return Boolean(report?.semanticValid && ['PASS', 'PASS_WITH_NOTES'].includes(report.result)
    && report.contract_id === contract.contract_id && report.contract_sha256 === contract.contract_sha256
    && report.base_ref === contract.base_ref && report.plan_ref === planRef && report.head_ref === 'WORKTREE'
    && /^[a-f0-9]{64}$/i.test(report.evidence_digest || '')
    && (!expectedDigest || report.evidence_digest === expectedDigest));
}

function computeEvidenceDigest(repoRoot, baseRef, planPath, additionalExcluded = []) {
  if (!/^[a-f0-9]{40}$/i.test(baseRef || '')) throw new Error('Evidence digest requires an exact base commit SHA');
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  const tokens = git(['diff', '--name-status', '-z', '--end-of-options', baseRef, '--']);
  const rawTokens = git(['diff', '--raw', '-z', '--end-of-options', baseRef, '--']);
  const rawMetadata = new Map();
  for (let index = 0; index < rawTokens.length;) {
    const header = rawTokens[index++];
    const fields = header.trim().split(/\s+/);
    const status = fields.at(-1) || '';
    const oldPath = normalizePath(rawTokens[index++]);
    const filePath = /^[RC]/.test(status) ? normalizePath(rawTokens[index++]) : oldPath;
    rawMetadata.set(filePath, `${fields[0]}\0${fields[1]}\0${status}\0${oldPath}`);
  }
  const entries = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    const oldPath = /^[RC]/.test(status) ? normalizePath(tokens[index++]) : null;
    const filePath = normalizePath(tokens[index++]);
    entries.push({ status, oldPath, path: filePath });
  }
  for (const filePath of git(['ls-files', '--others', '--exclude-standard', '-z'])) entries.push({ status: 'A', oldPath: null, path: normalizePath(filePath) });
  const excluded = new Set([
    planPath,
    // Las rutas de estado del proyecto llegan por additionalExcluded (perfil),
    // no inlineadas: el carril de estado no forma parte del diff auditado.
    ...additionalExcluded.map(normalizePath),
  ]);
  const hash = crypto.createHash('sha256');
  // Un indice scratch aislado (no el indice real del repo) reproduce exactamente lo
  // que un `git add` fresco produciria. `git hash-object --path=` de plomeria pura
  // normaliza CRLF de forma aislada, pero el indice REAL no reconvierte contenido ya
  // trackeado con un estilo de line-ending previo sin --renormalize: las dos fuentes
  // pueden divergir para un fichero que ya estaba commiteado con CRLF preservado
  // (encontrado en PLAN-2026-216/217/218, ver CF-PLAN-2026-217-001).
  const scratchIndex = path.join(
    os.tmpdir(),
    `saas-factory-evidence-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const scratchEnv = { ...process.env, GIT_INDEX_FILE: scratchIndex };
  const canonicalBlob = (relative, full) => {
    execFileSync('git', ['add', '--force', '--', full], { cwd: repoRoot, encoding: 'utf8', env: scratchEnv });
    return execFileSync('git', ['rev-parse', `:${relative}`], { cwd: repoRoot, encoding: 'utf8', env: scratchEnv }).trim();
  };
  try {
    for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
      const relative = entry.path;
      if (excluded.has(relative)) continue;
      const generated = relative.startsWith('docs/06-evidence/generated-knowledge/') || relative.startsWith('docs/06-evidence/timelines/knowledge-timelines/');
      const full = path.join(repoRoot, relative);
      let stat = null;
      try { stat = fs.lstatSync(full); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      let metadata = rawMetadata.get(relative);
      if (!metadata && stat) {
        const gitMode = stat.isSymbolicLink() ? '120000' : ((stat.mode & 0o111) ? '100755' : '100644');
        metadata = `:000000\0${gitMode}\0A\0${relative}`;
      }
      hash.update(`${entry.status}\0${entry.oldPath || ''}\0${relative}\0${metadata || 'DELETED'}\0`);
      if (generated) hash.update('<GENERATED_CONTENT_EXCLUDED>');
      else if (!stat) hash.update('<DELETED>');
      else {
        if (stat.isSymbolicLink()) hash.update(`SYMLINK:${fs.readlinkSync(full)}`);
        else hash.update(`BLOB:${canonicalBlob(relative, full)}`);
      }
      hash.update('\0');
    }
  } finally {
    try { fs.unlinkSync(scratchIndex); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return hash.digest('hex');
}

module.exports = {
  ACTIVE_PLAN_STATUSES,
  COMPLIANCE_STATUSES,
  LIFECYCLE_PHASES,
  PHASE_STATUSES,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_PREVIOUS,
  TERMINAL_INCIDENT_STATUSES,
  TERMINAL_PLAN_STATUSES,
  auditorCloseoutValid,
  auditorReport,
  auditorVerdict,
  changeTypeMatches,
  currentHeadApprovalCount,
  diffHunkWithinRanges,
  computeEvidenceDigest,
  collateralFindingsClosed,
  extractScopeBlock,
  findPlanFile,
  findScopeEntry,
  frontmatter,
  isPathAllowed,
  isIsoTimestamp,
  normalizePhaseStatus,
  normalizePath,
  patternMatches,
  parseFrontmatterDocument,
  parseIncidentRecords,
  parseIncidentDocument,
  parseScopeContract,
  parseStateFields,
  symbolsForDiffHunks,
  unexpectedGeneratedOutputs,
  validateScopeContract,
};
