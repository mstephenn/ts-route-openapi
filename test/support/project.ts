import { Project, type ProjectOptions } from 'ts-morph';
import { resolveHandler } from '../../src/handler-resolver.js';
import { scanRoutes } from '../../src/route-scanner.js';
import type { ResolvedRoute } from '../../src/types.js';

/** An in-memory ts-morph project, ready for `createSourceFile` calls. */
export function createInMemoryProject(options: ProjectOptions = {}): Project {
  return new Project({ useInMemoryFileSystem: true, ...options });
}

/** An in-memory project pre-populated with one source file per `files` entry. */
export function createProjectWithFiles(
  files: Record<string, string>,
  options: ProjectOptions = {},
): Project {
  const project = createInMemoryProject(options);
  for (const [path, code] of Object.entries(files)) project.createSourceFile(path, code);
  return project;
}

/** An in-memory project containing a single source file at `fileName`. */
export function createProjectWithSource(
  code: string,
  fileName = 'bootstrap.ts',
  options: ProjectOptions = {},
): Project {
  return createProjectWithFiles({ [fileName]: code }, options);
}

/** Every route in `project`, resolved to its handler (routes with no resolvable handler are skipped). */
export function scanResolvedRoutes(project: Project): ResolvedRoute[] {
  return scanRoutes(project)
    .map((binding) => resolveHandler(binding))
    .filter((route): route is ResolvedRoute => route !== null);
}
