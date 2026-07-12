/** A `console.warn` that only fires once per distinct key, for the lifetime of the returned function. */
export function createWarnOnce(): (key: string, message: string) => void {
  const warned = new Set<string>();

  return (key: string, message: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(message);
  };
}
