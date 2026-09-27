// Документы для e2e — через тот же API, что кнопка «Создать документ» (POST /api/journal-documents).
// Холодильники: два активных документа и один закрытый; дезинфекция (pest_control) — один активный.
// Запуск: node D:/wt-build/tmp-jpage/e2e/prepare.cjs
const { BASE, launch, loggedInState, readCreds, sql } = require("./lib.cjs");

(async () => {
  const creds = readCreds();
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ storageState: await loggedInState(browser, "manager") });
    const existing = await sql(
      `select t.code, count(*)::int as n from "JournalDocument" d join "JournalTemplate" t on t.id = d."templateId"
        where d."organizationId" = $1 group by t.code`,
      [creds.organizationId],
    );
    if (existing.length) {
      console.log("documents already exist", existing);
      return;
    }
    const docs = [
      { templateCode: "cold_equipment_control", title: "Температура холодильников — сентябрь", dateFrom: "2026-09-01", dateTo: "2026-09-30" },
      { templateCode: "cold_equipment_control", title: "Температура холодильников — октябрь", dateFrom: "2026-10-01", dateTo: "2026-10-31" },
      { templateCode: "cold_equipment_control", title: "Температура холодильников — август", dateFrom: "2026-08-01", dateTo: "2026-08-31", close: true },
      { templateCode: "pest_control", title: "Дезинфекция и дератизация — 2026", dateFrom: "2026-09-01", dateTo: "2026-12-31" },
    ];
    for (const doc of docs) {
      const res = await ctx.request.post(`${BASE}/api/journal-documents`, {
        data: {
          templateCode: doc.templateCode,
          title: doc.title,
          dateFrom: doc.dateFrom,
          dateTo: doc.dateTo,
          responsibleUserId: creds.managerId,
          responsibleTitle: "Управляющий",
        },
        timeout: 240000,
      });
      const body = await res.json().catch(() => null);
      console.log(doc.templateCode, doc.title, res.status(), body && (body.document?.id || body.id || body.error));
      const id = body && (body.document?.id || body.id);
      if (doc.close && id) {
        const patch = await ctx.request.patch(`${BASE}/api/journal-documents/${id}`, {
          data: { status: "closed" },
          timeout: 240000,
        });
        console.log("  closed", patch.status());
      }
    }
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
