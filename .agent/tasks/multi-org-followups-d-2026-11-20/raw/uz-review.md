# Р11 — review of Uzbek (Latin) texts added/changed by series A–D

Scope: `src/i18n/messages/uz.json` (working tree) compared with `02d0bcc6e:src/i18n/messages/uz.json`
(before series A), nested keys flattened.

- Keys reviewed: **263** (257 new, 6 changed); each checked against `ru.json` (and `en.json`) for the same key.
- Keys fixed: **18** (only in `uz.json`, written by one Python script: load → set → `json.dumps(..., ensure_ascii=False, indent=2) + "\n"`; the diff is exactly 18 value lines).
- `npm run i18n:types` — regenerated; `npm run i18n:check` — **100 pass, 0 fail**.

## Automatic checks over all 263 keys

- Placeholders: the `{…}` argument set matches ru in every key; ICU intact; plurals use only `other`
  (e.g. `{count, plural, other {# ta nuqta}}`, `{days, plural, other {# kunga}}`) — valid for uz.
- Apostrophes: the file style is `‘` U+2018 for oʻ/gʻ (13 354 uses vs 585 `ʻ`) and `’` U+2019 for the
  tutuq belgisi (`ma’lumot`, `me’yor`, `mas’ul`). All 263 keys already follow it; no `'`, `ʻ`, `ʼ`.
- Quotes: «…» throughout; no straight or “…” quotes.
- Cyrillic: only `«[Проверка]»` in `rootMailingShellAudience.exchangeLetters.description` — kept on purpose:
  it is the literal subject prefix the server puts on sample letters (`SAMPLE_LETTER_SUBJECT_PREFIX` in
  `src/lib/directory-exchange/sample-letters.ts`); en keeps it too.

## Changed keys

| Key | Before | After | Reason |
|---|---|---|---|
| `settingsManagement.balanceClient.account.subtitle` | …o‘tkazma ikkala tashkilot tarixida ko‘rinadi. | …o‘tkazma ikkala tashkilotning balans tafsilotida ko‘rinadi. | «детализация» is «Balans tafsiloti» in the existing balance screens |
| `settingsManagement.balanceClient.account.confirmDescription` | «{from}» dan «{to}» ga. … | «{from}»dan «{to}»ga. … | case suffix is written joined to the closing quote (file: `»ga` 43 vs `» ga` 1) |
| `settingsManagement.balanceClient.account.errors.toDeleting` | «{name}» o‘chirilmoqda — … | «{name}» tashkiloti o‘chirilmoqda — … | «Организация» was lost |
| `settingsManagement.balanceClient.account.errors.tooMany` | Juda ko‘p o‘tkazma ketma-ket. Bir daqiqa kuting. | Ketma-ket juda ko‘p o‘tkazma qilindi. Bir daqiqa kuting. | word order / no verb |
| `settingsManagement.network.totals.unfilled` | Bugun to‘ldirilmagan jurnallari borlar | Bugun to‘ldirilmagan jurnallari bor tashkilotlar | colloquial «borlar»; label counts organizations |
| `settingsManagement.network.journals.status.partial` | hammasi emas | hammasi ham to‘ldirilmagan | «заполнены» was lost («not all» alone) |
| `rootOrganizationManagement.orgTrial.suspicionEnded` | sinov davri tugatilgan | sinov davri tugagan | «закончен» = ended, not «was terminated» |
| `rootOrganizationManagement.orgTrial.extendDescription` | …Bugun va joriy muddatdan kechrog‘idan hisoblanadi… | …«Bugun» va joriy muddatdan qaysi biri kechroq bo‘lsa, shundan hisoblanadi… | awkward grammar; quoted «сегодня» restored |
| `rootOrganizationManagement.orgTrial.clearDescription` | …va muddat bo‘yicha boshqa yopilmaydi. | …va endi muddat bo‘yicha yopilmaydi. | «boshqa» reads as «other»; «больше не» = «endi … -maydi» |
| `rootOrganizationManagement.orgTrial.resetTitle` | Berilgan 14 kunlar hisoblagichi nollansinmi? | Berilgan 14 kunlik davrlar hisoblagichi nollansinmi? | noun after a numeral takes no plural («14 kunlar» is wrong) |
| `dashboardUi.directoryExchange.dialog.menuSeparate` | …menyusi va xomashyosini ulamaydi… | …menyusi va xom ashyosini ulamaydi… | master-cabinet texts (pre-series and the other 4 new ones) say «menyu va xom ashyo» |
| `dashboardUi.directoryExchange.foreign.page.poolLabel` | «{name}» ni kabinet… | «{name}»ni kabinet… | suffix joined to the quote (file: `»ni` 66 vs `» ni` 4) |
| `dashboardUi.directoryExchange.kindHints.checklists` | …Tayinlovlar va namuna fayllar ko‘chirilmaydi | …Biriktirishlar va namuna fayllar ko‘chirilmaydi | checklist «назначение» is «Biriktirish» (menu «Chek-listlarni biriktirish») |
| `dashboardUi.directoryExchange.foreign.kindHints.checklists` | …Tayinlovlar va namuna fayllar uzatilmaydi | …Biriktirishlar va namuna fayllar uzatilmaydi | same |
| `dashboardUi.directoryExchange.transfers.reasons.used` | …datchiklar yoki tayinlovlar | …datchiklar yoki biriktirishlar | same |
| `dashboardUi.directoryExchange.history.reasons.used` | …datchiklar yoki tayinlovlar | …datchiklar yoki biriktirishlar | same |
| `dashboardUi.directoryExchange.transfers.entities.product` | Mahsulot | Tovar | exchange uses «Tovarlar va taomlar» and «tovar» in the undo texts |
| `rootDirectoryExchange.problems.empty` | Barcha kabinetlar oxirgi bir kunda muvaffaqiyatli almashdi. | Barcha kabinetlarda oxirgi bir kun ichida muvaffaqiyatli almashinuv bo‘lgan. | «almashdi» with no object is unclear |

## Terms checked against pre-series uz.json (kept or standardised)

| ru | uz used |
|---|---|
| мастер-кабинет | Master-kabinet / master-kabinet |
| справочник(и) | ma’lumotnoma(lar); обмен справочниками — «Ma’lumotnomalar almashinuvi» |
| обмен | almashinuv |
| перенос (справочников) | ko‘chirish; передаётся (другой компании) — uzatiladi |
| перевод (денег) | o‘tkazma / o‘tkazish |
| точка (тарифа) | nuqta; `{count, plural, other {# ta nuqta}}`; «Добавить точку» — «Nuqta qo‘shish» |
| тариф | tarif |
| организация | tashkilot |
| аккаунт / владелец аккаунта | akkaunt / akkaunt egasi (multi-org texts); учётная запись — hisob |
| сотрудник / должность | xodim / lavozim |
| оборудование / цех / помещение / объект | uskuna / sex / xona / obyekt |
| баланс / детализация | balans / balans tafsiloti |
| бесплатные дни / свои 14 дней / пробный период | bepul kunlar / o‘z 14 kuni / sinov davri |
| назначения (чек-листов) | biriktirishlar (standardised from «tayinlovlar») |
| сырьё (мастер-кабинет) | xom ashyo (standardised; the master-cabinet family uses this spelling) |
| товар | tovar (exchange context) |
| ИНН | STIR |
| «X из Y» | `{total} tadan {count} ta` |

Left as is (acceptable): `{count} / {max}` (pre-series uses «/» too), `{value} s`, the trigger names
«Sozlamalar saqlandi» / «So‘rov tasdiqlandi» (match en), `yaratildi {created}, yangilandi {updated}, …`
(same pattern as the pre-series `card.syncDone`).

A native-speaker review is still recommended (spec Р11).
