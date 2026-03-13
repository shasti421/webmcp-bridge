/**
 * E2E Test Fixture: Todo App Server
 *
 * A simple Node HTTP server that serves an HTML todo application
 * matching the semantic definitions in semantic-examples/demo-todo-app/.
 *
 * Can be started/stopped programmatically for E2E tests.
 *
 * Usage:
 *   const server = createTodoServer();
 *   const port = await server.start(3000);
 *   // ... run tests ...
 *   await server.stop();
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

interface Todo {
  id: number;
  title: string;
  completed: boolean;
}

export interface TodoServer {
  /** Start listening. Pass 0 for a random available port. Returns the actual port. */
  start(port: number): Promise<number>;
  /** Stop the server. */
  stop(): Promise<void>;
  /** Reset todos to initial seed data. */
  reset(): void;
  /** The port the server is listening on, or 0 if not started. */
  readonly port: number;
}

const SEED_TODOS: Todo[] = [
  { id: 1, title: 'Buy milk', completed: false },
  { id: 2, title: 'Walk dog', completed: true },
];

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

export function createTodoServer(): TodoServer {
  let todos: Todo[] = JSON.parse(JSON.stringify(SEED_TODOS));
  let nextId = 100;
  let httpServer: http.Server | null = null;
  let currentPort = 0;

  function reset(): void {
    todos = JSON.parse(JSON.stringify(SEED_TODOS)) as Todo[];
    nextId = 100;
  }

  function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  function serveStatic(res: http.ServerResponse, urlPath: string): void {
    const publicDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');
    const filePath = urlPath === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, urlPath);

    // Prevent directory traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(publicDir))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      const ext = path.extname(resolved);
      const contentType = MIME_TYPES[ext] ?? 'text/plain';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // CORS headers for flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (url === '/api/todos' && method === 'GET') {
      sendJson(res, 200, todos);
      return;
    }

    if (url === '/api/todos' && method === 'POST') {
      const rawBody = await readBody(req);
      const body = JSON.parse(rawBody) as { title?: string };
      const todo: Todo = {
        id: nextId++,
        title: body.title ?? '',
        completed: false,
      };
      todos.push(todo);
      sendJson(res, 200, todo);
      return;
    }

    const putMatch = url.match(/^\/api\/todos\/(\d+)$/);
    if (putMatch && method === 'PUT') {
      const id = parseInt(putMatch[1]!, 10);
      const rawBody = await readBody(req);
      const body = JSON.parse(rawBody) as { title?: string; completed?: boolean };
      const todo = todos.find(t => t.id === id);
      if (todo) {
        if (body.title !== undefined) todo.title = body.title;
        if (body.completed !== undefined) todo.completed = body.completed;
        sendJson(res, 200, todo);
      } else {
        sendJson(res, 404, { error: 'Not found' });
      }
      return;
    }

    const deleteMatch = url.match(/^\/api\/todos\/(\d+)$/);
    if (deleteMatch && method === 'DELETE') {
      const id = parseInt(deleteMatch[1]!, 10);
      todos = todos.filter(t => t.id !== id);
      sendJson(res, 200, { ok: true });
      return;
    }

    // Static files
    serveStatic(res, url);
  }

  return {
    start(port: number): Promise<number> {
      return new Promise((resolve, reject) => {
        httpServer = http.createServer((req, res) => {
          handleRequest(req, res).catch((e: unknown) => {
            res.writeHead(500);
            res.end(String(e));
          });
        });

        httpServer.listen(port, () => {
          const addr = httpServer!.address();
          if (typeof addr === 'object' && addr !== null) {
            currentPort = addr.port;
          }
          resolve(currentPort);
        });

        httpServer.on('error', reject);
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!httpServer) {
          resolve();
          return;
        }
        httpServer.close((err) => {
          if (err) reject(err);
          else {
            currentPort = 0;
            resolve();
          }
        });
      });
    },

    reset,

    get port() {
      return currentPort;
    },
  };
}
