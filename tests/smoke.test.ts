import { describe, expect, it } from 'vitest';
import { createDefaultLocks, LOCK_TIER } from '@avs/project-core';
import {
  createGeminiVisionAnalysisEngine,
  createGeminiReferenceIntelligenceEngine,
  reasoningEngine,
  scenarioBuilder,
  aiQc,
} from '@avs/ai-core';
import { promptCompiler } from '@avs/prompt-engine';
import { ImageGenerationService, FutureAdapter } from '@avs/model-adapters';
import { InMemoryProjectRepository } from '@avs/storage-adapters';
import { DomainError, parseServerEnv } from '@avs/shared';

/**
 * Cross-package smoke test — docs/03 §10 / BUILD 02 acceptance criteria I.4-I.7:
 * core domain types load correctly, every service boundary compiles and is
 * importable from its published package entry point, and environment
 * validation succeeds without any secret being present.
 */
describe('BUILD 02 smoke test', () => {
  it('loads core domain types from @avs/project-core', () => {
    expect(Object.keys(LOCK_TIER)).toEqual(['architecture', 'camera', 'material', 'style', 'lighting']);
    expect(createDefaultLocks({ analysisVersion: 'v1', setBy: 'u1' as never, setAt: 't' as never })).toHaveLength(5);
  });

  it('loads every AI service boundary from @avs/ai-core', () => {
    expect(createGeminiVisionAnalysisEngine({ apiKey: undefined })).toBeDefined();
    expect(createGeminiReferenceIntelligenceEngine({ apiKey: undefined })).toBeDefined();
    expect(reasoningEngine).toBeDefined();
    expect(scenarioBuilder).toBeDefined();
    expect(aiQc).toBeDefined();
  });

  it('loads the prompt compiler boundary from @avs/prompt-engine', () => {
    expect(promptCompiler).toBeDefined();
  });

  it('loads the provider-agnostic ImageGenerationService from @avs/model-adapters', () => {
    const service = new ImageGenerationService({ auto: new FutureAdapter() });
    expect(service.resolve('auto')).toBeInstanceOf(FutureAdapter);
  });

  it('loads the in-memory storage reference implementation from @avs/storage-adapters', () => {
    expect(new InMemoryProjectRepository()).toBeInstanceOf(InMemoryProjectRepository);
  });

  it('validates an empty environment without requiring any secret', () => {
    const env = parseServerEnv({});
    expect(env.API_PORT).toBe(8080);
  });

  it('exposes a typed DomainError shared across every package', () => {
    const error = new DomainError({ code: 'X', message: 'y', retryable: false });
    expect(error.toEnvelope()).toEqual({ code: 'X', message: 'y', retryable: false });
  });
});
