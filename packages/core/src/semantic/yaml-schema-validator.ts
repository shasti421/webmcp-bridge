/**
 * YamlSchemaValidator — validates parsed YAML against JSON Schemas.
 *
 * Responsibilities:
 * - Define JSON Schemas for: app.yaml, page.yaml, tool.yaml, workflow.yaml
 * - Validate parsed objects against schemas using Ajv
 * - Return structured errors with path to invalid field
 *
 * Implementation notes for agents:
 * - Use ajv with allErrors: true
 * - Schemas enforce: required fields, selector minimums (2+), valid field types
 * - Export schemas as constants so CLI can use them too
 */
import type { Result } from '../types/result.js';
import type { BridgeError } from '../types/errors.js';

export interface ValidationError {
  path: string;
  message: string;
  schemaPath: string;
}

export class YamlSchemaValidator {
  /**
   * Validate a parsed app.yaml object.
   */
  validateApp(data: unknown): Result<void, BridgeError> {
    // TODO: Implement with Ajv
    throw new Error('Not implemented — see spec: docs/specs/yaml-schema-spec.md');
  }

  /**
   * Validate a parsed page YAML object.
   */
  validatePage(data: unknown): Result<void, BridgeError> {
    throw new Error('Not implemented');
  }

  /**
   * Validate a parsed tool YAML object.
   */
  validateTool(data: unknown): Result<void, BridgeError> {
    throw new Error('Not implemented');
  }

  /**
   * Validate a parsed workflow YAML object.
   */
  validateWorkflow(data: unknown): Result<void, BridgeError> {
    throw new Error('Not implemented');
  }
}
