# Frozen verification repair spec

The mandatory full typecheck has spent over 25 minutes processing the pre-existing AutosaveStatus expression `error ?? t("autosave.error")` in src/app/root/organizations/[id]/client-requisites-card.tsx. Inspector evidence in raw/typecheck-location.json identifies this expression; the helper accepts an unscoped ReturnType<typeof useTranslations>, although its caller uses rootOrganizationManagement.requisites. This expands translation types across the entire message catalog.

Bounded repair: change only that helper translator type to ReturnType<typeof useTranslations<"rootOrganizationManagement.requisites">>. Keep all runtime logic and visible text intact.

AC6: The helper translator retains the existing caller namespace, and full typecheck plus the targeted gate pass on current code. Run any related component/requisites tests selected by the targeted gate. Do not skip checks or broaden the runtime change.

Stop the stalled check, preserve its raw output, apply this declaration-only fix, then run a fresh verification pass for AC1–AC6.
