import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { RemoteRegistry } from '../remote-registry.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('RemoteRegistry', () => {
  let registry: RemoteRegistry;
  let tmpDir: string;

  beforeEach(() => {
    registry = new RemoteRegistry('https://registry.example.com', 'test-token');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-remote-test-'));
    mockFetch.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── search ──────────────────────────────────────────────

  describe('search', () => {
    it('sends GET request to search endpoint with query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], count: 0 }),
      });

      await registry.search('todo');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.example.com/api/apps/search?q=todo',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('includes tags in search query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], count: 0 }),
      });

      await registry.search('todo', ['productivity', 'web']);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.example.com/api/apps/search?q=todo&tags=productivity%2Cweb',
        expect.anything(),
      );
    });

    it('returns search results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { id: 'todo_app', name: 'Todo App', description: 'A todo app' },
          ],
          count: 1,
        }),
      });

      const results = await registry.search('todo');
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: 'todo_app',
        name: 'Todo App',
        description: 'A todo app',
      });
    });

    it('throws on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(registry.search('todo')).rejects.toThrow(/network error/i);
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(registry.search('todo')).rejects.toThrow(/500/);
    });
  });

  // ─── pull ────────────────────────────────────────────────

  describe('pull', () => {
    it('sends GET request to download endpoint', async () => {
      const fakeBuffer = new ArrayBuffer(10);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeBuffer,
      });

      await registry.pull('my_app', '1.0.0');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.example.com/api/apps/my_app/1.0.0',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('returns path to downloaded content', async () => {
      const fakeBuffer = new ArrayBuffer(10);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeBuffer,
      });

      const result = await registry.pull('my_app', '1.0.0');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('throws on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(registry.pull('nonexistent', '1.0.0')).rejects.toThrow(
        /not found|404/i,
      );
    });

    it('uses latest when no version specified', async () => {
      const fakeBuffer = new ArrayBuffer(10);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeBuffer,
      });

      await registry.pull('my_app');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.example.com/api/apps/my_app/latest',
        expect.anything(),
      );
    });
  });

  // ─── publish ─────────────────────────────────────────────

  describe('publish', () => {
    it('sends POST request with bundle', async () => {
      // Create a simple file to publish
      const bundlePath = path.join(tmpDir, 'bundle.tar.gz');
      fs.writeFileSync(bundlePath, 'fake-bundle-content');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ success: true }),
      });

      await registry.publish('my_app', '1.0.0', bundlePath);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.example.com/api/apps',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'X-App-ID': 'my_app',
            'X-Version': '1.0.0',
          }),
        }),
      );
    });

    it('throws when auth token is missing', async () => {
      const noAuthRegistry = new RemoteRegistry(
        'https://registry.example.com',
      );
      const bundlePath = path.join(tmpDir, 'bundle.tar.gz');
      fs.writeFileSync(bundlePath, 'fake');

      await expect(
        noAuthRegistry.publish('my_app', '1.0.0', bundlePath),
      ).rejects.toThrow(/auth/i);
    });

    it('throws on publish failure', async () => {
      const bundlePath = path.join(tmpDir, 'bundle.tar.gz');
      fs.writeFileSync(bundlePath, 'fake');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(
        registry.publish('my_app', '1.0.0', bundlePath),
      ).rejects.toThrow(/403|forbidden/i);
    });
  });

  // ─── getAppInfo ──────────────────────────────────────────

  describe('getAppInfo', () => {
    it('fetches app metadata from remote', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'my_app',
          name: 'My App',
          versions: ['1.0.0'],
          latest: '1.0.0',
        }),
      });

      const info = await registry.getAppInfo('my_app');
      expect(info).toEqual({
        id: 'my_app',
        name: 'My App',
        versions: ['1.0.0'],
        latest: '1.0.0',
      });
    });

    it('throws on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(registry.getAppInfo('nonexistent')).rejects.toThrow(
        /not found|404/i,
      );
    });
  });

  // ─── constructor ─────────────────────────────────────────

  describe('constructor', () => {
    it('stores base URL', () => {
      const r = new RemoteRegistry('https://example.com');
      expect(r).toBeDefined();
    });

    it('optionally accepts auth token', () => {
      const r = new RemoteRegistry('https://example.com', 'my-token');
      expect(r).toBeDefined();
    });
  });
});
