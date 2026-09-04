# CLAUDE CODE MASTER BUILD KIT

This kit is the source package for building AI Architectural Visualization Studio with Claude Code.

## Contents
- CLAUDE.md: operating contract
- docs/: product, AI, architecture, data, UX, security, testing and build specifications
- templates/: reusable gate and startup templates

## Recommended setup
1. Create a new Git repository.
2. Copy this kit into the repository.
3. Add environment management separately; never commit secrets.
4. Add `/test-dataset` with representative viewport images.
5. Review and approve Product Constitution and Technical Architecture.
6. Start Claude Code with the start sequence.
7. Execute BUILD 00 → BUILD 18 sequentially.
8. Require PASS at every gate.

## Suggested initial test dataset
20–50 images covering:
- Architecture/exterior and Interior
- Modern, Contemporary, Minimal, Japandi, Luxury, Tropical, etc.
- Day, afternoon, golden hour, sunset, night, overcast
- Wide, standard, eye-level, high/low and perspective cases
- Concrete, wood, stone, glass, metal, marble and fabric
- SketchUp and 3ds Max viewport examples

## Important
Provider APIs and model capabilities change. Verify current official documentation before implementation of each external integration.
