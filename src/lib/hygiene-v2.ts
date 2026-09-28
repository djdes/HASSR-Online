/**
 * Гигиенический журнал по форме Приложения №1 СанПиН «Гигиенический
 * журнал (сотрудники)» — решение владельца по его бланку (2026-09-22).
 * Чистый модуль: без БД, для сервера, клиента и печати.
 *
 * Сотрудник по QR (с PIN) подписывает три графы; ответственный — зав.
 * производством — по второму QR (тоже с PIN) ставит «допущен / отстранён»
 * и свою подпись. Запись дня сотрудника (`JournalDocumentEntry.data`)
 * сохраняет контракт QR «Гигиена и здоровье» (`health-qr.ts`): `status`,
 * `confirmedAt`, `confirmations`, `source`; допуск — поле `verification`.
 *
 * Новая форма — у документов с `config.hygieneFormVersion = 2` (новые
 * документы); текущие дорабатывают свой период в прежнем виде.
 */

export const HYGIENE_FORM_VERSION_KEY = "hygieneFormVersion";

export function readHygieneFormVersion(config: unknown): 1 | 2 {
  if (!config || typeof config !== "object" || Array.isArray(config)) return 1;
  return (config as Record<string, unknown>)[HYGIENE_FORM_VERSION_KEY] === 2 ? 2 : 1;
}

/**
 * Строка справа над заголовком «Гигиенический журнал (сотрудники)» — как
 * на форме заказчика. Печатается в PDF (`drawHygieneV2Pdf`) и стоит над
 * таблицей на сайте (`HygieneV2Table`).
 */
export const HYGIENE_V2_FORM_CAPTION =
  "Рекомендуемая форма в соответствии с Приложением №1 СанПиН 2.3/2.4.4282-26";

/** Колонки бланка — порядок и подписи как на форме заказчика. */
export const HYGIENE_V2_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "n", label: "N п/п" },
  { key: "date", label: "Дата" },
  { key: "name", label: "Ф.И.О. работника" },
  { key: "position", label: "Должность" },
  { key: "temperature", label: "Подпись сотрудника об отсутствии температуры выше 37" },
  {
    key: "infection",
    label: "Подпись сотрудника об отсутствии признаков инфекционных заболеваний у сотрудника и членов семьи",
  },
  {
    key: "respiratorySkin",
    label:
      "Подпись сотрудника об отсутствии заболеваний верхних дыхательных путей и гнойничковых заболеваний кожи рук и открытых поверхностей тела",
  },
  { key: "result", label: "Результат осмотра ответственным лицом, медицинским работником (допущен/отстранен)" },
  { key: "verifier", label: "Подпись ответственного лица, медицинского работника" },
];

export type HygieneVerification = {
  result: "admitted" | "suspended";
  byUserId: string;
  byName: string;
  byTitle: string | null;
  /** «ЧЧ:ММ» по поясу организации. */
  at: string;
  method: "qr" | "session";
};

export type HygieneSignatures = { temperature: boolean | null; infection: boolean | null; respiratorySkin: boolean | null };

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readVerification(value: unknown): HygieneVerification | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.result !== "admitted" && record.result !== "suspended") return null;
  if (typeof record.byName !== "string" || typeof record.at !== "string") return null;
  return {
    result: record.result,
    byUserId: typeof record.byUserId === "string" ? record.byUserId : "",
    byName: record.byName,
    byTitle: typeof record.byTitle === "string" ? record.byTitle : null,
    at: record.at,
    method: record.method === "session" ? "session" : "qr",
  };
}

/**
 * Подписи сотрудника из записи дня. Прежняя отметка QR (пять подтверждений,
 * 2026-09-22) раскладывается на три графы: инфекции = кишечник + семья,
 * дыхательные пути и кожа = ОРВИ + кожа.
 */
function readSignatures(value: unknown): HygieneSignatures | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  if ("infection" in c || "respiratorySkin" in c) {
    return { temperature: bool(c.temperature), infection: bool(c.infection), respiratorySkin: bool(c.respiratorySkin) };
  }
  const both = (a: unknown, b: unknown) => (bool(a) === null && bool(b) === null ? null : bool(a) !== false && bool(b) !== false);
  return { temperature: bool(c.temperature), infection: both(c.intestinal, c.family), respiratorySkin: both(c.respiratory, c.skin) };
}

export type HygieneV2View = {
  /** Сотрудник отметился сам (QR с подтверждениями). */
  declared: boolean;
  signatures: HygieneSignatures;
  declaredAt: string | null;
  /** Решение ответственного; null — ещё не проверил. */
  result: { result: "admitted" | "suspended"; byName: string; byTitle: string | null; at: string } | null;
  /** Выходной / отпуск / больничный — строка в бланк не нужна. */
  absence: "day_off" | "vacation" | "sick_leave" | null;
};

export function hygieneV2View(data: unknown): HygieneV2View {
  const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const signatures = readSignatures(record.confirmations);
  const verification = readVerification(record.verification);
  const status = typeof record.status === "string" ? record.status : "";
  return {
    declared: Boolean(signatures) && record._autoSeeded !== true,
    signatures: signatures ?? { temperature: null, infection: null, respiratorySkin: null },
    declaredAt: typeof record.confirmedAt === "string" ? record.confirmedAt : null,
    result: verification
      ? { result: verification.result, byName: verification.byName, byTitle: verification.byTitle, at: verification.at }
      : null,
    absence: status === "day_off" || status === "vacation" || status === "sick_leave" ? status : null,
  };
}

/**
 * Допуск ответственного: результат и подпись. Статус дня следует за
 * решением (сводка и крон читают `status`), отметка сотрудника
 * (`confirmations`, `confirmedAt`, `source`) остаётся как была.
 */
export function applyHygieneVerification(data: unknown, verification: HygieneVerification): Record<string, unknown> {
  const record = data && typeof data === "object" && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : {};
  delete record._autoSeeded;
  return {
    ...record,
    status: verification.result === "admitted" ? "healthy" : "suspended",
    verification,
  };
}

/** «✓» / «✗» / пусто для графы подписи в бланке и таблице. */
export function signatureMark(value: boolean | null): string {
  if (value === true) return "✓";
  if (value === false) return "✗";
  return "";
}

export function verificationResultLabel(result: "admitted" | "suspended" | null): string {
  if (result === "admitted") return "допущен";
  if (result === "suspended") return "отстранен";
  return "";
}

/**
 * Конфиг НОВОГО документа гигиены — по новой форме. Период — новый
 * документ, поэтому и конфиг, перенесённый из прошлого периода, получает
 * v2. Для остальных журналов — без изменений.
 */
export function withNewHygieneFormVersion<T extends Record<string, unknown>>(
  journalCode: string,
  config: T
): T {
  if (journalCode !== "hygiene") return config;
  return { ...config, [HYGIENE_FORM_VERSION_KEY]: 2 };
}

/**
 * Пересборка config СУЩЕСТВУЮЩЕГО документа (подбор ответственных и т.п.)
 * не меняет его форму: версия берётся из прежнего конфига.
 */
export function keepHygieneFormVersion(
  previousConfig: unknown,
  nextConfig: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...nextConfig };
  if (readHygieneFormVersion(previousConfig) === 2) next[HYGIENE_FORM_VERSION_KEY] = 2;
  else delete next[HYGIENE_FORM_VERSION_KEY];
  return next;
}

export type HygieneV2Row = {
  n: number;
  employeeId: string;
  dateKey: string;
  /** «ДД.ММ.ГГГГ». */
  date: string;
  name: string;
  position: string;
  /** Графы подписи сотрудника: «✓» / «✗» / пусто. */
  temperature: string;
  infection: string;
  respiratorySkin: string;
  /** «допущен» / «отстранен» / пусто. */
  result: string;
  resultKind: "admitted" | "suspended" | null;
  /** «ФИО, должность · ЧЧ:ММ» или пусто. */
  verifier: string;
};

function isRealMark(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  if (record._autoSeeded === true) return false;
  return typeof record.status === "string" && record.status !== "";
}

function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-");
  return `${day}.${month}.${year}`;
}

/**
 * Строки бланка Приложения №1: одна строка — сотрудник в день, когда есть
 * настоящая отметка (не заготовка) и это не выходной / отпуск / больничный.
 * Порядок — по дате, внутри дня по ФИО.
 */
export function buildHygieneV2Rows(input: {
  employees: ReadonlyArray<{ id: string; name: string; position: string | null }>;
  entries: ReadonlyArray<{ employeeId: string; dateKey: string; data: unknown }>;
  dateKeys: ReadonlyArray<string>;
}): HygieneV2Row[] {
  const employeeById = new Map(input.employees.map((employee) => [employee.id, employee]));
  const period = new Set(input.dateKeys);
  const picked = input.entries
    .filter((entry) => period.has(entry.dateKey) && employeeById.has(entry.employeeId) && isRealMark(entry.data))
    .map((entry) => ({ entry, view: hygieneV2View(entry.data), employee: employeeById.get(entry.employeeId)! }))
    .filter((item) => item.view.absence === null);

  picked.sort((left, right) => {
    if (left.entry.dateKey !== right.entry.dateKey) return left.entry.dateKey < right.entry.dateKey ? -1 : 1;
    return left.employee.name.localeCompare(right.employee.name, "ru");
  });

  return picked.map(({ entry, view, employee }, index) => {
    const sign = (value: boolean | null) => (view.declared ? signatureMark(value) : "");
    const verification = view.result;
    const who = verification ? [verification.byName, verification.byTitle].filter(Boolean).join(", ") : "";
    return {
      n: index + 1,
      employeeId: entry.employeeId,
      dateKey: entry.dateKey,
      date: formatDateKey(entry.dateKey),
      name: employee.name,
      position: employee.position ?? "",
      temperature: sign(view.signatures.temperature),
      infection: sign(view.signatures.infection),
      respiratorySkin: sign(view.signatures.respiratorySkin),
      result: verificationResultLabel(verification?.result ?? null),
      resultKind: verification?.result ?? null,
      verifier: verification ? `${who} · ${verification.at}` : "",
    };
  });
}

/**
 * Графа подписи в PDF — словами. Шрифт печати (Liberation Serif из
 * `src/lib/pdf-fonts`, как и запасные) знаков «✓»/«✗» не знает — отметка
 * пропала бы. «да»/«нет» читаются в любом шрифте и совпадают с прежним
 * бланком.
 */
export function hygieneV2PdfMark(mark: string): string {
  if (mark === "✓") return "да";
  if (mark === "✗") return "нет";
  return mark;
}

/** Отказ копированию отметок в документе новой формы. */
export const HYGIENE_V2_NO_COPY_MESSAGE =
  "В новой форме подписи ставит сам сотрудник по QR — копировать нельзя.";
