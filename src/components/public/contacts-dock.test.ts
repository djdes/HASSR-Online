import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

test("кнопка «Контакты» (правки 20.11.2026): значок чата, крупный заголовок, без лишних пояснений", () => {
  const dock = read("src/components/public/contacts-dock.tsx");
  // Значок на круглой кнопке — чат, не телефонная трубка.
  assert.match(dock, /<MessageCircle className="size-\[22px\]/);
  assert.doesNotMatch(dock, /<Phone\b/);
  // Заголовок в 3 раза крупнее прежних 22 px.
  assert.match(dock, /<DialogTitle className="text-\[clamp\(44px,14vw,66px\)\]/);
  assert.doesNotMatch(dock, /text-\[22px\]/);
  // Ни абзаца «Позвоните или напишите нам…», ни пояснения вкладки, ни строки под формой.
  assert.doesNotMatch(dock, /t\("lead"\)|DialogDescription/);
  assert.match(dock, /aria-describedby=\{undefined\}/);
  assert.match(dock, /<ContactUsPanel [^>]*groupLead=\{false\}/);
  assert.doesNotMatch(dock, /t\("privacy"\)/);

  // В других окнах «Свяжитесь с нами» пояснение вкладки остаётся.
  const panel = read("src/components/contact/contact-us-dialog.tsx");
  assert.match(panel, /groupLead = true/);
  assert.match(panel, /compact \|\| !groupLead \? null/);

  for (const locale of ["ru", "en", "uz"]) {
    const dockMessages = JSON.parse(read(`src/i18n/messages/${locale}.json`)).publicSupport.dock as Record<string, unknown>;
    assert.equal(dockMessages.lead, undefined, `${locale}: dock.lead убран`);
    assert.equal(dockMessages.privacy, undefined, `${locale}: dock.privacy убран`);
    assert.equal(typeof dockMessages.title, "string", `${locale}: dock.title`);
  }
});
