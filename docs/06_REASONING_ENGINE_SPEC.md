# Reasoning Engine

## Responsibilities
- Resolve conflicts between source analysis, user instructions, scenario, references, and locks.
- Never override explicit locks without an explicit user action.
- Separate facts observed from inferred assumptions.
- Propagate Project DNA to views and generations.
- Produce a deterministic normalized request for prompt compilation.

## Priority
1. Safety/system constraints
2. Explicit user locks and permissions
3. Source Architecture DNA
4. User scenario/instructions
5. Reference purpose
6. Creative enhancement

## Conflict example
If reference architecture conflicts with source architecture and Architecture Lock=true:
keep source architecture; use only permitted reference visual language.
