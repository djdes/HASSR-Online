/**
 * Ознакомление сотрудников с документами ППК: ключи документов.
 * Чистый модуль — им пользуются страницы, API и тесты.
 */
export const ACK_STATIC_KEYS = ["policy", "team-regulation"] as const;
const KNOWLEDGE_PREFIX = "knowledge:";
const KNOWLEDGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type AckDocKey = (typeof ACK_STATIC_KEYS)[number] | `knowledge:${string}`;

export function ackKnowledgeKey(id: string): AckDocKey {
  return `${KNOWLEDGE_PREFIX}${id}`;
}

/** id документа базы знаний из ключа или null, если ключ другой/битый. */
export function ackKnowledgeId(key: string): string | null {
  if (!key.startsWith(KNOWLEDGE_PREFIX)) return null;
  const id = key.slice(KNOWLEDGE_PREFIX.length);
  return KNOWLEDGE_ID_RE.test(id) ? id : null;
}

export function isAckDocKey(value: unknown): value is AckDocKey {
  if (typeof value !== "string") return false;
  if ((ACK_STATIC_KEYS as readonly string[]).includes(value)) return true;
  return ackKnowledgeId(value) !== null;
}

/** Адрес страницы документа для сотрудника (двоеточие кодируется). */
export function ackDocPath(key: string): string {
  return `/acknowledge/${encodeURIComponent(key)}`;
}

/** «17.10.2026» и «14:05» в часовом поясе организации (ошибочный пояс — Москва). */
export function formatAckMoment(iso: string, timeZone: string): { date: string; time: string } {
  const at = new Date(iso);
  const zone = (() => {
    try {
      new Intl.DateTimeFormat("ru-RU", { timeZone });
      return timeZone;
    } catch {
      return "Europe/Moscow";
    }
  })();
  return {
    date: new Intl.DateTimeFormat("ru-RU", { timeZone: zone, day: "2-digit", month: "2-digit", year: "numeric" }).format(at),
    time: new Intl.DateTimeFormat("ru-RU", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(at),
  };
}
