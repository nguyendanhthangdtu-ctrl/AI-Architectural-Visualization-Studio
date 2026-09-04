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
architectureLock
cameraLock
materialLock
styleLock
lightingLock
objectPermissions

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
