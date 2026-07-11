#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { cac } from 'cac';
import { stringify } from 'yaml';
import { generate } from './generate.js';
import { watchTsconfigSources } from './watch.js';

const cli = cac('ts-route-openapi');

cli
  .command('[tsconfig]', 'Generate an OpenAPI spec from a TS route→controller project')
  .option('-o, --out <file>', 'Output file path', { default: 'openapi.json' })
  .option('-f, --format <fmt>', 'Output format: json | yaml', { default: 'json' })
  .option('--title <title>', 'API title', { default: 'API' })
  .option('--api-version <version>', 'API version', { default: '1.0.0' })
  .option('--descriptions', 'Include JSDoc summaries, descriptions, deprecation, and property descriptions')
  .option('-w, --watch', 'Regenerate when project source files change')
  .action((tsconfig: string | undefined, options: { out: string; format: string; title: string; apiVersion: string; descriptions?: boolean; watch?: boolean }) => {
    if (options.format !== 'json' && options.format !== 'yaml') {
      console.error(`Invalid format "${options.format}": expected "json" or "yaml"`);
      process.exitCode = 1;
      return;
    }

    const tsconfigPath = tsconfig ?? 'tsconfig.json';
    const emit = (): void => {
      const doc = generate(tsconfigPath, {
        title: options.title,
        version: options.apiVersion,
      }, { descriptions: options.descriptions ?? false });
      const serialized = options.format === 'yaml' ? stringify(doc) : `${JSON.stringify(doc, null, 2)}\n`;
      writeFileSync(options.out, serialized);
      console.log(`Wrote ${options.out}`);
    };

    try {
      if (options.watch) {
        watchTsconfigSources(tsconfigPath, emit);
        return;
      }
      emit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to generate OpenAPI spec: ${message}`);
      process.exitCode = 1;
    }
  });

cli.help();
cli.parse();
