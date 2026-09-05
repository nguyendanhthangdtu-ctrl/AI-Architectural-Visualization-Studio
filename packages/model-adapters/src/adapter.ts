import type {
  AdapterCapabilities,
  EditRequest,
  GenerationRequest,
  GenerationResult,
  NormalizedAdapterError,
  ValidationResult,
} from './types.js';

export interface ImageGenerationAdapter {
  readonly id: string;
  capabilities(): AdapterCapabilities;
  validate(request: GenerationRequest): ValidationResult;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  /** Present only when `capabilities().supportsEdit` is true (BUILD 14, docs/12) — never a fake/no-op edit. */
  edit?(request: EditRequest): Promise<GenerationResult>;
  normalizeError(providerError: unknown): NormalizedAdapterError;
}
