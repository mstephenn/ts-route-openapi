/** Collect `:token` names from a route path, in order. */
export function pathTokens(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}
