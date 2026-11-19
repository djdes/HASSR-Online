# Verification

- AC1. The composer restores the browser draft on open. Manual edits and generated replies use the same local-storage key, scoped to the administrator, slot, and donor. A storage error keeps text in the current view.
- AC2. The send path clears storage only on a confirmed send and only if the stored text matches the sent text, so a later edit in another tab is preserved.
- AC3. PASS. Fresh npm run typecheck and npm run test:gate exited 0. The regression verified persistence, administrator/slot/donor isolation, and clearing only the matching draft.
