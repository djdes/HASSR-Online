import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { OUTGOING_EMAIL_TEXT_LIMIT, outgoingEmailRecipients, outgoingEmailRows, redactOutgoingEmailText, redactUrl } from "@/lib/outgoing-email";

test("получатели: адрес из «Имя <почта>», нижний регистр, без дублей и мусора", () => {
  assert.deepEqual(outgoingEmailRecipients("Анна <Anna@Kafe.RU>, buh@kafe.ru; anna@kafe.ru"), ["anna@kafe.ru", "buh@kafe.ru"]);
  assert.deepEqual(outgoingEmailRecipients(["a@b.ru", "не почта", ""]), ["a@b.ru"]);
  assert.deepEqual(outgoingEmailRecipients(""), []);
});

test("ссылки: без query, fragment и сегментов-токенов; обычные адреса и файлы остаются", () => {
  assert.equal(redactUrl("https://wesetup.ru/pricing"), "https://wesetup.ru/pricing");
  assert.equal(redactUrl("https://wesetup.ru/"), "https://wesetup.ru");
  assert.equal(redactUrl("https://wesetup.ru/landing/wesetup-presentation.pdf"), "https://wesetup.ru/landing/wesetup-presentation.pdf");
  assert.equal(redactUrl("https://wesetup.ru/landing/video/presentation-extended-ru.mp4"), "https://wesetup.ru/landing/video/presentation-extended-ru.mp4");
  assert.equal(redactUrl("https://wesetup.ru/blog/kak-vesti-zhurnal-temperatury-holodilnika-2026"), "https://wesetup.ru/blog/kak-vesti-zhurnal-temperatury-holodilnika-2026");
  assert.equal(redactUrl("https://wesetup.ru/api/auth/magic/Xk3_9aQwErTy12UiOpAsDf"), "https://wesetup.ru/api/auth/magic/…");
  assert.equal(redactUrl("https://wesetup.ru/invite/abc123def456ghi789"), "https://wesetup.ru/invite/…");
  assert.equal(redactUrl("https://wesetup.ru/r/cmwdgd42y006dz0ts1zkyr8tj.sig/1"), "https://wesetup.ru/r/…");
  assert.equal(redactUrl("https://wesetup.ru/unsubscribe?token=secret"), "https://wesetup.ru/unsubscribe?…");
  assert.equal(redactUrl("https://wesetup.ru/trial-feedback#answer"), "https://wesetup.ru/trial-feedback?…");
});

test("текст письма: ссылки внутри текста чистятся, точка в конце остаётся, длина ограничена", () => {
  const text = "Войти: https://wesetup.ru/api/auth/magic/Xk3_9aQwErTy12UiOpAsDf.\n\n\n\nТарифы — https://wesetup.ru/pricing?utm=mail, отписка https://wesetup.ru/unsubscribe?t=1";
  assert.equal(
    redactOutgoingEmailText(text),
    "Войти: https://wesetup.ru/api/auth/magic/….\n\nТарифы — https://wesetup.ru/pricing?…, отписка https://wesetup.ru/unsubscribe?…",
  );
  const long = redactOutgoingEmailText("а".repeat(OUTGOING_EMAIL_TEXT_LIMIT + 50));
  assert.equal(long.length, OUTGOING_EMAIL_TEXT_LIMIT);
  assert.ok(long.endsWith("…"));
});

test("строки журнала: по одной на получателя; секретное письмо — без текста; вложения — только имена и размеры", () => {
  const rows = outgoingEmailRows({
    to: ["Owner@Kafe.ru", "buh@kafe.ru"],
    subject: "  Счёт\n№ 12 ",
    text: "Пароль: 123456",
    sensitive: true,
    via: "system",
    fromEmail: "WeSetup <noreply@wesetup.ru>",
    attachments: [{ filename: "Счёт.pdf", content: Buffer.from("pdf!"), contentType: "application/pdf" }],
    status: "sent",
    messageId: " <m1@wesetup.ru> ",
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.to), ["owner@kafe.ru", "buh@kafe.ru"]);
  assert.equal(rows[0].subject, "Счёт № 12");
  assert.equal(rows[0].text, null, "код и пароль в журнал не попадают");
  assert.equal(rows[0].fromEmail, "noreply@wesetup.ru");
  assert.deepEqual(rows[0].attachmentsJson, [{ filename: "Счёт.pdf", size: 4, contentType: "application/pdf" }]);
  assert.equal(rows[0].messageId, "<m1@wesetup.ru>");
  const plain = outgoingEmailRows({ to: "a@b.ru", subject: "Напоминание", text: "Заполните журнал", via: "personal", status: "failed", error: "SMTP" });
  assert.equal(plain[0].text, "Заполните журнал");
  assert.equal(plain[0].error, "SMTP");
  assert.equal(plain[0].attachmentsJson, null);
  assert.deepEqual(outgoingEmailRows({ to: "нет", subject: "x", text: "y", via: "system", status: "sent" }), []);
});

test("письма с кодом, паролем или ссылкой входа помечены sensitive", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
  const email = read("src/lib/email.ts");
  for (const name of ["sendVerificationEmail", "sendInviteTokenEmail", "sendInviteEmail", "sendAccountPasswordEmail", "sendPasswordChangedEmail", "sendPasswordResetEmail"]) {
    const start = email.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    const next = email.indexOf("\nexport ", start + 10);
    const body = email.slice(start, next < 0 ? undefined : next);
    assert.match(body, /\{ sensitive: true \}/, `${name}: письмо без текста в журнале`);
  }
  assert.match(read("src/lib/magic-link.ts"), /sendRawEmail\(email, "Вход в WeSetup по ссылке", html, \{ sensitive: true \}\)/);
  assert.match(read("src/app/api/staff/[id]/personal-qr/route.ts"), /\{ sensitive: true \}/);
});
