"use client";

/**
 * Скриншот видимой части страницы — для репорта о проблеме.
 *
 * Снимаем DOM (`modern-screenshot`, SVG foreignObject), а не экран:
 * `getDisplayMedia` просит разрешение и на телефоне недоступен. Цвета
 * Tailwind 4 в `oklch` эта библиотека переносит как есть — html2canvas
 * на них падает.
 *
 * Клон рисуется без прокрутки, поэтому три поправки:
 * 1. Сам `body` в клоне сдвигаем на текущую прокрутку, а холст режем по
 *    размеру окна — получается ровно то, что видит человек.
 * 2. `fixed`-элементы ставим туда, где они сейчас на экране (в клоне они
 *    иначе остались бы у верха документа).
 * 3. `sticky` (шапка, сайдбар) — сдвигаем на столько, на сколько их
 *    сейчас «прилепило»: меряем положение с `position: relative` в той же
 *    синхронной задаче, так что мигания нет.
 *
 * Всё, что целиком выше или ниже окна, в клоне заменяем пустой коробкой
 * того же размера: раскладка видимой части не меняется, а клонировать,
 * сериализовать и рисовать длинный журнал целиком не нужно — на
 * странице журналов это секунды.
 *
 * Картинки за пределами окна в снимок не попадают, поэтому их не тянем:
 * библиотека ждёт загрузки каждой `<img>` и вшивает её в клон, а
 * ленивые превью журналов на телефоне не грузятся никогда — снимок
 * висел до таймаута (~30 с вместо пары секунд).
 */

const MARK = "data-bug-shot";
const IGNORE = "data-bug-report-ignore";
const SKIP_IMAGE = "data-bug-shot-skip";
const PRUNE = "data-bug-shot-prune";
/** Прозрачный пиксель: пустой `src` клон превратил бы в запрос страницы. */
const BLANK_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
/**
 * В Safari библиотека перерисовывает холст по разу на каждую картинку и
 * CSS-фон (лечит недекодированные картинки), с паузой 100 мс + i. На
 * странице журналов это ~100 перерисовок и 10+ секунд ожидания; пары
 * повторов хватает.
 */
const MAX_SAFARI_REDRAWS = 3;

type Fix = Partial<CSSStyleDeclaration>;

function markPositioned(bodyRect: DOMRect): Map<string, Fix> {
  const fixes = new Map<string, Fix>();
  const stickies: HTMLElement[] = [];
  const all = document.body.querySelectorAll<HTMLElement>("*");
  let index = 0;
  for (const el of all) {
    const position = getComputedStyle(el).position;
    if (position !== "fixed" && position !== "sticky") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const id = String(index++);
    el.setAttribute(MARK, id);
    if (position === "fixed") {
      // `fixed` остаётся `fixed`: сдвинутый `body` клона становится его
      // блоком отсчёта, так что координаты считаем от `body`.
      fixes.set(id, {
        position: "fixed",
        top: `${rect.top - bodyRect.top}px`,
        left: `${rect.left - bodyRect.left}px`,
        right: "auto",
        bottom: "auto",
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: "0",
        transform: "none",
        translate: "none",
      });
    } else {
      stickies.push(el);
    }
  }
  if (stickies.length > 0) {
    const stuck = stickies.map((el) => el.getBoundingClientRect());
    const saved = stickies.map((el) => el.style.position);
    for (const el of stickies) el.style.position = "relative";
    const natural = stickies.map((el) => el.getBoundingClientRect());
    stickies.forEach((el, i) => {
      el.style.position = saved[i];
      fixes.set(el.getAttribute(MARK)!, {
        position: "relative",
        top: `${stuck[i].top - natural[i].top}px`,
        left: `${stuck[i].left - natural[i].left}px`,
        bottom: "auto",
        right: "auto",
      });
    });
  }
  return fixes;
}

/**
 * Коробки, которые можно опустошить: целиком выше или ниже окна, блочные
 * (у строчных и табличных размер задаёт содержимое — пустая ячейка
 * поменяла бы ширину видимой колонки) и без `fixed`/`sticky` внутри —
 * те видны на экране, где бы ни стояли в разметке.
 */
function markPrunable(fixes: Map<string, Fix>): void {
  let index = 0;
  const visit = (el: Element) => {
    for (const child of el.children) {
      if (!(child instanceof HTMLElement) || child.hasAttribute(MARK)) {
        if (child instanceof HTMLElement) visit(child);
        continue;
      }
      const rect = child.getBoundingClientRect();
      const offscreen = rect.bottom < 0 || rect.top > window.innerHeight;
      if (!offscreen) {
        visit(child);
        continue;
      }
      const display = getComputedStyle(child).display;
      const boxy =
        display !== "none" &&
        display !== "contents" &&
        !display.startsWith("inline") &&
        !display.startsWith("table");
      if (!boxy || child.querySelector(`[${MARK}]`)) {
        visit(child);
        continue;
      }
      const id = `p${index++}`;
      child.setAttribute(PRUNE, id);
      const width = `${rect.width}px`;
      const height = `${rect.height}px`;
      fixes.set(id, {
        boxSizing: "border-box",
        width,
        minWidth: width,
        maxWidth: width,
        height,
        minHeight: height,
        maxHeight: height,
        flexGrow: "0",
        flexShrink: "0",
        overflow: "hidden",
      });
    }
  };
  visit(document.body);
}

function outsideViewport(rect: DOMRect): boolean {
  return (
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.top > window.innerHeight ||
    rect.left > window.innerWidth
  );
}

type Detached = { img: HTMLImageElement; src: string | null; srcset: string | null };

/**
 * Невидимые картинки: в клоне убираем `src` (не вшиваем), а у ещё не
 * загруженных — и в оригинале до конца снимка, иначе ожидание загрузки
 * упрётся в таймаут. Пустой `src` вне окна человек не увидит.
 */
function skipOffscreenImages(): Detached[] {
  const detached: Detached[] = [];
  for (const img of document.body.querySelectorAll("img")) {
    if (!outsideViewport(img.getBoundingClientRect())) continue;
    img.setAttribute(SKIP_IMAGE, "");
    if (!img.complete) {
      detached.push({
        img,
        src: img.getAttribute("src"),
        srcset: img.getAttribute("srcset"),
      });
      img.removeAttribute("srcset");
      img.removeAttribute("src");
    }
  }
  return detached;
}

/** Снимок окна в JPEG. Бросает, если браузер не справился. */
export async function capturePageScreenshot(): Promise<File> {
  const { createContext, destroyContext, domToBlob } = await import(
    "modern-screenshot"
  );
  const body = document.body;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const bodyRect = body.getBoundingClientRect();
  const fixes = markPositioned(bodyRect);
  markPrunable(fixes);
  const detached = skipOffscreenImages();
  try {
    const background =
      getComputedStyle(body).backgroundColor || "#ffffff";
    const context = await createContext(body, {
      width,
      height,
      // dpr 3 у телефонов даёт мегабайты без пользы для разбора бага.
      scale: Math.min(window.devicePixelRatio || 1, 2),
      type: "image/jpeg",
      quality: 0.9,
      backgroundColor:
        background === "rgba(0, 0, 0, 0)" ? "#ffffff" : background,
      timeout: 15_000,
      // Прокрученные таблицы и списки — как на экране, а не с начала.
      features: { restoreScrollPosition: true },
      style: {
        margin: "0",
        transform: `translate(${bodyRect.left}px, ${bodyRect.top}px)`,
        transformOrigin: "0 0",
      },
      filter: (node) =>
        !(node instanceof Element && node.hasAttribute(IGNORE)) &&
        !node.parentElement?.hasAttribute(PRUNE),
      onCloneEachNode: (cloned) => {
        if (!(cloned instanceof HTMLElement)) return;
        if (cloned.hasAttribute(SKIP_IMAGE)) {
          cloned.removeAttribute(SKIP_IMAGE);
          cloned.removeAttribute("srcset");
          cloned.setAttribute("src", BLANK_PIXEL);
          return;
        }
        const id = cloned.getAttribute(MARK) ?? cloned.getAttribute(PRUNE);
        if (id === null) return;
        cloned.removeAttribute(MARK);
        cloned.removeAttribute(PRUNE);
        const fix = fixes.get(id);
        if (fix) Object.assign(cloned.style, fix);
      },
      // Картинку чужого домена без CORS просто пропускаем, а не валим снимок.
      fetch: { placeholderImage: "" },
      // Вызывается после вшивания картинок, до отрисовки на холст.
      onCreateForeignObjectSvg: () => {
        context.drawImageCount = Math.min(
          context.drawImageCount,
          MAX_SAFARI_REDRAWS
        );
      },
    });
    let blob: Blob;
    try {
      blob = await domToBlob(context);
    } finally {
      destroyContext(context);
    }
    if (!blob) throw new Error("empty screenshot");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return new File([blob], `screenshot-${stamp}.jpg`, { type: "image/jpeg" });
  } finally {
    for (const el of body.querySelectorAll(
      `[${MARK}], [${SKIP_IMAGE}], [${PRUNE}]`
    )) {
      el.removeAttribute(MARK);
      el.removeAttribute(SKIP_IMAGE);
      el.removeAttribute(PRUNE);
    }
    for (const { img, src, srcset } of detached) {
      if (srcset !== null) img.setAttribute("srcset", srcset);
      if (src !== null) img.setAttribute("src", src);
    }
  }
}

/** Атрибут для элементов, которые не должны попасть в снимок. */
export const BUG_REPORT_IGNORE_ATTR = IGNORE;
