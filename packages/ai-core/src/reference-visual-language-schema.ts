import { z } from '@avs/shared';

/**
 * Validates the raw shape of a reference-extraction model response before
 * `filterFieldsForPurpose` (reference-field-vocabulary.ts) prunes it down to
 * the requested purpose's allowed keys. Every field is optional and nullable
 * since only a purpose-scoped subset is ever expected to be present — the
 * vocabulary filter, not this schema, is what enforces which subset.
 * Deliberately has no `architecture`/`geometry`/`floorPlan` fields at all.
 */
export const referenceVisualLanguageResponseSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
});

export type ReferenceVisualLanguageResponse = z.infer<typeof referenceVisualLanguageResponseSchema>;
