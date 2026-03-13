#!/usr/bin/env node
/**
 * Structural test: enforce dependency layers in packages/core/src/.
 *
 * Dependency graph (each layer may only import from layers listed):
 *   Types    → (none)
 *   Semantic → Types
 *   Selector → Types, Semantic
 *   Capture  → Types, Semantic, Selector
 *   Healing  → Types, Semantic, Selector, Capture
 *   Engine   → Types, Semantic, Selector, Capture, Healing, Utils
 *   Drivers  → Types
 *   Utils    → Types
 *
 * Run: node scripts/check-deps.js
 * Exit code 0 = no violations, 1 = violations found
 */
const fs = require('fs');
const path = require('path');

const LAYERS = ['types', 'semantic', 'selector', 'capture', 'healing', 'engine', 'drivers', 'utils'];

const ALLOWED_IMPORTS = {
  types: [],
  semantic: ['types'],
  selector: ['types', 'semantic'],
  capture: ['types', 'semantic', 'selector'],
  healing: ['types', 'semantic', 'selector', 'capture'],
  engine: ['types', 'semantic', 'selector', 'capture', 'healing', 'utils'],
  drivers: ['types'],
  utils: ['types'],
};

/**
 * Recursively find all .ts files in a directory, excluding __tests__ directories.
 */
function findTsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      results.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extract imported layer names from a TypeScript file's content.
 * Matches: import ... from '../types/...' or from '../../types/...' etc.
 */
function extractImportedLayers(content) {
  const importRegex = /from\s+['"].*\/(types|semantic|selector|capture|healing|engine|drivers|utils)\//g;
  const layers = [];
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    if (match[1]) {
      layers.push(match[1]);
    }
  }
  return layers;
}

/**
 * Check all dependency layer violations. Returns array of violation messages.
 */
function checkDependencyViolations(coreDir) {
  const violations = [];

  for (const layer of LAYERS) {
    const layerDir = path.join(coreDir, layer);
    const files = findTsFiles(layerDir);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const importedLayers = extractImportedLayers(content);

      for (const importedLayer of importedLayers) {
        const allowed = ALLOWED_IMPORTS[layer];
        if (allowed && !allowed.includes(importedLayer)) {
          const relPath = path.relative(coreDir, file);
          violations.push(
            `VIOLATION: ${relPath} imports from '${importedLayer}/' but '${layer}/' only allows: [${allowed.join(', ')}]`
          );
        }
      }
    }
  }

  return violations;
}

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = {
    LAYERS,
    ALLOWED_IMPORTS,
    findTsFiles,
    extractImportedLayers,
    checkDependencyViolations,
  };
}

// Run as CLI
if (require.main === module) {
  const coreDir = path.join(__dirname, '..', 'packages', 'core', 'src');
  const violations = checkDependencyViolations(coreDir);

  if (violations.length > 0) {
    for (const v of violations) {
      console.error(v);
    }
    console.error(`\n${violations.length} dependency violation(s) found.`);
    process.exit(1);
  } else {
    console.log('Dependency layers: OK');
  }
}
