/**
 * Вход CRM в рабочий аккаунт Telegram — в два шага, без интерактива
 * (код приходит владельцу аккаунта, его пересылают оператору):
 *
 *   npx tsx scripts/telegram-user-login.ts send-code +79991234567
 *   npx tsx scripts/telegram-user-login.ts sign-in 12345 [пароль 2FA]
 *   npx tsx scripts/telegram-user-login.ts check
 *
 * Нужны TG_API_ID, TG_API_HASH и TG_USER_SESSION_FILE в .env. Промежуточное
 * состояние (сессия до входа и хеш кода) — в `<TG_USER_SESSION_FILE>.pending`,
 * после входа сессия пишется в TG_USER_SESSION_FILE с правами 600. Сессия —
 * это полный доступ к аккаунту: в лог, git и чаты не выводится.
 */
import "dotenv/config";

import { chmod, readFile, rm, writeFile } from "node:fs/promises";

import { Api } from "telegram";
import { computeCheck } from "telegram/Password";

import { createTelegramClient, telegramApiCredentials } from "../src/lib/crm/telegram-user.server";

type Pending = { session: string; phone: string; phoneCodeHash: string };

async function main() {
  const [command, arg1, arg2] = process.argv.slice(2);
  const credentials = telegramApiCredentials();
  const sessionFile = process.env.TG_USER_SESSION_FILE?.trim();
  if (!credentials || !sessionFile) throw new Error("Нужны TG_API_ID, TG_API_HASH и TG_USER_SESSION_FILE в .env");
  const pendingFile = `${sessionFile}.pending`;

  if (command === "send-code") {
    const phone = (arg1 ?? "").replace(/[^\d+]/g, "");
    if (phone.replace(/\D/g, "").length < 10) throw new Error("Укажите номер рабочего аккаунта: send-code +79991234567");
    const client = createTelegramClient("", credentials);
    await client.connect();
    const sent = await client.invoke(new Api.auth.SendCode({ phoneNumber: phone, apiId: credentials.apiId, apiHash: credentials.apiHash, settings: new Api.CodeSettings({}) }));
    if (!(sent instanceof Api.auth.SentCode)) throw new Error("Telegram не отправил код");
    const pending: Pending = { session: String(client.session.save()), phone, phoneCodeHash: sent.phoneCodeHash };
    await writeFile(pendingFile, JSON.stringify(pending), { mode: 0o600 });
    await client.destroy();
    console.log(`Код отправлен (${sent.type.className}). Дальше: sign-in <код> [пароль 2FA]`);
    return;
  }

  if (command === "sign-in") {
    const pending = JSON.parse(await readFile(pendingFile, "utf8")) as Pending;
    const code = (arg1 ?? "").replace(/\D/g, "");
    if (!code) throw new Error("Укажите код: sign-in 12345 [пароль 2FA]");
    const client = createTelegramClient(pending.session, credentials);
    await client.connect();
    try {
      await client.invoke(new Api.auth.SignIn({ phoneNumber: pending.phone, phoneCodeHash: pending.phoneCodeHash, phoneCode: code }));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("SESSION_PASSWORD_NEEDED")) throw error;
      if (!arg2) throw new Error("На аккаунте облачный пароль: sign-in <код> <пароль>");
      const password = await client.invoke(new Api.account.GetPassword());
      await client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(password, arg2) }));
    }
    await writeFile(sessionFile, String(client.session.save()), { mode: 0o600 });
    await chmod(sessionFile, 0o600);
    await rm(pendingFile, { force: true });
    const me = await client.getMe();
    await client.destroy();
    console.log(`Вошли: ${[me.firstName, me.lastName].filter(Boolean).join(" ")} (id ${me.id}). Сессия записана.`);
    return;
  }

  if (command === "check") {
    const session = (await readFile(sessionFile, "utf8").catch(() => "")).trim();
    if (!session) throw new Error("Сессии нет — сначала send-code и sign-in");
    const client = createTelegramClient(session, credentials);
    await client.connect();
    const ok = await client.checkAuthorization();
    const me = ok ? await client.getMe() : null;
    await client.destroy();
    console.log(ok && me ? `Сессия рабочая: ${[me.firstName, me.lastName].filter(Boolean).join(" ")} (id ${me.id})` : "Сессия недействительна");
    return;
  }

  throw new Error("Команды: send-code <номер> | sign-in <код> [пароль] | check");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
