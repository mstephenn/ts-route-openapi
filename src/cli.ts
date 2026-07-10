#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { cac } from 'cac';
import { stringify } from 'yaml';
import { generate } from './generate.js';

const cli = cac('ts-route-openapi');

cli
  .command('[tsconfig]', 'Generate an OpenAPI spec from a TS route→controller project')
  .option('-o, --out <file>', 'Output file path', { default: 'openapi.json' })
  .option('-f, --format <fmt>', 'Output format: json | yaml', { default: 'json' })
  .option('--title <title>', 'API title', { default: 'API' })
  .option('--api-version <version>', 'API version', { default: '1.0.0' })
  .action((tsconfig: string | undefined, options: { out: string; format: string; title: string; apiVersion: string }) => {
    const doc = generate(tsconfig ?? 'tsconfig.json', {
      title: options.title,
      version: options.apiVersion,
    });
    const serialized = options.format === 'yaml' ? stringify(doc) : `${JSON.stringify(doc, null, 2)}\n`;
    writeFileSync(options.out, serialized);
    console.log(`Wrote ${options.out}`);
  });

cli.help();
cli.parse();
