import assert from "node:assert/strict";
import test from "node:test";

import type { Messages } from "@/i18n/messages";
import type { VerifiedUser } from "@/lib/credentials";
import {
  handleTelegramContact,
  type ContactHandlerContext,
  type ContactHandlerDeps,
} from "@/lib/bot/handlers/contact";

const STUB_MESSAGES = {
  telegram: {
    bot: {
      start: {
        sharePhoneButton: "📱 Поделиться номером телефона",
        openMiniAppButton: "📱 Открыть приложение",
      },
      contact: {
        notOwnContact:
          "Пожалуйста, отправьте именно свой контакт кнопкой «📱 Поделиться номером телефона».",
        invalidPhone:
          "Не удалось распознать номер телефона. Проверьте номер и попробуйте снова.",
        notFound:
          "Сотрудник с номером {phone} не найден. Войдите в мини-приложение по паролю или попросите руководителя добавить ваш номер.",
        ambiguous:
          "На номер {phone} найдено несколько профилей. Войдите в мини-приложение по телефону и паролю, чтобы привязать нужный аккаунт.",
        alreadyLinkedOther:
          "Этот Telegram уже привязан к другому аккаунту. Отвяжите его командой /stop в том аккаунте.",
        userHasOtherTelegram:
          "К аккаунту с номером {phone} уже привязан другой Telegram. Обратитесь к руководителю или отвяжите старый Telegram в профиле.",
        linkedSuccess:
          "✅ Номер {phone} подтверждён — Telegram привязан к профилю <b>{name}</b>!",
      },
    },
  },
} as unknown as Messages;

function makeStubCtx(args: {
  fromId?: number;
  contact?: { phone_number: string; user_id?: number };
}) {
  const replies: Array<{ text: string; options: unknown }> = [];
  const ctx = {
    from: args.fromId ? { id: args.fromId } : undefined,
    message: args.contact ? { contact: args.contact } : undefined,
    reply: async (text: string, options?: unknown) => {
      replies.push({ text, options });
      return {} as never;
    },
  } as unknown as ContactHandlerContext;
  return { ctx, replies };
}

function baseDeps(
  overrides: Partial<ContactHandlerDeps> = {}
): ContactHandlerDeps {
  return {
    localeForChat: async () => "ru",
    loadMessages: async () => STUB_MESSAGES,
    linkByPhone: async () => ({ ok: false, status: "not_found" }),
    replyStartHome: async () => {},
    getMiniAppBaseUrl: () => "https://wesetup.ru/mini",
    ...overrides,
  };
}

test("handleTelegramContact links own contact, removes keyboard, and sends start home", async () => {
  const { ctx, replies } = makeStubCtx({
    fromId: 777001,
    contact: { phone_number: "+79991234567", user_id: 777001 },
  });
  let startHomeChatId: string | null = null;

  await handleTelegramContact(
    ctx,
    baseDeps({
      linkByPhone: async ({ chatId, rawPhone }) => {
        assert.equal(chatId, "777001");
        assert.equal(rawPhone, "+79991234567");
        return {
          ok: true,
          status: "linked",
          user: {
            id: "u1",
            name: "Иван <Шеф>",
            phone: "+79991234567",
          } as VerifiedUser,
        };
      },
      replyStartHome: async (_c, chatId) => {
        startHomeChatId = chatId;
      },
    })
  );

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /\+7 999 123-45-67/);
  assert.match(replies[0].text, /<b>Иван &lt;Шеф&gt;<\/b>/);
  assert.deepEqual(replies[0].options, {
    parse_mode: "HTML",
    reply_markup: { remove_keyboard: true },
  });
  assert.equal(startHomeChatId, "777001");
});

test("handleTelegramContact rejects forwarded foreign contact", async () => {
  const { ctx, replies } = makeStubCtx({
    fromId: 777001,
    contact: { phone_number: "+79991234567", user_id: 888002 },
  });
  let linkCalled = false;

  await handleTelegramContact(
    ctx,
    baseDeps({
      linkByPhone: async () => {
        linkCalled = true;
        return { ok: false, status: "not_found" };
      },
    })
  );

  assert.equal(linkCalled, false);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /именно свой контакт/);
  assert.deepEqual(replies[0].options, {
    reply_markup: { remove_keyboard: true },
  });
});

test("handleTelegramContact handles not_found and offers Mini App login button", async () => {
  const { ctx, replies } = makeStubCtx({
    fromId: 777001,
    contact: { phone_number: "89991234567", user_id: 777001 },
  });

  await handleTelegramContact(
    ctx,
    baseDeps({
      linkByPhone: async () => ({ ok: false, status: "not_found" }),
    })
  );

  assert.equal(replies.length, 2);
  assert.match(replies[0].text, /\+7 999 123-45-67/);
  assert.match(replies[0].text, /не найден/);
  assert.deepEqual(replies[0].options, {
    reply_markup: { remove_keyboard: true },
  });
  assert.deepEqual(replies[1].options, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📱 Открыть приложение",
            web_app: { url: "https://wesetup.ru/mini/login?linkTg=1" },
          },
        ],
      ],
    },
  });
});

test("handleTelegramContact handles ambiguous phone matches", async () => {
  const { ctx, replies } = makeStubCtx({
    fromId: 777001,
    contact: { phone_number: "+79991234567", user_id: 777001 },
  });

  await handleTelegramContact(
    ctx,
    baseDeps({
      linkByPhone: async () => ({ ok: false, status: "ambiguous" }),
    })
  );

  assert.equal(replies.length, 2);
  assert.match(replies[0].text, /несколько профилей/);
  assert.deepEqual(replies[0].options, {
    reply_markup: { remove_keyboard: true },
  });
});

test("handleTelegramContact handles telegram_already_linked_other and user_already_linked_other_tg", async () => {
  const { ctx: ctx1, replies: replies1 } = makeStubCtx({
    fromId: 777001,
    contact: { phone_number: "+79991234567", user_id: 777001 },
  });
  await handleTelegramContact(
    ctx1,
    baseDeps({
      linkByPhone: async () => ({
        ok: false,
        status: "telegram_already_linked_other",
      }),
    })
  );
  assert.equal(replies1.length, 1);
  assert.match(replies1[0].text, /\/stop/);
  assert.deepEqual(replies1[0].options, {
    reply_markup: { remove_keyboard: true },
  });

  const { ctx: ctx2, replies: replies2 } = makeStubCtx({
    fromId: 777001,
    contact: { phone_number: "+79991234567", user_id: 777001 },
  });
  await handleTelegramContact(
    ctx2,
    baseDeps({
      linkByPhone: async () => ({
        ok: false,
        status: "user_already_linked_other_tg",
      }),
    })
  );
  assert.equal(replies2.length, 1);
  assert.match(replies2[0].text, /уже привязан другой Telegram/);
  assert.deepEqual(replies2[0].options, {
    reply_markup: { remove_keyboard: true },
  });
});
