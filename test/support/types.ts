import type { ProjectOptions, Type } from 'ts-morph';
import { createProjectWithSource } from './project.js';

/** The types of the named `declare const` variables in `source`. */
export function typesOfDeclarations(
  source: string,
  names: string[],
  fileName = 't.ts',
  options: ProjectOptions = {},
): Type[] {
  const sf = createProjectWithSource(source, fileName, options).getSourceFileOrThrow(fileName);
  return names.map((name) => sf.getVariableDeclarationOrThrow(name).getType());
}

/** The type of `declare const value: <annotation>;`. */
export function typeOfAnnotation(annotation: string): Type {
  const [type] = typesOfDeclarations(`declare const value: ${annotation};`, ['value']);
  return type;
}
