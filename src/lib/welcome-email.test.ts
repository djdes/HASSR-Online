import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { renderWelcomeEmail, WELCOME_SETUP_START_HREF, WELCOME_SETUP_STEPS } from "@/lib/email";

const dashboardPage = (href: string) =>
  join(process.cwd(), "src", "app", "(dashboard)", ...href.split("/").filter(Boolean), "page.tsx");

test("план настройки: компания → точка → сотрудники → журналы → QR", () => {
  assert.deepEqual(
    WELCOME_SETUP_STEPS.map((step) => step.id),
    ["company", "point", "staff", "journals", "qr"],
  );
  for (const href of [...WELCOME_SETUP_STEPS.map((step) => step.href), WELCOME_SETUP_START_HREF]) {
    assert.ok(existsSync(dashboardPage(href)), `нет страницы ${href}`);
  }
});

for (const locale of ["ru", "en", "uz"] as const) {
  test(`письмо после регистрации (${locale}): все шаги со ссылками, кнопка, телефон`, async () => {
    const { subject, html } = await renderWelcomeEmail({
      name: "Анна <script>",
      organizationName: "ООО «Ромашка»",
      locale,
    });
    assert.ok(subject.length > 0);
    for (const step of WELCOME_SETUP_STEPS) {
      assert.match(html, new RegExp(`href="[^"]*${step.href}" data-welcome-step="${step.id}"`));
    }
    assert.match(html, new RegExp(`href="[^"]*${WELCOME_SETUP_START_HREF}" data-welcome-start`));
    assert.ok(html.includes("8 (925) 305-80-77"));
    // Имя экранируется, плейсхолдеров и сырых ключей каталога нет.
    assert.ok(!html.includes("<script>"));
    assert.ok(!/\{(name|organization|phone|trialDays)\}/.test(html));
    assert.ok(!html.includes("email.welcome."));
  });
}
