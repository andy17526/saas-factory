#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const requiredFeatureLinks = (process.env.SAAS_FACTORY_FEATURE_LINKS || 'FEATURE-MAP').split(',').map((v) => v.trim()).filter(Boolean);
const repoRoot = path.resolve(__dirname, '..', '..');
const docsRoot = path.join(repoRoot, 'docs');
const featureRoot = path.join(docsRoot, '02-features');

function toPosix(value) {
  return value.replaceAll('\\', '/');
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function listFiles(dirPath, predicate = () => true) {
  if (!fs.existsSync(dirPath)) return [];
  const result = [];
  function walk(currentPath) {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (toPosix(path.relative(repoRoot, fullPath)) === 'docs/.obsidian') continue;
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(fullPath)) result.push(fullPath);
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

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function extractWikiLinks(content) {
  const links = [];
  const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = pattern.exec(content))) links.push(match[1].trim());
  return links;
}

function buildKnownNotes() {
  const known = new Set();
  for (const filePath of listFiles(docsRoot, (filePath) => path.extname(filePath).toLowerCase() === '.md')) {
    known.add(path.basename(filePath, '.md'));
    const frontmatter = parseFrontmatter(readText(filePath));
    if (frontmatter.id) known.add(frontmatter.id);
    if (frontmatter.title) known.add(frontmatter.title);
  }
  return known;
}

function validate() {
  const errors = [];
  const knownNotes = buildKnownNotes();
  const featureFiles = listFiles(featureRoot, (filePath) => path.extname(filePath).toLowerCase() === '.md');

  for (const filePath of featureFiles) {
    const relative = toPosix(path.relative(repoRoot, filePath));
    const content = readText(filePath);
    const frontmatter = parseFrontmatter(content);
    const tags = asArray(frontmatter.tags);
    const links = extractWikiLinks(content);
    const linkSet = new Set(links);
    const connectedFeatures = asArray(frontmatter.connected_features);
    const domains = asArray(frontmatter.domains).map((value) => String(value).toLowerCase());

    if (frontmatter.entity_type !== 'feature') errors.push(`${relative}: expected entity_type feature`);
    if (!content.includes('## Conexiones Obsidian')) errors.push(`${relative}: missing ## Conexiones Obsidian`);
    for (const section of ['## Caracteristicas Incluidas', '## Nivel De Entrega', '## Plan De Entrega']) {
      if (!content.includes(section)) errors.push(`${relative}: missing ${section}`);
    }
    for (const token of ['Nivel actual:', 'Nivel objetivo:', 'Planes incluidos:', 'Criterio para subir de nivel:', 'Bloqueos:']) {
      if (!content.includes(token)) errors.push(`${relative}: missing '${token}' in ## Nivel De Entrega`);
    }
    if (!tags.includes('feature')) errors.push(`${relative}: missing tag feature`);
    if (!tags.includes(`risk/${frontmatter.risk_level}`)) errors.push(`${relative}: missing tag risk/${frontmatter.risk_level}`);
    if (!tags.includes(`rag/${frontmatter.rag_priority}`)) errors.push(`${relative}: missing tag rag/${frontmatter.rag_priority}`);
    if (!tags.includes(`status/${frontmatter.status}`)) errors.push(`${relative}: missing tag status/${frontmatter.status}`);

    const sensitiveDomains = new Set(['payments', 'billing', 'verifactu', 'security', 'auth', 'compliance']);
    const needsComplianceSection = frontmatter.risk_level === 'high'
      || frontmatter.risk_level === 'critical'
      || domains.some((domain) => sensitiveDomains.has(domain));
    if (needsComplianceSection && !content.includes('## Requisitos De Cumplimiento')) {
      errors.push(`${relative}: missing ## Requisitos De Cumplimiento for high-risk/sensitive feature`);
    }

    // Los enlaces obligatorios de cada nodo de feature los declara el perfil.
    for (const requiredLink of requiredFeatureLinks) {
      if (!linkSet.has(requiredLink)) errors.push(`${relative}: missing required wikilink [[${requiredLink}]]`);
    }

    for (const featureId of connectedFeatures) {
      if (!linkSet.has(featureId)) errors.push(`${relative}: connected_features includes ${featureId} but body lacks [[${featureId}]]`);
    }

    for (const link of links) {
      if (!knownNotes.has(link)) errors.push(`${relative}: unresolved wikilink [[${link}]]`);
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`ERROR ${error}`);
    process.exit(1);
  }

  console.log(`Obsidian link validation passed. Feature nodes: ${featureFiles.length}`);
}

validate();
