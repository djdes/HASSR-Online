/**
 * Сравнение редакций документов ППК (владелец, 2026-11-25: «что именно
 * изменилось между «ППК 002» и «ППК 003»»). Пословно, алгоритмом Майерса.
 *
 * Сравниваются только слова и знаки: пробелы и переносы строк — не правка
 * (как и при определении новой редакции, `normalizeRevisionText`). Текст
 * показывается с переносами строк новой редакции. Очень непохожие тексты —
 * построчно; совсем разные — «удалено всё / добавлено всё». Чистый модуль.
 */

export type DiffOp = "eq" | "add" | "del";
export type DiffSegment = { op: DiffOp; text: string };
export type DiffResult = {
  segments: DiffSegment[];
  /** Добавлено и удалено слов (без знаков препинания). */
  added: number;
  removed: number;
  mode: "words" | "lines" | "whole";
};

type Token = { word: string; text: string };

/** Слово (буквы, цифры) или отдельный знак — вместе с пробелами после него. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /([\p{L}\p{N}_]+|[^\s\p{L}\p{N}_])(\s*)/gu;
  // Пробелы в начале текста идут вместе с первым словом.
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  re.lastIndex = lead.length;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push({ word: match[1], text: (tokens.length === 0 ? lead : "") + match[0] });
  }
  return tokens;
}

/** Строки как токены (запасной режим для очень непохожих текстов). */
function lineTokens(text: string): Token[] {
  const lines = text.split(/(?<=\n)/);
  return lines
    .map((line) => ({ word: line.replace(/\s+/g, " ").trim(), text: line }))
    .filter((token) => token.text.length > 0);
}

type Edit = { op: DiffOp; token: Token };

/**
 * Кратчайший список правок (Майерс). Хранятся только используемые части
 * массивов V — память ~D², поэтому число правок ограничено `maxD`:
 * больше — null (тексты слишком разные для пословного сравнения).
 */
function myers(a: Token[], b: Token[], maxD: number): Edit[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const limit = Math.min(max, maxD);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];
  let found = -1;
  outer: for (let d = 0; d <= limit; d += 1) {
    // Снимок V перед шагом d: нужны индексы k ∈ [-d-1, d+1].
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x].word === b[y].word) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break outer;
      }
    }
  }
  if (found < 0) return null;

  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d -= 1) {
    const snap = trace[d];
    // Индекс k в снимке шага d: k + d + 1.
    const at = (k: number) => snap[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      edits.push({ op: "eq", token: b[y - 1] });
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      if (x === prevX) edits.push({ op: "add", token: b[y - 1] });
      else edits.push({ op: "del", token: a[x - 1] });
    }
    x = prevX;
    y = prevY;
  }
  return edits.reverse();
}

const isWord = (token: Token) => /[\p{L}\p{N}]/u.test(token.word);

function merge(edits: Edit[]): DiffResult["segments"] {
  const segments: DiffSegment[] = [];
  for (const edit of edits) {
    const last = segments[segments.length - 1];
    if (last && last.op === edit.op) last.text += edit.token.text;
    else segments.push({ op: edit.op, text: edit.token.text });
  }
  return segments;
}

function result(edits: Edit[], mode: DiffResult["mode"]): DiffResult {
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    if (edit.op === "add") added += mode === "words" ? (isWord(edit.token) ? 1 : 0) : tokenize(edit.token.text).filter(isWord).length;
    if (edit.op === "del") removed += mode === "words" ? (isWord(edit.token) ? 1 : 0) : tokenize(edit.token.text).filter(isWord).length;
  }
  return { segments: merge(edits), added, removed, mode };
}

/** Общие начало и конец не участвуют в поиске правок — быстрее на почти одинаковых текстах. */
function withCommonEnds(a: Token[], b: Token[], inner: (a: Token[], b: Token[]) => Edit[] | null): Edit[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start].word === b[start].word) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end].word === b[b.length - 1 - end].word) end += 1;
  const middle = inner(a.slice(start, a.length - end), b.slice(start, b.length - end));
  if (!middle) return null;
  return [
    ...b.slice(0, start).map((token) => ({ op: "eq" as const, token })),
    ...middle,
    ...b.slice(b.length - end).map((token) => ({ op: "eq" as const, token })),
  ];
}

export type DiffOptions = {
  /** Больше токенов в сумме — сразу построчно. */
  maxTokens?: number;
  /** Больше правок — тексты слишком разные для этого режима. */
  maxEdits?: number;
};

/** Что изменилось от `before` к `after`. */
export function diffTexts(before: string, after: string, options: DiffOptions = {}): DiffResult {
  const maxTokens = options.maxTokens ?? 40_000;
  const maxEdits = options.maxEdits ?? 1_500;
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length + b.length <= maxTokens) {
    const edits = withCommonEnds(a, b, (x, y) => myers(x, y, maxEdits));
    if (edits) return result(edits, "words");
  }
  const lines = withCommonEnds(lineTokens(before), lineTokens(after), (x, y) => myers(x, y, maxEdits));
  if (lines) return result(lines, "lines");
  const whole: Edit[] = [];
  if (before.trim()) whole.push({ op: "del", token: { word: before, text: before } });
  if (after.trim()) whole.push({ op: "add", token: { word: after, text: after } });
  return result(whole, "whole");
}
