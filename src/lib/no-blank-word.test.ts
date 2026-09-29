import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

/**
 * Слово «бланк» в текстах для человека — только в исключениях ниже.
 *
 * Правка владельца 29.09.2026 про журнал холодильников: «Это не бланк, а
 * журнал учёта температурного режима… изменить везде, не должно быть
 * слова „бланк“». Наши журналы и документы на экране, в PDF и Word, в
 * письмах, Telegram, подсказках, гайдах и аудите называются журналом,
 * документом, листом, печатной формой — по смыслу места.
 *
 * Исходники разбирает компилятор TypeScript, и смотрится только то, что
 * может дойти до человека: строковые литералы, куски шаблонных строк,
 * JSX-текст и строковые атрибуты JSX. Комментарии, идентификаторы
 * (`blank`, `BlankQr`), маршруты (`/blanki`, `/qb/`) и сами тесты не
 * считаются.
 */

const ROOT = process.cwd();
const WORD = /бланк/i;
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.test\.(ts|tsx)$/;

type Exception = {
  /** Почему слово здесь остаётся. */
  reason: string;
  /** Разрешённые тексты целиком (пробелы схлопнуты). Без списка — весь файл. */
  only?: readonly string[];
};

/** Ключ — файл или папка (со слешем на конце: всё внутри неё). */
const EXCEPTIONS: Readonly<Record<string, Exception>> = {
  "src/app/blanki/": {
    reason:
      "Раздел «Бланки» — пустые формы для скачивания, так их ищут в Яндексе. Решение за владельцем.",
  },
  "src/app/journals-info/page.tsx": {
    reason: "Кнопка-ссылка на раздел «Бланки».",
    only: ["Скачать пустые бланки"],
  },
  "src/app/page.tsx": {
    reason: "Ссылка с главной на раздел «Бланки».",
    only: ["Бланки журналов: PDF и Word"],
  },
  "src/components/public/public-chrome.tsx": {
    reason: "Пункт меню сайта — ссылка на раздел «Бланки».",
    only: ["Бланки"],
  },
  "src/app/prikazy/page.tsx": {
    reason:
      "«Бланк приказа» — пустая форма приказа для скачивания, а не журнал; плюс ссылка на раздел «Бланки».",
  },
  "src/content/seo-landings.ts": {
    reason: "SEO-заголовки: «скачать бланк» — поисковый запрос про пустые формы.",
    only: [
      "Журнал здоровья сотрудников — скачать бланк",
      "Бракеражный журнал — скачать бланк и образец",
      "Журнал уборки помещений — скачать бланк 2026",
      "Температурный лист холодильника — скачать бланк",
    ],
  },
  "src/content/changelog.ts": {
    reason: "История изменений: запись о запуске раздела «Бланки».",
    only: ["Страница бланков: печатные формы всех журналов."],
  },
  "src/content/direct-campaigns.ts": {
    reason: "Минус-слово рекламных кампаний — поисковый запрос, человеку не показывается.",
    only: ["бланк"],
  },
  "src/lib/whats-new-notes.ts": {
    reason: "История «Что нового»: правка заново покажет окно всем руководителям.",
  },
  "src/lib/journal-title-renames.ts": {
    reason: "Прежние названия журналов: по ним находятся и переименовываются старые документы.",
  },
};

/**
 * Ключевые экраны и печать из правки владельца. Их нельзя «починить»,
 * дописав в исключения: слово здесь — ошибка всегда.
 */
const NEVER_EXCEPTED = [
  "src/components/journals/cold-equipment-document-client.tsx",
  "src/components/journals/climate-document-client.tsx",
  "src/app/room-fill/[roomId]/room-fill-client.tsx",
  "src/app/qb/[token]/page.tsx",
  "src/lib/audit-labels.ts",
  "src/lib/document-pdf.ts",
  "src/lib/document-docx.ts",
  "src/lib/paper-journal-pdf.ts",
];

type Text = { line: number; text: string };
type Hit = Text & { file: string };

/** Тексты, которые могут дойти до человека: литералы, шаблоны, JSX. */
function visibleTexts(fileName: string, source: string): Text[] {
  const kind = /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const texts: Text[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) || // и строковые атрибуты JSX: title="…"
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const raw = node.getText(sourceFile);
      const start = node.getStart(sourceFile) + Math.max(0, raw.search(/\S/));
      texts.push({
        line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
        text: node.text.replace(/\s+/g, " ").trim(),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return texts;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(relative, out);
    else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) out.push(relative);
  }
  return out;
}

function collectHits(): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles("src")) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (!WORD.test(source)) continue;
    for (const item of visibleTexts(file, source)) {
      if (WORD.test(item.text)) hits.push({ file, ...item });
    }
  }
  return hits;
}

function covers(key: string, file: string): boolean {
  return key.endsWith("/") ? file.startsWith(key) : file === key;
}

function isAllowed(hit: Hit): boolean {
  return Object.entries(EXCEPTIONS).some(
    ([key, exception]) =>
      covers(key, hit.file) && (!exception.only || exception.only.includes(hit.text)),
  );
}

const hits = collectHits();

test("в текстах для человека нет слова «бланк» — кроме исключений", (t) => {
  const offenders = hits.filter((hit) => !isAllowed(hit));
  t.diagnostic(
    `видимых «бланк»: ${hits.length}, все в исключениях: ${hits.length - offenders.length} ` +
      `(${new Set(hits.map((hit) => hit.file)).size} файлов)`,
  );
  assert.deepEqual(
    offenders.map((hit) => `${hit.file}:${hit.line} «${hit.text}»`),
    [],
    "Назовите по смыслу: журнал, документ, лист, печатная форма, шапка журнала. " +
      "Исключение — только с причиной в EXCEPTIONS этого теста.",
  );
});

test("исключения: у каждого есть причина, файл на месте и слово в нём ещё встречается", () => {
  for (const [key, exception] of Object.entries(EXCEPTIONS)) {
    assert.ok(exception.reason.trim().length > 0, `${key}: нет причины`);
    assert.ok(fs.existsSync(path.join(ROOT, key)), `${key}: файла нет — уберите исключение`);
    const texts = hits.filter((hit) => covers(key, hit.file)).map((hit) => hit.text);
    assert.ok(texts.length > 0, `${key}: слова больше нет — уберите исключение`);
    for (const allowed of exception.only ?? []) {
      assert.ok(texts.includes(allowed), `${key}: текста «${allowed}» больше нет — уберите его из only`);
    }
  }
});

test("журналы температуры, QR-страницы, аудит и печать не бывают исключениями", () => {
  for (const file of NEVER_EXCEPTED) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file}: файл переехал — обновите список`);
    assert.deepEqual(
      Object.keys(EXCEPTIONS).filter((key) => covers(key, file)),
      [],
      `${file}: в исключения нельзя`,
    );
    assert.deepEqual(
      hits.filter((hit) => hit.file === file).map((hit) => `${hit.line} «${hit.text}»`),
      [],
      file,
    );
  }
});

test("сканер видит литералы, шаблоны, JSX-текст и атрибуты — но не комментарии и имена", () => {
  const source = [
    "// в шапке бланка — комментарий",
    "/* и тут бланк */",
    'const blank = 1; const BlankQr = "/blanki/qb";',
    'const placeholder = "Строка в шапке бланка";',
    "const saved = `Записано в бланк за ${day}, фото — в бланке`;",
    "const plain = `Пустой бланк`;",
    'const view = <p title="Увеличить бланк">Пустой бланк</p>;',
  ].join("\n");
  const found = visibleTexts("sample.tsx", source).filter((item) => WORD.test(item.text));
  assert.deepEqual(found, [
    { line: 4, text: "Строка в шапке бланка" },
    { line: 5, text: "Записано в бланк за" },
    { line: 5, text: ", фото — в бланке" },
    { line: 6, text: "Пустой бланк" },
    { line: 7, text: "Увеличить бланк" },
    { line: 7, text: "Пустой бланк" },
  ]);
});
