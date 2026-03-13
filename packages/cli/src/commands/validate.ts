/**
 * validate command -- validate all YAML in a semantic directory.
 *
 * Usage: webmcp-bridge validate [path]
 *
 * Validates:
 * - app.yaml exists and is valid
 * - All pages/*.yaml valid against page schema
 * - All tools/*.yaml valid, page references resolve
 * - All workflows/*.yaml valid, tool references resolve
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { YamlSchemaValidator } from '@webmcp-bridge/core';
import * as yaml from 'js-yaml';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fileCount: number;
  summary: {
    apps: number;
    pages: number;
    tools: number;
    workflows: number;
  };
}

export async function validateCommand(dirPath: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const summary = { apps: 0, pages: 0, tools: 0, workflows: 0 };
  let fileCount = 0;

  // Check directory exists
  if (!fs.existsSync(dirPath)) {
    return {
      valid: false,
      errors: [`Directory not found: ${dirPath}`],
      warnings: [],
      fileCount: 0,
      summary,
    };
  }

  // Check for app.yaml
  const appYamlPath = path.join(dirPath, 'app.yaml');
  const appYmlPath = path.join(dirPath, 'app.yml');
  const hasAppYaml = fs.existsSync(appYamlPath) || fs.existsSync(appYmlPath);

  if (!hasAppYaml) {
    return {
      valid: false,
      errors: ['Missing app.yaml in directory'],
      warnings: [],
      fileCount: 0,
      summary,
    };
  }

  const validator = new YamlSchemaValidator();

  // Collect all YAML files
  const yamlFiles = collectYamlFiles(dirPath);
  fileCount = yamlFiles.length;

  // Validate each file
  for (const filePath of yamlFiles) {
    const relative = path.relative(dirPath, filePath);
    const basename = path.basename(relative).toLowerCase();
    const dirName = path.dirname(relative).toLowerCase();

    // Parse YAML
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (readErr) {
      errors.push(`${relative}: Failed to read file: ${readErr instanceof Error ? readErr.message : String(readErr)}`);
      continue;
    }

    let data: unknown;
    try {
      data = yaml.load(content);
    } catch (parseErr) {
      errors.push(`${relative}: YAML parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
      continue;
    }

    // Unwrap wrapper keys
    const unwrapped = unwrapData(data, basename, dirName);

    // Validate based on file type
    if (basename === 'app.yaml' || basename === 'app.yml') {
      const result = validator.validateApp(unwrapped);
      if (result.ok) {
        summary.apps++;
      } else {
        errors.push(`${relative}: ${result.error.message}`);
      }
    } else if (dirName === 'pages' || dirName.endsWith('/pages')) {
      const result = validator.validatePage(unwrapped);
      if (result.ok) {
        summary.pages++;
      } else {
        errors.push(`${relative}: ${result.error.message}`);
      }
    } else if (dirName === 'tools' || dirName.endsWith('/tools')) {
      const result = validator.validateTool(unwrapped);
      if (result.ok) {
        summary.tools++;
      } else {
        errors.push(`${relative}: ${result.error.message}`);
      }
    } else if (dirName === 'workflows' || dirName.endsWith('/workflows')) {
      const result = validator.validateWorkflow(unwrapped);
      if (result.ok) {
        summary.workflows++;
      } else {
        errors.push(`${relative}: ${result.error.message}`);
      }
    }
    // Files in other locations are skipped silently
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fileCount,
    summary,
  };
}

function collectYamlFiles(dirPath: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dirPath)) {
    return results;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectYamlFiles(fullPath));
    } else if (entry.isFile() && /\.(yaml|yml)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

function unwrapData(data: unknown, basename: string, dirName: string): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }

  const obj = data as Record<string, unknown>;

  if (basename.startsWith('app') && 'app' in obj && Object.keys(obj).length === 1) {
    return obj['app'];
  }
  if ((dirName === 'pages' || dirName.endsWith('/pages')) && 'page' in obj && Object.keys(obj).length === 1) {
    return obj['page'];
  }
  if ((dirName === 'tools' || dirName.endsWith('/tools')) && 'tool' in obj && Object.keys(obj).length === 1) {
    return obj['tool'];
  }
  if ((dirName === 'workflows' || dirName.endsWith('/workflows')) && 'workflow' in obj && Object.keys(obj).length === 1) {
    return obj['workflow'];
  }

  return data;
}
