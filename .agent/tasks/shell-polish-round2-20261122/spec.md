# Shell polish, round 2: menu states, sheet scroll, brand header, branding page, profile sheet, registration wizard, mobile sheets

Frozen 2026-11-22, before implementation. Follows `mobile-shell-polish-20261122` (PR #302, live).

Owner's feedback on production (five phone screenshots):

1. Menu: in light and dark the parent section and the active item get the same highlight — make it smarter. Scrolling the menu up/down sometimes moves the bottom (sheet) instead of the list.
2. Menu header: the logo placeholder and «Загрузить логотип» sit on top of each other — make it cleaner; a settings button at the side.
3. Branding settings: show the previews inside the blocks, not in a separate block below. The save button looks clickable when there is nothing to save.
4. Profile menu: e-mail shown twice; remove the «Мой кабинет … сейчас» line, show just «Тариф организации:»; «Сменить» instead of «Выбрать тариф», compact, an icon and «Сменить» to the right of the trial period line. «Открыть демо-организацию» below «Фирменный стиль». Language switch always visible to the right of «Выйти»; Uzbek is missing.
5. Registration wizard: the steps can be switched back and forth; on the phone the window comes up from the bottom (standard sheet), and every window on the site does the same. Caption under the demo button: a demo organization, not «отдельная организация». TasksFlow: just say «авторегистрация». Fields (должность etc.) symmetric, equal widths.

## Acceptance criteria

- AC1 Menu states: in the classic accordion the parent section of the current page has no fill (accent text, icon and chevron only); only the current item is filled. Same rule in light and dark (and «Новая», which already fills only the leaf). Sections without a submenu that are current stay filled.
- AC2 Sheet scroll: swipes inside the scrolling body of a bottom sheet with `scrollbar` (menu) scroll the list and never drag the sheet (`data-vaul-no-drag` on the scroll pane); the sheet still closes by its handle/header, the close button and the backdrop.
- AC3 Brand header: no overlap between the logo/placeholder and any control. For people who may edit branding a single round icon button sits on the logo's corner, fully inside the header: upload (no logo yet) or settings → «Фирменный стиль» (logo set). No text pill under the logo.
- AC4 Branding page: previews live inside their blocks (colours — poster, cabinet when on and the black-and-white switch; site — label; QR — sticker and phone after scan); the separate «Как это выглядит» block is gone; wide screens show fields and preview side by side inside a block. Toggle captions describe the current state (on and off texts). A disabled primary button keeps its disabled look in company-colour mode (brand repaint skips `:disabled`).
- AC5 Profile sheet: title shows the name once; the e-mail subtitle is omitted when it equals the title. Plan card: caption «Тариф организации:», plan line, compact «Сменить» button with an icon on the plan line; no «Мой кабинет»/«сейчас» row; same in the desktop menu. «Открыть демо-организацию» is below «Фирменный стиль» in the sheet. The language switch sits to the right of «Выйти» in the sheet footer, always visible. Offered languages: ru, en, uz. Labels ru/en/uz.
- AC6 Wizard: step labels are buttons; after the profile is saved any step can be opened and the profile step can be reopened; before saving only «Анкета» is active. On the phone (<640px) the wizard is a bottom sheet (full width, top corners rounded, slides up, safe-area padding); from 640px it stays centred. Paired fields have equal widths (employee/position, objects/INN, sphere/type, name/password); unchecked «Я сотрудник» takes the full row. TasksFlow strip says only what it is and «Авторегистрация» (no promo code, discount or external link). Demo caption: «Демо-организация, 7 дней» (ru/en/uz).
- AC7 Mobile sheets everywhere: every hand-built modal (organization, demo, master cabinet create/access, staff QR invite, stale CAPA reminder, prompt dialog, root blog/orders dialogs) is a bottom sheet under 640px and centred above; `ui/dialog` already is. Full-screen viewers (photo/video lightbox, inspection QR, kiosk, loading overlay) stay full-screen.
- AC8 Checks: typecheck, ESLint on changed files, targeted gate (and the full suite if it escalates), design guards, `i18n:types`; browser pass on phone 390×664 and desktop, light and dark: menu states, sheet scroll, brand header, branding page blocks, profile sheet, wizard as a sheet, one converted modal. Measurements and screenshots in `raw/`.

## Verification

Builder evidence under `.agent/tasks/shell-polish-round2-20261122/` (`evidence.md`, `evidence.json`, `raw/`), then a fresh verification pass on the branch head with `verdict.json`; non-PASS → `problems.md`, smallest fix, re-verify. No schema change expected.
