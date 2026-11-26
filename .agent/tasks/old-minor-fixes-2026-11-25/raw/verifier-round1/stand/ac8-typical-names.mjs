// Domain-typical point names: are words broken mid-word on phones (branch vs simulated previous layout)?
import fs from "node:fs";
import { BASE, chromium, session, acceptLegal } from "/home/user/HASSR-Online/.agent/tasks/old-minor-fixes-2026-11-25/raw/verifier/stand/lib.mjs";
const OUT = process.argv[2];
const NAMES = ["Производственный цех №2", "Кондитерский цех", "Центральная кухня", "Столовая «Берёзка»", "Ресторан «Белый журавль»", "Пекарня на Ленина"];
const browser = await chromium.launch();
const owner = await session(browser, "admin@haccp.local", "admin1234");
const ids = [];
const lines = [];
try {
  for (const name of NAMES) {
    const res = await owner.request.post(`${BASE}/api/settings/buildings`, { data: { name, sphere: "food" } });
    ids.push((await res.json()).building.id);
  }
  const page = await owner.newPage();
  for (const width of [320, 360, 375, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
    await acceptLegal(page);
    const measure = () => page.evaluate((names) => names.map((name) => {
      const h2 = [...document.querySelectorAll("[data-building-card] h2")].find((h) => h.textContent.trim() === name);
      if (!h2) return `${name}: not found`;
      const node = h2.firstChild; const broken = [];
      const re = /\S+/g; let m;
      while ((m = re.exec(node.textContent))) {
        const range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
        if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) broken.push(m[0]);
      }
      return `${name} [col ${Math.round(h2.getBoundingClientRect().width)}px]${broken.length ? ` broken: ${broken.join(", ")}` : ""}`;
    }), NAMES);
    for (const n of NAMES) {
      const h = page.locator("h2", { hasText: n }).first();
      await h.evaluate((el) => el.scrollIntoView({ block: "center" }));
    }
    await page.waitForTimeout(500);
    const now = await measure();
    const style = await page.addStyleTag({ content: "[data-building-title]{display:contents !important}" });
    await page.waitForTimeout(300);
    const old = await measure();
    await style.evaluate((el) => el.remove());
    lines.push(`${width}px branch:   ${now.filter((s) => s.includes("broken")).join(" | ") || "no broken words"}`);
    lines.push(`${width}px previous: ${old.filter((s) => s.includes("broken")).join(" | ") || "no broken words"}`);
    if (width === 390) {
      const h = page.locator("h2", { hasText: NAMES[0] }).first();
      await h.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);
      const clip = await h.evaluate((el) => { const c = el.closest("[data-building-card]").getBoundingClientRect(); return { x: Math.max(0, c.left), y: Math.max(0, c.top), width: Math.min(window.innerWidth, c.width), height: Math.min(c.height, 240) }; });
      await page.screenshot({ path: `${OUT}/ac8-typical-production-390-branch.png`, clip });
    }
  }
} finally {
  for (const id of ids) await owner.request.delete(`${BASE}/api/settings/buildings/${id}`);
  console.log(lines.join("\n"));
  fs.writeFileSync(`${OUT}/../ac8-typical-names.txt`, lines.join("\n") + "\n");
  await browser.close();
}
