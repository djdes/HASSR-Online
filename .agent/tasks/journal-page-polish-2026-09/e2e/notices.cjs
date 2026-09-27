// Отмечает гайды журналов «видел» (как после первого показа) — чтобы окно «Инструкция» не открывалось само на снимках.
const { BASE, launch, loggedInState } = require("./lib.cjs");
(async () => {
  const browser = await launch();
  try {
    for (const role of ["manager", "cook"]) {
      const ctx = await browser.newContext({ storageState: await loggedInState(browser, role) });
      for (const code of ["cold_equipment_control", "pest_control", "hygiene"]) {
        const res = await ctx.request.post(`${BASE}/api/me/notices`, { data: { key: `fill-guide:${code}` }, timeout: 240000 });
        console.log(role, code, res.status());
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
