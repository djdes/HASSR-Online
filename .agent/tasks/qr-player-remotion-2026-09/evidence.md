# Evidence — qr-player-remotion-2026-09

Проверки 2026-09-24, dev :3020 (HMR), remotion/@remotion/player 4.0.528.

## AC1 — движок реально Remotion
Тест «движок — Remotion» (qr-player.test.ts): импорт `@remotion/player` в
qr-player.tsx + `acknowledgeRemotionLicense`, `useCurrentFrame` в
composition.tsx, тайминги clock.ts из пакета `remotion`, версии remotion
и плеера пиннед и равны. Лицензия: Free License покрывает for-profit
до 3 сотрудников включительно, в т.ч. коммерческое использование и embed
Плеера (LICENSE.md + license/faq, проверено по актуальным докам).

## AC2 — тесты и типы
`npm run typecheck` — чисто. `npm test` — 2137 pass / 0 fail; прежний
тест interpolate (зажим/линейность, clamp:false → 200) проходит на
remotion-движке без правки ожиданий; ease.outBack =
Easing.out(Easing.back(1.4)) — алгебраически тождественно старой формуле.

## AC3 — поведение прежнее (interact.mjs, reduced2.mjs из задачи simplify)
- Слайдер холодильника 8°C → `frame=168` (RESULT_SECONDS), `playing=0`.
- Клик по вкладке «4 Фритюр» → `frame=540`, строка вкладок подъехала
  (scrollLeft 252).
- prefers-reduced-motion → `frame=179` (итог главы 1), пауза, mq=true.
- Автоплей в кадре: телеметрия debug-sync.mjs — data-frame растёт
  0→16→37→57→76, пауза кнопкой держит кадр, seek 90 стабилен три замера.
- SSR-HTML содержит подложку (первый кадр сцены) и вкладки.

## AC4 — кадр не разъехался
`shots/`: before-*-f90/f990 (старый движок) vs after2-*-f90/f990
(Remotion) — мобайл 390 и десктоп 1440 совпадают по компоновке и
содержимому (журнал, телефон, рельса шагов, значения). Расхождений нет.
Первая версия after-скриптов ловила гонку (пауза до старта автоплея,
скрин уезжал кадром) — скрипт переписан на детерминированный протокол:
дождаться data-playing=1 → пауза → seek → дождаться data-frame → скрин.

## AC5 — прод
См. отчёт: после деплоя проверка с прод-хоста
`curl --resolve wesetup.ru:443:79.137.237.2` (LAN-ловушку из
landing-text-pass учитываем — с локальной машины прод не проверяем).
