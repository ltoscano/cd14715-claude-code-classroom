---
name: typescript-patterns
description: Reviews TypeScript changes for type safety, reliable narrowing, and maintainable type design.
---

# TypeScript Patterns

- Trace external inputs from parsing to use. Prefer `unknown` with runtime validation at trust boundaries. A TypeScript annotation or assertion does not validate data at runtime.
- Check whether casts, non-null assertions, or `any` bypass a guarantee the caller relies on. Identify a concrete input or state that would violate that guarantee.
- Check nullability and indexed access. Account for missing object keys, empty arrays, and optional fields before dereferencing them.
- Look for discriminated unions that allow invalid combinations of fields, or branching that fails to handle a newly added variant. Prefer precise state types and exhaustive handling where appropriate.
- Check that generic parameters preserve useful relationships between inputs and outputs. Prefer an existing domain type or a simple constraint when it expresses the contract.

Report findings with an exact file and line, the affected behavior, and a practical correction. Follow the Code Quality Analyzer's output schema.
