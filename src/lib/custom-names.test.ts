import assert from "node:assert/strict";
import test from "node:test";

import { headerNavSections } from "@/lib/app-sections";
import { buildJournalSwitcherMenu, filterCrumbMenu } from "@/lib/crumb-menu";
import {
  CUSTOM_NAME_LENGTH_ERROR,
  CUSTOM_NAME_MAX_LENGTH,
  RENAMABLE_SECTIONS,
  STANDARD_NAME_AUDIT_LABEL,
  checkCustomNamesInput,
  checkJournalRename,
  countCustomNames,
  customJournalName,
  customNamesAuditDetails,
  customSectionNameByHref,
  customSectionTitleForPath,
  diffCustomNames,
  emptyCustomNames,
  journalDisplayName,
  journalMatchesCustomQuery,
  mergeCustomNamesPatch,
  parseCustomNames,
  sanitizeCustomName,
  sectionDisplayName,
  validateCustomNamesInput,
  withJournalDisplayNames,
  type CustomNames,
} from "@/lib/custom-names";

const OFFICIAL: Record<string, string> = {
  hygiene: "Гигиенический журнал (сотрудники)",
  health_check: "Журнал здоровья",
  cleaning: "Журнал уборки",
  finished_product: "Журнал бракеража готовой пищевой продукции",
};

function names(partial: Partial<CustomNames> = {}): CustomNames {
  return { journals: {}, sections: {}, ...partial };
}

test("sanitize: края обрезаны, пробелы и переносы схлопнуты, управляющие символы убраны", () => {
  assert.equal(sanitizeCustomName("  Гигиена   у\nнас\t "), "Гигиена у нас");
  assert.equal(sanitizeCustomName("Уборка\u0000\u0007 зала"), "Уборка зала");
  assert.equal(sanitizeCustomName("   "), "");
  assert.equal(sanitizeCustomName(42), "");
  assert.equal(sanitizeCustomName(null), "");
});

test("parse: битое и лишнее из базы отбрасывается молча", () => {
  assert.deepEqual(parseCustomNames(null), emptyCustomNames());
  assert.deepEqual(parseCustomNames("строка"), emptyCustomNames());
  assert.deepEqual(parseCustomNames([]), emptyCustomNames());
  const parsed = parseCustomNames({
    journals: {
      hygiene: "  Гигиена  персонала ",
      cleaning: "У", // короче 2 символов
      health_check: "а".repeat(CUSTOM_NAME_MAX_LENGTH + 1),
      "Bad Code": "Не код",
      finished_product: 7,
    },
    sections: { journals: "Документы", settings: "Не переименовывается", reports: "" },
    extra: { anything: true },
  });
  assert.deepEqual(parsed, {
    journals: { hygiene: "Гигиена персонала" },
    sections: { journals: "Документы" },
  });
  assert.equal(countCustomNames(parsed), 2);
});

test("показ: своё название вместо официального, без своего — официальное", () => {
  const org = names({ journals: { hygiene: "Гигиена персонала" } });
  assert.equal(journalDisplayName(org, "hygiene", OFFICIAL.hygiene), "Гигиена персонала");
  assert.equal(journalDisplayName(org, "cleaning", OFFICIAL.cleaning), OFFICIAL.cleaning);
  assert.equal(journalDisplayName(null, "hygiene", OFFICIAL.hygiene), OFFICIAL.hygiene);
  assert.equal(customJournalName(org, "cleaning"), null);
  // Старый адрес журнала (slug эталона) — тот же журнал.
  assert.equal(customJournalName(org, "healthjournal"), "Гигиена персонала");
});

test("изоляция: названия одной организации не касаются другой", () => {
  const orgA = parseCustomNames({ journals: { hygiene: "Гигиена у нас" }, sections: { journals: "Документы" } });
  const orgB = parseCustomNames({});
  assert.equal(journalDisplayName(orgA, "hygiene", OFFICIAL.hygiene), "Гигиена у нас");
  assert.equal(journalDisplayName(orgB, "hygiene", OFFICIAL.hygiene), OFFICIAL.hygiene);
  assert.equal(sectionDisplayName(orgA, "journals"), "Документы");
  assert.equal(sectionDisplayName(orgB, "journals"), "Журналы");
});

test("разделы: по ключу и по адресу страницы", () => {
  const org = names({ sections: { journals: "Документы", staff: "Команда" } });
  assert.equal(sectionDisplayName(org, "journals"), "Документы");
  assert.equal(sectionDisplayName(org, "reports"), "Отчёты");
  assert.equal(sectionDisplayName(org, "ideas", "Идеи и голосование"), "Идеи и голосование");
  assert.equal(customSectionNameByHref(org, "/journals"), "Документы");
  assert.equal(customSectionNameByHref(org, "/journals/"), "Документы");
  assert.equal(customSectionNameByHref(org, "/settings/users?tab=all"), "Команда");
  // Страница журнала — не раздел: крошка «Документы» ставится звеном выше.
  assert.equal(customSectionNameByHref(org, "/journals/hygiene"), null);
  assert.equal(customSectionNameByHref(org, "/settings"), null);
  assert.equal(customSectionNameByHref(null, "/journals"), null);
});

test("заголовок страницы: своё название ближайшего раздела по адресу", () => {
  const org = names({ sections: { journals: "Документы", staff: "Команда" } });
  // Страницы журнала и документа подписаны разделом «Журналы».
  assert.equal(customSectionTitleForPath(org, "/journals"), "Документы");
  assert.equal(customSectionTitleForPath(org, "/journals/hygiene/documents/c123"), "Документы");
  assert.equal(customSectionTitleForPath(org, "/settings/users"), "Команда");
  // У своей подписи страницы (не раздел меню) — прежний заголовок.
  assert.equal(customSectionTitleForPath(org, "/journals/traceability"), null);
  assert.equal(customSectionTitleForPath(org, "/settings/users/invite"), null);
  assert.equal(customSectionTitleForPath(org, "/settings/journals/hygiene/scope"), null);
  assert.equal(customSectionTitleForPath(org, "/reports"), null);
  assert.equal(customSectionTitleForPath(null, "/journals"), null);
});

test("поиск находит журнал и по своему, и по официальному названию", () => {
  const org = names({ journals: { hygiene: "Утренний осмотр" } });
  assert.equal(journalMatchesCustomQuery(org, "hygiene", OFFICIAL.hygiene, "утренн"), true);
  assert.equal(journalMatchesCustomQuery(org, "hygiene", OFFICIAL.hygiene, "гигиенич"), true);
  assert.equal(journalMatchesCustomQuery(org, "hygiene", OFFICIAL.hygiene, "осмотр гигиен"), true);
  assert.equal(journalMatchesCustomQuery(org, "hygiene", OFFICIAL.hygiene, "бракераж"), false);
  // Код тоже находится, если его передать дополнительным полем.
  assert.equal(journalMatchesCustomQuery(org, "hygiene", OFFICIAL.hygiene, "hygiene", "hygiene"), true);
});

test("шаблоны: своё название для показа, официальное рядом — для поиска", () => {
  const org = names({ journals: { hygiene: "Утренний осмотр" } });
  const templates = [
    { id: "t1", code: "hygiene", name: OFFICIAL.hygiene },
    { id: "t2", code: "cleaning", name: OFFICIAL.cleaning },
  ];
  const shown = withJournalDisplayNames(templates, org);
  assert.deepEqual(
    shown.map((t) => [t.name, t.officialName]),
    [
      ["Утренний осмотр", OFFICIAL.hygiene],
      [OFFICIAL.cleaning, OFFICIAL.cleaning],
    ]
  );
  // Переключатель журналов в крошках: подпись — своя, поиск — по обоим.
  const menu = buildJournalSwitcherMenu({
    templates: shown,
    disabledCodes: new Set(),
    filledTemplateIds: new Set(["t1"]),
    currentCode: "hygiene",
    showAllHref: null,
  });
  assert.equal(menu.items[0].label, "Утренний осмотр");
  assert.deepEqual(menu.items[0].keywords, ["hygiene", OFFICIAL.hygiene]);
  assert.deepEqual(menu.items[1].keywords, ["cleaning"]);
  assert.deepEqual(filterCrumbMenu(menu.items, "гигиенич").map((i) => i.label), ["Утренний осмотр"]);
  assert.deepEqual(filterCrumbMenu(menu.items, "утренн").map((i) => i.label), ["Утренний осмотр"]);
});

test("меню: каждый пункт шапки сайта можно переименовать, стандартные названия совпадают", () => {
  const byHref = new Map<string, string>(RENAMABLE_SECTIONS.map((s) => [s.href, s.label]));
  for (const item of headerNavSections()) {
    assert.equal(byHref.get(item.href), item.label, item.href);
  }
  assert.equal(byHref.get("/settings/users"), "Сотрудники");
  // Служебные пункты не переименовываются.
  assert.equal(byHref.has("/settings"), false);
  const keys = new Set(RENAMABLE_SECTIONS.map((s) => s.key));
  assert.equal(keys.size, RENAMABLE_SECTIONS.length);
});

test("проверка ввода: пустое — стандартное, 2–80 символов, обрезка пробелов", () => {
  const result = validateCustomNamesInput(
    {
      journals: { hygiene: "  Гигиена   персонала ", cleaning: "", health_check: "   " },
      sections: { journals: "Документы", reports: "" },
    },
    OFFICIAL
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.names, {
    journals: { hygiene: "Гигиена персонала" },
    sections: { journals: "Документы" },
  });

  const short = validateCustomNamesInput({ journals: { hygiene: " Г " } }, OFFICIAL);
  assert.equal(short.ok, false);
  if (short.ok) return;
  assert.deepEqual(short.errors, [
    { kind: "journal", key: "hygiene", message: CUSTOM_NAME_LENGTH_ERROR },
  ]);
  assert.match(short.message, /Гигиенический журнал \(сотрудники\)/);

  const exact = validateCustomNamesInput({ journals: { hygiene: "я".repeat(80) } }, OFFICIAL);
  assert.equal(exact.ok, true);
  const long = validateCustomNamesInput({ sections: { journals: "я".repeat(81) } }, OFFICIAL);
  assert.equal(long.ok, false);
});

test("проверка ввода: название, равное стандартному, не хранится", () => {
  const result = validateCustomNamesInput(
    {
      journals: { cleaning: "журнал  уборки" },
      sections: { journals: "ЖУРНАЛЫ" },
    },
    OFFICIAL
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(countCustomNames(result.names), 0);
});

test("проверка ввода: чужие журналы и разделы, не строки, не объект", () => {
  const unknown = validateCustomNamesInput(
    { journals: { nope: "Что-то" }, sections: { settings: "Мои настройки" } },
    OFFICIAL
  );
  assert.equal(unknown.ok, false);
  if (unknown.ok) return;
  assert.deepEqual(
    unknown.errors.map((error) => `${error.kind}:${error.key}`),
    ["journal:nope", "section:settings"]
  );

  const notText = validateCustomNamesInput({ journals: { hygiene: 5 } }, OFFICIAL);
  assert.equal(notText.ok, false);

  assert.equal(validateCustomNamesInput(null, OFFICIAL).ok, false);
  assert.equal(validateCustomNamesInput({ journals: [] }, OFFICIAL).ok, false);
  // Пустое тело — «всё стандартное», это корректный запрос.
  assert.equal(validateCustomNamesInput({}, OFFICIAL).ok, true);
});

test("проверка ввода: два журнала с одним названием не различить", () => {
  const same = checkCustomNamesInput(
    { journals: { hygiene: "Утро", health_check: "утро" } },
    OFFICIAL
  );
  assert.deepEqual(
    same.errors.map((error) => error.key),
    ["hygiene", "health_check"]
  );
  assert.match(same.errors[0].message, /Так уже назван журнал «Журнал здоровья»/);

  // Своё название совпадает с официальным названием другого журнала.
  const clash = checkCustomNamesInput({ journals: { cleaning: "Журнал здоровья" } }, OFFICIAL);
  assert.equal(clash.errors.length, 1);
  assert.match(clash.errors[0].message, /Так называется журнал «Журнал здоровья»/);

  // …но если тот журнал тоже переименовали — конфликта нет.
  const swapped = checkCustomNamesInput(
    { journals: { cleaning: "Журнал здоровья", health_check: "Здоровье персонала" } },
    OFFICIAL
  );
  assert.deepEqual(swapped.errors, []);

  const sections = checkCustomNamesInput({ sections: { plans: "Отчёты" } }, OFFICIAL);
  assert.equal(sections.errors.length, 1);
  assert.equal(sections.errors[0].kind, "section");
});

test("журнал действий: что было → что стало, стандартное подписано", () => {
  const before = names({ journals: { hygiene: "Гигиена" }, sections: { reports: "Выгрузки" } });
  const after = names({ journals: { cleaning: "Уборка зала" }, sections: { journals: "Документы", reports: "Выгрузки" } });
  const changes = diffCustomNames(before, after, OFFICIAL);
  assert.deepEqual(changes, [
    { kind: "section", key: "journals", standard: "Журналы", from: null, to: "Документы" },
    { kind: "journal", key: "hygiene", standard: OFFICIAL.hygiene, from: "Гигиена", to: null },
    { kind: "journal", key: "cleaning", standard: OFFICIAL.cleaning, from: null, to: "Уборка зала" },
  ]);
  assert.deepEqual(customNamesAuditDetails(changes), {
    count: 3,
    "Раздел «Журналы»": { from: STANDARD_NAME_AUDIT_LABEL, to: "Документы" },
    [`Журнал «${OFFICIAL.hygiene}»`]: { from: "Гигиена", to: STANDARD_NAME_AUDIT_LABEL },
    [`Журнал «${OFFICIAL.cleaning}»`]: { from: STANDARD_NAME_AUDIT_LABEL, to: "Уборка зала" },
  });
  assert.deepEqual(diffCustomNames(before, before, OFFICIAL), []);
});

test("проверка ввода: `constructor` и `toString` — не коды журналов, ответ 400, а не падение", () => {
  const result = validateCustomNamesInput(
    { journals: { constructor: "Своё", toString: "Ещё своё" } },
    OFFICIAL
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(
    result.errors.map((error) => `${error.key}: ${error.message}`),
    ["constructor: Такого журнала нет", "toString: Такого журнала нет"]
  );
  assert.equal(result.message, "Журнал «constructor»: такого журнала нет");
});

test("окно журнала: правка одного журнала ложится поверх сохранённых названий", () => {
  const stored = names({
    journals: { hygiene: "Гигиена персонала", removed_journal: "Журнала больше нет" },
    sections: { journals: "Документы" },
  });
  // Остальные названия организации окно не видит — и не затирает.
  assert.deepEqual(mergeCustomNamesPatch(stored, { journals: { cleaning: "Уборка кухни" } }, OFFICIAL), {
    journals: { hygiene: "Гигиена персонала", cleaning: "Уборка кухни" },
    sections: { journals: "Документы" },
  });
  // Пусто — «Вернуть стандартное» только у этого журнала.
  const reset = mergeCustomNamesPatch(stored, { journals: { hygiene: "" } }, OFFICIAL);
  assert.deepEqual(reset, { journals: { hygiene: "" }, sections: { journals: "Документы" } });
  const validated = validateCustomNamesInput(reset, OFFICIAL);
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.deepEqual(validated.names, { journals: {}, sections: { journals: "Документы" } });
  }
  // Тело не того вида — null: ошибку даёт та же проверка, что у PUT.
  assert.equal(mergeCustomNamesPatch(stored, null, OFFICIAL), null);
  assert.equal(mergeCustomNamesPatch(stored, { journals: "Уборка" }, OFFICIAL), null);
  assert.equal(mergeCustomNamesPatch(stored, { sections: [] }, OFFICIAL), null);
});

test("окно журнала: пусто или официальное — стандартное, своё — от 2 до 80 символов", () => {
  const official = OFFICIAL.cleaning;
  // Открыли и ничего не меняли — сохранять нечего.
  assert.deepEqual(checkJournalRename({ value: official, officialName: official, customName: null }), {
    name: null,
    error: null,
    changed: false,
  });
  assert.deepEqual(
    checkJournalRename({ value: "  Уборка   кухни ", officialName: official, customName: null }),
    { name: "Уборка кухни", error: null, changed: true }
  );
  assert.deepEqual(checkJournalRename({ value: "У", officialName: official, customName: null }), {
    name: "У",
    error: CUSTOM_NAME_LENGTH_ERROR,
    changed: true,
  });
  assert.equal(
    checkJournalRename({ value: "я".repeat(80), officialName: official, customName: null }).error,
    null
  );
  // Своё уже сохранено: то же самое — без изменений; пусто или
  // официальное (регистр и пробелы не важны) — вернуть стандартное.
  assert.equal(
    checkJournalRename({ value: "Уборка кухни", officialName: official, customName: "Уборка кухни" }).changed,
    false
  );
  assert.deepEqual(checkJournalRename({ value: "", officialName: official, customName: "Уборка кухни" }), {
    name: null,
    error: null,
    changed: true,
  });
  assert.deepEqual(
    checkJournalRename({ value: " журнал  УБОРКИ ", officialName: official, customName: "Уборка кухни" }),
    { name: null, error: null, changed: true }
  );
});
