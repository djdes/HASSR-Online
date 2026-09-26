// Аудит главной: список блоков сверху вниз, замеры мобильной сетки и
// полностраничные скриншоты 390 и 1440.
//
// Запуск (dev-сервер уже поднят на :3040):
//   node .agent/tasks/landing-pack-2026-09/e2e/landing-audit.mjs before http://localhost:3040
//   node .agent/tasks/landing-pack-2026-09/e2e/landing-audit.mjs after  http://localhost:3040
//
// Что считается (только на 390, кроме списка блоков):
//   - горизонтальная прокрутка: scrollWidth документа против ширины окна +
//     элементы, вылезающие за экран и ничем не обрезанные;
//   - боковые поля и ритм: левый/правый отступ контента каждого блока и
//     расстояние между соседними блоками (декоративные слои aria-hidden и
//     absolute+pointer-events:none не считаются);
//   - кнопки: кнопки, поля, <summary> и ссылки-кнопки (есть фон или рамка)
//     — высота не меньше 48 px;
//   - текст: каждый видимый текстовый узел — не меньше 16 px, кроме
//     заголовков (они крупнее) и явно помеченной мелкой строки
//     [data-fine-print] (юридический текст у формы, подпись-сноска).
//   Подвал (общий для 25 публичных страниц) и внутренности QR-ролика
//   (по спеке не трогаем) в проверку не входят — их числа пишутся отдельно.
import { chromium } from "playwright-core";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const prefix = process.argv[2] || "before";
const base = (process.argv[3] || "http://localhost:3040").replace(/\/+$/, "");
const theme = process.argv[4] === "dark" ? "dark" : "light";
const themeSuffix = theme === "dark" ? "-dark" : "";
const widthsArg = (process.argv[5] || "390,1440").split(",").map(Number);
const taskDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const evidenceDir = path.join(taskDir, "evidence");
const rawDir = path.join(taskDir, "raw");
fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(rawDir, { recursive: true });

function chromePath() {
  const root = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const dirs = fs
    .readdirSync(root)
    .filter((name) => name.startsWith("chromium-"))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const exe = path.join(root, dir, "chrome-win64", "chrome.exe");
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error("chromium not found in " + root);
}

/** Выполняется в странице: блоки, поля, кнопки, текст. */
function collect() {
  const vw = window.innerWidth;
  const page = document.querySelector(".landing-page");
  const qrPlayer = document.querySelector("[data-qr-player]");
  const round = (n) => Math.round(n * 10) / 10;

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return false;
    return true;
  };
  const decorative = (el) => {
    for (let node = el; node && node !== page; node = node.parentElement) {
      if (node.getAttribute("aria-hidden") === "true") return true;
      const s = getComputedStyle(node);
      if (s.position === "absolute" && s.pointerEvents === "none") return true;
      if (node.classList.contains("sr-only")) return true;
    }
    return false;
  };
  const clippedByAncestor = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.overflowX !== "visible" || s.overflow === "hidden" || s.contain.includes("paint")) {
        const r = node.getBoundingClientRect();
        if (r.left >= -0.5 && r.right <= vw + 0.5) return true;
      }
    }
    return false;
  };
  const label = (el) => {
    const text = (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || "").trim().replace(/\s+/g, " ");
    return text.slice(0, 60);
  };
  const scrollTop = window.scrollY;

  // ── блоки ────────────────────────────────────────────────────────
  // Край контента блока = крайние «видимые» элементы: текст, картинки,
  // поля и кнопки, карточки с фоном/рамкой/тенью. Обёртки без собственного
  // вида (div с отступами) края не задают. Элемент внутри обрезающего
  // контейнера (лента со скроллом, карусель) считается по видимой части.
  const transparent = (value) => !value || value === "transparent" || value === "rgba(0, 0, 0, 0)";
  const hasOwnLook = (el) => {
    if (["IMG", "SVG", "CANVAS", "VIDEO", "INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(el.tagName.toUpperCase())) return true;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3 && node.nodeValue.trim()) return true;
    }
    const s = getComputedStyle(el);
    if (!transparent(s.backgroundColor) || s.backgroundImage !== "none") return true;
    if (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none" && !transparent(s.borderTopColor)) return true;
    if (parseFloat(s.borderLeftWidth) > 0 && s.borderLeftStyle !== "none" && !transparent(s.borderLeftColor)) return true;
    return false;
  };
  const visibleRect = (el, stopAt) => {
    const r = el.getBoundingClientRect();
    let left = r.left;
    let right = r.right;
    let top = r.top;
    let bottom = r.bottom;
    for (let node = el.parentElement; node && node !== stopAt.parentElement; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.overflowX !== "visible" || s.overflowY !== "visible") {
        const nr = node.getBoundingClientRect();
        left = Math.max(left, nr.left);
        right = Math.min(right, nr.right);
        top = Math.max(top, nr.top);
        bottom = Math.min(bottom, nr.bottom);
      }
    }
    return { left, right, top, bottom };
  };
  const blocks = [];
  for (const child of Array.from(page.children)) {
    if (["SCRIPT", "STYLE", "TEMPLATE"].includes(child.tagName)) continue;
    const r = child.getBoundingClientRect();
    if (r.height <= 0) continue;
    const heading = child.querySelector("h1, h2, h3");
    let minL = Infinity;
    let maxR = -Infinity;
    let minT = Infinity;
    let maxB = -Infinity;
    for (const el of [child, ...Array.from(child.querySelectorAll("*"))]) {
      if (!visible(el) || decorative(el) || !hasOwnLook(el)) continue;
      const er = visibleRect(el, child);
      if (er.right - er.left < 1 || er.bottom - er.top < 1) continue;
      minL = Math.min(minL, er.left);
      maxR = Math.max(maxR, er.right);
      minT = Math.min(minT, er.top);
      maxB = Math.max(maxB, er.bottom);
    }
    blocks.push({
      tag: child.tagName.toLowerCase(),
      id: child.id || null,
      cls: (child.getAttribute("class") || "").split(/\s+/).filter((c) => /^(landing-|public-)/.test(c)).join(" ") || null,
      heading: heading ? heading.textContent.trim().replace(/\s+/g, " ").slice(0, 90) : null,
      headingTag: heading ? heading.tagName.toLowerCase() : null,
      top: Math.round(r.top + scrollTop),
      height: Math.round(r.height),
      insetL: Number.isFinite(minL) ? round(minL) : null,
      insetR: Number.isFinite(maxR) ? round(vw - maxR) : null,
      contentTop: Number.isFinite(minT) ? Math.round(minT + scrollTop) : null,
      contentBottom: Number.isFinite(maxB) ? Math.round(maxB + scrollTop) : null,
      headingLeft: heading ? round(heading.getBoundingClientRect().left) : null,
    });
  }
  for (let i = 1; i < blocks.length; i += 1) {
    const prev = blocks[i - 1];
    const cur = blocks[i];
    cur.gapFromPrev = prev.contentBottom != null && cur.contentTop != null ? cur.contentTop - prev.contentBottom : null;
  }

  // ── горизонтальная прокрутка ─────────────────────────────────────
  const docScrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const overflowOffenders = [];
  for (const el of Array.from(page.querySelectorAll("*"))) {
    if (!visible(el) || decorative(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 0.5 && r.left >= -0.5) continue;
    if (clippedByAncestor(el)) continue;
    overflowOffenders.push({ tag: el.tagName.toLowerCase(), cls: (el.getAttribute("class") || "").slice(0, 80), left: round(r.left), right: round(r.right) });
    if (overflowOffenders.length > 20) break;
  }

  // ── кнопки ───────────────────────────────────────────────────────
  // QR-блок (#qr: заголовок и ролик) по спеке не трогаем — его числа
  // пишутся отдельно, в общую проверку он не входит.
  const qrBlock = document.getElementById("qr");
  const scopeOf = (el) =>
    el.closest("footer") ? "footer" : qrPlayer && qrPlayer.contains(el) ? "qr-player" : qrBlock && qrBlock.contains(el) ? "qr-block" : "main";
  const controls = [];
  const links = [];
  for (const el of Array.from(page.querySelectorAll("a[href], button, summary, input, select, [role=button]"))) {
    if (el.matches("input[type=hidden]")) continue;
    if (!visible(el) || decorative(el)) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    let kind;
    if (el.matches("input[type=checkbox], input[type=radio]")) kind = "checkbox";
    else if (el.matches("input[type=range]")) kind = "range";
    else if (el.matches("button, summary, select, input, [role=button]")) kind = "control";
    else {
      const bg = s.backgroundColor;
      const hasBg = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      const hasBorder = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none";
      const block = /flex|block|grid/.test(s.display);
      kind = block && (hasBg || hasBorder) ? "control" : "link";
    }
    const item = {
      kind,
      scope: scopeOf(el),
      tag: el.tagName.toLowerCase(),
      label: label(el),
      h: round(r.height),
      w: round(r.width),
      font: parseFloat(s.fontSize),
    };
    if (kind === "checkbox") {
      const lab = el.closest("label");
      item.labelH = lab ? round(lab.getBoundingClientRect().height) : null;
    }
    if (kind === "link") links.push(item);
    else controls.push(item);
  }

  // ── текст ────────────────────────────────────────────────────────
  const texts = [];
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue.replace(/\s+/g, " ").trim();
    if (value.length < 2) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    if (!visible(el) || decorative(el)) continue;
    if (el.closest("script, style, noscript")) continue;
    seen.add(el);
    const s = getComputedStyle(el);
    const heading = el.closest("h1, h2, h3, h4");
    const fine = el.closest("[data-fine-print]");
    texts.push({
      scope: scopeOf(el),
      size: parseFloat(s.fontSize),
      heading: Boolean(heading),
      fine: fine ? fine.getAttribute("data-fine-print") || "fine" : null,
      tag: el.tagName.toLowerCase(),
      text: value.slice(0, 70),
    });
  }

  const h1 = Array.from(document.querySelectorAll("h1")).map((el) => el.textContent.trim().replace(/\s+/g, " "));
  const h2 = Array.from(page.querySelectorAll("h2")).filter(visible).map((el) => el.textContent.trim().replace(/\s+/g, " "));
  const hrefs = Array.from(page.querySelectorAll("a[href]")).map((a) => ({ href: a.getAttribute("href"), scope: scopeOf(a) }));

  return {
    vw,
    pageHeight: document.documentElement.scrollHeight,
    docScrollWidth,
    blocks,
    overflowOffenders,
    controls,
    links,
    texts,
    h1,
    h2,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    jsonLdTypes: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap((s) => {
      try {
        const data = JSON.parse(s.textContent || "{}");
        return (data["@graph"] || [data]).map((item) => item["@type"]);
      } catch {
        return [];
      }
    }),
    hrefs,
  };
}

function summarize(data) {
  const main = (list) => list.filter((item) => item.scope === "main");
  const smallControls = main(data.controls).filter((c) => (c.kind === "control" ? c.h < 48 : false));
  const smallText = main(data.texts).filter((t) => !t.heading && !t.fine && t.size < 16);
  const fineText = main(data.texts).filter((t) => t.fine);
  const insets = data.blocks
    .filter((b) => b.insetL != null)
    .map((b) => ({ block: b.heading ?? b.cls ?? b.tag, insetL: b.insetL, insetR: b.insetR, gap: b.gapFromPrev ?? null }));
  const hrefs = data.hrefs.map((h) => h.href);
  return {
    pageHeight: data.pageHeight,
    horizontalScroll: data.docScrollWidth > data.vw,
    docScrollWidth: data.docScrollWidth,
    overflowOffenders: data.overflowOffenders.length,
    controlsMain: main(data.controls).filter((c) => c.kind === "control").length,
    controlsUnder48: smallControls,
    textNodesMain: main(data.texts).length,
    textUnder16: smallText,
    finePrint: fineText.map((t) => ({ size: t.size, fine: t.fine, text: t.text })),
    insets,
    links: {
      blanki: hrefs.filter((h) => h === "/blanki").length,
      journalsInfo: hrefs.filter((h) => h === "/journals-info" || h?.startsWith("/journals-info/")).length,
      dlya: [...new Set(hrefs.filter((h) => h?.startsWith("/dlya-")))].length,
    },
    qrControls: data.controls.filter((c) => c.scope === "qr-player").map((c) => ({ label: c.label, h: c.h })),
    qrBlockText: data.texts.filter((t) => t.scope === "qr-block" || t.scope === "qr-player").map((t) => ({ size: t.size, text: t.text })),
    footerSmallText: data.texts.filter((t) => t.scope === "footer" && t.size < 16).length,
  };
}

const browser = await chromium.launch({
  executablePath: chromePath(),
  headless: true,
  args: ["--use-gl=swiftshader", "--no-sandbox"],
});
const result = { prefix, base, at: new Date().toISOString(), widths: {} };
try {
  for (const width of widthsArg) {
    const height = width < 768 ? 844 : 900;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: theme === "dark" ? "dark" : "light",
    });
    // Публичные страницы ночью сами переходят в тёмную тему (по часам) —
    // для сравнения до/после тема фиксируется явно.
    await context.addInitScript((mode) => {
      try {
        localStorage.setItem("wesetup-theme-auto-schedule", "0");
        localStorage.setItem("wesetup-theme-mode", mode);
      } catch {
        /* без хранилища — тема по умолчанию */
      }
    }, theme);
    // Плашка «Rendering…» dev-сервера Next — не часть страницы.
    await context.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal{display:none!important}";
        document.head.appendChild(style);
      });
    });
    const page = await context.newPage();
    const response = await page.goto(base + "/", { waitUntil: "load", timeout: 300_000 });
    await page.waitForSelector("[data-qr-player]", { timeout: 120_000 });
    await page.waitForTimeout(2500);
    // Первый экран — как его видит человек (анимации входа уже прошли).
    if (width === 390) {
      await page.screenshot({ path: path.join(evidenceDir, `${prefix}${themeSuffix}-first-screen-390.png`) });
    }
    // Секции ниже сгиба спрятаны до входа в кадр (LandingMotion) и
    // отложены content-visibility — для полной страницы снимаем оба.
    await page.evaluate(() => {
      document.documentElement.classList.remove("landing-motion-ready");
      document.querySelector(".landing-page")?.classList.add("anchor-measuring");
    });
    // Ленивые картинки (превью бланков) грузятся при подходе к экрану —
    // проходим страницу сверху вниз и возвращаемся.
    await page.evaluate(async () => {
      const step = Math.round(window.innerHeight * 0.8);
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1200);
    const data = await page.evaluate(collect);
    data.status = response?.status() ?? null;
    result.widths[width] = { summary: summarize(data), raw: data };
    const out = path.join(evidenceDir, `${prefix}${themeSuffix}-full-${width}.png`);
    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    // Chromium не рисует кадр выше 16 384 px — длинную страницу снимаем
    // кусками и склеиваем.
    const CHUNK = 8000;
    if (fullHeight <= 15000) {
      await page.screenshot({ path: out, fullPage: true });
    } else {
      const parts = [];
      for (let top = 0; top < fullHeight; top += CHUNK) {
        const h = Math.min(CHUNK, fullHeight - top);
        parts.push({ top, buffer: await page.screenshot({ fullPage: true, clip: { x: 0, y: top, width, height: h } }) });
      }
      await sharp({ create: { width, height: fullHeight, channels: 3, background: "#ffffff" } })
        .composite(parts.map((part) => ({ input: part.buffer, top: part.top, left: 0 })))
        .png({ compressionLevel: 9 })
        .toFile(out);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(rawDir, `audit-${prefix}${themeSuffix}.json`), JSON.stringify(result, null, 2));
for (const [width, value] of Object.entries(result.widths)) {
  const s = value.summary;
  console.log(
    JSON.stringify({
      width,
      height: s.pageHeight,
      hScroll: s.horizontalScroll,
      offenders: s.overflowOffenders,
      controlsUnder48: s.controlsUnder48.length,
      textUnder16: s.textUnder16.length,
      links: s.links,
      blocks: value.raw.blocks.length,
    }),
  );
}
