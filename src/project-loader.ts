import { Project } from 'ts-morph';

/** Load a ts-morph Project (program + type checker) from a tsconfig path. */
export function loadProject(tsconfigPath: string): Project {
  return new Project({ tsConfigFilePath: tsconfigPath });
}
