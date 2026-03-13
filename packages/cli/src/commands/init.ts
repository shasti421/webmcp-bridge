/**
 * init command — scaffold a new semantic definition directory.
 *
 * Usage: webmcp-bridge init my-app --url https://app.example.com --name "My App"
 *
 * Creates:
 *   my-app/
 *     app.yaml          (pre-filled with app id, name, base_url)
 *     pages/.gitkeep
 *     tools/.gitkeep
 *     workflows/.gitkeep
 */

import fs from 'node:fs';
import path from 'node:path';

export interface InitOptions {
  /** App display name. Defaults to appId. */
  name?: string;
  /** Base URL. Defaults to https://example.com. */
  url?: string;
  /** Output directory. Defaults to process.cwd(). */
  outputDir?: string;
}

function generateAppYaml(appId: string, options: InitOptions): string {
  const name = options.name ?? appId;
  const baseUrl = options.url ?? 'https://example.com';

  return `id: ${appId}
name: ${name}
base_url: ${baseUrl}
url_patterns:
  - ${baseUrl}/**

description: Description of your app
version: 1.0.0

auth:
  type: browser_session

registry:
  publisher: Your Name
  tags:
    - productivity
  license: MIT
`;
}

export async function initCommand(appId: string, options: InitOptions = {}): Promise<void> {
  const outputDir = options.outputDir ?? process.cwd();
  const appDir = path.join(outputDir, appId);

  // Check if directory already exists
  if (fs.existsSync(appDir)) {
    throw new Error(`Directory '${appId}' already exists at ${appDir}`);
  }

  // Create directory structure
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(path.join(appDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'workflows'), { recursive: true });

  // Write app.yaml
  const appYaml = generateAppYaml(appId, options);
  fs.writeFileSync(path.join(appDir, 'app.yaml'), appYaml, 'utf-8');

  // Write .gitkeep files
  fs.writeFileSync(path.join(appDir, 'pages', '.gitkeep'), '', 'utf-8');
  fs.writeFileSync(path.join(appDir, 'tools', '.gitkeep'), '', 'utf-8');
  fs.writeFileSync(path.join(appDir, 'workflows', '.gitkeep'), '', 'utf-8');
}
