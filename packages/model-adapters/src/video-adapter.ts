import type { NormalizedAdapterError, ValidationResult } from './types.js';
import type {
  VideoAdapterCapabilities,
  VideoGenerationRequest,
  VideoOperationRef,
  VideoPollResult,
  VideoSubmission,
} from './video-types.js';

export interface VideoGenerationAdapter {
  readonly id: string;
  capabilities(): VideoAdapterCapabilities;
  validate(request: VideoGenerationRequest): ValidationResult;
  submit(request: VideoGenerationRequest): Promise<VideoSubmission>;
  pollStatus(operation: VideoOperationRef): Promise<VideoPollResult>;
  normalizeError(providerError: unknown): NormalizedAdapterError;
}
