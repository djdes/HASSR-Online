# Task Spec: Telegram Mini App with Role-Based Simplified Mobile Site View & Phone Linking

- **Task ID:** `telegram-mobile-role-miniapp-2026-11-25`
- **Branch:** `t3/telegram-mobile-role-app`
- **Base Commit:** `e11c3606c084007b34f4a65b4ee94fef9084ca07` (`origin/master`)
- **Status:** FROZEN

---

## 1. Objective

Enhance the WeSetup Telegram Mini App (`/mini` + `MiniShellDashboard`) into a complete, role-aware, simplified mobile web experience guided by `modern-web-guidance`, with cryptographic **Telegram linking by phone number** across Mini App entry, login, profile, and the Telegram bot.

## 2. Hard Boundaries (Do NOT Modify)

To preserve security invariants and keep the fast targeted verification gate (`npm run test:changed`), **DO NOT modify**:
- `prisma/schema.prisma`
- `package-lock.json`
- `tsconfig*.json`
- `src/lib/db.ts`
- `src/lib/auth.ts` (keep exact error `"Аккаунт не связан с Telegram. Получите приглашение у руководителя."`)
- `src/lib/auth-helpers.ts`
- `src/lib/permissions.ts`
- `src/lib/user-roles.ts`
- `src/lib/journal-acl.ts`
- `src/app/mini/_components/mini-nav.tsx` (preserve `mini-home-localization.test.ts` strict VM mocks)

## 3. Acceptance Criteria

### AC1 — Cryptographic Telegram Phone Linking in Mini App
- Inside Telegram Mini App, unlinked users (or users on `/mini/login` / `/mini/me`) can share their Telegram phone contact via `Telegram.WebApp.requestContact()`.
- `src/lib/telegram-init-data.ts` extracts a shared `verifyWebAppSignedPayload` helper (`HMAC-SHA256("WebAppData", BOT_TOKEN)`) and exports:
  - existing `verifyTelegramInitData(initData, botToken)` (unchanged signature and behavior)
  - `TelegramWebAppContact`, `VerifiedContactResponse`, and `verifyTelegramContactResponse(response, botToken, maxAgeMs = 15 * 60 * 1000)` validating `contact` JSON (`typeof phone_number === "string"` and `typeof user_id === "number"`).
- `src/lib/telegram-phone-link.ts` exports:
  - `linkTelegramByVerifiedPhone({ chatId, rawPhone }, client?)`: normalizes phone (`normalizePhone`), matches active non-archived users (`isActive: true, archivedAt: null`), refuses ambiguous multi-user phone matches across accounts (`ambiguous`), refuses silent hijacking if `chatId` is already bound to another user (`telegram_already_linked_other`) or the matched user already has a different `telegramChatId` (`user_already_linked_other_tg`), binds `telegramChatId` cleanly otherwise.
  - `linkTelegramToAuthenticatedUser({ userId, chatId, verifiedPhone? }, client?)`: verifies no `chatId` collision (`conflict`), respects already-linked state (`already_linked` vs `user_already_linked_other_tg`), binds `telegramChatId` (and optionally saves `verifiedPhone` if `user.phone` is null and unique in org).
- `POST /api/mini/link-telegram-phone`:
  - Rate-limited via `createRateLimiter` (`10 / 5 min` per IP).
  - Verifies `initData` HMAC.
  - If `contactResponse` is passed: verifies `contactResponse` HMAC and strictly enforces `contact.user_id === initData.user.id` (403 on mismatch), then calls `linkTelegramByVerifiedPhone`.
  - If `contactResponse` is omitted (older TG client fallback after bot `message:contact`): looks up active user by `telegramChatId: String(initData.user.id)` and returns `202` `{ ok: false, status: "pending_bot_contact" }` if not yet linked.
  - On link success: records login (`recordLogin`), resolves role via `resolveMiniRole`, and issues session cookie via `issueSession`.
- `/api/mini/page.tsx` handles `"notLinked"` (`TELEGRAM_SIGN_IN_NOT_LINKED`) with a dedicated simplified **Telegram Phone-Link card** offering 1-tap `requestTelegramContact()` + fallback poll + secondary link to `/mini/login?linkTg=1`.

### AC2 — Login Binding & Profile Linking / Phone Dialog
- `POST /api/mini/login` and `POST /api/auth/login` accept optional `initData?: string` and `linkTelegram?: boolean`. After password verification succeeds (and when 2FA is not triggered), if `linkTelegram === true && initData`, they verify `initData` HMAC and call `linkTelegramToAuthenticatedUser` non-destructively (never blocking valid login), returning `telegramLinkStatus` in the JSON payload.
- `/mini/login` (`login-form.tsx` + `page.tsx` accepting `linkTg=1`): inside Telegram, renders a 1-tap **«Привязать Telegram по номеру телефона»** button and an opt-in checkbox (checked by default) **«Привязать этот Telegram к аккаунту»**.
- `GET / POST /api/mini/link-telegram`:
  - `GET`: returns `{ telegramLinked, phone, botUsername, botLinkUrl }` (using `generateLinkToken(session.user.id)`).
  - `POST`: authenticated endpoint verifying `initData` (and optional `contactResponse` with `user_id` match) and calling `linkTelegramToAuthenticatedUser` for `session.user.id`.
- `/mini/me` (`me-client.tsx` + `page.tsx`): shows role group («Руководитель» / «Сотрудник»), Telegram link status card (`data-testid="mini-telegram-phone"`), in-Telegram or bot deep-link binding controls, and a native HTML `<dialog class="mini-dialog" closedby="any">` (`<form method="dialog">` + `<form method="post">` calling `PUT /api/users/me/phone`) to set or edit the user's phone number.

### AC3 — Telegram Bot Phone-Contact Linking
- `src/lib/bot/handlers/start.ts`: exports `replyWithLoadedStartHome`. When `home.kind === "unlinked"`, keeps `buildTelegramUnlinkedStartReply()` text unchanged (`start-response.test.ts` stays green) and attaches Telegram's native `request_contact` keyboard button (`telegram.bot.start.sharePhoneButton`).
- `src/lib/bot/handlers/contact.ts`: handles `message:contact`:
  - Validates `ctx.from?.id` and `ctx.message.contact.user_id === ctx.from.id` (rejects forwarded contacts with `notOwnContact`).
  - Calls `linkTelegramByVerifiedPhone`.
  - On success: replies removing keyboard, then calls `replyWithLoadedStartHome` so the user gets their role-aware greeting and Mini App button.
  - On failure (`not_found`, `ambiguous`, `telegram_already_linked_other`, `user_already_linked_other_tg`, `invalid_phone`): replies localized error with `remove_keyboard: true` (plus Mini App `/mini/login?linkTg=1` button when applicable).
- Registered in `src/lib/bot/bot-app.ts` BEFORE `registerSupportHandlers(composer)`.

### AC4 — Role Detection & Role-Specific Functionality (Сотрудник vs Руководитель)
- `src/lib/mini-role.ts` (pure, client/server safe): resolves `MiniRoleKind` (`"manager" | "supervisor" | "staff" | "readonly"`), `MiniRoleGroup` (`"manager" | "staff"`), `homeHref`, and `quickActions` (`MiniQuickAction[]`).
  - `manager` (`roleGroup: "manager"`): `hasFullWorkspaceAccess(actor)` or `isManagerLikePermissions(perms, actor.role)` with `journals.view` → home `/dashboard`, quick actions: `/journals`, `/verifications`, `/settings/users`, `/reports` (filtered by permissions if provided).
  - `supervisor` (`roleGroup: "manager"`): `tasks.verify` without `journals.view` (e.g., `head_chef`) → home `/control-board`, quick actions: `/control-board`, `/verifications`, `/team`.
  - `staff` (`roleGroup: "staff"`): regular employee (`cook`, `waiter`, etc.) → home `miniHomeHref(actor)` (`/mini/today` or `/journals`), quick actions: `/mini/today`, optional `/journals` (only if `journals.view`), `/mini/me`. Never includes manager-only routes (`/verifications`, `/settings/users`, `/reports`, `/control-board`).
  - `readonly` (`roleGroup: "staff"`): view-only user → home `miniHomeHref(actor)`, quick actions: `/journals` (if `journals.view`) or `/mini/today`, `/mini/me`.
- Exposed via:
  - `GET /api/mini/session` (`roleKind`, `roleGroup`, `homeHref`, `phone`, `telegramLinked`, preserving `user`, `mode`, `permissions`)
  - `loadMiniShellData` (`roleKind`, `roleGroup`, `roleQuickActions`)
  - `MiniAppShell` (`data-mini-role={roleGroup}`)
  - `MiniTopBar` (optional `roleGroup` prop; shows translated role label in eyebrow when present)
  - `MiniRoleBar` (`src/app/mini/_components/mini-role-bar.tsx`) mounted in `MiniShellDashboard` (`src/app/(dashboard)/layout.tsx`) on home routes (`/dashboard`, `/control-board`, `/journals`, `/mini/today`), rendering large `>=52px` role-specific quick actions.

### AC5 — Large, Simplified Mobile Site View + `modern-web-guidance`
- `src/app/mini/layout.tsx`: remove `maximumScale: 1` and `userScalable: false` from `BASE_VIEWPORT` (allowing browser zoom, keeping `viewportFit: "cover"` inside `generateViewport`).
- `src/app/mini/mini-theme.css`:
  - `html:has(#mini-root)` `scroll-padding-top` and `scroll-padding-bottom` clearing fixed bars + safe-area insets (WCAG 2.4.11).
  - `.mini-root main` sets `container: mini-main / inline-size`, `overflow-wrap: break-word`; `.mini-root main :where(a, code)` sets `overflow-wrap: anywhere`; responsive `img, video { max-inline-size: 100%; block-size: auto; }`.
  - `text-wrap: balance` on headings (`h1, h2, h3, .mini-h1`) and `text-wrap: pretty` on body copy (`p, li`).
  - Fluid heading sizing `clamp(1.375rem, 1.15rem + 1.2cqi, 1.625rem)` on `#mini-root main h1`.
  - `@container mini-main (inline-size < 34rem)`: simplifies embedded desktop site pages inside `MiniShellDashboard` into spacious single/2-column mobile layouts, elevates small helper/table text (`>= 14px`), widens touch spacing, hides `[data-mini-hide]` and `<kbd>` desktop clutter.
  - `.mini-role-bar`, `.mini-role-grid`, `.mini-role-action`, `.mini-dialog` (native `<dialog>` with `::backdrop`, `overscroll-behavior: contain`, `@starting-style`), `.mini-disclosure` (`<details>`/`<summary>`).
  - Preserves all `mini-theme.test.ts`, `one-accent.test.ts` (`#5566f6` single accent, no gradients/glows on buttons/badges/cards), and `borderless.test.ts` invariants.
- `src/app/mini/login/login-form.tsx`:
  - Retains `method="post"` and `disabled={busy || !hydrated}` (satisfies `password-forms-post.test.ts` and `modern-web-guidance` `forms`).
  - Validates on submit, sets `aria-invalid`, `aria-describedby`, and focuses the first invalid control.
  - Adds `aria-pressed={showPassword}`, `autoCorrect="off"` on email, and `event.nativeEvent.isComposing` check on Enter.
- `src/app/mini/sections/sections-client.tsx`: wraps the search input in semantic `<search>`.

### AC6 — Full i18n Parity & Guard Tests
- All new strings added to `src/i18n/messages/{ru,en,uz}.json` and compiled via `npm run i18n:types`.
- Zero Cyrillic characters in `en.json` and `uz.json`.
- `npm run i18n:check`, `npm run typecheck`, `npm run test:changed`, and all Mini/Guard/Bot tests pass with 0 failures.

### AC7 — T3 Subagents & Proof-Loop Artifacts
- Implemented via `mcp_t3-code_delegate_task` disjoint workers + fresh independent `review` verifier.
- Artifacts stored in `.agent/tasks/telegram-mobile-role-miniapp-2026-11-25/`:
  - `spec.md`
  - `evidence.md`
  - `evidence.json`
  - `verdict.json`
  - `raw/*`

---

## 4. Exact i18n Contract (Shared Between Workers & Coordinator)

- `navigation.mini`:
  - `roleManager`: "Руководитель"
  - `roleStaff`: "Сотрудник"
  - `roleReadonly`: "Просмотр"
- `miniHome.entry`:
  - `error.notLinked`: "Ваш Telegram ещё не привязан к рабочему аккаунту."
  - `linkPhone.heading`: "Привязка по номеру телефона"
  - `linkPhone.description`: "Поделитесь номером телефона из Telegram — мы найдём ваш рабочий профиль и сразу откроем кабинет."
  - `linkPhone.shareButton`: "Поделиться номером из Telegram"
  - `linkPhone.sharing`: "Привязываем профиль…"
  - `linkPhone.orPassword`: "или войдите обычным способом"
  - `linkPhone.passwordButton`: "Войти по телефону и паролю"
  - `linkPhone.declined`: "Вы отменили передачу номера. Нажмите кнопку ещё раз или войдите по паролю."
  - `linkPhone.notFound`: "Профиль с этим номером не найден. Войдите по телефону или почте с паролем — Telegram привяжется сразу."
  - `linkPhone.ambiguous`: "На этот номер заведено несколько профилей. Войдите по телефону и паролю, чтобы выбрать нужный аккаунт."
  - `linkPhone.alreadyLinkedOther`: "Этот Telegram уже привязан к другому сотруднику. Отвяжите его через /stop в том аккаунте или войдите по паролю."
  - `linkPhone.userHasOtherTelegram`: "К вашему профилю уже привязан другой Telegram. Войдите по паролю и обновите привязку в профиле."
  - `linkPhone.pendingBot`: "Номер отправлен в бота — завершаем вход…"
  - `linkPhone.failed`: "Не удалось привязать Telegram по номеру. Попробуйте ещё раз или войдите по паролю."
  - `linkPhone.success`: "Telegram привязан! Открываем кабинет…"
- `miniHome.roleBar`:
  - `landmark`: "Быстрые действия роли"
  - `managerBadge`: "Режим руководителя"
  - `supervisorBadge`: "Контроль смены"
  - `staffBadge`: "Режим сотрудника"
  - `readonlyBadge`: "Только просмотр"
  - `actions.todayJournals`: "Журналы сегодня"
  - `actions.verifications`: "Проверка записей"
  - `actions.staff`: "Сотрудники"
  - `actions.reports`: "Отчёты"
  - `actions.controlBoard`: "Контрольная доска"
  - `actions.myTasks`: "Задачи смены"
  - `actions.journals`: "Журналы"
  - `actions.profile`: "Профиль"
- `miniLogin`:
  - `telegram.sharePhone`: "Войти и привязать по номеру Telegram"
  - `telegram.sharingPhone`: "Проверяем номер…"
  - `telegram.linkOnLogin`: "Привязать этот Telegram к аккаунту"
  - `telegram.linkOnLoginHint`: "В следующий раз кабинет откроется в одно касание без пароля."
  - `telegram.linkedToast`: "Telegram привязан к вашему аккаунту"
  - `telegram.conflictToast`: "Этот Telegram уже привязан к другому сотруднику"
  - `telegram.userOtherTgToast`: "К аккаунту уже привязан другой Telegram — отвяжите старый в профиле"
  - `errors.contactDeclined`: "Передача номера отменена"
  - `errors.phoneNotFound`: "Сотрудник с таким номером не найден. Войдите по телефону и паролю."
  - `errors.phoneAmbiguous`: "На этот номер найдено несколько аккаунтов — войдите с паролем."
  - `errors.telegramConflict`: "Этот Telegram уже привязан к другому профилю."
  - `errors.userHasOtherTelegram`: "К профилю уже привязан другой Telegram."
  - `errors.contactPending`: "Откройте чат с ботом и подтвердите номер, либо войдите с паролем."
- `miniProfile`:
  - `roleGroup.label`: "Режим кабинета"
  - `roleGroup.manager`: "Руководитель"
  - `roleGroup.staff`: "Сотрудник"
  - `telegram.title`: "Telegram и телефон"
  - `telegram.linked`: "Telegram привязан"
  - `telegram.notLinked`: "Telegram не привязан"
  - `telegram.linkInApp`: "Привязать этот Telegram"
  - `telegram.linkByPhone`: "Привязать по номеру из Telegram"
  - `telegram.linkViaBot`: "Привязать через бота Telegram"
  - `telegram.linking`: "Привязываем…"
  - `telegram.linkedSuccess`: "Telegram успешно привязан"
  - `telegram.linkConflict`: "Этот Telegram уже привязан к другому сотруднику"
  - `telegram.linkFailed`: "Не удалось привязать Telegram. Попробуйте позже."
  - `phoneDialog.editButton`: "Изменить телефон"
  - `phoneDialog.addButton`: "Указать телефон"
  - `phoneDialog.title`: "Номер телефона"
  - `phoneDialog.description`: "По номеру телефона работают быстрая привязка Telegram и вход в приложение."
  - `phoneDialog.label`: "Телефон"
  - `phoneDialog.placeholder`: "+7 999 123-45-67"
  - `phoneDialog.save`: "Сохранить"
  - `phoneDialog.saving`: "Сохраняем…"
  - `phoneDialog.cancel`: "Отмена"
  - `phoneDialog.saved`: "Телефон сохранён"
  - `phoneDialog.error`: "Не удалось сохранить телефон"
- `telegram.bot.start`:
  - `sharePhoneButton`: "📱 Поделиться номером телефона"
  - `openMiniAppButton`: "📱 Открыть приложение"
- `telegram.bot.contact`:
  - `notOwnContact`: "Пожалуйста, отправьте именно свой контакт кнопкой «📱 Поделиться номером телефона»."
  - `invalidPhone`: "Не удалось распознать номер телефона. Проверьте номер и попробуйте снова."
  - `notFound`: "Сотрудник с номером {phone} не найден. Войдите в мини-приложение по паролю или попросите руководителя добавить ваш номер."
  - `ambiguous`: "На номер {phone} найдено несколько профилей. Войдите в мини-приложение по телефону и паролю, чтобы привязать нужный аккаунт."
  - `alreadyLinkedOther`: "Этот Telegram уже привязан к другому аккаунту. Отвяжите его командой /stop в том аккаунте."
  - `userHasOtherTelegram`: "К аккаунту с номером {phone} уже привязан другой Telegram. Обратитесь к руководителю или отвяжите старый Telegram в профиле."
  - `linkedSuccess`: "✅ Номер {phone} подтверждён — Telegram привязан к профилю <b>{name}</b>!"

---

## 5. Worker File Ownership (Disjoint)

### Worker A (Backend, Auth, Phone Linking, Role Resolver, Bot Contact)
- `src/lib/telegram-init-data.ts`
- `src/lib/telegram-init-data.test.ts` (new)
- `src/lib/telegram-phone-link.ts` (new)
- `src/lib/telegram-phone-link.test.ts` (new)
- `src/lib/telegram-auth-messages.ts`
- `src/lib/mini-entry-error-presentation.ts`
- `src/lib/mini-role.ts` (new)
- `src/lib/mini-role.test.ts` (new)
- `src/app/api/mini/link-telegram-phone/route.ts` (new)
- `src/app/api/mini/link-telegram/route.ts` (new)
- `src/app/api/mini/login/route.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/mini/session/route.ts`
- `src/lib/bot/handlers/contact.ts` (new)
- `src/lib/bot/handlers/contact.test.ts` (new)
- `src/lib/bot/handlers/start.ts`
- `src/lib/bot/bot-app.ts`

### Worker B (Mobile Shell, Modern Web Guidance CSS/HTML, Role UI, Phone-Link Screens)
- `src/app/mini/_components/telegram-web-app.ts`
- `src/app/mini/_components/telegram-web-app.test.ts`
- `src/app/mini/layout.tsx`
- `src/app/mini/mini-theme.css`
- `src/app/mini/_components/mini-shell-data.ts`
- `src/app/mini/_components/mini-app-shell.tsx`
- `src/app/mini/_components/mini-shell.tsx`
- `src/app/mini/_components/mini-role-bar.tsx` (new)
- `src/app/(dashboard)/layout.tsx` (ONLY inside `MiniShellDashboard`)
- `src/app/mini/page.tsx`
- `src/app/mini/login/page.tsx`
- `src/app/mini/login/login-form.tsx`
- `src/app/mini/login/login-error-presentation.ts`
- `src/app/mini/me/page.tsx`
- `src/app/mini/me/me-client.tsx`
- `src/app/mini/sections/sections-client.tsx`

### Coordinator (Step 2 & Step 3)
- `src/i18n/messages/ru.json`, `en.json`, `uz.json`, `src/i18n/message-contract.d.ts`
- `src/lib/mini-home-localization.test.ts`
- `src/app/mini/mini-theme.test.ts`
- Proof-loop evidence (`evidence.md`, `evidence.json`, `raw/*`, `verdict.json` via Verifier)
