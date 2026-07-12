/** Collect `:token` names from a route path, in order. */
export function pathTokens(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

/** Join two path segments into a normalized `/base/sub` path — one leading slash, no doubled/trailing slashes. */
export function joinPaths(base: string, sub: string): string {
  const clean = (s: string) => s.replace(/^\/+|\/+$/g, '');
  const joined = [clean(base), clean(sub)].filter(Boolean).join('/');
  return `/${joined}`;
}
