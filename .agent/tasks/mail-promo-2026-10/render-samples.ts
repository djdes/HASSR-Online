/**
 * Образцы писем «Акция»: пять дизайнов в режиме предпросмотра с примером
 * получателя. Запуск: `npx tsx .agent/tasks/mail-promo-2026-10/render-samples.ts`.
 * Результат: raw/<дизайн>.html и samples.json (тема, прехедер).
 */
import fs from "node:fs";
import path from "node:path";

import { buildRecipientContext } from "../../../src/lib/mailing/queue";
import { createPromoTemplate } from "../../../src/lib/mailing/kinds/promo";
import { PROMO_DESIGNS, defaultPromoPayload } from "../../../src/lib/mailing/kinds/promo-shared";

const out = path.join(__dirname, "raw");
fs.mkdirSync(out, { recursive: true });

const template = createPromoTemplate({
  now: () => new Date(),
  async readPromo() {
    return null;
  },
  async promoAudience() {
    return null;
  },
  async createCodes() {
    return new Map();
  },
  async formData() {
    return { promoOptions: [], paidTariff: { title: "Подписка", priceRub: 1990 } };
  },
  log: () => {},
});

async function main() {
  const samples: Record<string, { subject: string; preheader: string; htmlBytes: number; notes: string[] }> = {};
  for (const { key } of PROMO_DESIGNS) {
    const { ctx } = buildRecipientContext(
      {
        id: "sample",
        token: "sample.sig",
        email: "anna@romashka.example",
        name: "Анна",
        companyName: "Кафе «Ромашка»",
        sphere: "cafe",
        userId: null,
        organizationId: null,
        contactId: null,
        links: [],
        payload: null,
      },
      "https://wesetup.ru",
      { track: false, mode: "preview" }
    );
    const rendered = await template.render(defaultPromoPayload(key), ctx);
    const email = rendered.email!;
    fs.writeFileSync(path.join(out, `${key}.html`), email.html, "utf8");
    samples[key] = {
      subject: email.subject,
      preheader: email.preheader ?? "",
      htmlBytes: Buffer.byteLength(email.html),
      notes: rendered.notes ?? [],
    };
  }
  fs.writeFileSync(path.join(__dirname, "samples.json"), JSON.stringify(samples, null, 2), "utf8");
  console.log(JSON.stringify(samples, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
