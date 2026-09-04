# AI ARCHITECTURAL VISUALIZATION STUDIO — CLAUDE CODE CONTRACT

## Mission
Build a production-grade AI application that converts SketchUp/3ds Max viewport images into photorealistic architectural/interior photography.

Core philosophy:
UNDERSTAND → PRESERVE → ENHANCE → CREATE → VERIFY

## Non-negotiable rules
1. Structured Intelligence is the source of truth; prompts are compiled artifacts.
2. Preserve Architecture DNA whenever Architecture Lock is enabled.
3. Preserve Camera DNA whenever Camera Lock is enabled.
4. Preserve Material DNA whenever Material Lock is enabled.
5. Reference images transmit visual language according to purpose; never silently replace source architecture.
6. Never hard-code API keys, secrets, tokens, or credentials.
7. Never fake a production integration and label it as real.
8. Do not rewrite or delete working functionality without a documented reason, migration plan, and acceptance criteria.
9. Keep UI, domain logic, AI reasoning, prompt compilation, provider adapters, storage, and infrastructure separated.
10. Every feature must have validation and tests appropriate to its risk.
11. Do not proceed to the next Build Gate until the current gate is PASS.
12. Prefer small, reviewable changes over large rewrites.
13. Validate external model/API assumptions against current provider documentation before implementation.
14. Record model/provider, prompt version, scenario, references, seed/job identifiers when available, and output metadata.
15. Fail safely: explicit errors, retry policy, idempotency where applicable, and no silent data loss.

## Before every Build Gate
- Inspect repository and current architecture.
- Read the relevant docs.
- Identify impacted files and dependencies.
- State implementation plan.
- Identify risks and test plan.
- Implement only the approved scope.

## After every Build Gate
Report:
- Objective met
- Files created/modified
- Architecture changes
- Integration status
- Tests passed
- Manual verification
- Known issues
- Security check
- Performance check
- Acceptance criteria
- PASS/FAIL
- Recommendation for next gate

## Coding standards
- TypeScript strict mode where applicable.
- Schema validation at system boundaries.
- Typed domain models.
- Centralized error handling.
- No secrets in source control.
- No duplicated business rules.
- Unit tests for deterministic domain logic.
- Integration tests for service boundaries.
- E2E tests for critical user journeys.
- Accessible UI and responsive behavior.
- Observable production services.

## Product identity
This is not a generic image generator. It is an architectural visualization reasoning and orchestration system whose first responsibility is to understand and preserve the source design.
