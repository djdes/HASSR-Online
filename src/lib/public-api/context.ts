import type { Locale } from "@/i18n/locales";
import type { EntryWriteActor } from "@/lib/journal-entry-write";
import type { ApiKeyAccess } from "./keys";

export type ApiVia = "mcp" | "rest";

/**
 * Кто и откуда вызывает инструмент: ключ, его владелец (с ролью в
 * организации ключа) и организация. Собирается в `authenticateApiKey`
 * на каждый запрос — MCP и REST v1 не читают cookie-сессию.
 */
export type ApiCallContext = {
  keyId: string;
  keyName: string;
  access: ApiKeyAccess;
  via: ApiVia;
  orgId: string;
  orgName: string;
  timezone: string | null;
  actor: EntryWriteActor;
  locale: Locale;
  baseUrl: string;
};
