# Problems found by the fresh review (23.11.2026, before merge)

Reviewer: independent subagent, read-only, judged the working tree. Fixes — smallest safe diff, then recheck.

1. **AC4 — filter without points mode.** `orgBuildingIds` was passed even when the organisation does not work by points
   (`perLocationJournals` off or < 2 objects), so «Кто заполняет по QR» was narrowed and «Сменить объект» dropped people,
   although the QR page (`loadQrPointScope` → `buildingTargets`) lets everyone in. Also a shared room (no point) kept the
   narrowed list. Fix: pages pass `orgBuildingIds` only under the QR rule (points on and ≥ 2 objects); the dialog falls back
   to no filter, filters only when the chosen room belongs to a point; the «Добавить» dialog of `/settings/equipment` gets the prop.
2. **AC3 — Tuya field unmounts while edited.** Visibility used the live input: clearing a saved Device ID hid the field
   mid-edit. Fix: «already recorded» = saved value or current text.
3. **AC1 — doors at the top/left edge clipped.** `diagramBounds` clamped the origin to 0; a door leaf can reach negative
   coordinates. Fix: clamp only when content is non-negative.
4. **AC1 — double-click 6px beyond a door opened the room label.** `doorBounds` had no padding along the wall while the SVG
   hit area had 6px. Fix: same padding along the wall.
5. **AC5 — upward list could overflow the top by ~12px.** Frame shift is applied after Radix collision handling. Fix: reduce
   the max height by the frame shift on the side the list opens.
6. Nits: native select inside a frame (`FloatingSelectField`, room type) got the styled picker anchored to the inner select
   (same misalignment) → keep the system picker inside `[data-field-frame]`; editor legend showed door items with no doors →
   only present kinds; door-kind chips `role="radiogroup"` with `aria-pressed` → `role="group"`; `focusTemp` not reset on
   reopen → reset; unlayered `display/position` could override `hidden`/`sr-only` on a native select → exclude them.

## После слияния (23.11.2026)

7. **AC14 — первый прогон проверки прода: 3/7.** `/` и `/login` — `000`, CSS-проверки — вслед за ними. Причина не в сайте:
   туннель прокси песочницы закрывался до ответа (`ws_closed_mid_exchange`, `curl: (35) Connection reset by peer` через
   ~10 с), запрос до wesetup.ru не доходил; подряд 12 из 19 запросов — 200 за 0,9–1,7 с. Исправление в
   `e2e/post-deploy-check.sh`: запрос без HTTP-ответа (код 000) повторяется до 5 раз, любой HTTP-ответ — окончательный.
   Повторный прогон: 7/7 (`raw/after-prod-checks.txt`).
