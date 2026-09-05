/** Branded identifier types shared across package boundaries. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, 'UserId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type GenerationVersionId = Brand<string, 'GenerationVersionId'>;
export type Timestamp = Brand<string, 'Timestamp'>; // ISO 8601
