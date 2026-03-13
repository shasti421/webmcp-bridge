/**
 * TemplateRenderer — renders {{variable}} templates in tool step params.
 *
 * Supports:
 * - Simple: {{variable_name}} -> context.get(variable_name)
 * - Nested: {{result.field}} -> context.get('result').field
 * - Array access: {{items[0].name}} -> context.get('items')[0].name
 * - Conditional: {{variable}} in condition context -> truthy check
 */

export class TemplateRenderer {
  private expressionRegex = /\{\{([^}]*)\}\}/g;

  /**
   * Render all {{...}} templates in a string using the given context.
   */
  render(template: string, context: Map<string, unknown>): string {
    if (typeof template !== 'string') {
      return template;
    }

    const matches = [...template.matchAll(this.expressionRegex)];
    if (matches.length === 0) {
      return template;
    }

    let result = template;

    for (const match of matches) {
      const fullExpression = match[0]; // e.g., "{{user.name}}"
      const expression = match[1] ?? ''; // e.g., "user.name"

      const value = this.resolveExpression(expression, context);
      const valueStr = this.valueToString(value);

      // Replace all occurrences of this exact expression
      result = result.split(fullExpression).join(valueStr);
    }

    return result;
  }

  /**
   * Render templates in all string values of an object (deep).
   */
  renderObject(obj: unknown, context: Map<string, unknown>): unknown {
    if (typeof obj === 'string') {
      return this.render(obj, context);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.renderObject(item, context));
    }

    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.renderObject(value, context);
      }
      return result;
    }

    // Primitives (number, boolean, null, undefined)
    return obj;
  }

  /**
   * Evaluate a template expression as truthy/falsy (for step conditions).
   */
  evaluateCondition(expression: string, context: Map<string, unknown>): boolean {
    const rendered = this.render(expression, context);

    if (rendered === '' || rendered === 'null' || rendered === 'undefined') {
      return false;
    }

    if (rendered === 'false' || rendered === '0') {
      return false;
    }

    return true;
  }

  /**
   * Resolve a template expression to a value from the context.
   */
  private resolveExpression(expression: string, context: Map<string, unknown>): unknown {
    // Remove all whitespace for parsing
    const trimmed = expression.replace(/\s+/g, '');

    if (trimmed === '') {
      return null;
    }

    // Parse base name: must start with a valid identifier character
    const baseMatch = trimmed.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)(.*)/);
    if (!baseMatch) {
      return null;
    }

    const baseName = baseMatch[1];
    const pathStr = baseMatch[2] ?? '';

    const baseValue = context.get(baseName!);
    if (baseValue === null || baseValue === undefined) {
      return baseValue ?? null;
    }

    if (pathStr === '') {
      return baseValue;
    }

    const path = this.parsePath(pathStr);
    return this.traverseProperty(baseValue, path);
  }

  /**
   * Parse a property path string like ".name[0].id" into segments.
   */
  private parsePath(pathStr: string): Array<string | number> {
    const path: Array<string | number> = [];
    let pos = 0;

    while (pos < pathStr.length) {
      const char = pathStr[pos];

      if (char === '.') {
        // Property access
        pos++;
        const propMatch = pathStr.substring(pos).match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
        if (propMatch?.[1]) {
          path.push(propMatch[1]);
          pos += propMatch[1].length;
        } else {
          // Invalid path (e.g., trailing dot) — stop parsing
          break;
        }
      } else if (char === '[') {
        // Array/object index access
        const closeIdx = pathStr.indexOf(']', pos);
        if (closeIdx === -1) {
          break;
        }

        let indexStr = pathStr.substring(pos + 1, closeIdx);

        // Check if numeric
        if (/^\d+$/.test(indexStr)) {
          path.push(parseInt(indexStr, 10));
        } else {
          // Remove surrounding quotes if present
          indexStr = indexStr.replace(/^['"]|['"]$/g, '');
          path.push(indexStr);
        }

        pos = closeIdx + 1;
      } else {
        // Unexpected character — stop
        break;
      }
    }

    return path;
  }

  /**
   * Traverse an object along a property path.
   */
  private traverseProperty(obj: unknown, path: Array<string | number>): unknown {
    let current: unknown = obj;

    for (const segment of path) {
      if (current === null || current === undefined) {
        return null;
      }

      if (typeof segment === 'number') {
        // Array index access
        if (!Array.isArray(current)) {
          return null;
        }
        current = (current as unknown[])[segment];
      } else {
        // Object property access
        if (typeof current !== 'object' || current === null) {
          return null;
        }
        current = (current as Record<string, unknown>)[segment];
      }
    }

    return current;
  }

  /**
   * Convert a value to its string representation for template substitution.
   */
  private valueToString(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[Object]';
      }
    }

    return String(value);
  }
}
