# Draft a first message to a GoGetLinks webmaster

- AC1. The message dialog offers a translated generate button and inserts the resulting draft into the editable textarea. An existing draft remains until a replacement succeeds. Generation never sends a message, opens a placement, or charges funds.
- AC2. The root-only server resolves the current donor and public WeSetup landing from the selected slot and uses the existing ProjectsFlow dispatcher. Its prompt includes the landing facts, intended format, and verified donor publications when available. The message asks about a suitable section and an in-text link. Unverified rubrics and article facts must not be invented.
- AC3. The UI can wait for a delayed job without keeping one server request open. Only the originating admin can read the job for the unchanged donor and landing. Failures and changed slots are reported.
- AC4. Regression tests exercise prompt context, dispatcher reply validation, and localization. The fresh type check and targeted gate pass.
