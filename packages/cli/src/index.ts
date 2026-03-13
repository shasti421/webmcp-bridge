#!/usr/bin/env node
/**
 * WebMCP Bridge CLI
 *
 * Commands:
 *   validate <path>     Validate semantic YAML definitions against schema
 *   test <path>         Run tool definitions against test fixtures
 *   publish <path>      Publish semantic definitions to registry
 *   pull <app-id>       Pull definitions from registry to local
 *   list                List locally installed semantic definitions
 *   search <query>      Search the public registry
 *   init <app-id>       Initialize a new semantic definition directory
 */

import { Command } from 'commander';

import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('webmcp-bridge')
  .description('Make any web application behave as if it had native WebMCP tools')
  .version('0.1.0');

program
  .command('init')
  .argument('<app-id>', 'Application identifier (snake_case)')
  .option('--name <name>', 'Application display name')
  .option('--url <url>', 'Base URL of the application')
  .description('Initialize a new semantic definition directory')
  .action(async (appId: string, options: { name?: string; url?: string }) => {
    try {
      await initCommand(appId, { name: options.name, url: options.url });
      // eslint-disable-next-line no-console
      console.log(`Creating app structure...`);
      // eslint-disable-next-line no-console
      console.log(`  app.yaml`);
      // eslint-disable-next-line no-console
      console.log(`  pages/`);
      // eslint-disable-next-line no-console
      console.log(`  tools/`);
      // eslint-disable-next-line no-console
      console.log(`  workflows/`);
      // eslint-disable-next-line no-console
      console.log(`\nEdit app.yaml and add pages, tools, and workflows.`);
      // eslint-disable-next-line no-console
      console.log(`Run 'webmcp-bridge validate' to check your work.`);
    } catch (e: unknown) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program
  .command('validate')
  .argument('[path]', 'Path to app directory', '.')
  .option('--strict', 'Fail on warnings')
  .option('--verbose', 'Detailed output')
  .description('Validate YAML files in a directory against schemas')
  .action((_path: string, _options: { strict?: boolean; verbose?: boolean }) => {
    console.error('validate command: not yet implemented');
    process.exit(1);
  });

program.parse();
