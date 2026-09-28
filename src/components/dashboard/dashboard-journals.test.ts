import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DashboardJournalRow,
  DashboardPaperRow,
} from "@/components/dashboard/dashboard-journal-row";
import {
  JOURNAL_ITEM_CLASS,
  JOURNAL_LIST_CLASS,
  JOURNAL_ROW_CLASS,
  JOURNAL_THUMB_SIZE_CLASS,
  JOURNAL_TOOLBAR_CLASS,
} from "@/components/dashboard/dashboard-journals-layout";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import {
  DASHBOARD_SECTION_PERSIST_SCRIPT,
  DASHBOARD_SECTION_STORAGE_PREFIX,
  attachDashboardSectionMemory,
} from "@/lib/dashboard-section-memory";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";

/**
 * Главная, «Обязательные журналы» (владелец, 2026-09-27): «во всю ширину,
 * без блока-кругляшка и с возможностью свернуть, пусть будет открыто…
 * слева у названий — маленькие прямоугольные скрины журналов с понятным
 * чекбоксом-галочкой… бумажный вид так же».
 *
 * Вёрстку и поведение в браузере смотрит e2e задачи
 * `.agent/tasks/dashboard-journals-2026-09`; здесь — ключевое, чтобы
 * следующая правка не вернула карточку и цветные плашки.
 */

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

/** Заливки и рамки прежних «зелёных/красных» карточек-строк. */
const OLD_ROW_FILLS = /#effaf1|#fff4f2|#ffd2cd|#c8f0d5|#a1362f|#ffe1dc|XCircle/;

test("секция без карточки, во всю ширину, развёрнута по умолчанию, счётчик в заголовке", () => {
  const markup = html(
    createElement(DashboardSection, {
      storageKey: "compliance-grid",
      title: "Обязательные журналы",
      flat: true,
      defaultOpen: true,
      badge: { text: "1/3", tone: "warn" },
      children: createElement("p", null, "список"),
    }),
  );
  const details = /<details([^>]*)>/.exec(markup)?.[1] ?? "";
  assert.match(details, /\bopen=""/, "по умолчанию развёрнута");
  assert.match(details, /data-storage-key="compliance-grid"/);
  assert.match(details, /data-section-layout="flat"/);
  // Никакой коробки вокруг: ни рамки, ни фона, ни скругления, ни тени.
  assert.doesNotMatch(details, /rounded-3xl|border|bg-white|shadow/);

  const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(markup)?.[1] ?? "";
  assert.match(summary, /<h2[^>]*>Обязательные <span[^>]*>журналы<span[^>]*>1\/3<\/span>/);
  assert.match(summary, /lucide-chevron-down/, "стрелка сворачивания в строке заголовка");
  // Значка в скруглённом квадрате слева от заголовка нет.
  assert.doesNotMatch(summary, /rounded-2xl bg-\[#eef1ff\]|rounded-xl border/);
  // Содержимое — вне строки заголовка: свёрнутая секция — одна строка.
  assert.doesNotMatch(summary, /список/);
  assert.match(markup, /<\/summary>[\s\S]*список/);

  const closed = html(
    createElement(DashboardSection, {
      storageKey: "x",
      title: "Секция",
      flat: true,
      defaultOpen: false,
      children: "…",
    }),
  );
  assert.doesNotMatch(/<details([^>]*)>/.exec(closed)?.[1] ?? "", /\bopen=/);
});

test("главная: «Обязательные журналы» — плоская секция, открыта, кнопки в панели списка", () => {
  const page = read("src/app/(dashboard)/dashboard/page.tsx");
  const start = page.indexOf('storageKey="compliance-grid"');
  assert.ok(start > 0, "секция compliance-grid не найдена");
  const section = page.slice(start, page.indexOf("</DashboardSection>", start));
  assert.match(section, /\bflat\b/);
  assert.match(section, /defaultOpen=\{true\}/);
  assert.doesNotMatch(section, /\bcentered\b/);
  // «Автозаполнить» / «QR-коды» — в панели с поиском, не в <summary>.
  assert.match(section, /<DashboardJournalsGrid[\s\S]*actions=\{<CloseDayCard \/>\}/);
  assert.doesNotMatch(section.slice(0, section.indexOf("<DashboardJournalsGrid")), /actions=/);
  // Скрипт запоминания стоит выше секций — ловит их при появлении в DOM.
  assert.ok(page.indexOf("<DashboardSectionPersistScript />") < start);
  // Без <summary> рядом кнопкам нечего гасить.
  assert.doesNotMatch(read("src/components/dashboard/close-day-card.tsx"), /preventDefault/);
});

test("строка журнала: превью бланка, отметка «заполнено сегодня», без цветной плашки", () => {
  const filled = html(
    createElement(DashboardJournalRow, {
      code: "hygiene",
      name: "Гигиенический журнал (сотрудники)",
      filled: true,
      thumb: { src: "/journal-samples/hygiene.webp", optimized: true },
    }),
  );
  assert.match(filled, /^<a [^>]*href="\/journals\/hygiene"/, "тап по строке — в журнал");
  assert.match(filled, /data-journal-status="filled"/);
  assert.match(filled, /data-journal-thumb=""/);
  // Образец отдаётся уменьшенным через next/image.
  assert.match(
    filled,
    /<img [^>]*srcSet="[^"]*\/_next\/image\?url=%2Fjournal-samples%2Fhygiene\.webp&amp;w=64&amp;q=75 64w/,
  );
  assert.match(filled, /data-journal-mark="filled"[^>]*bg-\[#16a34a\]/, "зелёный круг");
  assert.match(filled, /lucide-check/, "с галочкой");
  assert.match(filled, /class="sr-only">, заполнен сегодня</);
  assert.match(filled, /line-clamp-2/, "название до двух строк");
  assert.doesNotMatch(filled, OLD_ROW_FILLS);

  const open = html(
    createElement(DashboardJournalRow, {
      code: "cleaning",
      name: "Журнал уборки",
      filled: false,
      thumb: { src: "/journal-samples/cleaning.webp", optimized: true },
    }),
  );
  assert.match(open, /data-journal-status="open"/);
  // Не заполнено — оранжевый круг с часами (не пустой кружок: тот был похож на чекбокс), без красного.
  assert.match(open, /data-journal-mark="open"[^>]*bg-\[#d97706\]/);
  assert.match(open, /lucide-clock/);
  assert.doesNotMatch(open, /data-journal-mark="open"[^>]*border-2/);
  assert.doesNotMatch(open, /lucide-check|lucide-x|#d2453d|#a13a32/);
  assert.doesNotMatch(open, OLD_ROW_FILLS);
  // Строка — без заливки и рамки.
  const link = /^<a ([^>]*)>/.exec(open)?.[1] ?? "";
  assert.doesNotMatch(link, /\bbg-|\bborder\b|rounded-2xl/);
});

test("превью: живой снимок — как есть, без снимка и образца — заглушка того же размера", () => {
  const live = html(
    createElement(DashboardJournalRow, {
      code: "hygiene",
      name: "Гигиена",
      filled: false,
      thumb: { src: "/api/journal-previews/hygiene?v=1&b=", optimized: false },
    }),
  );
  // Приватный маршрут с версией в адресе оптимизатору не отдаём.
  assert.match(live, /<img [^>]*src="\/api\/journal-previews\/hygiene\?v=1&amp;b="/);
  assert.doesNotMatch(live, /_next\/image/);

  const none = html(
    createElement(DashboardJournalRow, { code: "custom", name: "Свой", filled: false, thumb: null }),
  );
  assert.doesNotMatch(none, /<img/);
  assert.match(none, /data-journal-thumb=""[^>]*><span class="[^"]*h-12 w-16 lg:h-\[60px\] lg:w-20[^"]*"><span[^>]*><svg[^>]*lucide-file-text/);
});

test("бумажный журнал — та же строка с превью paper_<id>, без отметки", () => {
  const paper = html(createElement(DashboardPaperRow, { id: "ot_intro", name: "Журнал вводного инструктажа" }));
  assert.match(paper, /^<a [^>]*href="\/settings\/journals\/paper\/ot_intro"/);
  assert.match(paper, /data-journal-thumb=""/);
  assert.match(paper, /journal-samples%2Fpaper_ot_intro\.webp/);
  assert.match(paper, /lucide-printer/);
  assert.doesNotMatch(paper, /data-journal-mark/);
});

test("у каждого журнала каталога и бумажного бланка есть превью (нет 404)", () => {
  const missing = [
    ...ACTIVE_JOURNAL_CATALOG.map((item) => `public/journal-samples/${item.code}.webp`),
    ...PAPER_JOURNALS.map((paper) => `public/journal-samples/paper_${paper.id}.webp`),
  ].filter((file) => !existsSync(path.join(ROOT, file)));
  assert.deepEqual(missing, []);
});

test("скелет загрузки — без карточки, теми же классами, что и список", () => {
  const loading = read("src/app/(dashboard)/dashboard/loading.tsx");
  const grid = read("src/components/dashboard/dashboard-journals-grid.tsx");
  for (const name of ["JOURNAL_TOOLBAR_CLASS", "JOURNAL_LIST_CLASS", "JOURNAL_ITEM_CLASS"]) {
    assert.match(loading, new RegExp(`className=\\{${name}\\}`), `скелет: ${name}`);
    assert.match(grid, new RegExp(`className=\\{${name}\\}`), `список: ${name}`);
  }
  assert.match(loading, /className=\{JOURNAL_ROW_CLASS\}/);
  assert.match(loading, /JOURNAL_THUMB_SIZE_CLASS/);
  const block = loading.slice(loading.indexOf('data-skeleton="compliance-grid"'), loading.indexOf("grid gap-3 sm:grid-cols-2"));
  assert.doesNotMatch(block, /rounded-3xl|shadow-/, "в скелете секции нет карточки");
  // Классы на месте: телефон — одна колонка, компьютер — 2–3.
  assert.match(JOURNAL_LIST_CLASS, /grid-cols-1 .*md:grid-cols-2 .*lg:grid-cols-3/);
  assert.match(JOURNAL_ITEM_CLASS, /border-t border-\[#ececf4\]/);
  assert.match(JOURNAL_ROW_CLASS, /items-center/);
  assert.match(JOURNAL_THUMB_SIZE_CLASS, /h-12 w-16/);
  assert.match(JOURNAL_TOOLBAR_CLASS, /lg:flex-row/);
});

type FakeDetails = {
  nodeType: 1;
  open: boolean;
  dataset: { storageKey?: string };
  __persistAttached?: boolean;
  listeners: Array<() => void>;
  addEventListener(type: string, fn: () => void): void;
  matches(selector: string): boolean;
  querySelectorAll(selector: string): FakeDetails[];
  toggle(next: boolean): void;
  /** `toggle` без смены состояния — так браузер отзывается на `<details open>` из разметки. */
  fire(): void;
};

function fakeDetails(key: string, open: boolean): FakeDetails {
  const el: FakeDetails = {
    nodeType: 1,
    open,
    dataset: { storageKey: key },
    listeners: [],
    addEventListener(type, fn) {
      if (type === "toggle") el.listeners.push(fn);
    },
    matches: (selector) => selector === "details[data-storage-key]",
    querySelectorAll: () => [],
    toggle(next) {
      el.open = next;
      el.listeners.forEach((fn) => fn());
    },
    fire() {
      el.listeners.forEach((fn) => fn());
    },
  };
  return el;
}

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

test("запоминание (помощник секции): сохранённое ставится сразу, переключение пишется, повтор — пустой", () => {
  const key = `${DASHBOARD_SECTION_STORAGE_PREFIX}compliance-grid`;
  const storage = fakeStorage({ [key]: "0" });
  const details = fakeDetails("compliance-grid", true);
  attachDashboardSectionMemory(details, storage);
  assert.equal(details.open, false, "свёрнута, как оставили");
  attachDashboardSectionMemory(details, storage);
  assert.equal(details.listeners.length, 1, "второй вызов ничего не навешивает");
  details.toggle(true);
  assert.equal(storage.map.get(key), "1");

  // Ничего не сохранено — остаётся по умолчанию (открыта), и отклик
  // браузера на `open` из разметки ничего не записывает.
  const fresh = fakeDetails("compliance-grid", true);
  const freshStorage = fakeStorage();
  attachDashboardSectionMemory(fresh, freshStorage);
  fresh.fire();
  assert.equal(fresh.open, true);
  assert.equal(freshStorage.map.size, 0, "без нажатия ничего не сохраняем");
  fresh.toggle(false);
  assert.equal(freshStorage.map.get(key), "0");
});

test("запоминание (inline-скрипт): секция подхватывается при появлении в DOM, до DOMContentLoaded", () => {
  const key = `${DASHBOARD_SECTION_STORAGE_PREFIX}compliance-grid`;
  const storage = fakeStorage({ [key]: "0", [`${DASHBOARD_SECTION_STORAGE_PREFIX}print-agent`]: "1" });
  const docListeners: Record<string, Array<() => void>> = {};
  const present: FakeDetails[] = [];
  const documentStub = {
    readyState: "loading",
    documentElement: {},
    querySelectorAll: () => present,
    addEventListener: (type: string, fn: () => void) => {
      (docListeners[type] ??= []).push(fn);
    },
  };
  class FakeObserver {
    static last: FakeObserver | null = null;
    observing = false;
    constructor(public callback: (records: Array<{ addedNodes: unknown[] }>) => void) {
      FakeObserver.last = this;
    }
    observe() {
      this.observing = true;
    }
    disconnect() {
      this.observing = false;
    }
  }
  new Function("document", "localStorage", "MutationObserver", DASHBOARD_SECTION_PERSIST_SCRIPT)(
    documentStub,
    storage,
    FakeObserver,
  );
  const observer = FakeObserver.last;
  assert.ok(observer?.observing, "страница ещё грузится — наблюдаем за DOM");

  // Секция пришла в потоке разметки: состояние ставится сразу, до отрисовки.
  const compliance = fakeDetails("compliance-grid", true);
  const wrapper = { nodeType: 1, querySelectorAll: () => [compliance] };
  observer!.callback([{ addedNodes: [{ nodeType: 3 }, wrapper] }]);
  assert.equal(compliance.open, false);
  compliance.fire();
  assert.equal(storage.map.get(key), "0", "отклик на подстановку не перезаписывает");
  compliance.toggle(true);
  assert.equal(storage.map.get(key), "1");

  const printer = fakeDetails("print-agent", false);
  present.push(printer);
  docListeners.DOMContentLoaded?.forEach((fn) => fn());
  assert.equal(printer.open, true, "добор на DOMContentLoaded");
  assert.equal(observer!.observing, false, "наблюдатель снят");
});
