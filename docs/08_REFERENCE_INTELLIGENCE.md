# Reference Intelligence

## Reference purpose
Style, Material, Lighting, Composition, Camera, Environment, Furniture, Color, Overall Look, Auto.

## Prompt From Image
Extract:
Subject, Style, Camera, Composition, Material, Lighting, Environment, Color, Photography, Atmosphere, Realism.

## Rule
Reference transmits visual language according to purpose, not source architecture. Enforced structurally
(BUILD 10, `packages/ai-core/src/reference-field-vocabulary.ts`) — each purpose has a fixed, closed set of
allowed fields, and every model response is filtered against it before use, not merely instructed.

## Reference Mixer
Source architecture + selected reference attributes + scenario + locks → normalized visual specification.
Not yet implemented — BUILD 10 delivers per-(image, purpose) extraction only (`ExtractedVisualLanguage`);
combining multiple extractions with locks/scenario into one normalized spec is future work.
