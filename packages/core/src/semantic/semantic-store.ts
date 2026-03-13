/**
 * SemanticStore — loads, validates, and resolves YAML semantic definitions.
 *
 * Responsibilities:
 * - Load app.yaml, pages/*.yaml, tools/*.yaml, workflows/*.yaml from a directory
 * - Validate all YAML against JSON Schema (see yaml-schema-validator.ts)
 * - Resolve page references in tools/workflows (e.g., "case_detail.fields.status")
 * - Detect current page from URL using app url_patterns
 * - Provide lookup APIs: getPage(id), getTool(name), getWorkflow(name), getApp(id)
 * - Support loading from local filesystem OR registry
 *
 * Implementation notes for agents:
 * - Use js-yaml for parsing
 * - Validate with YamlSchemaValidator before storing
 * - Build an in-memory index keyed by (app_id, page_id), (tool_name), (workflow_name)
 * - resolveFieldRef("app.pages.page_id.fields.field_id") returns FieldDefinition
 * - resolveOutputRef("app.pages.page_id.outputs.output_id") returns OutputDefinition
 * - matchPage(url) iterates all pages, matches url_pattern, returns PageDefinition | null
 */
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
import type { BridgeError } from '../types/errors.js';

export class SemanticStore {
  private apps: Map<string, AppDefinition> = new Map();
  private pages: Map<string, PageDefinition> = new Map();
  private tools: Map<string, ToolDefinition> = new Map();
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private patterns: InteractionPatternLibrary = {};

  /**
   * Load all semantic definitions from a directory.
   * Directory structure:
   *   <app-id>/
   *     app.yaml
   *     pages/*.yaml
   *     tools/*.yaml
   *     workflows/*.yaml
   *     patterns.yaml (optional)
   */
  async loadFromDirectory(dirPath: string): Promise<Result<void, BridgeError>> {
    // TODO: Implement — scan directory, parse YAML, validate, index
    throw new Error('Not implemented — see spec: docs/specs/semantic-store-spec.md');
  }

  /**
   * Load semantic definitions from a registry (local or remote).
   */
  async loadFromRegistry(appId: string, version?: string): Promise<Result<void, BridgeError>> {
    // TODO: Implement — fetch from registry, parse, validate, index
    throw new Error('Not implemented');
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
    // TODO: Implement — iterate pages, match url_pattern against url
    throw new Error('Not implemented');
  }

  /**
   * Resolve a dotted field reference like "page_id.fields.field_id"
   */
  resolveFieldRef(ref: string): FieldDefinition | undefined {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  /**
   * Resolve a dotted output reference like "page_id.outputs.output_id"
   */
  resolveOutputRef(ref: string): OutputDefinition | undefined {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  /**
   * Get all tools available for a given page (tools whose bridge.page matches).
   */
  getToolsForPage(pageId: string): ToolDefinition[] {
    // TODO: Implement
    throw new Error('Not implemented');
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
}
