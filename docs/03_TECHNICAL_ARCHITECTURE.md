# Technical Architecture

## Logical layers
Web UI
→ Application/API
→ Domain Core
→ AI Vision / Reasoning
→ Prompt Compiler
→ Model Adapter
→ Generation Job
→ Storage
→ QC

## Recommended separation
apps/web
apps/api
packages/ui
packages/shared
packages/ai-core
packages/prompt-engine
packages/model-adapters
packages/project-core
tests
infrastructure

## Provider abstraction
ImageGenerationService
- NanoBananaAdapter
- GoogleFlowAdapter
- ChatGPTImageAdapter
- FutureAdapter

The core application must not depend on provider-specific request formats.

## Operational requirements
- async jobs for long generation/video tasks
- retries with bounded backoff
- idempotency where possible
- rate limiting
- usage/cost tracking
- structured logging
- provider error normalization
