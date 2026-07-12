import type { Node } from 'ts-morph';

export interface JsDocText {
  summary?: string;
  description?: string;
  deprecated: boolean;
}

interface JsDocNode {
  getJsDocs(): Array<{
    getDescription(): string;
    getTags(): Array<{ getTagName(): string }>;
  }>;
}

export function jsDocText(node: Node): JsDocText {
  if (!hasJsDocs(node)) return { deprecated: false };
  const docs = node.getJsDocs();
  const doc = docs.at(-1);
  if (!doc) return { deprecated: false };

  const lines = doc
    .getDescription()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    summary: lines[0],
    description: lines.length > 1 ? lines.slice(1).join('\n') : undefined,
    deprecated: doc.getTags().some((tag) => tag.getTagName() === 'deprecated'),
  };
}

function hasJsDocs(node: Node): node is Node & JsDocNode {
  return typeof (node as unknown as Partial<JsDocNode>).getJsDocs === 'function';
}
