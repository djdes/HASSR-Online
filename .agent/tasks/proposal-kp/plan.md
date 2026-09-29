# План: КП (А4 PDF, письмо, веб-версия, ROOT-генератор)

Спека — `spec.md` рядом (заморожена 2026-09-29). Ветка `feat/proposal-kp-2026-09-29`, рабочая копия `d:/wt/kp`,
база `wesetup_wt_kp`, порт 3192.

## Что уже есть и на что опираемся
- Сферы — `ORG_SPHERES` (`src/lib/org-profile.ts`); журналы сферы — `SPHERE_RULES` (`src/lib/sphere-journal-rules.ts`),
  названия — `ACTIVE_JOURNAL_CATALOG`, число журналов — `JOURNALS_TOTAL` (`src/lib/journal-catalog.ts`).
- Тариф — `readTariff("monthly")` (`src/lib/tariffs.ts`), акция — `readActivePromotion` (`src/lib/promo/offer.ts`),
  расчёт «акция → промокод» — `computeCheckoutAmounts` (`src/lib/promo/promotions.ts`). Лимиты — `FREE_MAX_USERS = 1`,
  `SUBSCRIPTION_MAX_USERS = 10`, `EXTRA_USER_PRICE_RUB` (`plan-limits.ts`, `plan-catalog.ts`).
- Бесплатный период — `readFreePeriodSettings` / `billingPhase` (`billing.server.ts`, `billing-period.ts`).
- Реквизиты — `readPlatformRequisites` (`closing-documents/requisites.ts`); счёт по безналу доступен, только когда
  `invoiceRequisitesReady` — строка «по счёту для юрлиц» зависит от этого же условия.
- Фирменный QR — `brandQrLayout` + `drawBrandQrTilePdf` (вектор в PDF), `brandQrPng` (PNG для письма).
- Нишевые страницы — `NICHES` (`src/content/niches.ts`, поле `sphere`), `nicheLandingForSphere`.
- Письма — `sendRawEmail` (`src/lib/email.ts`; пустой `SMTP_HOST` — только лог).
- Аудит ROOT — `recordAuditLog` (организация `platform`), как в `/api/root/promotions`.
- Контракты соседей (в этой ветке их кода нет): `https://wesetup.ru/promo/<CODE>?s=<sphere>` (promo-personal),
  `PromoCode.lifetime` (promo-personal), `renderProposal*` зовёт рассылка (mailing).

## Интерфейс модуля `src/lib/proposal` (по спеке, не меняется)
```ts
export type ProposalPromo = { code: string; kind: "percent" | "fixed"; value: number; lifetime: boolean; endsAt: Date | null };
export type ProposalSender = { name: string; phone?: string | null; email?: string | null; telegram?: string | null };
export type ProposalVars = { sphere: OrgSphere; companyName?: string | null; recipientName?: string | null;
  promo?: ProposalPromo | null; ctaUrl?: string | null; sender?: ProposalSender | null };
export const PROPOSAL_SPHERES: Array<{ sphere: OrgSphere; label: string }>;
export async function renderProposalPdf(vars: ProposalVars): Promise<Buffer>;
export async function renderProposalEmail(vars: ProposalVars, opts?: { webUrl?: string | null; unsubscribeUrl?: string | null;
  trackUrl?: (url: string) => string }): Promise<{ subject: string; preheader: string; html: string; text: string }>;
export function proposalWebUrl(vars: ProposalVars, baseUrl?: string): string; // /kp/<подписанный токен>
```

## Файлы
| Файл | Что |
|---|---|
| `src/lib/proposal/types.ts` | типы из спеки (без сервера — их читает клиент ROOT) |
| `src/lib/proposal/spheres.ts` | `PROPOSAL_SPHERES` + тексты под сферу: «для кого», кто заполняет, где QR, 3–5 преимуществ, у каждого — коды журналов из `SPHERE_RULES` |
| `src/lib/proposal/price.ts` | чистый расчёт цены: тариф → акция → промокод (навсегда / до даты / фикс), зачёркнутая цена, «после акции» |
| `src/lib/proposal/cta.ts` | ссылка CTA и QR: промокод → `https://wesetup.ru/promo/<CODE>?s=<sphere>`, иначе нишевая страница сферы (регистрация сферу не принимает), `other` → `/register` |
| `src/lib/proposal/token.ts` | подписанный токен веб-версии: `base64url(JSON).HMAC-SHA256(секрет, "kp:" + тело)`, `proposalWebUrl` |
| `src/lib/proposal/sender.ts` | нормализация и проверка отправителя (чистая) |
| `src/lib/proposal/content.ts` | чистая модель страницы: заголовок, шаги, преимущества, журналы («и ещё N»), блок предложения, контакты, реквизиты — один источник для PDF, письма и веба |
| `src/lib/proposal/context.server.ts` | данные на момент отрисовки: тариф, акция, бесплатный период, реквизиты, готовность счёта, отправитель по умолчанию (`PlatformSetting` `proposal.sender`) |
| `src/lib/proposal/pdf-font.ts` | шрифт PDF — Manrope (шрифт сайта) статическими начертаниями |
| `src/lib/pdf-fonts/Manrope-*.ttf` | статические Regular/SemiBold/Bold из `src/app/fonts/manrope-variable.ttf` (fontTools instancer; jsPDF не умеет variable), OFL |
| `src/lib/proposal/pdf.ts` | jsPDF А4, одна страница; раскладка с измерением текста, сжатие при нехватке места, учёт габаритов всего нарисованного |
| `src/lib/proposal/email.ts` | письмо: таблицы 600 px, инлайн-стили, медиазапросы, VML-кнопка, прехедер, тёмная схема, текстовая версия |
| `src/lib/proposal/index.ts` | публичный интерфейс (сигнатуры выше) + логи `[kp]` |
| `src/app/kp/[token]/page.tsx` | веб-версия: noindex, адаптив, «Скачать PDF» |
| `src/app/kp/[token]/pdf/route.ts` | PDF по токену (inline / `?download=1`) |
| `src/app/api/kp/qr/[code]/route.ts` | PNG фирменного QR только для `https://wesetup.ru/promo/<CODE>?s=<sphere>` (формат кода и сфера проверяются) |
| `src/app/root/proposals/page.tsx`, `proposals-client.tsx` | ROOT-генератор: форма, предпросмотр PDF и письма (390/600), кнопки |
| `src/app/api/root/proposals/route.ts` | POST: предпросмотр (токен, ссылки, письмо, предупреждения) |
| `src/app/api/root/proposals/issue/route.ts` | POST: «Скачать PDF» / «Скопировать ссылку» — аудит + ссылки |
| `src/app/api/root/proposals/sender/route.ts` | GET/PUT отправителя по умолчанию (аудит) |
| `src/app/api/root/proposals/test-email/route.ts` | POST: тестовое письмо на почту текущего ROOT (аудит; без SMTP — лог) |
| `src/components/root/root-nav.tsx` | пункт «Коммерческие предложения» в «Деньги и продажи» |

## Решения
- **Честность по построению**: у каждого преимущества — коды журналов, тест сверяет их с `SPHERE_RULES` сферы и каталогом;
  числа — только из констант; «фото термометра — на подписке» (`hasPaidPlan` в `/api/ocr/reading`); «по счёту для юрлиц» —
  только если `invoiceRequisitesReady`; «обязательные» — только `electronicRequired` сферы, остальное — «рекомендуем».
  Салон красоты и фитнес — без «ХАССП» в заголовке (им пищевые журналы не нужны — так в `SPHERE_RULES`).
- **Цена**: база `PlatformTariff`, действующая акция, промокод поверх акции (как на оплате). Истёкший промокод не
  применяется, на веб-версии — пометка. Не-lifetime код: «по промокоду, действует до …» (скидка на оплату по коду),
  lifetime: «скидка навсегда».
- **Токен** без срока (КП открывают через недели), без времени выпуска — одни и те же данные дают одну ссылку.
- **CTA без промокода**: регистрация сферу не принимает (проверено `register-client.tsx`) → нишевая страница сферы
  (`NICHES`), для `other` — `/register`. Одна функция `proposalCtaUrl` — после слияния с promo-personal (если регистрация
  научится сфере) меняется в одном месте.
- **Картинки письма** — абсолютные `https://wesetup.ru/…` (как `EMAIL_ASSET_ORIGIN`); QR-картинка только при промокоде.
- **Две композиции А4** (A — сверху вниз, предложение внизу; B — колонка предложения справа): PNG бок о бок, выбор с
  обоснованием в `evidence.md`, в коде остаётся выбранная.

## Проверки
- Юнит: токен (подпись, подмена, чужой контекст, формат), цена (навсегда / до даты / фикс / с акцией / истёк), CTA,
  контент всех сфер (журналы из правил, нет «бланк», нет магазинов приложений), письмо (размер < 100 КБ, абсолютные
  ссылки, `trackUrl` кроме отписки, `alt`, прехедер, текстовая версия), PDF — одна страница на всей матрице.
- Скрипты задачи: матрица PDF (все сферы × {без промокода, 10 % навсегда, до даты} × {короткое, 80 знаков}) —
  одна страница, текст в полях (pdf.js), QR читается (jsQR + zxing) в правильный URL; PNG 150 dpi для 5 сфер.
- Письмо: скриншоты Chromium 375/600 × светлая/тёмная × 3 сферы, размер, ссылки, текст.
- E2E 390/1280: веб-версия (+PDF), ROOT-генератор (предпросмотр, 390/600, ссылка, PDF, тест-письмо в лог, аудит).
- `npm run typecheck`, `npm test`; целостность файлов перед каждым коммитом (`git update-index --really-refresh`).
