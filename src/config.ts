import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type SecurityRequirement = Record<string, string[]>;

export interface SecurityOverride {
  method?: string;
  path: string;
  security: SecurityRequirement[];
}

export interface GeneratorConfig {
  securitySchemes?: Record<string, Record<string, unknown>>;
  security?: SecurityRequirement[];
  securityOverrides?: SecurityOverride[];
  publicDecorator?: string;
}

const CONFIG_FILE = 'ts-route-openapi.config.json';

export function loadConfig(tsconfigPath: string): GeneratorConfig | undefined {
  const candidates = [resolve(dirname(tsconfigPath), CONFIG_FILE), resolve(CONFIG_FILE)];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    return JSON.parse(readFileSync(candidate, 'utf8')) as GeneratorConfig;
  }
  return undefined;
}
