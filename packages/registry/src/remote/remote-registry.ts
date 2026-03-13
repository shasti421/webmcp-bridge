/**
 * RemoteRegistry -- HTTP client for the public WebMCP Bridge registry.
 *
 * API endpoints:
 * - GET  /api/apps/search?q=...&tags=...  -> search apps
 * - GET  /api/apps/:id/:version           -> download semantic bundle
 * - POST /api/apps                        -> publish new app (auth required)
 * - GET  /api/apps/:id                    -> app metadata + versions
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface RemoteAppInfo {
  id: string;
  name: string;
  description?: string;
  versions: string[];
  latest: string;
  tags?: string[];
  downloads?: number;
}

export interface RemoteSearchResult {
  id: string;
  name: string;
  description: string;
  [key: string]: unknown;
}

export class RemoteRegistry {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken?: string,
  ) {}

  /**
   * Search for apps on the remote registry.
   */
  async search(query: string, tags?: string[]): Promise<RemoteSearchResult[]> {
    const url = new URL(`${this.baseUrl}/api/apps/search`);
    url.searchParams.set('q', query);
    if (tags && tags.length > 0) {
      url.searchParams.set('tags', tags.join(','));
    }

    const response = await this.fetchWithAuth(url.toString(), { method: 'GET' });

    if (!response.ok) {
      throw new Error(
        `Search failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { results: RemoteSearchResult[]; count: number };
    return data.results;
  }

  /**
   * Pull (download) an app bundle from the remote registry.
   * Returns the path to the downloaded file.
   */
  async pull(appId: string, version?: string): Promise<string> {
    const targetVersion = version ?? 'latest';
    const url = `${this.baseUrl}/api/apps/${appId}/${targetVersion}`;

    const response = await this.fetchWithAuth(url, { method: 'GET' });

    if (!response.ok) {
      throw new Error(
        `App not found on remote registry: ${response.status} ${response.statusText}`,
      );
    }

    const buffer = await response.arrayBuffer();

    // Save to temp directory
    const tmpDir = path.join(
      os.tmpdir(),
      `webmcp-bridge-${appId}-${targetVersion}-${Date.now()}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, `${appId}-${targetVersion}.tar.gz`);
    fs.writeFileSync(filePath, Buffer.from(buffer));

    return filePath;
  }

  /**
   * Publish an app bundle to the remote registry.
   * Requires authentication.
   */
  async publish(
    appId: string,
    version: string,
    bundlePath: string,
  ): Promise<void> {
    if (!this.authToken) {
      throw new Error(
        'Authentication required for publish. Set auth token.',
      );
    }

    const bundleContent = fs.readFileSync(bundlePath);

    const response = await this.fetchWithAuth(`${this.baseUrl}/api/apps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-App-ID': appId,
        'X-Version': version,
      },
      body: bundleContent,
    });

    if (!response.ok) {
      throw new Error(
        `Publish failed: ${response.status} ${response.statusText}`,
      );
    }
  }

  /**
   * Get metadata for a specific app from the remote registry.
   */
  async getAppInfo(appId: string): Promise<RemoteAppInfo> {
    const url = `${this.baseUrl}/api/apps/${appId}`;

    const response = await this.fetchWithAuth(url, { method: 'GET' });

    if (!response.ok) {
      throw new Error(
        `App not found: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as RemoteAppInfo;
  }

  // ─── Private helpers ──────────────────────────────────────

  private async fetchWithAuth(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    try {
      return await fetch(url, {
        ...options,
        headers,
      });
    } catch (error) {
      throw new Error(
        `Network error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
