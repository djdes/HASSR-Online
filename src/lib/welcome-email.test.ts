import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  renderWelcomeEmail,
  WELCOME_CABINET_HREF,
  WELCOME_PHOTO_URL,
  WELCOME_POSTER_URL,
  WELCOME_REGISTER_HREF,
} from "@/lib/email";

/**
 * Приветственное письмо (спека trial-emails-rename-2026-11): компактное, с
 * фото и плакатом, благодарность, рутина и контроль, поддержка с московским
 * телефоном.
 */

const publicFile = (url: string) => join(process.cwd(), "public", new URL(url).pathname);

test("картинки письма лежат в public, JPG/PNG и лёгкие", () => {
  for (const url of [WELCOME_PHOTO_URL, WELCOME_POSTER_URL]) {
    assert.match(url, /^https:\/\/wesetup\.ru\/email\/[a-z-]+\.(jpg|png)$/);
    const file = publicFile(url);
    assert.ok(existsSync(file), `нет файла ${file}`);
    assert.ok(statSync(file).size < 200_000, `${file} тяжелее 200 КБ`);
  }
  assert.ok(existsSync(join(process.cwd(), "src", "app", "(dashboard)", "dashboard", "page.tsx")), WELCOME_CABINET_HREF);
  assert.ok(existsSync(join(process.cwd(), "src", "app", "(auth)", "register", "page.tsx")), WELCOME_REGISTER_HREF);
});

for (const locale of ["ru", "en", "uz"] as const) {
  test(`приветственное письмо (${locale}): фото, плакат, телефон Москвы, кнопка`, async () => {
    const { subject, html, text } = await renderWelcomeEmail({ name: "Анна <script>", hasAccount: true, locale });
    assert.ok(subject.length > 0);
    assert.match(html, new RegExp(`src="${WELCOME_PHOTO_URL}"[^>]*data-welcome-photo`));
    assert.match(html, new RegExp(`src="${WELCOME_POSTER_URL}"[^>]*data-welcome-poster`));
    assert.ok(html.includes("+7 (495) 109-65-43"), "московский номер");
    assert.ok(html.includes('href="tel:+74951096543"'));
    assert.ok(html.includes("@wesetup_support"));
    assert.match(html, new RegExp(`href="[^"]*${WELCOME_CABINET_HREF}" data-welcome-action`));
    assert.ok(!html.includes("<script>"), "имя экранировано");
    assert.ok(!/\{(name|phone)\}/.test(html + text), "плейсхолдеров нет");
    assert.ok(!html.includes("email.welcome."), "сырых ключей нет");
    assert.ok(text.includes("+7 (495) 109-65-43"), "текстовая версия");
  });
}

test("русский текст: благодарность за выбор, рутина и контроль, «поможем, расскажем и научим»", async () => {
  const { subject, html } = await renderWelcomeEmail({ name: "Анна", hasAccount: true, locale: "ru" });
  assert.equal(subject, "Спасибо, что выбрали WeSetup");
  assert.ok(html.includes("Здравствуйте, Анна!"));
  assert.ok(html.includes("электронную программу производственного контроля"));
  assert.ok(html.includes("уйти от рутины"));
  assert.ok(html.includes("контролируете процессы по каждому журналу"));
  assert.ok(html.includes("поможем, расскажем и научим"));
});

test("без кабинета — «Попробовать бесплатно» на регистрацию; почта вместо имени — без имени", async () => {
  const { html } = await renderWelcomeEmail({ name: "chef@example.com", hasAccount: false, locale: "ru" });
  assert.match(html, new RegExp(`href="[^"]*${WELCOME_REGISTER_HREF.replace("?", "\\?")}" data-welcome-action`));
  assert.ok(html.includes("Попробовать бесплатно"));
  assert.ok(html.includes("Здравствуйте!"));
  assert.ok(!html.includes("chef@example.com"));
});
