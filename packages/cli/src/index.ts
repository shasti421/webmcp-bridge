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
import { publishCommand } from './commands/publish.js';
import { pullCommand } from './commands/pull.js';
import { validateCommand } from './commands/validate.js';

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
  .action(async (dirPath: string, options: { strict?: boolean; verbose?: boolean }) => {
    try {
      const result = await validateCommand(dirPath);

      if (result.valid) {
        // eslint-disable-next-line no-console
        console.log(`Validating: ${dirPath}\n`);
        // eslint-disable-next-line no-console
        console.log(`Summary: ${result.fileCount} files validated, 0 errors, ${result.warnings.length} warnings`);
        // eslint-disable-next-line no-console
        console.log(`  Apps: ${result.summary.apps}, Pages: ${result.summary.pages}, Tools: ${result.summary.tools}, Workflows: ${result.summary.workflows}`);
      } else {
        console.error(`Validation failed:\n`);
        for (const error of result.errors) {
          console.error(`  - ${error}`);
        }
        if (options.verbose) {
          console.error(`\nFiles scanned: ${result.fileCount}`);
        }
        process.exit(3);
      }

      if (options.strict && result.warnings.length > 0) {
        console.error(`\nWarnings (--strict mode):`);
        for (const warning of result.warnings) {
          console.error(`  - ${warning}`);
        }
        process.exit(3);
      }
    } catch (e: unknown) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program
  .command('publish')
  .argument('[path]', 'Path to app directory', '.')
  .requiredOption('--app <id>', 'Application ID')
  .requiredOption('--version <version>', 'Semantic version')
  .option('--registry <url>', 'Remote registry URL')
  .option('--dry-run', 'Validate without publishing')
  .description('Publish app to registry')
  .action(async (appPath: string, options: { app: string; version: string; registry?: string; dryRun?: boolean }) => {
    try {
      const result = await publishCommand(appPath, {
        appId: options.app,
        version: options.version,
        registryUrl: options.registry,
      });

      if (result.success) {
        // eslint-disable-next-line no-console
        console.log(`Published: ${options.app}@${options.version}`);
      } else {
        console.error(`Publish failed: ${result.error}`);
        process.exit(1);
      }
    } catch (e: unknown) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program
  .command('pull')
  .argument('<app-id>', 'Application ID to pull')
  .option('--version <version>', 'Semantic version', 'latest')
  .option('--registry <url>', 'Remote registry URL')
  .option('--source <path>', 'Local source path (instead of remote)')
  .description('Install app from registry')
  .action(async (appId: string, options: { version: string; registry?: string; source?: string }) => {
    try {
      const result = await pullCommand({
        appId,
        version: options.version,
        sourcePath: options.source,
        registryUrl: options.registry,
      });

      if (result.success) {
        // eslint-disable-next-line no-console
        console.log(`Installed: ${appId}@${options.version}`);
        if (result.installPath) {
          // eslint-disable-next-line no-console
          console.log(`  Path: ${result.installPath}`);
        }
      } else {
        console.error(`Pull failed: ${result.error}`);
        process.exit(1);
      }
    } catch (e: unknown) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program.parse();
