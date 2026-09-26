// Общее для server-*.ts и device-rebind.ts: ЛОКАЛЬНАЯ e2e-база с Prisma
// Client рабочей копии (в нём уже есть MobileDevice), вход на стенд 3021.
// Любой другой адрес базы — немедленный отказ.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import type { BrowserContext } from "playwright";

const url = "postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable";
if (!/@localhost:5432\/wesetup_e2e\b/.test(url)) throw new Error("not e2e db");
export const db = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: url })) });

export const BASE = "http://localhost:3021";
export const PASSWORD = "E2eTest2026!";
export const USERS = {
  managerA: "manager-a@e2e.local",
  cookA: "cook-a@e2e.local",
  cleanerA: "cleaner-a@e2e.local",
} as const;

export const APP_UA = (version: string) =>
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
  `Chrome/128.0.0.0 Mobile Safari/537.36 WeSetupApp/${version} (android)`;

/** Вход по почте и паролю прямо через NextAuth — куки сессии ложатся в контекст. */
export async function signIn(ctx: BrowserContext, email: string): Promise<void> {
  const csrf = (await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json()) as { csrfToken: string };
  const res = await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password: PASSWORD, json: "true", callbackUrl: `${BASE}/mini` },
    maxRedirects: 0,
  });
  const cookies = await ctx.cookies(BASE);
  if (!cookies.some((c) => /session/i.test(c.name))) {
    throw new Error(`sign-in failed for ${email}: ${res.status()} ${cookies.map((c) => c.name).join(",")}`);
  }
}
