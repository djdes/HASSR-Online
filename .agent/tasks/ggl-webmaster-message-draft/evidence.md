# Webmaster draft verification

- AC1. The localized generate button submits only to the draft endpoint. A validated reply fills the editable field, while failures retain the existing text. Send remains a separate form action.
- AC2. The production dispatcher accepted the prompt built with the first slot's published landing, article title, and verified donor publications. It returned a contextual draft that requested the section and in-text link. This was a dispatcher-only smoke check, without webmaster interaction.
- AC3. The submission returns an asynchronous ticket. Polling reads only the accepted ticket in a record scoped to the current admin and slot, with a bound donor and public URL. Slot and ticket constraints are enforced before calling the dispatcher.
- AC4. PASS. Fresh npm run typecheck exited 0. npm run test:gate passed 282 tests across 67 affected files. The message contract generation and staged whitespace checks passed.
