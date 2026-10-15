import assert from "node:assert/strict";
import test from "node:test";

import { loadMessages } from "@/i18n/messages";
import { loadTelegramStartHome } from "@/lib/bot/start-home";
import {
  buildTelegramLinkedStartReply,
  localizedTelegramCommands,
  setLocalizedTelegramChatCommands,
  telegramStartError,
  TELEGRAM_COMMANDS,
} from "@/lib/bot/start-response";

function linkedUser(input: { locale?: string | null; organizationLocale?: string | null }) {
  return {
    id: "user-1",
    name: "O‘tkir <manager>",
    role: "cook",
    isRoot: false,
    organizationId: "org-1",
    locale: input.locale,
    organization: { locale: input.organizationLocale },
    permissionsJson: null,
    jobPosition: { categoryKey: "staff", permissionsJson: null },
  };
}

async function readOnlyHome(input: { locale?: string | null; organizationLocale?: string | null }) {
  return await loadTelegramStartHome(
    { chatId: "1001", miniAppBaseUrl: "https://example.test/mini" },
    {
      findLinkedUserByChatId: async () => linkedUser(input),
      getUserPermissions: async () => new Set(["journals.view"]),
    }
  );
}

test("Telegram recipient locale resolves personal → organization → Russian fallback", async () => {
  const personal = await readOnlyHome({ locale: "en", organizationLocale: "uz" });
  const organization = await readOnlyHome({ locale: null, organizationLocale: "uz" });
  const fallback = await readOnlyHome({ locale: "invalid", organizationLocale: null });

  assert.equal(personal.kind === "readonly" ? personal.actor.locale : null, "en");
  assert.equal(organization.kind === "readonly" ? organization.actor.locale : null, "uz");
  assert.equal(fallback.kind === "readonly" ? fallback.actor.locale : null, "ru");
});

test("two recipients in the same process receive their own locale without shared locale state", async () => {
  const [englishHome, uzbekHome] = await Promise.all([
    readOnlyHome({ locale: "en", organizationLocale: "ru" }),
    readOnlyHome({ locale: "uz", organizationLocale: "ru" }),
  ]);
  assert.equal(englishHome.kind, "readonly");
  assert.equal(uzbekHome.kind, "readonly");
  if (englishHome.kind !== "readonly" || uzbekHome.kind !== "readonly") return;

  const [englishMessages, uzbekMessages] = await Promise.all([loadMessages("en"), loadMessages("uz")]);
  const english = buildTelegramLinkedStartReply({ ...englishHome.actor, kind: "readonly" }, englishHome.buttonUrl, "", englishHome.actor.locale, englishMessages);
  const uzbek = buildTelegramLinkedStartReply({ ...uzbekHome.actor, kind: "readonly" }, uzbekHome.buttonUrl, "", uzbekHome.actor.locale, uzbekMessages);

  assert.match(english.text, /read-only access/);
  assert.match(uzbek.text, /faqat ko‘rish huquqi/);
  assert.match(english.text, /O‘tkir &lt;manager&gt;/);
  assert.match(uzbek.text, /O‘tkir &lt;manager&gt;/);
});

test("static /start error replies use the intended recipient locale", async () => {
  const [englishMessages, uzbekMessages] = await Promise.all([loadMessages("en"), loadMessages("uz")]);
  assert.match(telegramStartError("inviteExpired", "en", englishMessages), /invitation has expired/i);
  assert.match(telegramStartError("inviteExpired", "uz", uzbekMessages), /taklif muddati tugagan/i);
});

test("chat command descriptions localize while protocol command identifiers remain unchanged", async () => {
  const [russianMessages, englishMessages, uzbekMessages] = await Promise.all([loadMessages("ru"), loadMessages("en"), loadMessages("uz")]);
  assert.deepEqual(TELEGRAM_COMMANDS.map(({ description }) => description), TELEGRAM_COMMANDS.map(({ command }) => russianMessages.telegram.bot.commands[command]));
  const english = localizedTelegramCommands(englishMessages);
  const uzbek = localizedTelegramCommands(uzbekMessages);

  assert.deepEqual(english.map(({ command }) => command), TELEGRAM_COMMANDS.map(({ command }) => command));
  assert.deepEqual(uzbek.map(({ command }) => command), TELEGRAM_COMMANDS.map(({ command }) => command));
  assert.match(english.find(({ command }) => command === "start")?.description ?? "", /Open WeSetup/);
  assert.match(uzbek.find(({ command }) => command === "start")?.description ?? "", /WeSetup’ni ochish/);
});

test("localized command registration is scoped to the recipient chat", async () => {
  const messages = await loadMessages("uz");
  let call: { commands: ReturnType<typeof localizedTelegramCommands>; options: unknown } | undefined;
  await setLocalizedTelegramChatCommands({
    setMyCommands: async (commands, options) => { call = { commands, options }; },
  }, "777", messages);

  assert.deepEqual(call?.options, { scope: { type: "chat", chat_id: "777" } });
  assert.deepEqual(call?.commands.map(({ command }) => command), TELEGRAM_COMMANDS.map(({ command }) => command));
  assert.match(call?.commands[0]?.description ?? "", /WeSetup’ni ochish/);
});

test("command-menu API failures are contained so /start can continue replying", async () => {
  const messages = await loadMessages("en");
  let logged: unknown;
  await assert.doesNotReject(() => setLocalizedTelegramChatCommands({
    setMyCommands: async () => { throw new Error("mock Telegram API failure"); },
  }, "777", messages, (error) => { logged = error; }));
  assert.equal((logged as Error).message, "mock Telegram API failure");
});

test("Telegram HTML dynamic names and action labels are escaped without translation", async () => {
  const messages = await loadMessages("en");
  const reply = buildTelegramLinkedStartReply({
    name: "A <company> & O‘tkir",
    role: "cook",
    isRoot: false,
    kind: "staff",
    nextActionLabel: "Check <fridge> & sign",
  }, "https://example.test/mini", "", "en", messages);

  assert.match(reply.text, /A &lt;company&gt; &amp; O‘tkir/);
  assert.match(reply.text, /Check &lt;fridge&gt; &amp; sign/);
});
