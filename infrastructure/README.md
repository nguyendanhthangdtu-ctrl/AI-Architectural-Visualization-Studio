# Infrastructure

No IaC yet. Concrete hosting/cloud provider, database engine, blob storage vendor, job queue
technology, auth provider, and observability stack are open decisions tracked in
docs/03_TECHNICAL_ARCHITECTURE.md §13, confirmed at BUILD 02/BUILD 18 — not fabricated ahead of
that verification (CLAUDE.md rule 13).

Never commit secret values here. See docs/16_SECURITY_SPEC.md and `.env.example`.
