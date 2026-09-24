import assert from "node:assert/strict";
import test from "node:test";

import {
  WALKTHROUGH_CODES,
  getJournalWalkthrough,
  hasJournalWalkthrough,
  visibleWalkthroughSteps,
} from "./journal-ui-walkthroughs";
import { TOUR_ANCHOR_VALUES } from "./tour-anchors";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";

test("walkthrough есть у каждого журнала с инструкцией (v2)", () => {
  // v1 фиксировал прежний контракт: ручной разбор был только у hygiene и
  // climate_control, остальные журналы отдавали null и получали общий
  // скелет. Теперь шаги достраиваются из `journal-filling-guides`, и
  // подсказка есть у всех журналов, для которых инструкция написана.
  assert.ok(
    WALKTHROUGH_CODES.size >= JOURNALS_TOTAL,
    `ожидали подсказку у всех ${JOURNALS_TOTAL} журналов каталога, получили ${WALKTHROUGH_CODES.size}`
  );

  // Ручные разборы никуда не делись и по-прежнему в приоритете.
  for (const code of ["hygiene", "climate_control"]) {
    assert.equal(hasJournalWalkthrough(code), true, code);
    assert.ok(WALKTHROUGH_CODES.has(code), code);
  }

  // Журнал без ручного разбора теперь тоже отдаёт шаги, а не null.
  assert.equal(hasJournalWalkthrough("cleaning"), true);
  const cleaning = getJournalWalkthrough("cleaning");
  assert.ok(cleaning && cleaning.length >= 3, "cleaning: шагов нет");

  // Код, которого нет ни в разборах, ни в инструкциях — по-прежнему null.
  assert.equal(hasJournalWalkthrough("__no_such_journal__"), false);
  assert.equal(getJournalWalkthrough("__no_such_journal__"), null);
});

test("every step is well-formed", () => {
  for (const code of WALKTHROUGH_CODES) {
    const steps = getJournalWalkthrough(code);
    assert.ok(steps && steps.length >= 3, `${code}: too few steps`);
    const ids = new Set<string>();
    for (const step of steps) {
      assert.ok(step.id && !ids.has(step.id), `${code}: duplicate/empty id ${step.id}`);
      ids.add(step.id);
      assert.ok(step.title.trim().length > 0, `${code}/${step.id}: empty title`);
      assert.ok(step.body.trim().length > 0, `${code}/${step.id}: empty body`);
      assert.ok(step.title.length <= 48, `${code}/${step.id}: title too long`);
      assert.ok(step.page === "list" || step.page === "document");
      if (step.anchor) {
        assert.ok(TOUR_ANCHOR_VALUES.includes(step.anchor), `${code}/${step.id}: unknown anchor`);
      }
      if (step.fallbackAnchor) {
        assert.ok(step.anchor, `${code}/${step.id}: fallback without anchor`);
        assert.ok(TOUR_ANCHOR_VALUES.includes(step.fallbackAnchor));
      }
    }
    assert.ok(steps.some((s) => s.page === "list"), `${code}: no list step`);
    assert.ok(steps.some((s) => s.page === "document"), `${code}: no document step`);
  }
});

test("visibleWalkthroughSteps hides mobile-only steps on desktop", () => {
  const steps = getJournalWalkthrough("climate_control")!;
  const desktop = visibleWalkthroughSteps(steps, { isMobile: false });
  const mobile = visibleWalkthroughSteps(steps, { isMobile: true });
  assert.ok(desktop.every((s) => !s.mobileOnly));
  assert.equal(mobile.length, steps.length);
  assert.ok(mobile.length > desktop.length);
});
