import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  LAYERS,
  ALLOWED_IMPORTS,
  findTsFiles,
  extractImportedLayers,
  checkDependencyViolations,
} = require('../../scripts/check-deps.js');

describe('check-deps', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-deps-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('LAYERS', () => {
    it('includes all expected layers', () => {
      expect(LAYERS).toContain('types');
      expect(LAYERS).toContain('semantic');
      expect(LAYERS).toContain('selector');
      expect(LAYERS).toContain('capture');
      expect(LAYERS).toContain('healing');
      expect(LAYERS).toContain('engine');
      expect(LAYERS).toContain('drivers');
      expect(LAYERS).toContain('utils');
    });
  });

  describe('ALLOWED_IMPORTS', () => {
    it('types has no allowed imports', () => {
      expect(ALLOWED_IMPORTS.types).toEqual([]);
    });

    it('semantic only imports from types', () => {
      expect(ALLOWED_IMPORTS.semantic).toEqual(['types']);
    });

    it('selector imports from types and semantic', () => {
      expect(ALLOWED_IMPORTS.selector).toEqual(['types', 'semantic']);
    });

    it('engine imports from types, semantic, selector, capture, healing, utils', () => {
      expect(ALLOWED_IMPORTS.engine).toContain('types');
      expect(ALLOWED_IMPORTS.engine).toContain('semantic');
      expect(ALLOWED_IMPORTS.engine).toContain('healing');
      expect(ALLOWED_IMPORTS.engine).toContain('utils');
      expect(ALLOWED_IMPORTS.engine).not.toContain('drivers');
    });

    it('drivers only imports from types', () => {
      expect(ALLOWED_IMPORTS.drivers).toEqual(['types']);
    });

    it('utils only imports from types', () => {
      expect(ALLOWED_IMPORTS.utils).toEqual(['types']);
    });
  });

  describe('findTsFiles()', () => {
    it('finds .ts files in a directory', () => {
      fs.mkdirSync(path.join(tmpDir, 'types'));
      fs.writeFileSync(path.join(tmpDir, 'types', 'errors.ts'), '');
      fs.writeFileSync(path.join(tmpDir, 'types', 'result.ts'), '');

      const files = findTsFiles(path.join(tmpDir, 'types'));
      expect(files).toHaveLength(2);
    });

    it('excludes __tests__ directories', () => {
      fs.mkdirSync(path.join(tmpDir, 'types'));
      fs.mkdirSync(path.join(tmpDir, 'types', '__tests__'));
      fs.writeFileSync(path.join(tmpDir, 'types', 'errors.ts'), '');
      fs.writeFileSync(path.join(tmpDir, 'types', '__tests__', 'errors.test.ts'), '');

      const files = findTsFiles(path.join(tmpDir, 'types'));
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('errors.ts');
    });

    it('excludes .test.ts files', () => {
      fs.mkdirSync(path.join(tmpDir, 'utils'));
      fs.writeFileSync(path.join(tmpDir, 'utils', 'helper.ts'), '');
      fs.writeFileSync(path.join(tmpDir, 'utils', 'helper.test.ts'), '');

      const files = findTsFiles(path.join(tmpDir, 'utils'));
      expect(files).toHaveLength(1);
    });

    it('returns empty array for non-existent directory', () => {
      const files = findTsFiles(path.join(tmpDir, 'nonexistent'));
      expect(files).toEqual([]);
    });

    it('recurses into subdirectories', () => {
      fs.mkdirSync(path.join(tmpDir, 'types', 'sub'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'types', 'errors.ts'), '');
      fs.writeFileSync(path.join(tmpDir, 'types', 'sub', 'nested.ts'), '');

      const files = findTsFiles(path.join(tmpDir, 'types'));
      expect(files).toHaveLength(2);
    });
  });

  describe('extractImportedLayers()', () => {
    it('extracts layer from relative import', () => {
      const content = "import type { BridgeError } from '../types/errors.js';";
      expect(extractImportedLayers(content)).toEqual(['types']);
    });

    it('extracts multiple layers', () => {
      const content = `
import type { Result } from '../types/result.js';
import type { SemanticStore } from '../semantic/semantic-store.js';
      `;
      const layers = extractImportedLayers(content);
      expect(layers).toContain('types');
      expect(layers).toContain('semantic');
    });

    it('extracts layer from deeper relative path', () => {
      const content = "import type { BridgeDriver } from '../../types/bridge-driver.js';";
      expect(extractImportedLayers(content)).toEqual(['types']);
    });

    it('returns empty array when no internal imports', () => {
      const content = "import { describe } from 'vitest';";
      expect(extractImportedLayers(content)).toEqual([]);
    });

    it('handles double-quoted imports', () => {
      const content = 'import { ok } from "../types/result.js";';
      expect(extractImportedLayers(content)).toEqual(['types']);
    });
  });

  describe('checkDependencyViolations()', () => {
    function setupLayer(layer: string, content: string): void {
      fs.mkdirSync(path.join(tmpDir, layer), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, layer, 'index.ts'), content);
    }

    it('returns no violations for valid imports', () => {
      setupLayer('semantic', "import type { Result } from '../types/result.js';");
      setupLayer('types', 'export type Result<T> = T;');

      const violations = checkDependencyViolations(tmpDir);
      expect(violations).toEqual([]);
    });

    it('catches types importing from semantic (violation)', () => {
      setupLayer('types', "import { SemanticStore } from '../semantic/semantic-store.js';");

      const violations = checkDependencyViolations(tmpDir);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('VIOLATION');
      expect(violations[0]).toContain('types/');
      expect(violations[0]).toContain('semantic');
    });

    it('catches semantic importing from engine (violation)', () => {
      setupLayer('semantic', "import { ExecutionEngine } from '../engine/execution-engine.js';");

      const violations = checkDependencyViolations(tmpDir);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('VIOLATION');
      expect(violations[0]).toContain("'engine/'");
    });

    it('catches utils importing from engine (violation)', () => {
      setupLayer('utils', "import { ExecutionEngine } from '../engine/execution-engine.js';");

      const violations = checkDependencyViolations(tmpDir);
      expect(violations).toHaveLength(1);
    });

    it('catches drivers importing from engine (violation)', () => {
      setupLayer('drivers', "import { ExecutionEngine } from '../engine/execution-engine.js';");

      const violations = checkDependencyViolations(tmpDir);
      expect(violations).toHaveLength(1);
    });

    it('allows engine importing from utils', () => {
      setupLayer('engine', "import { TemplateRenderer } from '../utils/template-renderer.js';");

      const violations = checkDependencyViolations(tmpDir);
      expect(violations).toEqual([]);
    });

    it('allows engine importing from healing', () => {
      setupLayer('engine', "import { HealingPipeline } from '../healing/healing-pipeline.js';");

      const violations = checkDependencyViolations(tmpDir);
      expect(violations).toEqual([]);
    });

    it('catches engine importing from drivers (violation)', () => {
      setupLayer('engine', "import { MockDriver } from '../drivers/mock-driver.js';");

      const violations = checkDependencyViolations(tmpDir);
      expect(violations).toHaveLength(1);
    });

    it('reports multiple violations', () => {
      setupLayer('types', `
import { SemanticStore } from '../semantic/semantic-store.js';
import { ExecutionEngine } from '../engine/execution-engine.js';
      `);

      const violations = checkDependencyViolations(tmpDir);
      expect(violations).toHaveLength(2);
    });

    it('ignores __tests__ directories', () => {
      fs.mkdirSync(path.join(tmpDir, 'types', '__tests__'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'types', '__tests__', 'result.test.ts'),
        "import { SelectorResolver } from '../../selector/selector-resolver.js';",
      );

      const violations = checkDependencyViolations(tmpDir);
      expect(violations).toEqual([]);
    });

    it('handles empty core directory', () => {
      const violations = checkDependencyViolations(path.join(tmpDir, 'nonexistent'));
      expect(violations).toEqual([]);
    });
  });

  describe('integration: real codebase', () => {
    it('has no violations in the actual packages/core/src', () => {
      const coreDir = path.join(__dirname, '..', '..', 'packages', 'core', 'src');
      const violations = checkDependencyViolations(coreDir);
      expect(violations).toEqual([]);
    });
  });
});
