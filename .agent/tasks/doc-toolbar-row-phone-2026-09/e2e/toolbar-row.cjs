// Шапка документа климата (журнал складов) после правки владельца 29.09:
// описание и «Добавить» в одну строку на всех ширинах. До 640px описание
// обрезано до 3 строк, «Подробнее» раскрывает, «Свернуть» сворачивает;
// кнопка компактная («+ Добавить»), от 640px — «Добавить строку».
// Плюс: закрытый документ (кнопки нет — описание на всю ширину) и печать.
//   node D:/wt-build/tmp-noblank/e2e/toolbar-row.cjs after
const fs = require("node:fs");
const path = require("node:path");
const { OUT, launch, readCreds, newContext, quietPage, gotoHydrated } = require("./lib.cjs");

const LABEL = process.argv[2] || "after";
const VIEWPORTS = [
  { key: "360", viewport: { width: 360, height: 780 } },
  { key: "390", viewport: { width: 390, height: 844 } },
  { key: "640", viewport: { width: 640, height: 900 } },
  { key: "768", viewport: { width: 768, height: 1024 } },
  { key: "1280", viewport: { width: 1280, height: 800 } },
];
const SHOTS = path.join(OUT, "shots", LABEL);

function measure() {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      left: Math.round(b.left),
      right: Math.round(b.right),
      top: Math.round(b.top),
      bottom: Math.round(b.bottom),
      width: Math.round(b.width),
      height: Math.round(b.height),
    };
  };
  const shown = (el) => Boolean(el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0);
  const bar = document.querySelector("[data-doc-toolbar-row]");
  const desc = bar ? bar.querySelector("[data-doc-toolbar-description]") : null;
  const add = bar ? bar.querySelector("[data-doc-toolbar-add]") : null;
  const toggle = bar
    ? [...bar.querySelectorAll("button")].find((b) => /^(Подробнее|Свернуть)$/.test((b.textContent || "").trim()))
    : null;
  const cs = desc ? getComputedStyle(desc) : null;
  const barCs = bar ? getComputedStyle(bar) : null;
  return {
    vw: window.innerWidth,
    docW: document.documentElement.scrollWidth,
    bar: r(bar),
    barPadding: barCs ? [parseFloat(barCs.paddingLeft), parseFloat(barCs.paddingRight)] : null,
    desc: r(desc),
    add: shown(add) ? r(add) : null,
    addText: shown(add) ? add.innerText.replace(/\s+/g, " ").trim() : null,
    addLabel: add ? add.getAttribute("aria-label") : null,
    toggle: shown(toggle)
      ? { text: toggle.textContent.trim(), expanded: toggle.getAttribute("aria-expanded"), ...r(toggle) }
      : null,
    descFont: cs ? cs.fontSize : null,
    descAlign: cs ? cs.textAlign : null,
    descLines: desc ? Math.round(desc.clientHeight / parseFloat(cs.lineHeight)) : null,
    descClipped: desc ? desc.scrollHeight - desc.clientHeight > 1 : null,
  };
}

function checkRow(key, width, row, problems) {
  if (!row.bar || !row.desc) {
    problems.push("row/description not found");
    return;
  }
  if (!row.add) {
    problems.push("add button not found");
    return;
  }
  const sameLine = row.add.top < row.desc.bottom && row.desc.top < row.add.bottom;
  if (!sameLine) problems.push("description and button are not in one line");
  if (!(row.desc.right <= row.add.left)) problems.push("button is not to the right of the description");
  if (row.add.left < 0 || row.add.right > row.vw) problems.push(`button cut by the screen edge (${row.add.left}..${row.add.right})`);
  if (row.add.height < 40) problems.push(`button lower than 40px (${row.add.height})`);
  if (row.docW > row.vw) problems.push(`page wider than screen (${row.docW})`);
  if (row.addLabel !== "Добавить строку") problems.push(`aria-label «${row.addLabel}»`);
  if (row.descFont !== "13px") problems.push(`description font ${row.descFont}`);
  if (width < 640) {
    if (row.addText !== "Добавить") problems.push(`phone label «${row.addText}»`);
    if (Math.abs(row.add.top - row.desc.top) > 1) problems.push(`button not aligned to the top (${row.add.top} vs ${row.desc.top})`);
    if (row.descLines > 3) problems.push(`description ${row.descLines} lines when collapsed`);
    if (row.descClipped && !(row.toggle && row.toggle.text === "Подробнее")) problems.push("clipped text without «Подробнее»");
    if (!row.descClipped && row.toggle) problems.push("«Подробнее» for a text that fits");
  } else {
    if (row.addText !== "Добавить строку") problems.push(`label «${row.addText}»`);
    if (row.toggle) problems.push("toggle visible from 640px");
    if (row.descClipped) problems.push("description clipped from 640px");
  }
}

(async () => {
  const creds = readCreds();
  const active = creds.documents.find((d) => d.code === "climate_control" && d.status === "active");
  const closed = creds.documents.find((d) => d.code === "climate_control" && d.status === "closed");
  const results = { label: LABEL, pageErrors: [], rows: [], toggles: [], closed: [], print: [] };
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launch();
  try {
    for (const { key, viewport } of VIEWPORTS) {
      for (const view of ["table", "cards"]) {
        if (viewport.width >= 640 && view === "cards") continue;
        const ctx = await newContext(browser, viewport);
        const page = await quietPage(ctx, results);
        await page.addInitScript((v) => {
          try {
            localStorage.setItem("journal-mobile-view:climate_control", v);
          } catch {}
        }, view);
        await gotoHydrated(page, `/journals/climate_control/documents/${active.id}`, "main h1");
        await page.waitForTimeout(2500);
        const bar = page.locator("[data-doc-toolbar-row]").first();
        await bar.scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
        const row = await page.evaluate(measure);
        const problems = [];
        checkRow(key, viewport.width, row, problems);
        results.rows.push({ viewport: key, view, ...row, problems });
        console.log(
          `${key.padEnd(5)} ${view.padEnd(6)} desc=${JSON.stringify(row.desc)} lines=${row.descLines} font=${row.descFont} ` +
            `add=${JSON.stringify(row.add)} «${row.addText}» toggle=${row.toggle ? row.toggle.text : "-"} docW=${row.docW} ` +
            `${problems.length ? "✗ " + problems.join("; ") : "✓"}`,
        );
        const shotBase = `toolbar-${key}-${view}`;
        if (view === "table" && (key === "390" || key === "1280")) {
          await page.screenshot({ path: path.join(SHOTS, `${shotBase}${key === "390" ? "-collapsed" : ""}.png`) });
        }

        // «Подробнее» → весь текст, «Свернуть» → обратно (только телефон).
        if (viewport.width < 640 && row.toggle) {
          const toggleProblems = [];
          await page.getByRole("button", { name: "Подробнее" }).click();
          await page.waitForTimeout(300);
          const open = await page.evaluate(measure);
          if (!open.toggle || open.toggle.text !== "Свернуть" || open.toggle.expanded !== "true") toggleProblems.push("no «Свернуть» after expand");
          if (open.descClipped) toggleProblems.push("text still clipped after «Подробнее»");
          if (!(open.desc.height > row.desc.height)) toggleProblems.push("description did not grow");
          if (!(open.add && open.add.top < open.desc.bottom && open.desc.top < open.add.bottom)) toggleProblems.push("button left the row when expanded");
          if (open.docW > open.vw) toggleProblems.push(`page wider than screen when expanded (${open.docW})`);
          if (view === "table" && key === "390") {
            await page.screenshot({ path: path.join(SHOTS, `${shotBase}-expanded.png`) });
          }
          await page.getByRole("button", { name: "Свернуть" }).click();
          await page.waitForTimeout(300);
          const back = await page.evaluate(measure);
          if (!back.toggle || back.toggle.text !== "Подробнее" || back.toggle.expanded !== "false") toggleProblems.push("no «Подробнее» after collapse");
          if (back.desc.height !== row.desc.height) toggleProblems.push(`collapsed height ${back.desc.height} ≠ ${row.desc.height}`);
          if (back.descLines > 3) toggleProblems.push(`collapsed back to ${back.descLines} lines`);
          results.toggles.push({
            viewport: key,
            view,
            collapsed: { height: row.desc.height, lines: row.descLines },
            expanded: { height: open.desc.height, lines: open.descLines },
            back: { height: back.desc.height, lines: back.descLines },
            problems: toggleProblems,
          });
          console.log(
            `      toggle: ${row.desc.height}px/${row.descLines} стр. → ${open.desc.height}px/${open.descLines} стр. → ${back.desc.height}px/${back.descLines} стр. ` +
              `${toggleProblems.length ? "✗ " + toggleProblems.join("; ") : "✓"}`,
          );
        }

        // Печать: описание целиком мелко по центру, кнопок и «Подробнее» нет.
        if (view === "table" && (key === "390" || key === "1280")) {
          await page.emulateMedia({ media: "print" });
          await page.waitForTimeout(200);
          const printed = await page.evaluate(measure);
          const printProblems = [];
          if (printed.add) printProblems.push("add button printed");
          if (printed.toggle) printProblems.push("toggle printed");
          if (printed.descClipped) printProblems.push("description clipped in print");
          if (printed.descAlign !== "center") printProblems.push(`align ${printed.descAlign}`);
          if (printed.descFont !== "10px") printProblems.push(`print font ${printed.descFont}`);
          results.print.push({ viewport: key, font: printed.descFont, align: printed.descAlign, problems: printProblems });
          console.log(`      print: font=${printed.descFont} align=${printed.descAlign} ${printProblems.length ? "✗ " + printProblems.join("; ") : "✓"}`);
          await page.emulateMedia({ media: "screen" });
        }
        await ctx.close();
      }
    }

    // Закрытый документ: кнопки нет — описание на всю ширину ряда.
    if (closed) {
      for (const { key, viewport } of VIEWPORTS.filter((v) => ["390", "1280"].includes(v.key))) {
        const ctx = await newContext(browser, viewport);
        const page = await quietPage(ctx, results);
        await gotoHydrated(page, `/journals/climate_control/documents/${closed.id}`, "main h1");
        await page.waitForTimeout(2500);
        const row = await page.evaluate(measure);
        const problems = [];
        if (!row.desc) problems.push("description not found");
        if (row.add) problems.push("add button in a closed document");
        if (row.desc && row.bar) {
          const inner = row.bar.width - row.barPadding[0] - row.barPadding[1];
          if (row.desc.width < inner - 1) problems.push(`description ${row.desc.width}px of ${inner}px`);
        }
        if (row.docW > row.vw) problems.push(`page wider than screen (${row.docW})`);
        results.closed.push({ viewport: key, desc: row.desc, bar: row.bar, problems });
        console.log(`closed ${key.padEnd(5)} desc=${JSON.stringify(row.desc)} bar=${JSON.stringify(row.bar)} ${problems.length ? "✗ " + problems.join("; ") : "✓"}`);
        await ctx.close();
      }
    } else {
      console.log("closed document not found in creds — skipped");
    }
  } finally {
    await browser.close();
    fs.mkdirSync(path.join(OUT, "raw"), { recursive: true });
    fs.writeFileSync(path.join(OUT, "raw", `toolbar-row-${LABEL}.json`), JSON.stringify(results, null, 2));
  }
  const failed = [...results.rows, ...results.toggles, ...results.closed, ...results.print].filter((r) => r.problems.length);
  console.log(`\npage errors: ${results.pageErrors.length}; failed checks: ${failed.length}`);
  if (failed.length || results.pageErrors.length) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
