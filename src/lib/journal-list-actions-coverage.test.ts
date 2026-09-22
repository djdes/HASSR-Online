import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * «Убедиться, что во всех журналах есть кнопка QR» (владелец, 2026-09-22).
 *
 * Статическая проверка: каждый список документов журнала рисует кнопки
 * через общий блок `JournalListActions` — напрямую или через общую шапку
 * `JournalTopBar`. Новый `*-documents-client.tsx` со своей шапкой и своей
 * «Инструкцией» без QR тест не пропустит.
 */
const ROOT = process.cwd();
const JOURNALS_DIR = path.join(ROOT, "src/components/journals");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const listClients = fs
  .readdirSync(JOURNALS_DIR)
  .filter((name) => name.endsWith("-documents-client.tsx"))
  .sort();

describe("кнопки страницы журнала — у всех журналов один блок с QR", () => {
  it("списков журналов не меньше 35 (защита от пустого глоба)", () => {
    assert.ok(listClients.length >= 35, `нашлось ${listClients.length}`);
  });

  for (const name of listClients) {
    it(`${name}: блок кнопок общий (JournalTopBar или JournalListActions)`, () => {
      const source = fs.readFileSync(path.join(JOURNALS_DIR, name), "utf8");
      const viaTopBar = /<JournalTopBar\b/.test(source);
      const viaActions = /<JournalListActions\b/.test(source);
      assert.ok(viaTopBar || viaActions, "нет ни <JournalTopBar>, ни <JournalListActions>");
      // «Инструкция» — только внутри общего блока: иначе QR окажется не над ней.
      assert.ok(!/<FillGuideLauncher\b/.test(source), "своя «Инструкция» мимо общего блока");
      assert.ok(!/JOURNAL_LIST_ACTIONS_CLASS/.test(source), "старый вертикальный блок кнопок");
      if (viaActions) {
        assert.match(source, /<JournalListActions[\s\S]*?canManage=\{/, "QR-кнопке нужен признак руководителя");
        // «Создать документ» во втором ряду — в общем стиле.
        if (/Создать документ/.test(source)) assert.match(source, /JOURNAL_ACTION_CREATE_CLASS/);
        // Строка «заголовок + блок»: блок справа, пока есть место, иначе под
        // заголовком — без сплющенного заголовка на планшете.
        assert.match(source, /className=\{JOURNAL_LIST_HEADER_ROW_CLASS\}/, "шапка без общей строки заголовка");
        assert.match(source, /<h1 className=\{JOURNAL_LIST_TITLE_CLASS\}/, "заголовок без общего класса");
      }
    });
  }

  it("общая шапка JournalTopBar рисует JournalListActions, старой ссылки «QR» нет", () => {
    const source = read("src/components/journals/document-list-ui.tsx");
    assert.match(source, /<JournalListActions\b/);
    assert.ok(!source.includes("kind=journals&ids="), "осталась старая ссылка на плакат журнала");
  });

  it("поле-журналы без документов (запасная страница) — тот же блок", () => {
    const page = read("src/app/(dashboard)/journals/[code]/page.tsx");
    assert.match(page, /<JournalListActions\b/);
    // Каждый список, который подключает страница журнала, — из проверенного набора.
    const imported = Array.from(page.matchAll(/from "@\/components\/journals\/([a-z-]+-documents-client)"/g)).map((m) => `${m[1]}.tsx`);
    assert.ok(imported.length >= 30, `страница подключает ${imported.length} списков`);
    for (const file of imported) assert.ok(listClients.includes(file), `${file} не проверен`);
  });

  it("QR — первым рядом, над «Создать документ» и «Инструкцией»", () => {
    const source = read("src/components/journals/journal-list-actions.tsx");
    const qr = source.indexOf("<JournalQrPointButton");
    const create = source.indexOf("{create}");
    const guide = source.indexOf("<FillGuideLauncher");
    assert.ok(qr > 0 && create > qr && guide > create, `порядок: qr=${qr} create=${create} guide=${guide}`);
    assert.match(source, /grid-cols-2/);
    assert.match(source, /col-span-2/);
  });

  it("золотой блик выключается при «уменьшить движение»", () => {
    const actions = read("src/components/journals/journal-list-actions.tsx");
    assert.match(actions, /qr-point-sheen/);
    assert.match(actions, /motion-reduce:transition-none/);
    const css = read("src/app/globals.css");
    assert.match(css, /@keyframes qr-point-sheen/);
    assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.qr-point-sheen::after\s*\{\s*animation: none/);
  });

  it("скелетон загрузки повторяет блок: широкая кнопка и два столбца", () => {
    const loading = read("src/app/(dashboard)/journals/[code]/loading.tsx");
    assert.match(loading, /col-span-2 h-12/);
    assert.equal((loading.match(/h-11 w-full rounded-2xl/g) ?? []).length, 2);
  });
});
