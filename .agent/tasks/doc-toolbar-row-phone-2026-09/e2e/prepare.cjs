// Подготовка к e2e: «Инструкция» уже просмотрена во всех журналах (иначе при
// первом заходе окно всплывает само и закрывает страницу) и второй документ
// климата (август, закрыт) — для перехода «документ → другой документ» через
// меню крошки документа.
// Запуск: node D:/wt-build/tmp-noblank/e2e/prepare.cjs
const fs = require("node:fs");
const { BASE, CREDS, launch, loggedInState, readCreds, sql } = require("./lib.cjs");

(async () => {
  const creds = readCreds();
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ storageState: await loggedInState(browser) });
    const codes = [...new Set(creds.documents.map((d) => d.code))];
    let marked = 0;
    for (const code of codes) {
      const res = await ctx.request.post(`${BASE}/api/me/notices`, {
        data: { key: `fill-guide:${code}` },
        timeout: 240000,
      });
      if (res.ok()) marked += 1;
      else console.log("notice", code, res.status(), await res.text());
    }
    console.log("fill-guide notices marked:", marked, "/", codes.length);

    if (!creds.documents.some((d) => d.code === "climate_control" && d.status === "closed")) {
      const res = await ctx.request.post(`${BASE}/api/journal-documents`, {
        data: {
          templateCode: "climate_control",
          title: "Журнал учёта температуры и влажности на складах — август 2026",
          dateFrom: "2026-08-01",
          dateTo: "2026-08-31",
          responsibleUserId: creds.managerId,
          responsibleTitle: "Управляющий",
        },
        timeout: 240000,
      });
      const body = await res.json().catch(() => null);
      const id = body && (body.document?.id || body.id);
      console.log("climate august", res.status(), id || body);
      if (id) {
        const patch = await ctx.request.patch(`${BASE}/api/journal-documents/${id}`, {
          data: { status: "closed" },
          timeout: 240000,
        });
        console.log("  closed", patch.status());
        const [row] = await sql('select title, status from "JournalDocument" where id = $1', [id]);
        creds.documents.push({
          id,
          code: "climate_control",
          journal: "Журнал учёта температуры и влажности на складах",
          title: row.title,
          status: row.status,
        });
        fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
      }
    }
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
