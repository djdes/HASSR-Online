# Evidence: QR печатного журнала — в шапке справа, фирменный вид

Спека: `spec.md` (заморожена 2026-09-27), план: `plan.md`. Ветка `feat/journal-qr-header-2026-09-27` от master
f09f6736. Все проверки — на текущем коде ветки, 2026-09-27; сырые данные — `raw/`.

## Что сделано

- **Фирменный QR векторно в jsPDF** — `drawBrandQrTilePdf` (`src/lib/brand-qr.ts`): та же плитка, что у PNG/SVG
  (`brandQrLayout`, вариант `full`): коррекция H, чёрные квадратные модули и «глаза» (подряд идущие модули строки —
  одним прямоугольником), белая скруглённая подложка со знаком сайта (`icon.png`, вырез `MARK_CROP` — обрезкой по
  пути, картинка одна на документ, сжатая), плашка градиентом серый→чёрный из `PLATE_STRIPES` = 24 полос внутри
  скруглённого контура (как SVG), белые «Отсканировать» / «wesetup.ru» жирным, кегль подбирается под плашку.
  Неиспользуемый после правки `drawBrandQrMatrixPdf` (компактная матрица для угла) удалён.
- **QR в шапке** (`src/lib/pdf-journal-qr.ts` + `drawJournalHeader` в `src/lib/document-pdf.ts`): документ с QR
  (`prepareJournalQr`) получает в шапке ХАССП отдельную ячейку справа от колонки «Начат / Окончен · СТР. X ИЗ N» на
  высоту строк организации и названия. Рамка шапки той же ширины, что таблица (правое поле 10 мм), — сужается
  средняя колонка с названием журнала; «Окончен ____» подрезается по своей колонке. Шапка регистрирует ячейку
  (`registerJournalQrSlot`) на каждой своей странице — и на первой, и на каждом повторе; `stampJournalQr` в конце
  рисует плитку по центру ячейки. Строка «Периодичность контроля» идёт под шапкой на всю ширину, как раньше.
- **Размер под высоту шапки** (`journalQrTile`): плитка в две строки шапки — 19,7 мм высотой (ячейка 20 мм, шапка
  не растёт), ширина 16,6 мм. Если модуль при этом меньше 0,365 мм (плотный адрес), плитка выше — до модуля
  0,365 мм, но шапка растёт не больше чем на 4 мм и модуль не меньше 0,35 мм. Плотнее 53 модулей (версия 9) —
  ошибка «адрес нужно укоротить». Почему 0,365 — ниже, в «Размер плитки».
- **Страницы без шапки**: плитка в правом верхнем углу (верх на верхнем поле, правый край вровень с содержимым),
  только если там пусто по учёту чернил (`trackPdfInk`, зазор 1,3 мм); занято — на странице QR нет, строки он не
  сдвигает. Так же работают бланки со своей шапкой (журнал дезсредств, бумажные бланки `paper-journal-pdf.ts`):
  QR справа в их заголовке, над таблицей.
- **Нижнего резерва больше нет**: удалены `reserveJournalQrBottomMargin`, `JOURNAL_QR_BOTTOM_RESERVE_MM`, поиск места
  внизу (`findJournalQrSpot`), сдвиги «СТР. X ИЗ N» и подвала партнёра под QR (`journalQrFooterInset`,
  `journalQrRightEdges`, опции `fallbackRightInset` / `rightReserve`) и второй проход рендера — у документов и у
  бумажных бланков. Таблицы доходят до нижнего поля листа + полоса под «СТР. X ИЗ N» (`journalTableMargin`, как
  было до QR). Подъём нижнего поля под подвал партнёра в две строки остался — перенесён в
  `reserveJournalTableBottom` (`pdf-journal-table.ts`), он к QR не относится.
- **Подпись сбоку от QR убрана**: у плитки своя плашка «Отсканировать / wesetup.ru». У скачанных шаблонов (/qb)
  обязательная строка копирайта осталась на каждой странице — теперь одной строкой внизу слева
  (`JournalPdfQr.footer`, `BLANK_PDF_FOOTER` = «Заполнять с телефона — wesetup.ru · © WeSetup — электронные журналы
  ХАССП и СанПиН · wesetup.ru»). Адреса внутри QR не менялись (`journal-pdf-qr-link.ts` — только подписи).
- Комментарии «в правом нижнем углу» обновлены (pdf-journal-qr, document-pdf, pdf-journal-sheet, pdf-page-labels,
  pdf-journal-table, blank-qr-token, qr-fill-token, маршруты /qj и /qb, образцы PDF); в тексте окна скачивания и
  письма с шаблоном «QR — тому же, что в углу шаблона» → «что на шаблоне» (у Word он по-прежнему в подвале).

## Вариант раскладки: A — ячейка в рамке шапки (выбран), B — блок справа от рамки

| | A — ячейка в рамке шапки | B — блок сразу справа от рамки |
|---|---|---|
| Кадр | `shots/variant-a-header.png`, страница — `screen-periodicity-samples-hygiene-p1.png` | `shots/variant-b-header.png`, страница — `shots/variant-b-samples-hygiene-p1.png` |
| Правый край | рамка шапки и таблица — вровень (правое поле 10 мм), QR внутри последней ячейки | QR вровень с таблицей, а рамка шапки короче таблицы на ширину QR + 2 мм — «ступенька» справа |
| Шапка | одна рамка, как у всех бланков; QR — её пятая ячейка | две фигуры: рамка и отдельная плитка |
| Строка «Периодичность» | на всю ширину под QR, как раньше | обрывается раньше таблицы |

Выбран **A**. Владелец просил встроить QR в шапку («как её часть»), а аудит бланков требует, чтобы штамп ХАССП и
таблица были одной ширины (без «ступеньки», `document-pdf.ts`, аудит r5 п. 2). В A рамка шапки остаётся ровно
над таблицей, QR — её ячейка; в B рамка становится короче таблицы, и справа видна та самая ступенька. По
чтению варианты равны: B проверен тем же `decode-matrix.ts` на 6 длинных документах (10 страниц, 49–53 модуля,
ещё с модулем 0,35 мм) — приёмка jsQR 80/80, zxing-cpp 80/80, стресс как у A (`raw/decode-long-variant-b.json`). B снят временной правкой
`drawJournalHeader` — патч `variant-b.patch` в этой папке (в коде не остался).

## Размер плитки

Плитка — фирменная пропорция (ширина = матрица + тихая зона 2 модуля, высота ×1,185 — с плашкой). Ячейка = плитка
+ 0,15 мм до линий. Строки организации и названия — 10 + 10 мм; QR встаёт в них, если модуль там не меньше
0,365 мм, иначе строки растут до модуля 0,365 мм, но не больше чем на 4 мм (модуль при этом ≥ 0,35 мм — пол спеки).

Почему 0,365, а не 0,35: первый полный прогон распознавания был с ростом «ровно до 0,35 мм» — jsQR не прочитал
1 снимок из 1256 приёмочных (длинный документ гигиены, стр. 2, ч/б + телефон 300 dpi). Опыт
`raw/target-module-experiment.txt` (настоящие шапки, 12 поворотов ±5…10°, лёгкий и жёсткий «телефон»): 49
модулей при 0,35 мм — jsQR 70/72 на лёгком ч/б + телефоне, при 0,365 мм — 72/72 (и 144/144 на лёгком); zxing-cpp
— все снимки при обоих. Спека разрешает рост «только если без этого не читается» — здесь это и есть. Страниц
от этого нигде не прибавилось (таблица ниже снята уже с 0,365).

| Адрес | Пример | Модулей (H) | Плитка, мм (ш × в) | Модуль, мм | Рост шапки |
|---|---|---|---|---|---|
| образец `/journals-info/<код>` | hygiene, med_books | 37 | 16,6 × 19,7 | 0,405 | нет |
| образец `/journals-info/<код>` | большинство журналов | 41 | 16,6 × 19,7 | 0,369 | нет |
| образец `/journals-info/<код>` (код ≥ 22 символов) | incoming_raw_materials_control, cleaning_ventilation_checklist | 45 | 17,9 × 21,2 | 0,365 | +1,5 мм |
| документ `/qj/<org>/<код>/<подпись>` | код ≤ 23 символов (42 журнала) | 49 | 19,3 × 22,9 | 0,365 | +3,2 мм |
| документ `/qj/…` | код 24–30 символов (3 журнала) | 53 | 20,0 × 23,7 | 0,351 | +4,0 мм |
| шаблон `/qb/<токен>` без почты / почта ≤ 32 байт | скачанный шаблон | 45–53 | 17,9–20,0 × 21,2–23,7 | 0,351–0,365 | +1,5…+4,0 мм |

Самый плотный адрес — 53 модуля: 20,0 × 23,7 мм, шапка +4,0 мм (предел спеки), модуль 0,351 мм. Плотнее не
бывает: `journalQrTile` бросает ошибку, `blankQrUrl` для почты длиннее 32 байт выдаёт токен без почты
(`fitsJournalQr`).

## Итог по критериям

| AC | Итог | Коротко |
|---|---|---|
| AC1 — QR в шапке справа, фирменный вид, на каждой странице с шапкой | **PASS** | на всех 313 страницах с шапкой ХАССП из 5 наборов QR стоит в её ячейке (проверка «шапка есть ⇔ QR в шапке» по тексту страницы); фирменная плитка; скриншоты |
| AC2 — нижнего резерва нет; страниц нигде не больше | **PASS** | резерв и второй проход удалены; 186 PDF: больше — 0, меньше — 8 (длинные: 581 → 486 стр., план аудитов 394 → 309) |
| AC3 — 100 % распознавание всех вариантов | **ЧАСТИЧНО** | 300 dpi (чистый, ч/б, ч/б-принтер, телефон, ч/б + телефон) — jsQR и zxing-cpp 785/785 + 785/785; 150 dpi — zxing-cpp 471/471, jsQR 389/471: чистый и ч/б-принтер при 150 dpi (≈ 2 px на модуль) jsQR читает не при любой фазе сетки — см. ниже |
| AC4 — перекрытий нет, скриншоты, typecheck и тесты | **PASS** | check-qr-overlap: 231/231 бланков, 728 страниц — 0 чернил на месте QR до штампа, 0 пикселей вне QR, 0 расхождений модулей; typecheck чистый; тесты 2624/2624 |

### AC1 — QR в шапке, фирменный вид — PASS

- `check-qr-overlap.ts` (финальный прогон, `raw/check-overlap-*.json`): на каждой странице, где есть шапка ХАССП
  (текст «СИСТЕМА ХАССП»), QR стоит в её ячейке, а где шапки нет — не в шапке: образцы 54/57 страниц в шапке,
  шаблоны 54/57, длинные документы 93/486, с подвалом партнёра 59/62, книжный лист 53/56; бумажные бланки — справа
  в своём заголовке на первой странице (5/5). Правый край ячейки QR (рамка шапки) — вровень с правой границей
  содержимого страницы по растру: макс. разница 0,27 мм (пиксель 100 dpi — 0,25 мм).
- Фирменный вид — `drawBrandQrTilePdf`: модули по растру 600 dpi совпадают с матрицей H (тест
  `pdf-journal-qr.test.ts`, проверка — 0 расхождений на всех страницах с QR), знак сайта, плашка с градиентом и
  надписями (тест `brand-qr.test.ts` — две обрезки, одна картинка, надписи «Отсканировать» / «wesetup.ru»).
- Скриншоты (100 dpi, страница целиком): `screen-landscape-long-med_books-p2.png` (альбомный лист, повтор шапки,
  QR документа 49 модулей), `screen-portrait-cold_equipment_control-p1.png` (книжный лист; самое длинное название
  журнала — 4 строки в средней колонке, ячейка QR выше плитки, плитка по центру),
  `screen-periodicity-samples-hygiene-p1.png` (с «Периодичностью контроля»),
  `screen-longest-title-long-cold_equipment_control-p1.png` (самое длинное название на альбомном листе — 2 строки).
  Ещё: `shots/variant-a-header.png`, `shots/variant-b-header.png`, `shots/variant-b-samples-hygiene-p1.png`,
  `shots/paper-ot_intro-p1.png` (бумажный бланк: QR справа в заголовке, копирайт внизу),
  `shots/cleaning_ventilation-p2-overflow.png` и `shots/master-cleaning_ventilation-p2-overflow.png` (известное
  вылезание таблицы на шапку — сейчас и на master).

### AC2 — нижнего резерва нет, страниц не больше — PASS

Резерв `JOURNAL_QR_BOTTOM_RESERVE_MM` (24,4 мм снизу у всех таблиц) и второй проход рендера удалены у документов
и бумажных бланков; таблицы доходят до нижнего поля листа + полоса 4 мм под «СТР. X ИЗ N» (тест
`pdf-journal-sheet.test.ts` «полная страница таблицы…» — книжный и альбомный лист, у каждой полной страницы низ
таблицы в пределах одной строки от этой линии). Число страниц (одни и те же входы, `pages.ts`, база — master
f09f6736): **186 PDF — больше ни у одного, меньше у 8**: климат 30 → 27, чек-лист уборки 10 → 9, план обучения
28 → 25, дезсредства 13 → 12, поверка 4 → 3, план аудитов 394 → 309, перечень стекла 5 → 4, гигиена по
Приложению №1 6 → 5. Всего 768 → 672 страницы. Таблица по каждому бланку — ниже.

### AC3 — распознавание — ЧАСТИЧНО

157 страниц 140 бланков (образцы, шаблоны /qb с самой длинной помещающейся почтой — 53 модуля, длинные документы
с QR /qj — 49/53 модуля, бумажные бланки): первая страница и первый повтор шапки. Сетка пикселей снимка — от края
листа, как у принтера и сканера (`qr-sim.ts`).

- **300 dpi — 100 % обоими:** чистый, ч/б (серый + порог), ч/б принтер, «телефон» (поворот 5–10°, перспектива 4 %,
  размытие σ 0,6 px, JPEG 90), ч/б + телефон — jsQR 785/785, zxing-cpp 785/785. Фаза сетки на 300 dpi не влияет:
  `raw/phase-sweep.txt` — 4 фазы × 3 снимка × 6 плиток (37–53 модуля) читают оба декодера все.
- **150 dpi — zxing-cpp 100 %, jsQR — нет:** ч/б (серый + порог) — оба 157/157; чистый — jsQR 123/157, ч/б принтер
  — jsQR 109/157; zxing-cpp — 157/157 каждый. На 150 dpi модуль 0,35–0,405 мм — 2,1–2,4 px, и jsQR читает код или
  нет в зависимости от того, как границы модулей легли на пиксели: `raw/phase-sweep.txt` — 16 фаз (шаг ¼ px) у
  каждой плитки: zxing-cpp 16/16 везде, jsQR 11–16 из 16 — даже у 41-модульной плитки образца без роста шапки
  (0,369 мм: 14/16 и 15/16). Первый прогон с сеткой, привязанной к кадру вокруг QR (одна «удачная» фаза для всех
  плиток), давал jsQR 157/157 и на 150 dpi — это случай фазы, а не свойство кода; в приёмку взята честная сетка от
  края листа.
- **Почему не исправить размером:** по фазам (`raw/phase-sweep.txt`) jsQR на 150 dpi уверенно читает с модуля
  ~0,4 мм (37-модульный образец, 0,405 мм — 16/16 фаз); на 0,35–0,37 мм — 11–16 из 16 в зависимости от кода и
  фазы. Документам (49–53 модуля) модуль 0,4 мм — это плитка 25–27 мм и шапка выше на 5,4–7,3 мм при пределе спеки
  4 мм. Внутри предела можно поднять цель с 0,365 до 0,4 мм (одна константа `JOURNAL_QR_TARGET_MODULE_MM`):
  образцы и шаблоны до 45 модулей дойдут до 0,4 мм (шапка +1,6…3,5 мм, у 41-модульных образцов она сейчас не
  растёт вовсе), документы — до 0,377 / 0,351 мм (+4 мм) — промахи jsQR на 150 dpi станут реже, но не исчезнут.
  Не сделал: спека просит «по возможности шапка не растёт», а zxing-cpp и 300 dpi уже 100 %. Прежний угловой QR
  (0,317 мм) на 150–200 dpi jsQR тоже читал не всегда (`qr-brand-2026-09/evidence.md`: «угловой QR 13 мм … при
  150–200 dpi»).
- **Стресс** (в приёмку не входит): «телефон» при 150 dpi — zxing-cpp 157/157, jsQR 36/157; ч/б + телефон 150 dpi
  — 157/157 и 26/157; «жёсткий телефон» (перспектива 8 %, σ 0,8, JPEG 85) при 300 dpi — zxing-cpp 157/157 и
  157/157, jsQR 132/157 и 122/157; при 150 dpi — zxing-cpp 156/157 и 155/157, jsQR 2/157 и 0/157.

Решение для владельца/оркестратора: либо принять «300 dpi — оба декодера, 150 dpi — zxing-cpp» (телефон, поднесённый
к шапке, снимает её с разрешением в разы выше 300 dpi; современные сканеры — уровня zxing и выше), либо разрешить
шапке расти больше чем на 4 мм (или убрать плашку у QR в шапке — модуль +18 %).

### AC4 — перекрытий нет, скриншоты, typecheck и тесты — PASS

- `check-qr-overlap.ts` (переписан под шапку) по всем наборам: **231/231 бланков OK**, 728 страниц — чернил пробы на
  месте QR 0 (кроме 3 страниц синтетического чек-листа уборки, где таблица и на master печатается поверх шапки —
  `knownOverflow`, плитка поверх и читается), вне QR штамп не изменил ни пикселя, расхождений модулей 0, поля
  листа 10 ± 1 мм сверху/слева/справа и ≥ 9 мм снизу на всех страницах (кроме бумажных бланков — их поля не
  выравнивались и только записаны).
- Скриншоты — см. AC1.
- `tsc --noEmit -p tsconfig.typecheck.json` — без ошибок; тесты — **2624/2624** (хук pre-commit обоих коммитов с
  кодом: `raw/commit-hooks.txt`, `raw/commit-hooks-2.txt`). Обновлены `pdf-journal-qr.test.ts` (плитка: размер,
  рост шапки, предел плотности; место без шапки; штамп в ячейках книжной и альбомной страницы с проверкой модулей
  по растру 600 dpi; надписи плашки, строка копирайта, проба) и `pdf-journal-sheet.test.ts` (полная страница
  таблицы — без резерва; QR в шапке на каждой странице с шапкой у 5 образцов × 2 плотности адреса — внутри полей,
  ячейка у правого поля, модуль ≥ 0,35 мм, текст страницы не заходит на плитку), а также `brand-qr.test.ts`,
  `blank-qr-token.test.ts`, `journal-pdf-qr-link.test.ts`, `journal-order-scans.test.ts`.

## Таблицы (raw/tables.md)

### Страниц на master → сейчас (одни и те же входы)

| Журнал | образец | шаблон /qb | длинный документ | с подвалом партнёра |
|---|---|---|---|---|
| hygiene | 2 → 2 | 2 → 2 | 7 → 7 | 2 → 2 |
| health_check | 1 → 1 | 1 → 1 | 4 → 4 | 1 → 1 |
| climate_control | 2 → 2 | 2 → 2 | **30 → 27** | 2 → 2 |
| cold_equipment_control | 1 → 1 | 1 → 1 | 4 → 4 | 1 → 1 |
| cleaning_ventilation_checklist | 6 → 6 | 6 → 6 | **10 → 9** | 6 → 6 |
| cleaning | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| general_cleaning | 1 → 1 | 1 → 1 | 6 → 6 | 1 → 1 |
| uv_lamp_runtime | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| finished_product | 1 → 1 | 1 → 1 | 4 → 4 | 1 → 1 |
| perishable_rejection | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| incoming_control | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| fryer_oil | 2 → 2 | 2 → 2 | 2 → 2 | 2 → 2 |
| med_books | 3 → 3 | 3 → 3 | 3 → 3 | 3 → 3 |
| training_plan | 1 → 1 | 1 → 1 | **28 → 25** | 1 → 1 |
| staff_training | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| disinfectant_usage | 1 → 1 | 1 → 1 | **13 → 12** | 1 → 1 |
| sanitary_day_control | 2 → 2 | 2 → 2 | 9 → 9 | 2 → 2 |
| equipment_maintenance | 1 → 1 | 1 → 1 | 5 → 5 | 1 → 1 |
| breakdown_history | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| equipment_calibration | 1 → 1 | 1 → 1 | **4 → 3** | 1 → 1 |
| incoming_raw_materials_control | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| ppe_issuance | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| accident_journal | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| complaint_register | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| product_writeoff | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| audit_plan | 2 → 2 | 2 → 2 | **394 → 309** | 2 → 2 |
| audit_protocol | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| audit_report | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| traceability_test | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| metal_impurity | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| equipment_cleaning | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| intensive_cooling | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| glass_items_list | 1 → 1 | 1 → 1 | **5 → 4** | 1 → 1 |
| glass_control | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| pest_control | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| daily_samples | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| vitaminization | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| ration_control | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| transport_temperature | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| tableware_breakage | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| pool_water_control | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| inventory_condition | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| instrument_sterilization | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| medical_waste_b | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| batch_release | 1 → 1 | 1 → 1 | 3 → 3 | 1 → 1 |
| гигиена по Приложению №1 (образец) | — | — | — | **6 → 5** |

| Бумажный бланк (шаблон /qb) | Страниц master → сейчас |
|---|---|
| ot_intro | 2 → 2 |
| ot_workplace | 2 → 2 |
| fire_safety | 2 → 2 |
| fire_extinguishers | 2 → 2 |
| electrical_safety | 2 → 2 |

| Набор | PDF | Страниц master | Страниц сейчас | Меньше | Больше | Размер PDF master → сейчас, МБ |
|---|---|---|---|---|---|---|
| samples | 45 | 57 | 57 | 0 | 0 | 16.9 → 18.1 |
| blanks | 45 | 57 | 57 | 0 | 0 | 17.8 → 19.5 |
| long | 45 | 581 | 486 | 7 | 0 | 147.4 → 113.1 |
| paper | 5 | 10 | 10 | 0 | 0 | 2.0 → 2.0 |
| variants | 46 | 63 | 62 | 1 | 0 | 17.7 → 18.9 |

### Проверка «ничего не перекрыто» (check-qr-overlap.ts)

| Набор | Бланков OK | Страниц | QR в шапке | QR в углу (нет шапки) | Без QR | Чернил пробы на месте QR (макс.) | Изменено штампом вне QR (макс., px) | Расхождений модулей (макс.) | «Вровень», макс. разница, мм | Поля 10 ± 1 (верх/лево/право), низ ≥ 9 | Известное вылезание таблицы на шапку |
|---|---|---|---|---|---|---|---|---|---|---|---|
| samples | 45/45 | 57 | 54 | 1 | 2 | 0 | 0 | 0 | 0.27 | 57/57 | — |
| blanks | 45/45 | 57 | 54 | 1 | 2 | 0 | 0 | 0 | 0.27 | 57/57 | — |
| long | 45/45 | 486 | 93 | 4 | 389 | 0 | 0 | 0 | 0.27 | 486/486 | cleaning_ventilation_checklist стр. 2, cleaning_ventilation_checklist стр. 3, cleaning_ventilation_checklist стр. 4 |
| paper | 5/5 | 10 | 0 | 5 | 5 | 0 | 0 | 0 | 0.27 | 10/10 | — |
| variants | 46/46 | 62 | 59 | 1 | 2 | 0 | 0 | 0 | 0.27 | 62/62 | — |
| portrait | 45/45 | 56 | 53 | 0 | 3 | 0 | 0 | 0 | 0.17 | 56/56 | — |

### Страницы без шапки

| Набор | Журнал | Страниц | QR в шапке | QR в правом верхнем углу (свободен) | Без QR (угол занят таблицей) |
|---|---|---|---|---|---|
| samples | disinfectant_usage | 1 | — | 1 | — |
| samples | sanitary_day_control | 2 | 1 | — | 2 |
| samples | audit_plan | 2 | 1 | — | 2 |
| blanks | disinfectant_usage | 1 | — | 1 | — |
| blanks | sanitary_day_control | 2 | 1 | — | 2 |
| blanks | audit_plan | 2 | 1 | — | 2 |
| long | general_cleaning | 6 | 1 | — | 2–6 |
| long | finished_product | 4 | 1 | — | 2–4 |
| long | training_plan | 25 | 1 | — | 2–25 |
| long | disinfectant_usage | 12 | — | 1 | 2–12 |
| long | sanitary_day_control | 9 | 1 | 9 | 2–8 |
| long | equipment_maintenance | 5 | 1 | — | 2–5 |
| long | equipment_calibration | 3 | 1 | — | 2–3 |
| long | audit_plan | 309 | 1 | — | 2–309 |
| long | audit_protocol | 3 | 1 | — | 2–3 |
| long | audit_report | 3 | 1 | 2–3 | — |
| long | glass_items_list | 4 | 1 | — | 2–4 |
| long | daily_samples | 3 | 1 | — | 2–3 |
| long | vitaminization | 3 | 1 | — | 2–3 |
| long | ration_control | 3 | 1 | — | 2–3 |
| long | transport_temperature | 3 | 1 | — | 2–3 |
| long | tableware_breakage | 3 | 1 | — | 2–3 |
| long | pool_water_control | 3 | 1 | — | 2–3 |
| long | inventory_condition | 3 | 1 | — | 2–3 |
| long | instrument_sterilization | 3 | 1 | — | 2–3 |
| long | medical_waste_b | 3 | 1 | — | 2–3 |
| long | batch_release | 3 | 1 | — | 2–3 |
| paper | ot_intro | 2 | — | 1 | 2 |
| paper | ot_workplace | 2 | — | 1 | 2 |
| paper | fire_safety | 2 | — | 1 | 2 |
| paper | fire_extinguishers | 2 | — | 1 | 2 |
| paper | electrical_safety | 2 | — | 1 | 2 |
| variants | partner-disinfectant_usage | 1 | — | 1 | — |
| variants | partner-sanitary_day_control | 2 | 1 | — | 2 |
| variants | partner-audit_plan | 2 | 1 | — | 2 |
| portrait | disinfectant_usage | 2 | — | — | 1–2 |
| portrait | sanitary_day_control | 2 | 1 | — | 2 |

### Распознавание — сводка (все бланки, первая страница и повтор шапки)

| Снимок | dpi | px на модуль | jsQR | zxing-cpp | В приёмке |
|---|---|---|---|---|---|
| чистый | 150 | 2.1–2.4 | 123/157 | 157/157 | да |
| ч/б (серый + порог) | 150 | 2.1–2.4 | 157/157 | 157/157 | да |
| ч/б принтер | 150 | 2.1–2.4 | 109/157 | 157/157 | да |
| телефон | 150 | 2.1–2.4 | 36/157 | 157/157 | стресс |
| ч/б + телефон | 150 | 2.1–2.4 | 26/157 | 157/157 | стресс |
| телефон жёстко | 150 | 2.1–2.4 | 2/157 | 156/157 | стресс |
| ч/б + телефон жёстко | 150 | 2.1–2.4 | 0/157 | 155/157 | стресс |
| чистый | 300 | 4.1–4.8 | 157/157 | 157/157 | да |
| ч/б (серый + порог) | 300 | 4.1–4.8 | 157/157 | 157/157 | да |
| ч/б принтер | 300 | 4.1–4.8 | 157/157 | 157/157 | да |
| телефон | 300 | 4.1–4.8 | 157/157 | 157/157 | да |
| ч/б + телефон | 300 | 4.1–4.8 | 157/157 | 157/157 | да |
| телефон жёстко | 300 | 4.1–4.8 | 132/157 | 157/157 | стресс |
| ч/б + телефон жёстко | 300 | 4.1–4.8 | 122/157 | 157/157 | стресс |

Приёмка: jsQR **1174/1256**, zxing-cpp **1256/1256** (140 бланков, 157 страниц).

### Распознавание по бланкам и страницам

J — jsQR, Z — zxing-cpp, «·» — не прочитал. Порядок в группе: чистый / ч/б / ч/б принтер / телефон / ч/б + телефон; стресс — телефон и ч/б + телефон жёстко.

| Набор | Журнал | Стр. | n | Модуль, мм | Угол | 150 dpi | 300 dpi | Стресс 300 | Стресс 150 (телефон) |
|---|---|---|---|---|---|---|---|---|---|
| samples | hygiene | 1 | 37 | 0.406 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z JZ ·Z ·Z |
| samples | hygiene | 2 (повтор) | 37 | 0.406 | 6° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| samples | health_check | 1 | 41 | 0.369 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | climate_control | 1 | 41 | 0.369 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| samples | climate_control | 2 (повтор) | 41 | 0.369 | 10° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z JZ ·Z ·Z |
| samples | cold_equipment_control | 1 | 41 | 0.369 | -5° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | cleaning_ventilation_checklist | 1 | 45 | 0.365 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | cleaning_ventilation_checklist | 2 (повтор) | 45 | 0.365 | 8° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | cleaning | 1 | 37 | 0.406 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ JZ ·Z |
| samples | general_cleaning | 1 | 41 | 0.369 | 5° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | uv_lamp_runtime | 1 | 41 | 0.369 | -7° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | finished_product | 1 | 41 | 0.369 | 9° | ·Z JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| samples | perishable_rejection | 1 | 41 | 0.369 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | incoming_control | 1 | 41 | 0.369 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| samples | fryer_oil | 1 | 37 | 0.406 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| samples | fryer_oil | 2 (повтор) | 37 | 0.406 | -10° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z JZ ·Z |
| samples | med_books | 1 | 37 | 0.406 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | med_books | 2 (повтор) | 37 | 0.406 | 6° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| samples | training_plan | 1 | 41 | 0.369 | -7° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | staff_training | 1 | 41 | 0.369 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| samples | disinfectant_usage | 1 | 41 | 0.369 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| samples | sanitary_day_control | 1 | 41 | 0.369 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| samples | equipment_maintenance | 1 | 41 | 0.369 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| samples | breakdown_history | 1 | 41 | 0.369 | 5° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | equipment_calibration | 1 | 41 | 0.369 | -7° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | incoming_raw_materials_control | 1 | 45 | 0.365 | 9° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| samples | ppe_issuance | 1 | 41 | 0.369 | -5° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·· ·Z |
| samples | accident_journal | 1 | 41 | 0.369 | 7° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | complaint_register | 1 | 41 | 0.369 | -9° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z JZ ·Z ·Z |
| samples | product_writeoff | 1 | 41 | 0.369 | 5° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | audit_plan | 1 | 37 | 0.406 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| samples | audit_protocol | 1 | 41 | 0.369 | 9° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | audit_report | 1 | 41 | 0.369 | -5° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | traceability_test | 1 | 41 | 0.369 | 7° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | metal_impurity | 1 | 41 | 0.369 | -9° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ ·Z | JZ JZ ·Z ·Z |
| samples | equipment_cleaning | 1 | 41 | 0.369 | 5° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | intensive_cooling | 1 | 41 | 0.369 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | glass_items_list | 1 | 41 | 0.369 | 9° | ·Z JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| samples | glass_control | 1 | 41 | 0.369 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | pest_control | 1 | 41 | 0.369 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| samples | daily_samples | 1 | 41 | 0.369 | -9° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z JZ ·Z ·Z |
| samples | vitaminization | 1 | 41 | 0.369 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | ration_control | 1 | 41 | 0.369 | -7° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | transport_temperature | 1 | 41 | 0.369 | 9° | ·Z JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| samples | tableware_breakage | 1 | 41 | 0.369 | -5° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | pool_water_control | 1 | 41 | 0.369 | 7° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | inventory_condition | 1 | 41 | 0.369 | -9° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| samples | instrument_sterilization | 1 | 41 | 0.369 | 5° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | medical_waste_b | 1 | 41 | 0.369 | -7° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| samples | batch_release | 1 | 41 | 0.369 | 9° | JZ JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| blanks | hygiene | 1 | 53 | 0.351 | -5° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | hygiene | 2 (повтор) | 53 | 0.351 | -6° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | ·Z JZ | ·Z ·Z ·Z ·Z |
| blanks | health_check | 1 | 53 | 0.351 | 7° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| blanks | climate_control | 1 | 53 | 0.351 | -9° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | climate_control | 2 (повтор) | 53 | 0.351 | -10° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | ·Z JZ | ·Z ·Z ·Z ·Z |
| blanks | cold_equipment_control | 1 | 53 | 0.351 | 5° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| blanks | cleaning_ventilation_checklist | 1 | 53 | 0.351 | -7° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·· |
| blanks | cleaning_ventilation_checklist | 2 (повтор) | 53 | 0.351 | -8° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| blanks | cleaning | 1 | 53 | 0.351 | 9° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z JZ ·Z ·Z |
| blanks | general_cleaning | 1 | 53 | 0.351 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | uv_lamp_runtime | 1 | 53 | 0.351 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | finished_product | 1 | 53 | 0.351 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | perishable_rejection | 1 | 53 | 0.351 | 5° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| blanks | incoming_control | 1 | 53 | 0.351 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| blanks | fryer_oil | 1 | 53 | 0.351 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z JZ ·Z ·Z |
| blanks | fryer_oil | 2 (повтор) | 53 | 0.351 | 10° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | med_books | 1 | 53 | 0.351 | -5° | ·Z JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | med_books | 2 (повтор) | 53 | 0.351 | -6° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | ·Z JZ | ·Z ·Z ·Z ·Z |
| blanks | training_plan | 1 | 53 | 0.351 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| blanks | staff_training | 1 | 53 | 0.351 | -9° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | ·Z JZ | ·Z ·Z ·Z ·Z |
| blanks | disinfectant_usage | 1 | 53 | 0.351 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| blanks | sanitary_day_control | 1 | 53 | 0.351 | -7° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| blanks | equipment_maintenance | 1 | 53 | 0.351 | 9° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z JZ ·Z ·Z |
| blanks | breakdown_history | 1 | 53 | 0.351 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | equipment_calibration | 1 | 53 | 0.351 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| blanks | incoming_raw_materials_control | 1 | 53 | 0.351 | -9° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | ppe_issuance | 1 | 53 | 0.351 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | accident_journal | 1 | 53 | 0.351 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| blanks | complaint_register | 1 | 53 | 0.351 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | product_writeoff | 1 | 53 | 0.351 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | audit_plan | 1 | 53 | 0.351 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| blanks | audit_protocol | 1 | 53 | 0.351 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| blanks | audit_report | 1 | 53 | 0.351 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | traceability_test | 1 | 53 | 0.351 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| blanks | metal_impurity | 1 | 53 | 0.351 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | equipment_cleaning | 1 | 53 | 0.351 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | intensive_cooling | 1 | 53 | 0.351 | 7° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| blanks | glass_items_list | 1 | 53 | 0.351 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | glass_control | 1 | 53 | 0.351 | 5° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| blanks | pest_control | 1 | 53 | 0.351 | -7° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| blanks | daily_samples | 1 | 53 | 0.351 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | vitaminization | 1 | 53 | 0.351 | -5° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | ration_control | 1 | 53 | 0.351 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| blanks | transport_temperature | 1 | 53 | 0.351 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z JZ | ·Z ·Z ·Z ·Z |
| blanks | tableware_breakage | 1 | 53 | 0.351 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | pool_water_control | 1 | 53 | 0.351 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| blanks | inventory_condition | 1 | 53 | 0.351 | 9° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z JZ ·Z ·Z |
| blanks | instrument_sterilization | 1 | 53 | 0.351 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| blanks | medical_waste_b | 1 | 53 | 0.351 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| blanks | batch_release | 1 | 53 | 0.351 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| long | hygiene | 1 | 49 | 0.365 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | hygiene | 2 (повтор) | 49 | 0.365 | 6° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| long | health_check | 1 | 49 | 0.365 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | health_check | 2 (повтор) | 49 | 0.365 | -8° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| long | climate_control | 1 | 49 | 0.365 | 9° | ·Z JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| long | climate_control | 2 (повтор) | 49 | 0.365 | 10° | ·Z JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | JZ JZ ·Z ·Z |
| long | cold_equipment_control | 1 | 49 | 0.365 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| long | cold_equipment_control | 2 (повтор) | 49 | 0.365 | -6° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z JZ | ·Z ·Z ·Z ·Z |
| long | cleaning_ventilation_checklist | 1 | 53 | 0.351 | 7° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·· |
| long | cleaning_ventilation_checklist | 2 (повтор) | 53 | 0.351 | 8° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ ·Z | JZ JZ ·Z ·Z |
| long | cleaning | 1 | 49 | 0.365 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| long | general_cleaning | 1 | 49 | 0.365 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | uv_lamp_runtime | 1 | 49 | 0.365 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | finished_product | 1 | 49 | 0.365 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | perishable_rejection | 1 | 49 | 0.365 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| long | incoming_control | 1 | 49 | 0.365 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | fryer_oil | 1 | 49 | 0.365 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| long | fryer_oil | 2 (повтор) | 49 | 0.365 | -10° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| long | med_books | 1 | 49 | 0.365 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | med_books | 2 (повтор) | 49 | 0.365 | 6° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| long | training_plan | 1 | 49 | 0.365 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | staff_training | 1 | 49 | 0.365 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| long | disinfectant_usage | 1 | 49 | 0.365 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | sanitary_day_control | 1 | 49 | 0.365 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | JZ ·Z ·Z ·Z |
| long | equipment_maintenance | 1 | 49 | 0.365 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| long | breakdown_history | 1 | 49 | 0.365 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | equipment_calibration | 1 | 49 | 0.365 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | incoming_raw_materials_control | 1 | 53 | 0.351 | 9° | ·Z JZ ·Z | JZ JZ JZ JZ JZ | JZ JZ | ·Z JZ ·Z ·Z |
| long | ppe_issuance | 1 | 49 | 0.365 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | accident_journal | 1 | 49 | 0.365 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z JZ | ·Z ·Z ·Z ·Z |
| long | complaint_register | 1 | 49 | 0.365 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| long | product_writeoff | 1 | 49 | 0.365 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | audit_plan | 1 | 49 | 0.365 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | audit_protocol | 1 | 49 | 0.365 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| long | audit_report | 1 | 49 | 0.365 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | traceability_test | 1 | 49 | 0.365 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| long | metal_impurity | 1 | 49 | 0.365 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |
| long | equipment_cleaning | 1 | 49 | 0.365 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | intensive_cooling | 1 | 49 | 0.365 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | glass_items_list | 1 | 49 | 0.365 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| long | glass_control | 1 | 49 | 0.365 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | pest_control | 1 | 49 | 0.365 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | daily_samples | 1 | 49 | 0.365 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| long | vitaminization | 1 | 49 | 0.365 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | ration_control | 1 | 49 | 0.365 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | transport_temperature | 1 | 49 | 0.365 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ ·Z | ·Z ·Z ·Z ·Z |
| long | tableware_breakage | 1 | 49 | 0.365 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | pool_water_control | 1 | 49 | 0.365 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | ·Z ·Z | ·Z ·Z ·Z ·Z |
| long | inventory_condition | 1 | 49 | 0.365 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| long | instrument_sterilization | 1 | 53 | 0.351 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | medical_waste_b | 1 | 49 | 0.365 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| long | batch_release | 1 | 49 | 0.365 | 9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| paper | ot_intro | 1 | 53 | 0.351 | -5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| paper | ot_workplace | 1 | 53 | 0.351 | 7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ JZ ·Z ·Z |
| paper | fire_safety | 1 | 53 | 0.351 | -9° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z ·Z ·Z ·Z |
| paper | fire_extinguishers | 1 | 53 | 0.351 | 5° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | ·Z JZ ·Z ·Z |
| paper | electrical_safety | 1 | 53 | 0.351 | -7° | JZ JZ JZ | JZ JZ JZ JZ JZ | JZ JZ | JZ ·Z ·Z ·Z |


## Как проверялось

- **Наборы бланков** (`pages.ts`, одни и те же входы на коде master и ветки; база «до» снята на master f09f6736 до
  правок и повторно через `git stash` с байтами PDF): образцы 45 журналов каталога (QR образца
  `/journals-info/<код>`), те же образцы как скачанный шаблон (QR `/qb/<токен>` с почтой 32 байта — самый плотный,
  53 модуля, + строка копирайта), «длинные» документы всех 45 журналов (`long-inputs.ts`: то же, что
  `seed-overlap-docs.ts` делал через базу, — строки до 70, гигиена/здоровье 45 сотрудников × 14 дней; QR документа
  `/qj/<org>/<код>/<подпись>`), 5 бумажных бланков (`paper-journal-pdf.ts`), варианты (гигиена по Приложению №1,
  45 образцов с подвалом партнёра), образцы на книжном листе (`portrait-inputs.ts` — в продукте бланков на книжном
  листе нет, проверка шапки и длинных названий).
- **Перекрытия** — `.agent/tasks/journal-pdf-qr-2026-09/check-qr-overlap.ts`, переписан под QR в шапке: проба без
  плитки (место посчитано) → 0 тёмных пикселей на месте плитки; растр с QR совпадает с пробой везде, кроме плитки и
  строки копирайта; модули в центрах клеток = матрица H; ячейка QR вровень с правой границей содержимого страницы;
  поля листа 10 ± 1 мм сверху/слева/справа, снизу ≥ 9 мм. Поля мерит тот же скрипт (как `measure-margins.ts`
  задачи pdf-top-margin; её критерий «снизу 10 мм» держался на QR в нижнем углу и к новой раскладке не применим).
- **Распознавание** — `decode-matrix.ts` + `qr-sim.ts`: jsQR 1.4.0 и zxing-cpp (npm zxing-wasm 3.1.4) — только во
  временной папке `C:/wt/_verify-pdfqr`, в проект не добавлены. Кадр — плитка с частью шапки вокруг; сетка
  пикселей — от края листа (как у принтера и сканера). Снимки: растр реального размера 150 и 300 dpi (pdf.js), ч/б
  — серый + порог 50 % снимка, ч/б принтер — серый + порог при 600 dpi и снимок усреднением, «как с телефона» —
  лист 600 dpi → перспектива 4 % + поворот 5–10° (у каждого бланка свой угол, знак чередуется) → снимок 3 × 3
  усреднением → размытие σ 0,6 px → JPEG 90, и ч/б принтер + телефон. Стресс (в приёмку не входит): тот же
  телефон при 150 dpi и «жёсткий» телефон (перспектива 8 %, σ 0,8 px, JPEG 85) при 150 и 300 dpi.
- **Опыты** (не приёмка): `size-experiment.ts` — размер плитки против чтения (`raw/size-experiment.txt`);
  `design-ablation.ts` — что мешает jsQR (знак, плашка, линии, модуль; `raw/design-ablation.txt`);
  `phone-sweep.ts` — 12 поворотов × 3 степени «телефона» (`raw/phone-sweep.txt`); цель модуля 0,35 / 0,365 /
  0,38 мм (`raw/target-module-experiment.txt`); `phase-sweep.ts` — фаза сетки снимка (`raw/phase-sweep.txt`).
  Первые три сняты до окончательной раскладки (модуль 0,35 мм), их числа — про тенденцию.

## Замечания (честно)

- **150 dpi — jsQR не 100 % (AC3 выполнен частично).** 150 dpi реального размера — это 2,1–2,4 px на модуль
  0,35–0,405 мм (весь лист A4 в кадре с полуметра). zxing-cpp читает все снимки при 150 dpi (чистый, ч/б,
  ч/б-принтер) и почти все «телефонные»; jsQR — ч/б все, а чистый и ч/б-принтер в зависимости от фазы сетки
  (389/471), «телефон» на 150 dpi почти никогда. «Телефон» в приёмке — при 300 dpi (весь лист в кадре с 25–30 см;
  когда телефон подносят к коду, разрешение в разы выше), там оба декодера 100 %. Что можно сделать и почему не
  сделано — в AC3.
- **jsQR и перспектива.** На модуле ~0,35 мм при 300 dpi (~4,1 px на модуль) jsQR на отдельных позах «жёсткого»
  телефона промахивается (разброс — `raw/phone-sweep.txt`, 12 поз × 3 степени), zxing-cpp читает все. Опыт
  `raw/design-ablation.txt`: знак сайта и плашка на это не влияют (простой QR H того же размера промахивается так
  же), линии ячейки рядом с кодом — немного, решает модуль. Поэтому плитка плотных адресов растёт до 0,365 мм
  (см. «Размер плитки»); у самого плотного (53 модуля) предел роста шапки 4 мм оставляет 0,351 мм — «жёсткий»
  телефон jsQR там читает не всегда (стресс), приёмочный — все снимки.
- **Почта в QR шаблона — до 32 байт** (было 39): у полного QR коррекция H, и больше 53 модулей в шапку не входит.
  Почта длиннее — `blankQrUrl` отдаёт токен без почты (страница /qb не подставит адрес, остальное работает; так
  было и раньше для почты длиннее 39 байт). Адреса и формат токена не менялись.
- **Страницы без шапки остались без QR** — там, где бланк не повторяет шапку, а таблица начинается с верхнего поля
  (список выше: 389 страниц «длинных» документов, из них 308 — план аудитов на 309 листов; у образцов — 2
  страницы; продолжения бумажных бланков). Раньше QR стоял на каждой странице внизу — ценой нижнего резерва. QR в
  углу без шапки встал на 1 странице образца (журнал дезсредств — своя шапка, QR справа от неё) и на 4 страницах
  длинных документов (страницы с подписями у левого поля и т. п.).
- **Вылезание таблицы на шапку — известная ошибка бланка.** Синтетический чек-лист уборки с 70 ответственными:
  строка «Процедура» выше листа, autoTable печатает её продолжение поверх шапки стр. 2–4 — так же на master
  (задача pdf-top-margin-2026-09, «Замечания»; кадр `shots/master-cleaning_ventilation-p2-overflow.png`). Теперь
  поверх шапки лежит и ячейка QR; плитка рисуется последней, с белым фоном, её модули по растру совпадают с
  матрицей (0 расхождений). В проверке такие страницы помечены `knownOverflow`.
- **Размер PDF** вырос на ~7 % у одностраничных бланков (плитка — ~700 векторных прямоугольников; jsPDF пишет
  координаты с полной точностью, сжатие потоков в журналах выключено) и уменьшился у длинных документов (меньше
  страниц, нет QR на страницах без шапки). Картинка знака сжата (`addImage(…, "FAST")`): без этого +110 КБ на
  документ.
- **Бумажные бланки**: у них свои поля (продолжение таблицы — с 14,1 мм, поле autoTable) — не выравнивались и
  сейчас не трогались; «жирный» у их шрифта — тот же обычный файл, поэтому надписи плашки у них обычного
  начертания.
- **Word-шаблон не трогал** (решение оркестратора): QR там по-прежнему компактный в подвале; комментарий в
  `document-docx.ts` («как угловой QR у PDF того же шаблона») устарел — файл по условию не правился.
- **Полоса под «СТР. X ИЗ N»** (4 мм) у таблиц осталась на всех страницах, как было до QR. У документов, где
  шапка повторяется на каждой странице, номер стоит в шапке и эту полосу можно отдать таблице — это отдельное
  улучшение (+4 мм строк на страницу), в эту задачу не входило.

## Как повторить

Декодеры — во временной папке вне проекта: `mkdir C:/wt/_verify-pdfqr && cd C:/wt/_verify-pdfqr && npm init -y &&
npm i jsqr@1.4.0 zxing-wasm@3.1.4` (путь — `QR_VERIFY_DIR`, по умолчанию этот). Из корня репо:

```bash
# страниц «до» (на master f09f6736: git stash — прогон — git stash pop) и «после»
node --import tsx .agent/tasks/journal-qr-header-2026-09/pages.ts master
node --import tsx .agent/tasks/journal-qr-header-2026-09/pages.ts after
# перекрытия, место, вровень, модули, поля — по наборам
node --import tsx .agent/tasks/journal-pdf-qr-2026-09/check-qr-overlap.ts samples   # blanks | long | paper | variants | portrait
# распознавание (приёмка + стресс)
node --import tsx .agent/tasks/journal-qr-header-2026-09/decode-matrix.ts samples,blanks,long,paper
# таблицы для evidence
node --import tsx .agent/tasks/journal-qr-header-2026-09/summarize.ts > .agent/tasks/journal-qr-header-2026-09/raw/tables.md
# скриншоты: набор:метка:страница[:dpi[:кроп x0,y0,x1,y1 мм]]
node --import tsx .agent/tasks/journal-qr-header-2026-09/screens.ts <папка> samples:hygiene:1:100 portrait:cold_equipment_control:1:100
# опыты для выбора размера и разбор промахов jsQR
node --import tsx .agent/tasks/journal-qr-header-2026-09/size-experiment.ts
node --import tsx .agent/tasks/journal-qr-header-2026-09/design-ablation.ts
node --import tsx .agent/tasks/journal-qr-header-2026-09/phone-sweep.ts
# вариант B для сравнения: git apply .agent/tasks/journal-qr-header-2026-09/variant-b.patch (потом git checkout -- src/lib/document-pdf.ts)
node node_modules/typescript/bin/tsc --noEmit --skipLibCheck -p tsconfig.typecheck.json
node --import tsx --test --test-reporter=spec "src/**/*.test.ts"
```
