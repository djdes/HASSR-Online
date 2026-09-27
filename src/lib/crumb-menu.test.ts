import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCUMENT_STATUS_LEGEND,
  JOURNAL_STATUS_LEGEND,
  JOURNAL_SWITCHER_SHOW_ALL_HREF,
  buildJournalSwitcherMenu,
  filterCrumbMenu,
  journalSwitcherOptions,
  legendEntriesFor,
  matchingHidden,
  quotedList,
  type CrumbMenuItem,
} from "@/lib/crumb-menu";

const ITEMS: CrumbMenuItem[] = [
  { label: "Гигиенический журнал", href: "/journals/hygiene", status: "ok", keywords: ["hygiene"] },
  { label: "Журнал учёта температуры холодильников", href: "/journals/cold", status: "danger" },
  { label: "Бракеражный журнал", href: "/journals/brak", status: "danger", hint: "Основная точка · сен 2026" },
];

test("filterCrumbMenu: empty or blank query keeps every item in order", () => {
  assert.deepEqual(filterCrumbMenu(ITEMS, ""), ITEMS);
  assert.deepEqual(filterCrumbMenu(ITEMS, "   "), ITEMS);
});

test("filterCrumbMenu: ё/е, case and word order do not matter", () => {
  assert.deepEqual(
    filterCrumbMenu(ITEMS, "УЧЕТ холодил").map((item) => item.href),
    ["/journals/cold"],
  );
  assert.deepEqual(
    filterCrumbMenu(ITEMS, "журнал гигиен").map((item) => item.href),
    ["/journals/hygiene"],
  );
});

test("filterCrumbMenu: finds by keywords (journal code) and by the right-hand hint", () => {
  assert.deepEqual(filterCrumbMenu(ITEMS, "hygiene").map((item) => item.href), ["/journals/hygiene"]);
  assert.deepEqual(filterCrumbMenu(ITEMS, "сен 2026").map((item) => item.href), ["/journals/brak"]);
});

test("filterCrumbMenu: keeps the original objects and sort order", () => {
  const found = filterCrumbMenu(ITEMS, "журнал");
  assert.equal(found.length, 3);
  assert.equal(found[0], ITEMS[0]);
  assert.deepEqual(found.map((item) => item.href), ITEMS.map((item) => item.href));
  assert.deepEqual(filterCrumbMenu(ITEMS, "нет такого"), []);
});

test("legendEntriesFor: only statuses present in the list, in legend order", () => {
  assert.deepEqual(legendEntriesFor(ITEMS, JOURNAL_STATUS_LEGEND), [
    { status: "ok", label: "заполнен сегодня" },
    { status: "danger", label: "ждёт заполнения" },
  ]);
  const withDisabled: CrumbMenuItem[] = [
    { label: "Выключенный", href: "/journals/x", status: "muted" },
    ...ITEMS,
  ];
  assert.deepEqual(
    legendEntriesFor(withDisabled, JOURNAL_STATUS_LEGEND).map((entry) => entry.status),
    ["ok", "danger", "muted"],
  );
  assert.deepEqual(legendEntriesFor([{ label: "Без статуса", href: "/x" }], JOURNAL_STATUS_LEGEND), []);
});

test("document legend speaks about open/closed, not about disabled journals", () => {
  assert.deepEqual(
    DOCUMENT_STATUS_LEGEND.map((entry) => [entry.status, entry.label]),
    [
      ["ok", "открыт"],
      ["muted", "закрыт"],
    ],
  );
  assert.equal(DOCUMENT_STATUS_LEGEND.some((entry) => entry.label.includes("выключен")), false);
  const documents: CrumbMenuItem[] = [
    { label: "Сентябрь", href: "/d/1", status: "ok" },
    { label: "Август", href: "/d/2", status: "muted" },
  ];
  assert.deepEqual(legendEntriesFor(documents, DOCUMENT_STATUS_LEGEND).map((entry) => entry.label), [
    "открыт",
    "закрыт",
  ]);
});

test("matchingHidden: nothing for an empty query, matches otherwise (ё-insensitive)", () => {
  const hidden = ["Журнал учёта дезсредств", "Бракераж скоропорта"];
  assert.deepEqual(matchingHidden(hidden, ""), []);
  assert.deepEqual(matchingHidden(hidden, "  "), []);
  assert.deepEqual(matchingHidden(hidden, "учет"), ["Журнал учёта дезсредств"]);
  assert.deepEqual(matchingHidden(hidden, "бракераж"), ["Бракераж скоропорта"]);
  assert.deepEqual(matchingHidden(hidden, "гигиен"), []);
});

test("quotedList: quotes names and folds the tail into «и ещё N»", () => {
  assert.equal(quotedList(["Бракераж"]), "«Бракераж»");
  assert.equal(quotedList(["А", "Б", "В"]), "«А», «Б», «В»");
  assert.equal(quotedList(["А", "Б", "В", "Г", "Д"]), "«А», «Б», «В» и ещё 2");
  assert.equal(quotedList(["А", "Б", "В"], 2), "«А», «Б» и ещё 1");
});

const TEMPLATES = [
  { id: "t1", code: "hygiene", name: "Гигиенический журнал" },
  { id: "t2", code: "brakerage", name: "Бракеражный журнал" },
  { id: "t3", code: "disinfectant_usage", name: "Журнал учёта дезсредств" },
];

test("buildJournalSwitcherMenu: only enabled journals, status by today's fill", () => {
  const menu = buildJournalSwitcherMenu({
    templates: TEMPLATES,
    disabledCodes: new Set(["brakerage"]),
    filledTemplateIds: new Set(["t1"]),
    currentCode: "hygiene",
    showAllHref: JOURNAL_SWITCHER_SHOW_ALL_HREF,
  });
  assert.deepEqual(
    menu.items.map((item) => [item.href, item.status, item.current ?? false]),
    [
      ["/journals/hygiene", "ok", true],
      ["/journals/disinfectant_usage", "danger", false],
    ],
  );
  assert.equal(menu.items[0].submenuJournalCode, "hygiene");
  assert.deepEqual(menu.items[0].keywords, ["hygiene"]);
  assert.deepEqual(menu.disabledLabels, ["Бракеражный журнал"]);
  assert.equal(menu.showAllHref, "/settings/journals");
});

test("buildJournalSwitcherMenu: a disabled CURRENT journal stays in the list, muted", () => {
  const menu = buildJournalSwitcherMenu({
    templates: TEMPLATES,
    disabledCodes: new Set(["brakerage"]),
    filledTemplateIds: new Set(),
    currentCode: "brakerage",
    showAllHref: null,
  });
  const current = menu.items.find((item) => item.current);
  assert.deepEqual(
    current && { href: current.href, status: current.status, hint: current.hint },
    { href: "/journals/brakerage", status: "muted", hint: "выключен" },
  );
  // Его нет в «скрытых»: он и так в списке.
  assert.deepEqual(menu.disabledLabels, []);
  assert.equal(menu.showAllHref, null);
});

test("buildJournalSwitcherMenu: journals and hidden labels go alphabetically by the shown name", () => {
  const menu = buildJournalSwitcherMenu({
    templates: [
      { id: "t1", code: "hygiene", name: "Гигиенический журнал" },
      { id: "t4", code: "fryer", name: "Журнал фритюрных жиров" },
      // Переименован в «Настройки → Названия» — встаёт по своему названию.
      { id: "t3", code: "disinfectant_usage", name: "Акт дезсредств", officialName: "Журнал учёта дезсредств" },
      { id: "t2", code: "brakerage", name: "Бракеражный журнал" },
      { id: "t5", code: "acceptance", name: "Входной контроль" },
    ],
    disabledCodes: new Set(["fryer", "acceptance"]),
    filledTemplateIds: new Set(),
    showAllHref: null,
  });
  assert.deepEqual(
    menu.items.map((item) => item.label),
    ["Акт дезсредств", "Бракеражный журнал", "Гигиенический журнал"],
  );
  assert.deepEqual(menu.disabledLabels, ["Входной контроль", "Журнал фритюрных жиров"]);
});

test("journalSwitcherOptions: manager gets «Показать все» and a link in the hidden-matches hint", () => {
  const options = journalSwitcherOptions({
    items: [],
    showAllHref: "/settings/journals",
    disabledLabels: ["Бракеражный журнал"],
  });
  assert.equal(options.menuSearch, "Найти журнал");
  assert.deepEqual(options.menuFooterLink, {
    label: "Показать все",
    href: "/settings/journals",
    hint: "включая выключенные",
  });
  assert.equal(options.menuLegend, JOURNAL_STATUS_LEGEND);
  assert.deepEqual(options.menuHiddenMatches?.labels, ["Бракеражный журнал"]);
  assert.deepEqual(options.menuHiddenMatches?.link, {
    label: "Открыть набор журналов",
    href: "/settings/journals",
  });
  assert.equal(options.menuHiddenMatches?.note, undefined);
});

test("journalSwitcherOptions: employee — no «Показать все», the hint explains who can enable", () => {
  const options = journalSwitcherOptions({
    items: [],
    showAllHref: null,
    disabledLabels: ["Бракеражный журнал"],
  });
  assert.equal(options.menuFooterLink, undefined);
  assert.equal(options.menuHiddenMatches?.link, undefined);
  assert.equal(options.menuHiddenMatches?.note, "Включить может руководитель");
  assert.deepEqual(options.menuHiddenMatches?.title, ["Выключен в наборе", "Выключены в наборе"]);
});

test("journalSwitcherOptions: no disabled journals — no hidden-matches block at all", () => {
  const options = journalSwitcherOptions({ items: [], showAllHref: null, disabledLabels: [] });
  assert.equal(options.menuHiddenMatches, undefined);
});
