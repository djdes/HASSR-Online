import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getMailingTemplate } from "@/lib/mailing/kinds";
import { anyChannel } from "@/lib/mailing/labels";
import { getMailingPreset, MAILING_PRESETS } from "@/lib/mailing/presets";
import { buildRecipientContext } from "@/lib/mailing/queue";
import { isSafeLinkUrl } from "@/lib/mailing/text-format";

/**
 * Готовые письма простого режима «Рассылки». Их пишет Claude — тест
 * ловит ошибки до деплоя: тип письма есть, данные проходят его проверку,
 * ссылки безопасные, переменные подставляются, письмо рисуется.
 */

const recipient = (over: { name: string | null; companyName: string | null }) =>
  buildRecipientContext(
    {
      id: "mr1",
      token: "mr1.sig",
      email: "ivan@mail.ru",
      sphere: "cafe",
      userId: null,
      organizationId: null,
      contactId: "c1",
      links: [],
      payload: null,
      ...over,
    },
    "https://wesetup.ru"
  );

describe("готовые письма (presets)", () => {
  it("id уникальны, латиница и дефис; у каждого есть название, пояснение и канал", () => {
    const ids = MAILING_PRESETS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, "повтор id");
    for (const p of MAILING_PRESETS) {
      assert.match(p.id, /^[a-z0-9][a-z0-9-]{1,59}$/, `id «${p.id}»`);
      assert.ok(p.title.trim().length > 0 && p.title.length <= 80, `${p.id}: название`);
      assert.ok(p.description.trim().length > 0, `${p.id}: пояснение`);
      assert.ok(anyChannel(p.channels), `${p.id}: нет ни одного канала`);
      assert.equal(getMailingPreset(p.id), p);
    }
    assert.equal(getMailingPreset("нет-такого"), null);
  });

  for (const preset of MAILING_PRESETS) {
    it(`«${preset.title}»: проходит проверку типа «${preset.kind}» и рисуется`, async () => {
      const template = getMailingTemplate(preset.kind);
      assert.ok(template, `тип ${preset.kind} не зарегистрирован`);
      const v = template.validate ? await template.validate(preset.payload) : { ok: true as const };
      assert.ok(v.ok, v.ok ? "" : `${preset.id}: ${v.error}`);
      assert.ok(isSafeLinkUrl(preset.payload.buttonUrl), `${preset.id}: ссылка кнопки`);

      // Без имени и компании — запасные слова, ни одной «{переменной}» в тексте.
      for (const who of [{ name: "Иван", companyName: "Кафе «Ромашка»" }, { name: null, companyName: null }]) {
        const { ctx } = recipient(who);
        const r = await template.render(preset.payload, ctx);
        assert.ok(r.email?.subject, `${preset.id}: тема`);
        for (const text of [r.email?.subject ?? "", r.email?.text ?? "", r.inApp?.body ?? ""]) {
          assert.doesNotMatch(text, /\{(имя|компания|сфера)/iu, `${preset.id}: переменная не подставилась`);
        }
        assert.match(r.email?.html ?? "", /unsubscribe\/mr1\.sig/, `${preset.id}: нет отписки`);
      }
    });
  }

  it("акция YEAR50 ведёт на ссылку промокода, цены совпадают с постом", () => {
    const p = getMailingPreset("year50-2026-11");
    assert.ok(p);
    assert.equal(p.payload.buttonUrl, "https://wesetup.ru/promo/YEAR50");
    assert.match(p.payload.body, /995 ₽ в месяц вместо 1 990 ₽/);
    assert.match(p.payload.body, /до 30 ноября/);
  });
});
