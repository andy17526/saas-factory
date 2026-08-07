#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..', '..');
const docsRoot = path.join(repoRoot, 'docs');
const generatedRoot = path.join(docsRoot, '06-evidence', 'generated-knowledge', 'knowledge-generated');
const timelinesRoot = path.join(docsRoot, '06-evidence', 'timelines', 'knowledge-timelines');

const allowedExtensions = new Set(['.md', '.mdx', '.yaml', '.yml', '.json']);
const idPattern = /\b(?:ADR-\d{3}|FIND-\d{4}-\d{3}|MIT-\d{4}-\d{3}-[A-Z]|AUDIT-\d{4}-\d{3}|EVT-\d{4}-\d{2}-\d{2}-\d{3}|FEATURE-[A-Z0-9-]+)\b/g;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosix(value) {
  return value.replaceAll('\\', '/');
}

function sha256(content) {
  return crypto.createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex');
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function listFiles(dirPath) {
  const result = [];
  function walk(currentPath) {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const fullPath = path.join(currentPath, entry.name);
      const relative = toPosix(path.relative(repoRoot, fullPath));
      if (entry.isDirectory()) {
        if (relative === 'docs/.obsidian') continue;
        if (relative === 'docs/06-evidence/generated-knowledge/knowledge-generated') continue;
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
        result.push(fullPath);
      }
    }
  }
  walk(dirPath);
  return result.sort((a, b) => a.localeCompare(b));
}

function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return {};
  const normalized = content.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return {};
  const raw = normalized.slice(4, end).split('\n');
  const result = {};
  let currentArray = null;
  for (const line of raw) {
    if (!line.trim()) continue;
    const arrayItem = line.match(/^\s+-\s+(.*)$/);
    if (arrayItem && currentArray) {
      result[currentArray].push(cleanScalar(arrayItem[1]));
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (rawValue === '') {
      result[key] = [];
      currentArray = key;
      continue;
    }
    currentArray = null;
    result[key] = cleanScalar(rawValue);
  }
  return result;
}

function cleanScalar(value) {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed === '[]') return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => cleanScalar(item))
      .filter((item) => item !== '');
  }
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function classify(pathFromRepo, frontmatter, idsFound) {
  if (frontmatter.entity_type) return String(frontmatter.entity_type);
  if (pathFromRepo.includes('/05-security-compliance/security/findings/')) return 'security_finding';
  if (pathFromRepo.includes('/05-security-compliance/security/mitigations/')) return 'mitigation';
  if (pathFromRepo.includes('/03-architecture/decisions/adr/') || idsFound.some((id) => id.startsWith('ADR-'))) return 'adr';
  if (pathFromRepo.includes('/06-evidence/security-audits/')) return 'audit';
  if (pathFromRepo.includes('/06-evidence/security-reports/')) return 'report';
  if (pathFromRepo.includes('/05-security-compliance/security/checklists/')) return 'checklist';
  if (pathFromRepo.includes('/05-security-compliance/security/program/plans/')) return 'plan';
  if (pathFromRepo.includes('/00-system/legacy-agent-memory/')) return 'memory';
  if (pathFromRepo.includes('/06-evidence/events/')) return 'decision';
  if (pathFromRepo.includes('/04-operations/')) return 'operation_runbook';
  if (pathFromRepo.includes('/05-security-compliance/')) return 'compliance_item';
  return 'document';
}

function documentRole(pathFromRepo, frontmatter, duplicateOf) {
  if (duplicateOf) return 'duplicate';
  if (frontmatter.canonical === true) return 'canonical';
  if (pathFromRepo.startsWith('docs/00-system/legacy-agent-memory/ai-memory/')) return 'canonical';
  if (pathFromRepo.startsWith('docs/03-architecture/decisions/adr/')) return 'canonical';
  if (pathFromRepo.startsWith('docs/05-security-compliance/security/findings/')) return 'canonical';
  if (pathFromRepo.startsWith('docs/05-security-compliance/security/mitigations/')) return 'canonical';
  if (pathFromRepo === 'docs/05-security-compliance/verifactu/verifactu-program/CERTIFICATION_PLAN.md') return 'canonical';
  if (pathFromRepo.startsWith('docs/06-evidence/security-audits/') || pathFromRepo.startsWith('docs/06-evidence/security-reports/')) return 'evidence';
  if (pathFromRepo.startsWith('docs/06-evidence/checkpoints/')) return 'historical';
  if (pathFromRepo.startsWith('docs/06-evidence/generated-knowledge/knowledge-generated/')) return 'excluded';
  return 'derived';
}

function ragPriority(pathFromRepo, role, entityType, frontmatter) {
  if (frontmatter.rag_priority) return String(frontmatter.rag_priority);
  if (role === 'duplicate' || role === 'excluded') return 'excluded';
  if (['security_finding', 'mitigation', 'adr', 'decision', 'memory', 'compliance_item'].includes(entityType)) return 'high';
  if (role === 'evidence') return 'medium';
  if (role === 'historical') return 'low';
  if (pathFromRepo.startsWith('docs/04-operations/') || pathFromRepo.startsWith('docs/01-product/') || pathFromRepo.startsWith('docs/03-architecture/')) return 'medium';
  return 'low';
}

function buildInventory() {
  const files = listFiles(docsRoot);
  const hashOwner = new Map();
  const records = [];

  for (const filePath of files) {
    const pathFromRepo = toPosix(path.relative(repoRoot, filePath));
    const content = readText(filePath);
    const hash = sha256(content);
    const duplicateOf = hashOwner.get(hash) || null;
    if (!duplicateOf) hashOwner.set(hash, pathFromRepo);
    const frontmatter = parseFrontmatter(content);
    const idsFound = [...new Set(content.match(idPattern) || [])];
    const entityType = classify(pathFromRepo, frontmatter, idsFound);
    const role = documentRole(pathFromRepo, frontmatter, duplicateOf);
    const priority = ragPriority(pathFromRepo, role, entityType, frontmatter);
    const ragIndex = frontmatter.rag_index !== undefined ? frontmatter.rag_index === true : role !== 'duplicate' && role !== 'excluded';

    records.push({
      path: pathFromRepo,
      hash,
      extension: path.extname(filePath).toLowerCase(),
      domain: pathFromRepo.split('/')[1] || 'docs',
      entity_type: entityType,
      document_role: role,
      ids_found: idsFound,
      canonical_candidate: role === 'canonical',
      duplicate_of: duplicateOf,
      rag_index: ragIndex,
      rag_priority: priority,
      status: frontmatter.status || null,
      severity: frontmatter.severity || null,
      finding_id: frontmatter.finding_id || null,
      title: frontmatter.title || titleFromPath(pathFromRepo),
    });
  }

  return records;
}

function titleFromPath(pathFromRepo) {
  return path.basename(pathFromRepo, path.extname(pathFromRepo)).replace(/[-_]+/g, ' ');
}

function buildManifest(records) {
  return records
    .filter((record) => record.rag_index && record.document_role !== 'duplicate' && record.document_role !== 'excluded')
    .map((record) => ({
      path: record.path,
      entity_type: record.entity_type,
      canonical: record.document_role === 'canonical',
      document_role: record.document_role,
      rag_index: true,
      rag_priority: record.rag_priority,
      filters: {
        domain: record.domain,
        ids: record.ids_found,
        status: record.status,
        severity: record.severity,
        finding_id: record.finding_id,
      },
    }));
}

function writeDuplicatesReport(records) {
  const duplicates = records.filter((record) => record.duplicate_of);
  const lines = [
    '# Duplicates Report',
    '',
    `Exact duplicates by hash: ${duplicates.length}`,
    '',
    '| Duplicate | Canonical Candidate | RAG Indexed |',
    '| --- | --- | --- |',
    ...duplicates.map((record) => `| ${record.path} | ${record.duplicate_of} | ${record.rag_index ? 'yes' : 'no'} |`),
    '',
    '## Cleanup Rule',
    '',
    'Do not delete automatically. First confirm the duplicate has no unique historical/evidence value.',
  ];
  fs.writeFileSync(path.join(generatedRoot, 'duplicates-report.md'), `${lines.join('\n')}\n`, 'utf8');
}

function writeOrphanReport(records) {
  const orphans = records.filter((record) => record.ids_found.length === 0 && record.document_role !== 'duplicate' && !record.path.endsWith('README.md'));
  const lines = [
    '# Orphan Docs Report',
    '',
    'Documents without recognized ADR/FIND/MIT/AUDIT/EVT/FEATURE identifiers.',
    '',
    '| Path | Role | Type | RAG Priority |',
    '| --- | --- | --- | --- |',
    ...orphans.map((record) => `| ${record.path} | ${record.document_role} | ${record.entity_type} | ${record.rag_priority} |`),
  ];
  fs.writeFileSync(path.join(generatedRoot, 'orphan-docs-report.md'), `${lines.join('\n')}\n`, 'utf8');
}

function readFrontmatterDocs(prefix) {
  return listFiles(path.join(repoRoot, prefix)).filter((filePath) => path.extname(filePath).toLowerCase() === '.md').map((filePath) => {
    const content = readText(filePath);
    return { path: toPosix(path.relative(repoRoot, filePath)), frontmatter: parseFrontmatter(content), content };
  });
}

function writeTimelines() {
  ensureDir(timelinesRoot);
  const events = readFrontmatterDocs('docs/06-evidence/events/knowledge-events').sort((a, b) => String(a.frontmatter.date || '').localeCompare(String(b.frontmatter.date || '')));
  const findings = readFrontmatterDocs('docs/05-security-compliance/security/findings').sort((a, b) => String(a.frontmatter.id || '').localeCompare(String(b.frontmatter.id || '')));

  fs.writeFileSync(
    path.join(timelinesRoot, 'recent-changes.md'),
    [
      '# Recent Changes',
      '',
      '| Date | ID | Title | Status | Source |',
      '| --- | --- | --- | --- | --- |',
      ...events.map((event) => `| ${event.frontmatter.date || ''} | ${event.frontmatter.id || ''} | ${event.frontmatter.title || ''} | ${event.frontmatter.status || ''} | ${event.path} |`),
    ].join('\n') + '\n',
    'utf8',
  );

  fs.writeFileSync(
    path.join(timelinesRoot, 'security-timeline.md'),
    [
      '# Security Timeline',
      '',
      '| ID | Severity | Status | Verification | Source |',
      '| --- | --- | --- | --- | --- |',
      ...findings.map((finding) => `| ${finding.frontmatter.id || ''} | ${finding.frontmatter.severity || ''} | ${finding.frontmatter.status || ''} | ${finding.frontmatter.verification_status || ''} | ${finding.path} |`),
    ].join('\n') + '\n',
    'utf8',
  );

  const featuresPath = path.join(docsRoot, '00-system', 'knowledge-registry', 'entities', 'features.yaml');
  const featureLines = fs.existsSync(featuresPath)
    ? readText(featuresPath).split(/\r?\n/).filter((line) => /^\s+- id: FEATURE-/.test(line) || /^\s+name:|^\s+status:|^\s+risk_level:/.test(line))
    : [];
  fs.writeFileSync(
    path.join(timelinesRoot, 'feature-timeline.md'),
    ['# Feature Timeline', '', 'Derived from `docs/00-system/knowledge-registry/entities/features.yaml`.', '', '```yaml', ...featureLines, '```'].join('\n') + '\n',
    'utf8',
  );
}

function main() {
  ensureDir(generatedRoot);
  ensureDir(timelinesRoot);
  const records = buildInventory();
  writeJson(path.join(generatedRoot, 'docs-inventory.json'), records);
  writeJson(path.join(generatedRoot, 'rag-manifest.json'), buildManifest(records));
  writeDuplicatesReport(records);
  writeOrphanReport(records);
  writeTimelines();
  console.log(`Docs inventory records: ${records.length}`);
  console.log(`RAG manifest records: ${buildManifest(records).length}`);
  console.log(`Exact duplicates: ${records.filter((record) => record.duplicate_of).length}`);
}

if (require.main === module) main();

module.exports = { sha256 };
