import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Утечка пароля при входе (владелец, 2026-11-24): «Войти», нажатое до загрузки
 * скриптов страницы, отправляло форму браузером — методом GET по умолчанию, и
 * логин с паролем уходили в адрес (`/login?email=…&password=…`), историю
 * браузера и логи сервера. Правило: форма с паролем, PIN или кодом входа —
 * только `method="post"`, а кнопка входных форм ждёт загрузки страницы.
 */

const SRC = path.join(process.cwd(), "src");

function listTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) listTsx(full, out);
    else if (name.endsWith(".tsx") && !name.includes(".test.")) out.push(full);
  }
  return out;
}

// И атрибуты JSX, и свойства объекта (`type: "password"` у полей, собранных из описаний).
const PASSWORD_INPUT =
  /type=["']password["']|type=\{[^}]*["']password["'][^}]*\}|autoComplete=["'](?:current|new)-password["']|\btype:\s*["']password["']|\bautoComplete:\s*["'](?:current|new)-password["']/;

/** Открывающие теги `<form …>` целиком: атрибуты с `{…}` (в том числе `=>`) не обрывают тег. */
function formTags(source: string): string[] {
  const tags: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf("<form", from);
    if (start < 0) return tags;
    const next = source[start + 5];
    if (next !== " " && next !== "\n" && next !== ">" && next !== "\r" && next !== "\t") {
      from = start + 5;
      continue;
    }
    let depth = 0;
    let quote: string | null = null;
    let end = start + 5;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(source.slice(start, end + 1));
    from = end + 1;
  }
}

const files = listTsx(SRC);
const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
const relative = (file: string) => path.relative(process.cwd(), file);

/** Файлы с полем пароля/PIN и те, что рисуют такой компонент внутри своей формы. */
function passwordFormFiles(): string[] {
  const direct = files.filter((file) => PASSWORD_INPUT.test(sources.get(file) ?? ""));
  const wrappers: string[] = [];
  for (const file of direct) {
    if (formTags(sources.get(file) ?? "").length > 0) continue;
    // Поле без своей формы: его форма — у того, кто импортирует компонент.
    const spec = "@/" + path.relative(SRC, file).replace(/\\/g, "/").replace(/\.tsx$/, "");
    for (const [other, text] of sources) {
      if (other !== file && (text.includes(`"${spec}"`) || text.includes(`'${spec}'`))) wrappers.push(other);
    }
  }
  return [...new Set([...direct, ...wrappers])].filter((file) => formTags(sources.get(file) ?? "").length > 0);
}

test("форма с паролем, PIN или кодом входа отправляется только методом POST", () => {
  const offenders: string[] = [];
  for (const file of passwordFormFiles()) {
    for (const tag of formTags(sources.get(file) ?? "")) {
      if (!/\bmethod=["']post["']/.test(tag)) offenders.push(`${relative(file)}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [], "без method=\"post\" браузер до загрузки скриптов кладёт поля в адрес страницы");
});

test("страж видит формы входа, PIN по личному QR и обёртки полей пароля", () => {
  const found = new Set(passwordFormFiles().map(relative));
  for (const file of [
    "src/app/(auth)/login/login-client.tsx",
    "src/app/mini/login/login-form.tsx",
    "src/app/invite/[token]/invite-accept-client.tsx",
    "src/app/join/[token]/join-form.tsx",
    "src/app/pair/[token]/pair-form.tsx",
    "src/app/q/[token]/personal-qr-login.tsx",
    // Пароль SMTP в свойствах поля (`type: "password"`) — проверка 2026-11-24.
    "src/app/root/me/mail-sender-form.tsx",
  ]) {
    assert.ok(found.has(file), file);
  }
});

/** Входные формы: до загрузки страницы кнопка не отправляет ничего — ни щелчком, ни Enter. */
const ENTRY_FORMS = [
  "src/app/(auth)/login/login-client.tsx",
  "src/app/(auth)/register/register-client.tsx",
  "src/app/mini/login/login-form.tsx",
  "src/app/invite/[token]/invite-accept-client.tsx",
  "src/app/join/[token]/join-form.tsx",
  "src/app/pair/[token]/pair-form.tsx",
  "src/app/q/[token]/personal-qr-login.tsx",
];

test("входные формы: method=\"post\" и кнопка отправки ждёт загрузки страницы", () => {
  for (const file of ENTRY_FORMS) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    for (const tag of formTags(source)) assert.match(tag, /\bmethod=["']post["']/, `${file}: ${tag.slice(0, 60)}`);
    assert.match(source, /useHydrated\(\)/, `${file}: useHydrated`);
    const submits = [...source.matchAll(/type="submit"[\s\S]{0,200}?disabled=\{([^}]*)\}/g)].map((match) => match[1]);
    assert.ok(submits.length > 0, `${file}: кнопка отправки`);
    for (const expression of submits) assert.match(expression, /!hydrated/, `${file}: disabled={${expression}}`);
  }
});

test("useHydrated: на сервере и при гидрации — false", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { useHydrated } = await import("@/lib/use-hydrated");
  function Probe() {
    return createElement("span", null, useHydrated() ? "ready" : "waiting");
  }
  assert.equal(renderToStaticMarkup(createElement(Probe)), "<span>waiting</span>");
});
