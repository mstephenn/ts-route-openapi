# Describe All Overload Signatures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Describe every call signature of a callable-typed property, not just the first, so overloaded functions no longer silently drop their other overloads from the generated OpenAPI description.

**Architecture:** `toSchema` (src/schema/schema-mapper.ts) currently reads `type.getCallSignatures()[0]`. Replace with the full signature array, mapped through the existing `signatureText` helper (unchanged) and joined with `" | "`.

**Tech Stack:** TypeScript, ts-morph, vitest.

## Global Constraints

- No change to `signatureText` itself or to JSDoc-override behavior.
- Single-signature callables must produce byte-identical output to today (regression-proof via existing tests).
- No structured (`oneOf`) representation of overloads — description string only, per existing design.

---

### Task 1: Join all call signatures into the callable-type description

**Files:**
- Modify: `src/schema/schema-mapper.ts`
- Test: `test/schema-mapper.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `signatureText(signature: Signature): string` (existing, unchanged, `src/schema/schema-mapper.ts:170-178`).
- Produces: nothing consumed by other tasks (this is the only task in this plan).

- [ ] **Step 1: Write the failing test**

Add to `test/schema-mapper.test.ts`, after the existing "describes a method-shorthand property..." test (around line 101):

```ts
test('an overloaded callable property describes every signature, joined by " | "', () => {
  const [type] = typesOfDeclarations(
    `interface Handlers {
       onSave(id: string): void;
       onSave(id: number): void;
     }
     declare const value: Handlers;`,
    ['value'],
  );

  const result = mapType(type);

  expect(result.schema.properties).toEqual({
    onSave: {
      description: 'Function: (id: string) => void | (id: number) => void',
    },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/schema-mapper.test.ts`
Expected: FAIL — actual description is `'Function: (id: string) => void'` (only the first overload), not matching the expected joined string.

- [ ] **Step 3: Implement the fix**

In `src/schema/schema-mapper.ts`, replace lines 111-116:

```ts
    // Callable types (functions, arrow types, etc.) have no meaningful OpenAPI
    // shape to hoist; describe the signature instead of emitting an empty schema.
    // Built from the call signature itself, not `type.getText()` — a named
    // function type alias/interface's `getText()` is just its name, not its shape.
    const signature = type.getCallSignatures()[0];
    if (signature) return { description: `Function: ${signatureText(signature)}` };
```

with:

```ts
    // Callable types (functions, arrow types, etc.) have no meaningful OpenAPI
    // shape to hoist; describe the signature(s) instead of emitting an empty
    // schema. Built from the call signatures themselves, not `type.getText()` —
    // a named function type alias/interface's `getText()` is just its name, not
    // its shape. An overloaded callable has multiple call signatures; all of
    // them are described, joined by " | " (a single-signature callable joins
    // to just that one signature, unchanged from before).
    const signatures = type.getCallSignatures();
    if (signatures.length > 0) {
      return { description: `Function: ${signatures.map(signatureText).join(' | ')}` };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/schema-mapper.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: All tests pass, including every pre-existing single-signature callable-type test in `test/schema-mapper.test.ts` (they must produce byte-identical output to before).

- [ ] **Step 6: Update the README limitation**

In `README.md`, under `## Limitations`, the second bullet currently reads:

```markdown
- **Callable types** (functions, methods) map to a schema-less
  `{ description: 'Function: <signature text>' }` (overridden by the
  property's own JSDoc when present) rather than being hoisted like an
  object type. Overloaded signatures only describe the first overload.
```

Replace it with:

```markdown
- **Callable types** (functions, methods) map to a schema-less
  `{ description: 'Function: <signature text>' }` (overridden by the
  property's own JSDoc when present) rather than being hoisted like an
  object type. An overloaded callable's description joins every
  signature with ` | `.
```

- [ ] **Step 7: Commit**

```bash
git add src/schema/schema-mapper.ts test/schema-mapper.test.ts README.md
git commit -m "feat: describe every overload signature of a callable type"
```

## Self-Review Notes

- **Spec coverage:** approach (Task 1 Step 3), testing (Steps 1-5), documentation (Step 6). All spec sections covered by this single task.
- **Placeholders:** none — every step has literal code.
- **Type consistency:** `signatureText` signature (`(signature: Signature): string`) is unchanged and used identically, just mapped over an array instead of called once.
