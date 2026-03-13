/**
 * SemanticStore — loads, validates, and resolves YAML semantic definitions.
 *
 * Responsibilities:
 * - Load app.yaml, pages/*.yaml, tools/*.yaml, workflows/*.yaml from a directory
 * - Validate all YAML against JSON Schema (see yaml-schema-validator.ts)
 * - Resolve page references in tools/workflows (e.g., "page_id.fields.field_id")
 * - Detect current page from URL using url_patterns
 * - Provide lookup APIs: getPage(id), getTool(name), getWorkflow(name), getApp(id)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as yaml from 'js-yaml';

import type {
  AppDefinition,
  PageDefinition,
  ToolDefinition,
  WorkflowDefinition,
  FieldDefinition,
  OutputDefinition,
  InteractionPatternLibrary,
} from '../types/index.js';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import type { BridgeError } from '../types/errors.js';
import { createBridgeError } from '../types/errors.js';

import type { YamlSchemaValidator } from './yaml-schema-validator.js';

export class SemanticStore {
  private apps: Map<string, AppDefinition> = new Map();
  private pages: Map<string, PageDefinition> = new Map();
  private tools: Map<string, ToolDefinition> = new Map();
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private patterns: InteractionPatternLibrary = {};
  private urlPatternCache: Map<string, RegExp> = new Map();

  private readonly validator: YamlSchemaValidator;

  constructor(validator: YamlSchemaValidator) {
    this.validator = validator;
  }

  /**
   * Load all semantic definitions from a directory.
   * Directory structure:
   *   app.yaml (or app.yml)
   *   pages/*.yaml
   *   tools/*.yaml
   *   workflows/*.yaml
   */
  async loadFromDirectory(dirPath: string): Promise<Result<void, BridgeError>> {
    const files = this.collectYamlFiles(dirPath);

    // Sort for deterministic loading order
    files.sort();

    for (const filePath of files) {
      const parseResult = this.parseYamlFile(filePath);
      if (!parseResult.ok) {
        return parseResult;
      }

      const data = parseResult.value;
      const relative = path.relative(dirPath, filePath);
      const categorizeResult = this.categorizeAndValidate(data, relative, filePath);
      if (!categorizeResult.ok) {
        return categorizeResult;
      }
    }

    // Compile URL patterns for loaded apps
    this.compileUrlPatterns();

    return ok(undefined);
  }

  /**
   * Load semantic definitions from a registry path.
   *
   * The registryPath should point to a resolved app version directory
   * (e.g., ~/.webmcp-bridge/registry/my_app/1.0.0/) containing
   * app.yaml, pages/, tools/, workflows/.
   *
   * Use LocalRegistry.resolve() to get this path before calling.
   */
  async loadFromRegistry(registryPath: string): Promise<Result<void, BridgeError>> {
    // Validate that the path exists
    if (!fs.existsSync(registryPath)) {
      return err(createBridgeError(
        'REGISTRY_ERROR',
        `Registry path does not exist: ${registryPath}`,
        'registry',
      ));
    }

    // Validate that app.yaml exists (registry entries must have an app definition)
    const appYamlPath = path.join(registryPath, 'app.yaml');
    const appYmlPath = path.join(registryPath, 'app.yml');
    if (!fs.existsSync(appYamlPath) && !fs.existsSync(appYmlPath)) {
      return err(createBridgeError(
        'REGISTRY_ERROR',
        `No app.yaml found in registry path: ${registryPath}`,
        'registry',
      ));
    }

    // Delegate to loadFromDirectory which handles YAML loading and validation
    return this.loadFromDirectory(registryPath);
  }

  getApp(appId: string): AppDefinition | undefined {
    return this.apps.get(appId);
  }

  getPage(pageId: string): PageDefinition | undefined {
    return this.pages.get(pageId);
  }

  getTool(toolName: string): ToolDefinition | undefined {
    return this.tools.get(toolName);
  }

  getWorkflow(workflowName: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowName);
  }

  /**
   * Match a URL to a page definition across all loaded apps.
   */
  matchPage(url: string): PageDefinition | undefined {
    let pathname: string;
    try {
      const urlObj = new URL(url);
      pathname = urlObj.pathname;
    } catch {
      pathname = url;
    }

    // Sort pages by id for deterministic matching
    const sortedPages = [...this.pages.values()].sort((a, b) => a.id.localeCompare(b.id));

    for (const page of sortedPages) {
      const cacheKey = `${page.app}:${page.url_pattern}`;
      let regex = this.urlPatternCache.get(cacheKey);

      if (!regex) {
        regex = this.convertPatternToRegex(page.url_pattern);
        this.urlPatternCache.set(cacheKey, regex);
      }

      if (regex.test(pathname)) {
        return page;
      }
    }

    return undefined;
  }

  /**
   * Resolve a dotted field reference like "page_id.fields.field_id"
   */
  resolveFieldRef(ref: string): FieldDefinition | undefined {
    const parts = ref.split('.');
    if (parts.length !== 3 || parts[1] !== 'fields') {
      return undefined;
    }

    const pageId = parts[0]!;
    const fieldId = parts[2]!;

    const page = this.pages.get(pageId);
    if (!page) {
      return undefined;
    }

    return page.fields.find((f) => f.id === fieldId);
  }

  /**
   * Resolve a dotted output reference like "page_id.outputs.output_id"
   */
  resolveOutputRef(ref: string): OutputDefinition | undefined {
    const parts = ref.split('.');
    if (parts.length !== 3 || parts[1] !== 'outputs') {
      return undefined;
    }

    const pageId = parts[0]!;
    const outputId = parts[2]!;

    const page = this.pages.get(pageId);
    if (!page) {
      return undefined;
    }

    return page.outputs.find((o) => o.id === outputId);
  }

  /**
   * List all loaded tools.
   */
  listTools(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /**
   * Get all tools available for a given page (tools whose bridge.page matches).
   */
  getToolsForPage(pageId: string): ToolDefinition[] {
    return [...this.tools.values()].filter((t) => t.bridge.page === pageId);
  }

  /**
   * Get a named interaction pattern.
   */
  getPattern(name: string): InteractionPatternLibrary[string] | undefined {
    return this.patterns[name];
  }

  /**
   * List all loaded apps.
   */
  listApps(): AppDefinition[] {
    return [...this.apps.values()];
  }

  /**
   * List all pages for an app.
   */
  listPages(appId?: string): PageDefinition[] {
    const all = [...this.pages.values()];
    return appId ? all.filter((p) => p.app === appId) : all;
  }

  // ─── Private helpers ──────────────────────────────────

  private collectYamlFiles(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const results: string[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.collectYamlFiles(fullPath));
      } else if (entry.isFile() && /\.(yaml|yml)$/i.test(entry.name)) {
        results.push(fullPath);
      }
    }

    return results;
  }

  private parseYamlFile(filePath: string): Result<unknown, BridgeError> {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (readErr) {
      return err(createBridgeError(
        'YAML_PARSE_ERROR',
        `Failed to read ${filePath}: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
        'semantic',
        { cause: readErr },
      ));
    }

    try {
      const data = yaml.load(content);
      return ok(data);
    } catch (parseErr) {
      return err(createBridgeError(
        'YAML_PARSE_ERROR',
        `Failed to parse ${filePath}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        'semantic',
        { cause: parseErr },
      ));
    }
  }

  private categorizeAndValidate(
    rawData: unknown,
    relativePath: string,
    fullPath: string,
  ): Result<void, BridgeError> {
    const basename = path.basename(relativePath).toLowerCase();
    const dirName = path.dirname(relativePath).toLowerCase();

    // Unwrap wrapper keys if present (e.g., { app: { ... } } -> { ... })
    const data = this.unwrapYamlData(rawData, basename, dirName);

    if (basename === 'app.yaml' || basename === 'app.yml') {
      return this.validateAndStoreApp(data, fullPath);
    }

    if (dirName === 'pages' || dirName.endsWith('/pages')) {
      return this.validateAndStorePage(data, fullPath);
    }

    if (dirName === 'tools' || dirName.endsWith('/tools')) {
      return this.validateAndStoreTool(data, fullPath);
    }

    if (dirName === 'workflows' || dirName.endsWith('/workflows')) {
      return this.validateAndStoreWorkflow(data, fullPath);
    }

    // Unknown file location — skip silently
    return ok(undefined);
  }

  private unwrapYamlData(data: unknown, basename: string, dirName: string): unknown {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return data;
    }

    const obj = data as Record<string, unknown>;

    // Check for wrapper keys
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

  private validateAndStoreApp(data: unknown, filePath: string): Result<void, BridgeError> {
    const result = this.validator.validateApp(data);
    if (!result.ok) {
      return err(createBridgeError(
        result.error.code,
        `${filePath}: ${result.error.message}`,
        'semantic',
        { cause: result.error.cause },
      ));
    }

    const app = result.value;
    this.apps.set(app.id, app);
    return ok(undefined);
  }

  private validateAndStorePage(data: unknown, filePath: string): Result<void, BridgeError> {
    const result = this.validator.validatePage(data);
    if (!result.ok) {
      return err(createBridgeError(
        result.error.code,
        `${filePath}: ${result.error.message}`,
        'semantic',
        { cause: result.error.cause },
      ));
    }

    const page = result.value;
    this.pages.set(page.id, page);
    return ok(undefined);
  }

  private validateAndStoreTool(data: unknown, filePath: string): Result<void, BridgeError> {
    const result = this.validator.validateTool(data);
    if (!result.ok) {
      return err(createBridgeError(
        result.error.code,
        `${filePath}: ${result.error.message}`,
        'semantic',
        { cause: result.error.cause },
      ));
    }

    const tool = result.value;
    this.tools.set(tool.name, tool);
    return ok(undefined);
  }

  private validateAndStoreWorkflow(data: unknown, filePath: string): Result<void, BridgeError> {
    const result = this.validator.validateWorkflow(data);
    if (!result.ok) {
      return err(createBridgeError(
        result.error.code,
        `${filePath}: ${result.error.message}`,
        'semantic',
        { cause: result.error.cause },
      ));
    }

    const workflow = result.value;
    this.workflows.set(workflow.name, workflow);
    return ok(undefined);
  }

  private compileUrlPatterns(): void {
    for (const app of this.apps.values()) {
      for (const pattern of app.url_patterns) {
        const cacheKey = `${app.id}:${pattern}`;
        if (!this.urlPatternCache.has(cacheKey)) {
          this.urlPatternCache.set(cacheKey, this.convertPatternToRegex(pattern));
        }
      }
    }
  }

  private convertPatternToRegex(pattern: string): RegExp {
    // Escape regex special chars except {} and *
    let escaped = pattern.replace(/[.+?^$|()[\]\\]/g, '\\$&');

    // Replace {param} with named capture group
    escaped = escaped.replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, '([^/]+)');

    // Replace ** wildcard with .* (match anything including /)
    escaped = escaped.replace(/\*\*/g, '.*');

    // Replace remaining * wildcard with [^/]* (match anything except /)
    escaped = escaped.replace(/\*/g, '[^/]*');

    return new RegExp(`^${escaped}$`);
  }
}
