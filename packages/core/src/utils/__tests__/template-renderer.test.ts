import { describe, it, expect } from 'vitest';

import { TemplateRenderer } from '../template-renderer.js';

describe('TemplateRenderer', () => {
  const renderer = new TemplateRenderer();

  describe('render()', () => {
    it('simple variable substitution', () => {
      const ctx = new Map<string, unknown>([['name', 'Alice']]);
      expect(renderer.render('Hello {{name}}', ctx)).toBe('Hello Alice');
    });

    it('multiple variables', () => {
      const ctx = new Map<string, unknown>([
        ['greeting', 'Hi'],
        ['name', 'Alice'],
        ['age', 30],
      ]);
      expect(renderer.render('{{greeting}} {{name}}, you are {{age}} years old', ctx))
        .toBe('Hi Alice, you are 30 years old');
    });

    it('nested property access', () => {
      const ctx = new Map<string, unknown>([
        ['user', { profile: { name: 'Alice' } }],
      ]);
      expect(renderer.render('User: {{user.profile.name}}', ctx)).toBe('User: Alice');
    });

    it('array index access', () => {
      const ctx = new Map<string, unknown>([['items', ['a', 'b', 'c']]]);
      expect(renderer.render('First item: {{items[0]}}', ctx)).toBe('First item: a');
    });

    it('array element with property', () => {
      const ctx = new Map<string, unknown>([['items', [{ id: 42 }]]]);
      expect(renderer.render('ID: {{items[0].id}}', ctx)).toBe('ID: 42');
    });

    it('missing variable replaced with empty string', () => {
      const ctx = new Map<string, unknown>();
      expect(renderer.render('User: {{user}}', ctx)).toBe('User: ');
    });

    it('null property access replaced with empty string', () => {
      const ctx = new Map<string, unknown>([['user', null]]);
      expect(renderer.render('Name: {{user.name}}', ctx)).toBe('Name: ');
    });

    it('out-of-bounds array index replaced with empty string', () => {
      const ctx = new Map<string, unknown>([['items', ['a', 'b']]]);
      expect(renderer.render('Item: {{items[5]}}', ctx)).toBe('Item: ');
    });

    it('bracket notation with string key', () => {
      const ctx = new Map<string, unknown>([['config', { api_key: 'secret123' }]]);
      expect(renderer.render('{{config["api_key"]}}', ctx)).toBe('secret123');
    });

    it('bracket notation with single quotes', () => {
      const ctx = new Map<string, unknown>([['config', { 'api-key': 'secret' }]]);
      expect(renderer.render("{{config['api-key']}}", ctx)).toBe('secret');
    });

    it('object value rendered as JSON', () => {
      const ctx = new Map<string, unknown>([['metadata', { type: 'user', id: 42 }]]);
      expect(renderer.render('Data: {{metadata}}', ctx)).toBe('Data: {"type":"user","id":42}');
    });

    it('boolean false rendered as "false"', () => {
      const ctx = new Map<string, unknown>([['isActive', false]]);
      expect(renderer.render('Active: {{isActive}}', ctx)).toBe('Active: false');
    });

    it('boolean true rendered as "true"', () => {
      const ctx = new Map<string, unknown>([['isActive', true]]);
      expect(renderer.render('Active: {{isActive}}', ctx)).toBe('Active: true');
    });

    it('empty template expression replaced with empty string', () => {
      const ctx = new Map<string, unknown>();
      expect(renderer.render('Value: {{}}', ctx)).toBe('Value: ');
    });

    it('whitespace in expression is trimmed', () => {
      const ctx = new Map<string, unknown>([['user', { name: 'Alice' }]]);
      expect(renderer.render('{{ user . name }}', ctx)).toBe('Alice');
    });

    it('non-string input returned as-is', () => {
      const ctx = new Map<string, unknown>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(renderer.render(42 as any, ctx)).toBe(42);
    });

    it('template with no expressions returned unchanged', () => {
      const ctx = new Map<string, unknown>([['name', 'Alice']]);
      expect(renderer.render('Hello World', ctx)).toBe('Hello World');
    });

    it('URL construction', () => {
      const ctx = new Map<string, unknown>([['userId', '123']]);
      expect(renderer.render('https://example.com/user/{{userId}}', ctx))
        .toBe('https://example.com/user/123');
    });

    it('same variable used multiple times', () => {
      const ctx = new Map<string, unknown>([['x', 'A']]);
      expect(renderer.render('{{x}}-{{x}}-{{x}}', ctx)).toBe('A-A-A');
    });

    it('array value rendered as JSON', () => {
      const ctx = new Map<string, unknown>([['items', [1, 2, 3]]]);
      expect(renderer.render('Items: {{items}}', ctx)).toBe('Items: [1,2,3]');
    });

    it('undefined value replaced with empty string', () => {
      const ctx = new Map<string, unknown>([['val', undefined]]);
      expect(renderer.render('Value: {{val}}', ctx)).toBe('Value: ');
    });

    it('handles circular references gracefully', () => {
      const obj: Record<string, unknown> = { name: 'test' };
      obj['self'] = obj;
      const ctx = new Map<string, unknown>([['obj', obj]]);
      expect(renderer.render('Data: {{obj}}', ctx)).toBe('Data: [Object]');
    });
  });

  describe('renderObject()', () => {
    it('renders strings in object values', () => {
      const obj = { url: '/api/{{version}}/users/{{userId}}', page: 1 };
      const ctx = new Map<string, unknown>([['version', 'v1'], ['userId', '123']]);
      const result = renderer.renderObject(obj, ctx);
      expect(result).toEqual({ url: '/api/v1/users/123', page: 1 });
    });

    it('renders nested objects', () => {
      const obj = {
        url: '/api/{{version}}/users/{{userId}}',
        headers: { auth: 'Bearer {{token}}' },
      };
      const ctx = new Map<string, unknown>([
        ['version', 'v1'],
        ['userId', '123'],
        ['token', 'abc'],
      ]);
      const result = renderer.renderObject(obj, ctx);
      expect(result).toEqual({
        url: '/api/v1/users/123',
        headers: { auth: 'Bearer abc' },
      });
    });

    it('renders arrays', () => {
      const obj = [{ name: '{{user1}}' }, { name: '{{user2}}' }];
      const ctx = new Map<string, unknown>([['user1', 'Alice'], ['user2', 'Bob']]);
      const result = renderer.renderObject(obj, ctx);
      expect(result).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
    });

    it('preserves primitives', () => {
      const ctx = new Map<string, unknown>();
      expect(renderer.renderObject(42, ctx)).toBe(42);
      expect(renderer.renderObject(true, ctx)).toBe(true);
      expect(renderer.renderObject(null, ctx)).toBe(null);
      expect(renderer.renderObject(undefined, ctx)).toBe(undefined);
    });

    it('renders mixed arrays', () => {
      const obj = ['Item {{id}}', { name: '{{title}}' }];
      const ctx = new Map<string, unknown>([['id', 42], ['title', 'Widget']]);
      const result = renderer.renderObject(obj, ctx);
      expect(result).toEqual(['Item 42', { name: 'Widget' }]);
    });
  });

  describe('evaluateCondition()', () => {
    it('true boolean evaluates to true', () => {
      const ctx = new Map<string, unknown>([['isActive', true]]);
      expect(renderer.evaluateCondition('{{isActive}}', ctx)).toBe(true);
    });

    it('false boolean evaluates to false', () => {
      const ctx = new Map<string, unknown>([['isActive', false]]);
      expect(renderer.evaluateCondition('{{isActive}}', ctx)).toBe(false);
    });

    it('missing variable evaluates to false', () => {
      const ctx = new Map<string, unknown>();
      expect(renderer.evaluateCondition('{{isActive}}', ctx)).toBe(false);
    });

    it('non-empty string evaluates to true', () => {
      const ctx = new Map<string, unknown>([['status', 'pending']]);
      expect(renderer.evaluateCondition('{{status}}', ctx)).toBe(true);
    });

    it('empty string evaluates to false', () => {
      const ctx = new Map<string, unknown>([['name', '']]);
      expect(renderer.evaluateCondition('{{name}}', ctx)).toBe(false);
    });

    it('zero evaluates to false', () => {
      const ctx = new Map<string, unknown>([['count', 0]]);
      expect(renderer.evaluateCondition('{{count}}', ctx)).toBe(false);
    });

    it('non-zero number evaluates to true', () => {
      const ctx = new Map<string, unknown>([['count', 5]]);
      expect(renderer.evaluateCondition('{{count}}', ctx)).toBe(true);
    });

    it('null evaluates to false', () => {
      const ctx = new Map<string, unknown>([['user', null]]);
      expect(renderer.evaluateCondition('{{user}}', ctx)).toBe(false);
    });

    it('array evaluates to true (even empty)', () => {
      const ctx = new Map<string, unknown>([['items', []]]);
      expect(renderer.evaluateCondition('{{items}}', ctx)).toBe(true);
    });

    it('object evaluates to true', () => {
      const ctx = new Map<string, unknown>([['obj', {}]]);
      expect(renderer.evaluateCondition('{{obj}}', ctx)).toBe(true);
    });

    it('"null" string evaluates to false', () => {
      const ctx = new Map<string, unknown>();
      // Missing var renders to empty, which is falsy
      expect(renderer.evaluateCondition('{{missing}}', ctx)).toBe(false);
    });
  });
});
