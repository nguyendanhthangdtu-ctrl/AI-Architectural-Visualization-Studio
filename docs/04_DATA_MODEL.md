# Data Model

## Project
id, name, module, createdAt, updatedAt, status, currentVersionId

## Project DNA
architectureDNA
interiorDNA
cameraDNA
materialDNA
lightingDNA
environmentDNA
referenceDNA

## Analysis
sourceAssetId
analysisVersion
structuredIntelligence
confidence
warnings

## Constraints
Locks are typed `Lock` objects, not bare booleans — see docs/03_TECHNICAL_ARCHITECTURE.md §1 ADR-001 and §7.

architectureLock, cameraLock, materialLock — tier: source-fidelity; default enabled; pinned to the current analysisVersion's structuredIntelligence snapshot.
styleLock, lightingLock — tier: output-stability; default disabled; pinned to a specific accepted GenerationVersion.

Each Lock: { id, tier, enabled, pinnedRef, setBy, setAt, reason?, history[] } — history is append-only; enabling/disabling is always attributed, never silent.

objectPermissions — per-object { objectId, action: keep|edit|replace|add } map (docs/05 layer 9); not a Lock.

## Version / History
GenerationVersion: id, projectId, parentVersionId, kind (analysis|scenario|generation|edit|view), snapshotRef, createdAt, createdBy

Append-only DAG from MVP (docs/03 ADR-006). Project.currentVersionId always points into this graph. Regeneration creates a new version; it never mutates a prior version in place.

## Scenario
context
lighting
sunDirection
artificialLighting
environment
cameraMode
aspectRatio
generationResolution
upscaleResolution
renderCore

## Reference
assetId
purpose
extractedVisualLanguage
extractedPrompt
weight
constraints

## Generation
id, projectId, viewId, provider, model, promptVersion, scenarioVersion, sourceAssets, referenceAssets, status, outputAssets, usageMetadata

## Edit (docs/12_EDITOR_SPEC.md, BUILD 14)
id, projectId, parentGenerationId, sourceAssetId, targetRegionDescription, maskAssetId, intendedChange, category, protectedLocks, resultingAssetId, status, usageMetadata, createdAt

## View (docs/13_MULTIVIEW_SPEC.md, BUILD 15)
id, projectId, mode (sync|creative), cameraProposal, materialProposal, lightingProposal, styleProposal, ignoredProposals, parentVersionId, resultingGenerationId, createdAt

## Video (docs/14_VIDEO_SPEC.md, BUILD 16)
id, projectId, parentGenerationId, sourceAssetId, motionType, motionDescription, durationSeconds, protectedLocks (always the full 5-item video lock set), provider, providerOperationName, status, resultingAssetId, usageMetadata, createdAt, updatedAt

## QC
architectureScore
cameraScore
materialScore
lightingScore
objectConsistencyScore
photorealismScore
issues
correctionInstruction
decision
