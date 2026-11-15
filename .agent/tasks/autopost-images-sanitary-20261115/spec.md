# Sanitary scene requirements for autopost images

Frozen before implementation: 2026-11-15 (Europe/Moscow).

Request: adjust generated post images because the supplied professional-kitchen illustration contains potted plants. Scope is the Telegram/MAX autopost image prompt chain, not post wording or publishing behavior. Reuse the clean task checkout on a new branch from current origin/master; preserve unrelated dispatcher edits in the main working tree.

- AC1: Photo instructions explicitly exclude potted/decorative plants, herbs growing in soil, flowers and decorative greenery inside food-production/preparation/storage areas, including windowsills. Food ingredients such as edible herbs remain allowed in clean food-grade containers. Include practical scene hygiene guidance without inventing legal references or promising visual compliance.
- AC2: The text model receives these photo requirements, and the final image-job prompt independently applies them to every generation, including older model-generated scene descriptions, empty prompts and missing topic metadata. Preserve existing realistic style/no-text rules and post text, schedules, dimensions, quotas and publication behavior. No automatic edits or regeneration of existing posts/images.
- AC3: Extend the existing prompt-boundary regression coverage for the reported plant scenario and fallback paths; run the affected tests, ESLint, npm run typecheck and npm run test:gate. Review the current code and rerun the focused verification; record evidence.md, evidence.json and raw results. Prompt assertions verify the request contract, not generated pixels. If verification fails, record problems.md, apply a minimal fix and reverify.
- AC4: Deliver via a mergeable green PR squash-merged into current master, preserve unrelated working-tree edits, and verify a successful production workflow and exact live build identity. No live post publication or image generation is triggered by verification tools.

Expected product files: src/lib/channel-autopost/topics.ts, topics.test.ts and the final image-prompt call in service.server.ts. No schema, endpoint, dependencies or UI changes.
