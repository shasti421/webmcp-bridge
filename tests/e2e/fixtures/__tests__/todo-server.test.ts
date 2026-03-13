import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

import { createTodoServer, type TodoServer } from '../todo-server.js';

function request(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method ?? 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        let body: unknown;
        try {
          body = JSON.parse(data);
        } catch {
          body = data;
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

describe('TodoServer', () => {
  let server: TodoServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = createTodoServer();
    const port = await server.start(0); // random port
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('programmatic start/stop', () => {
    it('starts on a random port when 0 is passed', () => {
      expect(server.port).toBeGreaterThan(0);
    });

    it('can be started and stopped multiple times', async () => {
      const server2 = createTodoServer();
      const port2 = await server2.start(0);
      expect(port2).toBeGreaterThan(0);
      await server2.stop();
    });
  });

  describe('static HTML serving', () => {
    it('serves index.html at /', async () => {
      const res = await request(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('string');
      expect(res.body as string).toContain('<title>Todo App</title>');
    });

    it('serves app.js', async () => {
      const res = await request(`${baseUrl}/app.js`);
      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('string');
      expect(res.body as string).toContain('todo');
    });

    it('returns 404 for unknown static files', async () => {
      const res = await request(`${baseUrl}/nonexistent.html`);
      expect(res.status).toBe(404);
    });
  });

  describe('API: GET /api/todos', () => {
    it('returns initial seed todos', async () => {
      const res = await request(`${baseUrl}/api/todos`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const todos = res.body as Array<{ id: number; title: string; completed: boolean }>;
      expect(todos.length).toBeGreaterThanOrEqual(2);
      expect(todos[0]).toHaveProperty('id');
      expect(todos[0]).toHaveProperty('title');
      expect(todos[0]).toHaveProperty('completed');
    });
  });

  describe('API: POST /api/todos', () => {
    it('creates a new todo', async () => {
      const res = await request(`${baseUrl}/api/todos`, {
        method: 'POST',
        body: { title: 'Test todo' },
      });
      expect(res.status).toBe(200);
      const todo = res.body as { id: number; title: string; completed: boolean };
      expect(todo.title).toBe('Test todo');
      expect(todo.completed).toBe(false);
      expect(todo.id).toBeDefined();
    });

    it('new todo appears in list', async () => {
      const res = await request(`${baseUrl}/api/todos`);
      const todos = res.body as Array<{ title: string }>;
      expect(todos.some(t => t.title === 'Test todo')).toBe(true);
    });
  });

  describe('API: PUT /api/todos/:id', () => {
    it('updates a todo title', async () => {
      const listRes = await request(`${baseUrl}/api/todos`);
      const todos = listRes.body as Array<{ id: number }>;
      const firstId = todos[0]?.id;

      const res = await request(`${baseUrl}/api/todos/${firstId}`, {
        method: 'PUT',
        body: { title: 'Updated title' },
      });
      expect(res.status).toBe(200);
      const todo = res.body as { title: string };
      expect(todo.title).toBe('Updated title');
    });

    it('toggles completion status', async () => {
      const listRes = await request(`${baseUrl}/api/todos`);
      const todos = listRes.body as Array<{ id: number; completed: boolean }>;
      const todo = todos[0]!;

      const res = await request(`${baseUrl}/api/todos/${todo.id}`, {
        method: 'PUT',
        body: { completed: !todo.completed },
      });
      expect(res.status).toBe(200);
      const updated = res.body as { completed: boolean };
      expect(updated.completed).toBe(!todo.completed);
    });
  });

  describe('API: DELETE /api/todos/:id', () => {
    it('deletes a todo', async () => {
      const listRes = await request(`${baseUrl}/api/todos`);
      const todos = listRes.body as Array<{ id: number }>;
      const countBefore = todos.length;
      const firstId = todos[0]?.id;

      const res = await request(`${baseUrl}/api/todos/${firstId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect((res.body as { ok: boolean }).ok).toBe(true);

      const listRes2 = await request(`${baseUrl}/api/todos`);
      const todosAfter = listRes2.body as Array<{ id: number }>;
      expect(todosAfter.length).toBe(countBefore - 1);
    });
  });

  describe('HTML matches semantic definitions', () => {
    it('has input.new-todo with aria role', async () => {
      const res = await request(`${baseUrl}/`);
      const html = res.body as string;
      expect(html).toContain('class="new-todo"');
      expect(html).toContain('aria-label="New Todo"');
    });

    it('has button.add-todo with aria label', async () => {
      const res = await request(`${baseUrl}/`);
      const html = res.body as string;
      expect(html).toContain('class="add-todo"');
      expect(html).toContain('aria-label="Add"');
    });

    it('has .todo-list container', async () => {
      const res = await request(`${baseUrl}/`);
      const html = res.body as string;
      expect(html).toContain('class="todo-list"');
    });

    it('has .todo-count status element', async () => {
      const res = await request(`${baseUrl}/`);
      const html = res.body as string;
      expect(html).toContain('class="todo-count"');
    });
  });

  describe('reset()', () => {
    it('resets todos to initial seed data', async () => {
      // Add some extra todos
      await request(`${baseUrl}/api/todos`, {
        method: 'POST',
        body: { title: 'extra 1' },
      });

      server.reset();

      const res = await request(`${baseUrl}/api/todos`);
      const todos = res.body as Array<{ title: string }>;
      expect(todos.length).toBe(2);
      expect(todos.some(t => t.title === 'extra 1')).toBe(false);
    });
  });
});
