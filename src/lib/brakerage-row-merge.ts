/**
 * Слияние строк бракеражных журналов при сохранении с сайта.
 *
 * Страница документа держит строки в своём состоянии и шлёт конфиг целиком.
 * Пока она открыта, повар добавляет блюда по QR, а комиссия подписывает их
 * с телефона — без слияния сохранение с сайта стирало бы эти строки и
 * подписи («последний победил»).
 *
 * Правило: клиент присылает `knownRowIds` — id строк, которые он видел.
 *   • строка клиента остаётся как есть, но серверные поля (подписи, ключ
 *     задачи TasksFlow) берутся из базы — их клиент не может ни стереть, ни
 *     подделать;
 *   • строка из базы, которую клиент не видел, сохраняется (её добавили по
 *     QR после загрузки страницы) и дописывается в конец;
 *   • строка, которую клиент видел и не прислал, — удалена им.
 * Без `knownRowIds` (старый клиент) — прежнее поведение: строки клиента
 * заменяют базу, но серверные поля всё равно берутся из базы.
 */

export const BRAKERAGE_JOURNAL_CODES = new Set(["finished_product", "perishable_rejection"]);

export function isBrakerageJournalCode(code: string | null | undefined): boolean {
  return typeof code === "string" && BRAKERAGE_JOURNAL_CODES.has(code);
}

/** Поля строки, которыми владеет сервер. */
export const SERVER_OWNED_ROW_KEYS = ["signatures", "sourceRowKey"] as const;

type RowLike = { id: string } & Record<string, unknown>;

function asRows(value: unknown): RowLike[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is RowLike =>
      Boolean(row) && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
  );
}

export function parseKnownRowIds(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) return null;
  return new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, 5000));
}

export function mergeBrakerageRows(params: {
  incoming: unknown;
  current: unknown;
  knownRowIds: ReadonlySet<string> | null;
}): RowLike[] {
  const incoming = asRows(params.incoming);
  const current = asRows(params.current);
  const currentById = new Map(current.map((row) => [row.id, row]));
  const incomingIds = new Set(incoming.map((row) => row.id));

  const merged = incoming.map((row) => {
    const stored = currentById.get(row.id);
    const next: RowLike = { ...row };
    for (const key of SERVER_OWNED_ROW_KEYS) {
      if (stored && stored[key] !== undefined) next[key] = stored[key];
      else delete next[key];
    }
    return next;
  });

  if (params.knownRowIds) {
    for (const row of current) {
      if (incomingIds.has(row.id)) continue;
      if (params.knownRowIds.has(row.id)) continue; // клиент её видел и удалил
      merged.push(row);
    }
  }
  return merged;
}

/**
 * Ключи конфига, которыми владеет сервер. Состав комиссии пишет только окно
 * «Комиссия» (прямо в базу, `saveOrgCommission`); вкладка сайта, открытая до
 * смены состава, возвращала бы старый список при автосохранении.
 */
export const SERVER_OWNED_CONFIG_KEYS = ["commissionMembers"] as const;

function withServerOwnedKeys(
  incoming: Record<string, unknown>,
  current: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...incoming };
  for (const key of SERVER_OWNED_CONFIG_KEYS) {
    if (current[key] !== undefined) next[key] = current[key];
    else delete next[key];
  }
  return next;
}

/** Конфиг с объединёнными строками (остальные ключи — как прислал клиент). */
export function mergeBrakerageConfig(params: {
  incoming: unknown;
  current: unknown;
  knownRowIds: ReadonlySet<string> | null;
}): Record<string, unknown> {
  const incoming =
    params.incoming && typeof params.incoming === "object" && !Array.isArray(params.incoming)
      ? (params.incoming as Record<string, unknown>)
      : {};
  const current =
    params.current && typeof params.current === "object" && !Array.isArray(params.current)
      ? (params.current as Record<string, unknown>)
      : {};
  const guarded = withServerOwnedKeys(incoming, current);
  if (!Array.isArray(incoming.rows)) return guarded;
  return {
    ...guarded,
    rows: mergeBrakerageRows({ incoming: incoming.rows, current: current.rows, knownRowIds: params.knownRowIds }),
  };
}
