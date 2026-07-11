import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadProject } from '../src/project-loader.js';

test('loadProject loads source files from a tsconfig', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trotest-'));
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }),
  );
  writeFileSync(join(dir, 'app.ts'), 'export const x: number = 1;\n');

  const project = loadProject(join(dir, 'tsconfig.json'));

  const files = project.getSourceFiles().map((f) => f.getBaseName());
  expect(files).toContain('app.ts');
});
