# Доказательства — site-motion-round3-2026-11-23

Спецификация: `spec.md` (заморожена до правок). Проверено на локальном стенде
(`next dev`, PostgreSQL, Chromium с эмуляцией iPhone 13 и компьютера 1440×900).

**Чего здесь проверить нельзя.** Реального iPhone в среде нет. Системные жесты Safari
(прокрутка страницы под слоем, «резинка», pull-to-refresh) в Chromium не существуют, поэтому
то, что их «больше нет», подтверждено не наблюдением, а условиями, от которых они зависят:
страница прибита (`position: fixed`), у ручки `touch-action: none`, `touchmove` жеста отменён.
Окончательная проверка — на телефоне владельца после выкладки.

## Причины (воспроизведены до правок)

| Замечание | Причина | Где |
|---|---|---|
| В меню при прокрутке едет фон | Лист открыт из кода, а защиты vaul для iOS включаются только при открытии через `Drawer.Trigger` (`hasBeenOpened`). Оставшийся `body { overflow: hidden }` страницу не держит: прокрутка окна берётся с `html` (`overflow-x: clip`). До правок у `body` было `position: relative`, сдвига нет | `ui/bottom-sheet.tsx`, `lib/use-body-scroll-lock.ts` |
| Свайп листа вниз не работает | Жест слушал `document` пассивно и не мог отнять касание у страницы | `components/motion/motion-presence.ts` |
| Шаги не переключаются | До сохранения анкеты все четыре кнопки шагов `disabled` | `dashboard/complete-profile-nudge.tsx` |
| Подсказки помощника ключами | Выводилось `{s}` вместо `{t(s)}` | `ai/sanpin-chat-widget.tsx` |
| Двойная полоска у мастера | Своя полоска мастера плюс полоска круга 2 фоном | `motion.css`, раздел 11 |

## Критерии

| AC | Итог | Чем подтверждено |
|---|---|---|
| AC1. Фон под листом стоит | PASS | `raw/measure.json`: `AC1.menu.page-pinned` (у body `position: fixed; top: -300px`), `AC1.menu.swipes-past-both-ends` (6+3 свайпа за конец списка и 9 за начало — сдвиг страницы тот же), `AC1.menu.scroll-restored`, `AC1.menu.link-closes-and-unpins`, `AC1.menu.page-change-under-lock` (раздел меню открыл другую страницу при открытом листе — сдвиг сброшен в 0), `AC1.dialog.page-pinned`, `AC1.dialog.scroll-restored`, `AC1.desktop.dialog-not-pinned`. Тесты `use-body-scroll-lock.test.ts` (4) |
| AC2. Свайп вниз закрывает лист | PASS | `AC2.pull.moves-are-cancelled` (каждый `touchmove` жеста `cancelable` и `defaultPrevented`), `AC2.pull.short-springs-back`, `AC2.pull.long-closes`, `AC2.pull.flick-closes`, `AC2.pull.only-down-only-top` (вбок, вверх и ниже верхней зоны лист не берёт, касание остаётся странице), `AC2.qr.sheet-pull` (шторка «Кто заполняет» QR-формы). Тесты модели: порог, смахивание, направление |
| AC3. Живая ручка, одна на сайт | PASS | `AC3.wizard.one-handle` (одна ручка, старой полоски и фоновой нет, `touch-action: none`), `AC3.wizard.tap-is-arrow-then-bar` (палец на ручке — половины ±22°, отпустили — 0°, лист открыт), `AC3.wizard.armed-past-threshold` (за порогом — акцент), `AC3.dialog.handle`, `AC3.bottom-sheet.handle`, `AC3.hand-built.handle-added` (листу без своей ручки её ставит рантайм; листу без кнопки закрытия — нет), `AC3.assistant.light-handle`, `AC3.desktop.no-handle`, `AC3.still.handle-without-motion` |
| AC4. Шаги мастера отвечают | PASS | `AC4.steps.enabled`, `AC4.steps.invalid-profile-explains` (остались на «Анкете», поле «Телефон» подсвечено и вздрогнуло, сообщение «Сначала заполните анкету — обязательные поля отмечены», запроса на сохранение нет), `AC4.steps.valid-profile-saves-and-goes` (один запрос сохранения, открыт «Сотрудники», дальше шаги ходят в обе стороны без повторного сохранения) |
| AC5. Подсказки помощника текстом | PASS | `AC5.assistant.starters-are-text`: четыре русские фразы |
| AC6. Поля живее | PASS | `AC6.framed.breath-and-caption`, `AC6.plain.breath-caption-placeholder`, `AC6.plain.wrong-shakes-table-stays` (ошибка вздрагивает, поле в таблице неподвижно), `AC6.touch.field-gives-under-finger`, `AC6.caption-accent.new` (чёрный акцент «Новой»), `AC6.caption-accent.classic-dark`, `AC6.still.off`, `AC6.qr.field-breath` |
| AC7. Ничего не сломано | PASS | `raw/verify-round1.json` — 46/46, `raw/verify-round2.json` — 19/19, `raw/crawl.txt` — 24 страницы ×3 (компьютер, телефон, телефон «Новая») без ошибок, `errors.console` в `measure.json` пуст; `raw/typecheck.txt` (0), `raw/test-gate.txt` (410 тестов, 0 падений), `raw/eslint.txt` (0), `raw/unit-tests.txt` (67/67), `raw/prod-minify.json` (минификатор продакшн-сборки ничего не выбросил) |

Замеры круга 3: `raw/measure.json` — 42 из 42 (`raw/measure-round3.cjs`).

## Что изменено в прежних проверках и почему

- `raw/measure-round2.cjs` — копия сценария круга 2 с одной правкой: признак ручки листа
  ищется по элементу `data-sheet-grabber`, а не по фоновой картинке (её круг 3 убрал намеренно).
- Тесты `motion.test.ts` (круг 2: условие начала жеста, порядок в `onTree`, фоновая полоска,
  список скрытого при печати) и `shell-polish-round2.test.ts` (шаги до сохранения анкеты)
  переписаны под новое поведение: это прямые решения владельца от 2026-11-23, а не обход.
- `use-body-scroll-lock.test.ts`: подделка `body.style` получила `setProperty` — замок теперь
  ставит `position` с приоритетом.

## Решения, принятые без владельца

- Тап по ручке лист не закрывает (см. «Допущения» в спеке); закрывает протяжка дальше 90 px
  или смахивание (≥ 0,6 px/мс и ≥ 30 px).
- Закрепление страницы под `Dialog` и `BottomSheet` включено только на сенсорных устройствах:
  на компьютере Radix держит страницу сам, лишний сдвиг не нужен.
- Окно помощника получило `role="dialog"` — теперь общий слой движения ведёт его как остальные
  самодельные окна (закрытие с анимацией, свайп вниз, ручка).
