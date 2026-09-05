import { DomainError } from '@avs/shared';

/** Marks a contract as defined-but-not-yet-implemented, with the owning Build Gate. */
export function notImplemented(moduleName: string, owningBuildGate: string): never {
  throw new DomainError({
    code: 'NOT_IMPLEMENTED',
    message: `${moduleName} is defined by docs/03_TECHNICAL_ARCHITECTURE.md §5 but implemented in ${owningBuildGate}.`,
    retryable: false,
  });
}
