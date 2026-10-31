import { z } from "zod";

import { isAllowedSabyBaseUrl, normalizeSabyBaseUrl, SABY_DEFAULT_BASE_URL } from "@/lib/edo/saby/session";

import { DIADOC_BASE_URL } from "./diadoc";

/**
 * Подключения к ЭДО для входящих накладных: что вводит руководитель и что
 * хранится (зашифрованным). Наружу — только маска: логин, ID подключения,
 * ящик; пароль и защищённый ключ не отдаются никогда.
 */

export const SUPPLY_PROVIDERS = ["diadoc", "saby", "iiko"] as const;
export type SupplyProvider = (typeof SUPPLY_PROVIDERS)[number];

export function isSupplyProvider(value: unknown): value is SupplyProvider {
  return SUPPLY_PROVIDERS.includes(value as SupplyProvider);
}

export const diadocCredentialsSchema = z.object({
  apiClientId: z.string().trim().min(8).max(200),
  login: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});

export const sabyCredentialsSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => normalizeSabyBaseUrl(value || SABY_DEFAULT_BASE_URL))
    .refine((value) => isAllowedSabyBaseUrl(value), "Адрес СБИС — online.saby.ru или online.sbis.ru"),
  clientId: z.string().trim().min(3).max(200),
  appSecret: z.string().trim().min(3).max(500),
});

export const iikoCredentialsSchema = z.object({
  serverUrl: z.string().trim().min(8).max(300),
  login: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});

/** Что забирать из iiko; по умолчанию — всё. */
export const iikoOptionsSchema = z.object({
  invoices: z.boolean().default(true),
  writeoffs: z.boolean().default(true),
  products: z.boolean().default(true),
});

export type IikoStoredCredentials = z.infer<typeof iikoCredentialsSchema> & { options?: z.infer<typeof iikoOptionsSchema> };
export type IikoOptions = z.infer<typeof iikoOptionsSchema>;

export function readIikoOptions(value: unknown): IikoOptions {
  const parsed = iikoOptionsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { invoices: true, writeoffs: true, products: true };
}

export type DiadocStoredCredentials = z.infer<typeof diadocCredentialsSchema>;
export type SabyStoredCredentials = z.infer<typeof sabyCredentialsSchema>;

/** «ivan@…» → «iv***@…»: видно, чей вход, но не весь адрес. */
export function maskLogin(login: string): string {
  const [name, domain] = login.split("@");
  const head = name.slice(0, 2);
  return domain ? `${head}***@${domain}` : `${head}***`;
}

export type SupplyConnectionView = {
  provider: SupplyProvider;
  connected: true;
  /** Диадок — логин (маска), СБИС — ID подключения. */
  account: string;
  boxTitle: string | null;
  status: "active" | "error";
  lastSyncAt: string | null;
  lastError: string | null;
};

export function connectionView(
  provider: SupplyProvider,
  credentials: unknown,
  row: { boxTitle: string | null; status: string; lastSyncAt: Date | null; lastError: string | null },
): SupplyConnectionView {
  const record = credentials && typeof credentials === "object" ? (credentials as Record<string, unknown>) : {};
  const login = typeof record.login === "string" ? record.login : "";
  const account =
    provider === "diadoc"
      ? maskLogin(login)
      : provider === "iiko"
        ? `${login} · ${typeof record.serverUrl === "string" ? record.serverUrl : ""}`
        : typeof record.clientId === "string"
          ? record.clientId
          : "";
  return {
    provider,
    connected: true,
    account,
    boxTitle: row.boxTitle,
    status: row.status === "error" ? "error" : "active",
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

/** С какой даты брать документы: прошлый заход минус 3 дня (опоздавшие), первый — 30 дней. */
export function syncFromDate(lastSyncAt: Date | null, now: Date): string {
  const days = lastSyncAt ? 3 : 30;
  const from = new Date((lastSyncAt ?? now).getTime() - days * 24 * 60 * 60 * 1000);
  return from.toISOString().slice(0, 10);
}

/**
 * Адрес API Диадока. `DIADOC_API_URL` — локальная заглушка для проверки
 * без живого Диадока; в продакшене всегда настоящий адрес.
 */
export function diadocBaseUrl(env: { NODE_ENV?: string; DIADOC_API_URL?: string } = process.env): string {
  const override = env.DIADOC_API_URL?.trim();
  if (override && env.NODE_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(override)) return override;
  return DIADOC_BASE_URL;
}
