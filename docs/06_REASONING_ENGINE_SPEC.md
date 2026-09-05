# Reasoning Engine

## Responsibilities
- Resolve conflicts between source analysis, user instructions, scenario, references, and locks.
- Never override explicit locks without an explicit user action.
- Separate facts observed from inferred assumptions.
- Propagate Project DNA to views and generations.
- Produce a deterministic normalized request for prompt compilation.

## Priority
1. Safety/system constraints
2. Explicit user locks and permissions — source-fidelity tier only (Architecture, Camera, Material Lock)
3. Source Architecture DNA
4. User scenario/instructions
5. Reference purpose
6. Creative enhancement

Output-stability locks (Style Lock, Lighting Lock; docs/03 ADR-001) do not occupy tier 2. They pin only
the Style/Lighting sub-fields of tiers 4–6 to their last-accepted value, leaving every other field in
those tiers free, and never outrank a tier-2 source-fidelity lock.

## Conflict example
If reference architecture conflicts with source architecture and Architecture Lock=true:
keep source architecture; use only permitted reference visual language.

If Style Lock=true and the selected scenario would otherwise imply a different style: keep the pinned
style; surface the conflict explicitly rather than silently overriding either the lock or the scenario.
