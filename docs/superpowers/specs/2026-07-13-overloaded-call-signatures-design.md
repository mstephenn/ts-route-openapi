# Describe all overload signatures for callable types

## Problem

`toSchema` (src/schema/schema-mapper.ts:115-116) only reads
`type.getCallSignatures()[0]` when building the `{ description: 'Function:
<signature text>' }` schema for a callable-typed property. TypeScript merges
an overloaded function's declarations into one symbol with multiple call
signatures; only the first is ever described, so a property like:

```ts
interface Handlers {
  onSave(id: string): void;
  onSave(id: number): void;
}
```

only documents `onSave(id: string): void`, silently dropping the
`onSave(id: number): void` overload. This is documented as a known
limitation in README.md.

## Goal

Describe every call signature a callable type has, not just the first.

## Approach

Replace the single-signature lookup with the full signature list, and join
each signature's formatted text (via the existing `signatureText` helper,
unchanged) with `" | "`:

```ts
const signatures = type.getCallSignatures();
if (signatures.length > 0) {
  return { description: `Function: ${signatures.map(signatureText).join(' | ')}` };
}
```

For a single-signature callable (the common case), `signatures.map(...).join(' | ')`
produces exactly the same string as today (a one-element array joined is
just that element) — no change in output, no risk to existing tests. For a
multi-signature (overloaded) callable, the description becomes e.g.
`Function: (id: string) => void | (id: number) => void`.

## Scope boundaries

- No change to `signatureText` itself, to JSDoc-override behavior (a
  property's own JSDoc still overrides the generated description whole —
  unaffected by how many signatures are joined into it), or to any other
  branch of `toSchema`.
- No attempt to represent overloads as a structured schema (e.g. `oneOf`)
  — the callable-type representation stays a plain description string, per
  the existing design.

## Testing

- New test: a type with two overloaded call signatures (merged by
  TypeScript into one symbol, e.g. `{ onSave(id: string): void; onSave(id:
  number): void }`), asserting the resulting description contains both
  signatures joined by `" | "`.
- All existing single-signature callable-type tests
  (test/schema-mapper.test.ts) must keep passing unchanged, proving no
  behavior change for the non-overloaded case.

## Documentation

Update README's callable-types limitation bullet to drop "Overloaded
signatures only describe the first overload" now that all overloads are
described.
