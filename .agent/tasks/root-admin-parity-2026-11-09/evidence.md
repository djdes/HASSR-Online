# Evidence: панель платформы — администратор как владелец, пополнение баланса, дата регистрации

База: master b1747297. Проверено 2026-11-09 на текущем коде ветки `claude/confident-faraday-3pbaul`
(локальная PostgreSQL 16 + `next dev`, вход под администратором «Алексей» со всеми разделами, где «Переводы»
даны флажком переводчика; клиенты «Кафе «Тест»» и «МАУ «КП ДК»»).

## Почему у alexey@wesetup.ru не было «Войти»

1. Скриншот владельца снят на проде с кодом d6a9c595 («Все 192» = 187 + 5 демо — до 3b5a13c2): тогда «Войти»
   показывалась только `isRoot`. Код с «Войти» для администратора (bda54c02, 4f3c824d) уже в master и выложен.
2. Но и в master оставалась дыра: кнопку и `/api/root/impersonate` решали разделы «как в панели»
   (`effectivePlatformSections`, с «Переводами» переводчика), а `session()` в `auth.ts` — сырые
   `User.platformSections`. A/B на локальной базе (`raw/session-ab.txt`):
   - master `auth.ts`: `impersonate=200 actingAs=null` — администратор после «Войти» попадает в свою организацию;
   - эта правка: `impersonate=200 actingAs=org-cafe role=owner`.

## AC1. Дата регистрации в списке — PASS

- `src/app/root/metrics-table.tsx`: колонка «Регистрация» (дата + «N назад»), на телефоне «· Регистрация дд.мм.гггг»;
  хвост «с …» убран; сортировка «Новые регистрации».
- `raw/browser-check.txt`: `columns: [КЛИЕНТ, КОНТАКТ, ТАРИФ, РЕГИСТРАЦИЯ, АКТИВНОСТЬ, MRR, ДЕЙСТВИЯ]`,
  `cafe registered cell: "05.10.2026\n1 мес назад"`, на телефоне «Регистрация 05.10.2026». `raw/01-clients-admin.png`.
- Тест `src/lib/root-metrics-localization.test.ts` (ru/en/uz): заголовок колонки, дата, подпись на телефоне.

## AC2. Дата регистрации в карточке — PASS

- Шапка: «Регистрация 05.10.2026» (`page.since`). Сотрудники: «Вход …»/«Не заходил» и «Регистрация …» (`data-person-dates`).
- `raw/browser-check.txt`: `card header has «Регистрация»: true`, `person dates: "Не заходил\nРегистрация 05.10.2026"`;
  `raw/04-client-card.png`. Тест `root-organization-management-localization.test.ts` (ru/en/uz).

## AC3. Пополнение баланса из списка и карточки — PASS

- Одно окно `src/app/root/organizations/[id]/balance-top-up.tsx` (Начислить/Списать, сумма, за что, «Баланс станет …»)
  в строке списка («+ Пополнить» под баллами), в карточке клиента на телефоне, в шапке карточки («Пополнить баланс»)
  и в блоке баллов («Пополнить или списать баллы»). API прежний (`/api/root/organizations/<id>/balance`, ворота billing).
- `raw/browser-check.txt`: окно → «Баланс станет 500 ₽» → «Начислить» → строка «баллы 500»; `raw/db-after-top-up.txt`:
  проводка `500|manual_adjust|Компенсация за простой` и аудит `balance.credit` от «Алексей». `raw/02-top-up-dialog.png`,
  `raw/03-after-top-up.png`, `raw/05-client-card-balance.png`.
- Без раздела «Оплаты» кнопок нет: тест `root-metrics-localization` (`canManage: false` → нет `data-balance-top-up`).

## AC4. Администратор = владелец, одинаково — PASS

- `canEnterClientCabinetsAsUser` (`src/lib/platform-access.ts`) — одна проверка по записи из БД; `auth.ts` `session()`
  использует её. Тест в `platform-access.test.ts`: переводчик-администратор проходит; охват «свои», неполный набор,
  выключенный, архивный — нет.
- Список: администратор видит «Войти», «Пополнить», удаление (компьютер и телефон); карточка: «Войти как …»,
  «Пополнить баланс», «Удалить организацию» (`raw/browser-check.txt`). После «Войти» — `actingAs=org-cafe role=owner`
  (`raw/06-impersonated-dashboard.png`).
- Попутно: на телефоне (<768px) глобальное правило `globals.css` (`table:not(.ds-no-scroll) { display: block }`)
  перебивало `hidden`, и таблица клиентов показывалась над карточками (так и на проде). `ds-no-scroll` на таблице:
  `phone desktop table display: none`, `raw/07-phone-clients.png`.

## AC5. Ворота — PASS

- `npm run typecheck` — exit 0 (`raw/typecheck.log`).
- `npm run test:gate` — pass=5911, fail=0 (`raw/test-gate.log`). Регрессия master «слово „бланк“» (fa317695,
  страница журнала уборки) починена заменой на «журнал»/«печатная форма» в `journal-info.ts`, `journal-seo.ts`, ru.json.
- `npm run i18n:check` — exit 0, `message-contract.d.ts` перегенерирован (`raw/i18n-check.log`).
- eslint изменённых файлов — exit 0 (`raw/eslint.log`).
- Браузер — `raw/browser-check.js`, `raw/browser-check.txt`, скриншоты `raw/0*.png` (в git не попадают: `.agent/**/*.png` в `.gitignore`; отправлены владельцу в чат).

Что меняет выкладка: только код и тексты; схема БД не меняется.
