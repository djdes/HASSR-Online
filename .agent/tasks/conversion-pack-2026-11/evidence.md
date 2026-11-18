# Evidence — conversion-pack-2026-11

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `autoRequestReviews` в `review-requests.server.ts`, вызывается кроном CRM; тест окна времени (`blank-followup.test.ts`). |
| AC2 | PASS | `/api/public/geo-hint` + эффект в `register-client.tsx` (заполняет только пустое поле); e2e: ответ 200. |
| AC3 | PASS | `callback-button(-client).tsx` на странице журнала; e2e: пустой номер — ошибка, номер — заявка `/api/public/feedback` 200, окно закрылось (`../seo-speed-pack-2026-11/raw/callback.png`). |
| AC4 | PASS | `blank-followup.server.ts`, письмо `buildBlankFollowupEmail` (ru/en/uz), крон `/api/cron/crm`; тесты отбора и шаблона. |
| AC5 | PASS | `landingComponents.tariffs.cta.tryFree` ru/en/uz. |
| AC6 | PASS | Инструкция в отчёте пользователю. |
