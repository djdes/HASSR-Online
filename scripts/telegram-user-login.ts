/**
 * Вход CRM в рабочий аккаунт Telegram. Код запрашивает и принимает ОДНО
 * подключение: код, введённый из другого подключения, Telegram считает
 * просроченным (PHONE_CODE_EXPIRED) — проверено 10.11.2026.
 *
 *   npx tsx scripts/telegram-user-login.ts start +79991234567   # ждёт код до 15 минут
 *   npx tsx scripts/telegram-user-login.ts code 12345            # во втором окне
 *   npx tsx scripts/telegram-user-login.ts password <пароль>     # если включена 2FA
 *   npx tsx scripts/telegram-user-login.ts check
 *
 * Код не пересылать в Telegram: попав в сообщение, он сразу аннулируется.
 * Нужны TG_API_ID, TG_API_HASH и TG_USER_SESSION_FILE в .env. Сессия
 * пишется в TG_USER_SESSION_FILE с правами 600 — это полный доступ к
 * аккаунту: в лог, git и чаты не выводится.
 */
import "dotenv/config";

import { existsSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";

import { createTelegramClient, telegramApiCredentials } from "../src/lib/crm/telegram-user.server";

const WAIT_MS = 15 * 60_000;

async function waitFor(file: string, what: string): Promise<string> {
  console.log(`Жду ${what}: npx tsx scripts/telegram-user-login.ts ${what === "код" ? "code <код>" : "password <пароль>"}`);
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    if (existsSync(file)) {
      const value = (await readFile(file, "utf8")).trim();
      await rm(file, { force: true });
      if (value) return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Не дождались: ${what}`);
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  const credentials = telegramApiCredentials();
  const sessionFile = process.env.TG_USER_SESSION_FILE?.trim();
  if (!credentials || !sessionFile) throw new Error("Нужны TG_API_ID, TG_API_HASH и TG_USER_SESSION_FILE в .env");
  const codeFile = `${sessionFile}.code`;
  const passwordFile = `${sessionFile}.password`;

  if (command === "code" || command === "password") {
    const value = command === "code" ? (arg ?? "").replace(/\D/g, "") : (arg ?? "");
    if (!value) throw new Error(`Укажите ${command === "code" ? "код" : "пароль"}`);
    await writeFile(command === "code" ? codeFile : passwordFile, value, { mode: 0o600 });
    console.log("Передано процессу входа.");
    return;
  }

  if (command === "start") {
    const phone = (arg ?? "").replace(/[^\d+]/g, "");
    if (phone.replace(/\D/g, "").length < 10) throw new Error("Укажите номер рабочего аккаунта: start +79991234567");
    await rm(codeFile, { force: true });
    await rm(passwordFile, { force: true });
    const client = createTelegramClient("", credentials);
    await client.start({
      phoneNumber: async () => phone,
      phoneCode: async () => (await waitFor(codeFile, "код")).replace(/\D/g, ""),
      password: async () => waitFor(passwordFile, "пароль"),
      onError: async (error) => {
        console.error(`Telegram: ${error.message}`);
        return true; // прервать: повторять с тем же кодом бессмысленно
      },
    });
    await writeFile(sessionFile, String(client.session.save()), { mode: 0o600 });
    await chmod(sessionFile, 0o600);
    const me = await client.getMe();
    await client.destroy();
    console.log(`Вошли: ${[me.firstName, me.lastName].filter(Boolean).join(" ")} (id ${me.id}). Сессия записана.`);
    return;
  }

  if (command === "check") {
    const session = (await readFile(sessionFile, "utf8").catch(() => "")).trim();
    if (!session) throw new Error("Сессии нет — сначала start");
    const client = createTelegramClient(session, credentials);
    await client.connect();
    const ok = await client.checkAuthorization();
    const me = ok ? await client.getMe() : null;
    await client.destroy();
    console.log(ok && me ? `Сессия рабочая: ${[me.firstName, me.lastName].filter(Boolean).join(" ")} (id ${me.id})` : "Сессия недействительна");
    return;
  }

  throw new Error("Команды: start <номер> | code <код> | password <пароль> | check");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
