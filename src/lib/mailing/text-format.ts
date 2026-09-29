/**
 * Текст рассылки: переменные и простая разметка.
 *
 * Разметка — ровно то, что обещает форма: абзацы (пустая строка),
 * перенос строки, `**жирный**`, ссылки `[текст](https://…)` и голые
 * `https://…`. Адрес ссылки — только http(s) или путь сайта `/…`:
 * `javascript:` и прочее остаются обычным текстом.
 *
 * Переменные `{имя}`, `{компания}`, `{сфера}` подставляются ПОСЛЕ разбора
 * разметки: значение из загруженного CSV («[Скидка](https://чужой.сайт)»)
 * остаётся текстом и не может превратиться в ссылку или жирный. Пустое
 * значение заменяется запасным: `{имя|друзья}` → «друзья», иначе — запасное
 * из формы, иначе — общее по умолчанию.
 *
 * Модуль чистый: его читают и сервер (письма), и форма (подсказки).
 */

export type VariableKey = "name" | "company" | "sphere";

export const MAILING_VARIABLES: ReadonlyArray<{
  key: VariableKey;
  token: string;
  label: string;
  defaultFallback: string;
}> = [
  { key: "name", token: "имя", label: "Имя", defaultFallback: "коллеги" },
  { key: "company", token: "компания", label: "Компания", defaultFallback: "ваше заведение" },
  { key: "sphere", token: "сфера", label: "Сфера", defaultFallback: "общепит" },
];

export type VariableValues = Partial<Record<VariableKey, string | null | undefined>>;
export type VariableFallbacks = Partial<Record<VariableKey, string | null | undefined>>;

const TOKEN_TO_KEY = new Map(MAILING_VARIABLES.map((v) => [v.token, v.key]));

/** `{имя}` / `{Имя}` / `{имя|запасное}`. */
const VARIABLE_RE = /\{\s*(имя|компания|сфера)\s*(?:\|([^{}\n]*))?\}/giu;

function resolveVariable(
  key: VariableKey,
  inlineFallback: string | undefined,
  values: VariableValues,
  fallbacks: VariableFallbacks
): string {
  const value = (values[key] ?? "").trim();
  if (value) return value;
  if (inlineFallback !== undefined) return inlineFallback.trim();
  const fromForm = fallbacks[key];
  if (typeof fromForm === "string") return fromForm.trim();
  return MAILING_VARIABLES.find((v) => v.key === key)?.defaultFallback ?? "";
}

/** Подстановка в простой текст (тема письма, заголовок уведомления). */
export function substituteVariables(
  text: string,
  values: VariableValues,
  fallbacks: VariableFallbacks = {}
): string {
  return text.replace(VARIABLE_RE, (_m, token: string, inline?: string) => {
    const key = TOKEN_TO_KEY.get(token.toLowerCase());
    return key ? resolveVariable(key, inline, values, fallbacks) : _m;
  });
}

/** Какие переменные встречаются в тексте — для подсказки «пусто у N получателей». */
export function usedVariables(text: string): VariableKey[] {
  const found = new Set<VariableKey>();
  for (const m of text.matchAll(VARIABLE_RE)) {
    const key = TOKEN_TO_KEY.get(m[1].toLowerCase());
    if (key) found.add(key);
  }
  return [...found];
}

// ------------------------------------------------------------------ markup

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "link"; url: string; c: Inline[] }
  | { t: "br" };

/** Абзац — строка инлайнов; документ — абзацы. */
export type MarkupDoc = Inline[][];

/** Только http(s) и путь сайта: ничего, что браузер выполнит как код. */
export function isSafeLinkUrl(url: string): boolean {
  const value = url.trim();
  if (/^https?:\/\/[^\s<>"'`]+$/i.test(value)) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }
  return /^\/(?![/\\])[^\s<>"'`]*$/.test(value);
}

/** Путь сайта → абсолютный адрес (в письме и Telegram относительный не откроется). */
export function absoluteUrl(url: string, appUrl: string): string {
  const value = url.trim();
  if (value.startsWith("/")) return `${appUrl.replace(/\/+$/, "")}${value}`;
  return value;
}

const INLINE_RE =
  /\[([^\]\n]+)\]\(([^()\s]+)\)|\*\*([^\n]+?)\*\*|(https?:\/\/[^\s<>()"'`]*[^\s<>()"'`.,;:!?»…])|\n/g;

function parseInline(text: string, allowBold = true): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const pushText = (v: string) => {
    if (!v) return;
    const prev = out[out.length - 1];
    if (prev && prev.t === "text") prev.v += v;
    else out.push({ t: "text", v });
  };
  for (const m of text.matchAll(INLINE_RE)) {
    const index = m.index ?? 0;
    pushText(text.slice(last, index));
    last = index + m[0].length;
    if (m[0] === "\n") {
      out.push({ t: "br" });
    } else if (m[1] !== undefined && m[2] !== undefined) {
      if (isSafeLinkUrl(m[2])) out.push({ t: "link", url: m[2], c: parseInline(m[1], allowBold) });
      else pushText(m[0]);
    } else if (m[3] !== undefined) {
      if (allowBold) out.push({ t: "bold", c: parseInline(m[3], false) });
      else pushText(m[0]);
    } else if (m[4] !== undefined) {
      if (isSafeLinkUrl(m[4])) out.push({ t: "link", url: m[4], c: [{ t: "text", v: m[4] }] });
      else pushText(m[0]);
    }
  }
  pushText(text.slice(last));
  return out;
}

/** Private Use Area: такие символы в тексте ROOT не встречаются. */
const PH_OPEN = "";
const PH_CLOSE = "";
const PLACEHOLDER_RE = /(\d+)/g;

export type PreparedText = { doc: MarkupDoc; values: string[] };

/**
 * Разобрать текст с переменными: переменные заменяются метками, разметка
 * разбирается по тексту с метками, значения вставляются при выводе.
 */
export function prepareText(
  text: string,
  values: VariableValues,
  fallbacks: VariableFallbacks = {}
): PreparedText {
  const substituted: string[] = [];
  const withPlaceholders = text
    .replace(/\r\n?/g, "\n")
    .replace(/[]/g, "")
    .replace(VARIABLE_RE, (_m, token: string, inline?: string) => {
      const key = TOKEN_TO_KEY.get(token.toLowerCase());
      if (!key) return _m;
      substituted.push(resolveVariable(key, inline, values, fallbacks));
      return `${PH_OPEN}${substituted.length - 1}${PH_CLOSE}`;
    });
  const paragraphs = withPlaceholders
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim().length > 0);
  return { doc: paragraphs.map((p) => parseInline(p)), values: substituted };
}

function fillPlaceholders(text: string, values: string[]): string {
  return text.replace(PLACEHOLDER_RE, (_m, i: string) => values[Number(i)] ?? "");
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type RenderOptions = {
  /** Во что превратить адрес ссылки (учёт клика, абсолютный адрес). */
  linkHref?: (url: string) => string;
};

/** Ссылка, в адресе которой оказалась переменная, — просто текст. */
function linkUsable(url: string): boolean {
  return !url.includes(PH_OPEN);
}

function inlineToHtml(nodes: Inline[], prepared: PreparedText, opts: RenderOptions): string {
  return nodes
    .map((node) => {
      if (node.t === "text") return escapeHtmlText(fillPlaceholders(node.v, prepared.values));
      if (node.t === "br") return "<br>";
      if (node.t === "bold") return `<strong>${inlineToHtml(node.c, prepared, opts)}</strong>`;
      const label = inlineToHtml(node.c, prepared, opts);
      if (!linkUsable(node.url)) return label;
      const href = opts.linkHref ? opts.linkHref(node.url) : node.url;
      return `<a href="${escapeHtmlText(href)}" style="color:#3848c7;text-decoration:underline">${label}</a>`;
    })
    .join("");
}

const EMAIL_P_STYLE = "margin:0 0 16px;color:#3f3f46;line-height:1.6;font-size:15px";

/** HTML тела письма: абзацы `<p>` со стилями, как в остальных письмах. */
export function toEmailHtml(prepared: PreparedText, opts: RenderOptions = {}): string {
  return prepared.doc
    .map((p) => `<p style="${EMAIL_P_STYLE}">${inlineToHtml(p, prepared, opts)}</p>`)
    .join("\n");
}

function inlineToText(nodes: Inline[], prepared: PreparedText, opts: RenderOptions & { withUrls: boolean }): string {
  return nodes
    .map((node) => {
      if (node.t === "text") return fillPlaceholders(node.v, prepared.values);
      if (node.t === "br") return "\n";
      if (node.t === "bold") return inlineToText(node.c, prepared, opts);
      const label = inlineToText(node.c, prepared, opts);
      if (!opts.withUrls || !linkUsable(node.url)) return label;
      const href = opts.linkHref ? opts.linkHref(node.url) : node.url;
      return label === node.url ? href : `${label} (${href})`;
    })
    .join("");
}

/** Текстовая часть письма: ссылки — «текст (адрес)». */
export function toPlainText(prepared: PreparedText, opts: RenderOptions = {}): string {
  return prepared.doc.map((p) => inlineToText(p, prepared, { ...opts, withUrls: true })).join("\n\n");
}

/** Короткий текст без адресов — колокольчик, push, прехедер. */
export function toShortText(prepared: PreparedText, maxLength = 300): string {
  const text = prepared.doc
    .map((p) => inlineToText(p, prepared, { withUrls: false }))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function inlineToTelegram(nodes: Inline[], prepared: PreparedText, opts: RenderOptions): string {
  return nodes
    .map((node) => {
      if (node.t === "text") return escapeHtmlText(fillPlaceholders(node.v, prepared.values));
      if (node.t === "br") return "\n";
      if (node.t === "bold") return `<b>${inlineToTelegram(node.c, prepared, opts)}</b>`;
      const label = inlineToTelegram(node.c, prepared, opts);
      if (!linkUsable(node.url)) return label;
      const href = opts.linkHref ? opts.linkHref(node.url) : node.url;
      return `<a href="${escapeHtmlText(href)}">${label}</a>`;
    })
    .join("");
}

/** HTML для Telegram (`parse_mode: HTML`): `<b>`, `<a>`, переносы строк. */
export function toTelegramHtml(prepared: PreparedText, opts: RenderOptions = {}): string {
  return prepared.doc.map((p) => inlineToTelegram(p, prepared, opts)).join("\n\n");
}

/** Адреса всех ссылок в порядке появления (без повторов). */
export function extractLinks(prepared: PreparedText): string[] {
  const urls: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.t === "link") {
        if (linkUsable(node.url) && !urls.includes(node.url)) urls.push(node.url);
        walk(node.c);
      } else if (node.t === "bold") {
        walk(node.c);
      }
    }
  };
  prepared.doc.forEach(walk);
  return urls;
}
