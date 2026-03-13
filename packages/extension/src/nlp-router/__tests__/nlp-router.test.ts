import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  routeUserCommand,
  buildToolSelectionPrompt,
  parseRouterResponse,
  type NlpRouterConfig,
  type ToolSummary,
} from '../index.js';

// ─── Test data ─────────────────────────────────────────

const sampleTools: ToolSummary[] = [
  {
    name: 'create_todo',
    description: 'Create a new todo item',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Todo title' },
        priority: { type: 'string', description: 'Priority level', enum: ['low', 'medium', 'high'] },
      },
      required: ['title'],
    },
  },
  {
    name: 'delete_todo',
    description: 'Delete a todo item by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Todo ID' },
      },
      required: ['id'],
    },
  },
];

const defaultConfig: NlpRouterConfig = {
  bridgeApiUrl: 'http://localhost:3000',
};

// ─── Tests ─────────────────────────────────────────────

describe('NLP Router', () => {
  describe('buildToolSelectionPrompt', () => {
    it('includes user command in the prompt', () => {
      const prompt = buildToolSelectionPrompt('create a task called Buy Milk', sampleTools);
      expect(prompt).toContain('create a task called Buy Milk');
    });

    it('includes tool names and descriptions', () => {
      const prompt = buildToolSelectionPrompt('do something', sampleTools);
      expect(prompt).toContain('create_todo');
      expect(prompt).toContain('Create a new todo item');
      expect(prompt).toContain('delete_todo');
      expect(prompt).toContain('Delete a todo item by ID');
    });

    it('includes input schema info', () => {
      const prompt = buildToolSelectionPrompt('do something', sampleTools);
      expect(prompt).toContain('title');
      expect(prompt).toContain('priority');
    });

    it('instructs LLM to respond with JSON', () => {
      const prompt = buildToolSelectionPrompt('do something', sampleTools);
      expect(prompt).toContain('JSON');
    });
  });

  describe('parseRouterResponse', () => {
    it('parses valid JSON response', () => {
      const response = '{"toolName": "create_todo", "inputs": {"title": "Buy Milk"}}';
      const result = parseRouterResponse(response);
      expect(result).toEqual({ toolName: 'create_todo', inputs: { title: 'Buy Milk' } });
    });

    it('parses response with markdown code block', () => {
      const response = '```json\n{"toolName": "create_todo", "inputs": {"title": "Test"}}\n```';
      const result = parseRouterResponse(response);
      expect(result).toEqual({ toolName: 'create_todo', inputs: { title: 'Test' } });
    });

    it('returns null for invalid JSON', () => {
      const result = parseRouterResponse('not valid json');
      expect(result).toBeNull();
    });

    it('returns null for JSON missing required fields', () => {
      const result = parseRouterResponse('{"foo": "bar"}');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = parseRouterResponse('');
      expect(result).toBeNull();
    });

    it('handles JSON embedded in surrounding text', () => {
      const response = 'Here is my response: {"toolName": "delete_todo", "inputs": {"id": "abc123"}} Hope that helps!';
      const result = parseRouterResponse(response);
      expect(result).toEqual({ toolName: 'delete_todo', inputs: { id: 'abc123' } });
    });
  });

  describe('routeUserCommand', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
    });

    it('sends request to bridge API NLP endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          toolName: 'create_todo',
          inputs: { title: 'Buy Milk' },
        }),
      });

      await routeUserCommand('create a task called Buy Milk', sampleTools, defaultConfig, mockFetch);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/nlp/route',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('returns routing result on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          toolName: 'create_todo',
          inputs: { title: 'Buy Milk' },
        }),
      });

      const result = await routeUserCommand('create a task called Buy Milk', sampleTools, defaultConfig, mockFetch);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.toolName).toBe('create_todo');
        expect(result.value.inputs).toEqual({ title: 'Buy Milk' });
      }
    });

    it('returns error on API failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await routeUserCommand('create task', sampleTools, defaultConfig, mockFetch);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Network error');
      }
    });

    it('returns error on non-ok API response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await routeUserCommand('create task', sampleTools, defaultConfig, mockFetch);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('500');
      }
    });

    it('includes tools in request body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          toolName: 'create_todo',
          inputs: { title: 'Test' },
        }),
      });

      await routeUserCommand('create task Test', sampleTools, defaultConfig, mockFetch);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(requestBody).toHaveProperty('prompt');
      expect(requestBody).toHaveProperty('tools');
      expect(requestBody.tools).toHaveLength(2);
    });

    it('handles empty tools list', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          toolName: '',
          inputs: {},
        }),
      });

      const result = await routeUserCommand('do something', [], defaultConfig, mockFetch);

      expect(result.ok).toBe(true);
    });
  });
});
