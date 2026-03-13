#!/usr/bin/env node
/**
 * Structural test: enforce dependency layers.
 * Types → Semantic → Selector → Capture → Healing → Engine → Drivers
 *
 * Run: node scripts/check-deps.js
 */
const { execSync } = require('child_process');
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

const coreDir = path.join(__dirname, '..', 'packages', 'core', 'src');
let violations = 0;

for (const layer of LAYERS) {
  const layerDir = path.join(coreDir, layer);
  try {
    const files = execSync(`find ${layerDir} -name "*.ts" -not -path "*__tests__*"`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
    for (const file of files) {
      const content = require('fs').readFileSync(file, 'utf-8');
      const imports = [...content.matchAll(/from\s+['"].*\/(types|semantic|selector|capture|healing|engine|drivers|utils)\//g)];
      for (const match of imports) {
        const importedLayer = match[1];
        if (importedLayer && !ALLOWED_IMPORTS[layer]?.includes(importedLayer)) {
          console.error(`VIOLATION: ${path.relative(coreDir, file)} imports from '${importedLayer}/' but '${layer}/' only allows: [${ALLOWED_IMPORTS[layer]?.join(', ')}]`);
          violations++;
        }
      }
    }
  } catch { /* layer dir may not exist yet */ }
}

if (violations > 0) {
  console.error(`\n${violations} dependency violation(s) found.`);
  process.exit(1);
} else {
  console.log('Dependency layers: OK');
}
