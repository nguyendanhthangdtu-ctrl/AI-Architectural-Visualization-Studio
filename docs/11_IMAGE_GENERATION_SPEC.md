# Image Generation Pipeline

1. Validate request.
2. Freeze input snapshot/version.
3. Create generation job.
4. Compile canonical prompt.
5. Adapt to provider.
6. Submit request.
7. Track status.
8. Store outputs.
9. Store provenance.
10. Run QC.
11. Pass or create correction/regeneration job.

Long-running operations must be asynchronous.
