import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { THEME_COOKIE, pickInitialTheme } from "@/lib/theme-cookie";
import { SiteThemeBootstrap, siteThemeBootstrapCode } from "./site-theme";

/**
 * Тема ставится ДО гидрации:
 *   • сервер рисует `.app-shell` сразу в теме устройства (кука), а не профиля;
 *   • скрипт темы — первый ребёнок `.app-shell` в каждой оболочке сайта:
 *     браузер выполняет его, когда оболочка уже открыта, а её содержимое
 *     ещё не разобрано, — первый кадр рисуется уже в нужной теме.
 * Раньше скрипт стоял ПЕРЕД оболочкой, `querySelectorAll('.app-shell')`
 * ничего не находил, и каждая загрузка начиналась с темы профиля.
 */

const SHELL_LAYOUTS = [
  "src/app/(dashboard)/layout.tsx",
  "src/app/root/layout.tsx",
  "src/app/partner/layout.tsx",
  "src/app/master/layout.tsx",
];

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("тема до гидрации: оболочки сайта", () => {
  for (const file of SHELL_LAYOUTS) {
    it(`${file}: скрипт темы — первый ребёнок .app-shell`, () => {
      const src = read(file);
      const shell = /<div\b[^>]*className="app-shell[^"]*"[^>]*>/.exec(src);
      assert.ok(shell, "нет <div class=app-shell>");
      const afterOpen = src.slice(shell.index + shell[0].length);
      // До скрипта допускаются только комментарии JSX.
      const beforeScript = afterOpen.slice(0, afterOpen.indexOf("<SiteThemeBootstrap />"));
      assert.ok(afterOpen.includes("<SiteThemeBootstrap />"), "скрипта темы нет внутри оболочки");
      assert.equal(beforeScript.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim(), "", beforeScript);
      // И больше нигде: второй скрипт вне оболочки ничего бы не делал.
      assert.equal(src.split("<SiteThemeBootstrap />").length - 1, 1);
    });

    it(`${file}: тема первого кадра — из куки устройства, потом профиль`, () => {
      const src = read(file);
      assert.match(src, /pickInitialTheme\(|readInitialTheme\(/);
      assert.doesNotMatch(src, /themePreference === "dark" \? "dark" : "light"/);
    });
  }

  it("клиентский переход в новую оболочку: тема применяется до отрисовки кадра", () => {
    // Скрипт до гидрации при клиентском переходе не выполняется (вход, возврат
    // из /root, публичная страница, экраны мини-приложения) — тему применяет
    // эффект провайдера. Обычный useEffect срабатывал ПОСЛЕ отрисовки кадра.
    const site = read("src/components/theme/site-theme.tsx");
    assert.match(site, /const useBeforePaintEffect =\s+typeof window === "undefined" \? useEffect : useLayoutEffect;/);
    const hydrate = site.slice(site.indexOf("Hydrate из localStorage"), site.indexOf("Cross-tab/cross-instance sync"));
    assert.match(hydrate, /useBeforePaintEffect\(\(\) => \{/, "провайдер сайта");
    const publicTheme = site.slice(site.indexOf("export function usePublicAutoTheme"), site.indexOf("export function PublicThemeScope"));
    assert.match(publicTheme, /useBeforePaintEffect\(\(\) => \{/, "публичные страницы");
    const mini = read("src/app/mini/_components/mini-theme.tsx");
    const resolve = mini.slice(mini.indexOf("Выбор лежит в localStorage и в Telegram"), mini.indexOf("Вход из Telegram проходит на клиенте"));
    assert.match(resolve, /useBeforePaintEffect\(\(\) => \{/, "мини-приложение");
  });

  it("серверная разметка: оболочка уже в теме устройства, скрипт — первым", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        { className: "app-shell", "data-app-theme": pickInitialTheme("dark", "light") },
        createElement(SiteThemeBootstrap),
        createElement("main", null, "страница"),
      ),
    );
    assert.match(html, /^<div class="app-shell" data-app-theme="dark"><script>/);
    assert.ok(html.indexOf("<script>") < html.indexOf("<main>"));
  });
});

type Env = {
  storage: Record<string, string>;
  prefersDark?: boolean;
  hour?: number;
  server?: "light" | "dark";
  cookie?: string;
};

/** Прогнать скрипт темы в песочнице: он стоит внутри `.app-shell`. */
function runBootstrap(env: Env) {
  const attrs: Record<string, string> = { "data-app-theme": env.server ?? "light" };
  const shell = {
    classList: { contains: (c: string) => c === "app-shell" },
    getAttribute: (name: string) => attrs[name] ?? null,
    setAttribute: (name: string, value: string) => {
      attrs[name] = value;
    },
  };
  const meta: Record<string, string> = {};
  const document = {
    currentScript: { parentElement: shell },
    querySelectorAll: () => [],
    querySelector: (sel: string) =>
      sel.includes("theme-color") ? { setAttribute: (_: string, v: string) => (meta.content = v) } : null,
    cookie: env.cookie ?? "",
  };
  const hour = env.hour ?? 12;
  class FixedDate extends Date {
    getHours() {
      return hour;
    }
  }
  const localStorage = { getItem: (k: string) => (k in env.storage ? env.storage[k] : null) };
  vm.runInNewContext(siteThemeBootstrapCode(), {
    localStorage,
    document,
    Date: FixedDate,
    RegExp,
    window: { matchMedia: (q: string) => ({ matches: q.includes("dark") ? Boolean(env.prefersDark) : false }) },
    console: { info: () => {} },
  });
  return { theme: attrs["data-app-theme"], cookie: document.cookie, themeColor: meta.content };
}

describe("тема до гидрации: скрипт", () => {
  const mode = (m: string, auto = "0") => ({ "wesetup-theme-mode": m, "wesetup-theme-auto-schedule": auto });

  it("своя тёмная при светлой в профиле — оболочка тёмная до первого кадра, кука обновлена", () => {
    const r = runBootstrap({ storage: mode("dark"), server: "light" });
    assert.equal(r.theme, "dark");
    assert.match(r.cookie, new RegExp(`^${THEME_COOKIE}=dark; Path=/;`));
    assert.equal(r.themeColor, "#2b2841");
  });

  it("своя светлая — светлая, и строка браузера светлая (раньше оставалась тёмно-синей)", () => {
    const r = runBootstrap({ storage: mode("light"), server: "dark" });
    assert.equal(r.theme, "light");
    assert.equal(r.themeColor, "#ffffff");
  });

  it("«как на устройстве» — по теме системы", () => {
    assert.equal(runBootstrap({ storage: mode("system"), prefersDark: true }).theme, "dark");
    assert.equal(runBootstrap({ storage: mode("system"), prefersDark: false, server: "dark" }).theme, "light");
  });

  it("смена по времени суток — по часу", () => {
    assert.equal(runBootstrap({ storage: mode("light", "1"), hour: 23 }).theme, "dark");
    assert.equal(runBootstrap({ storage: mode("dark", "1"), hour: 9, server: "dark" }).theme, "light");
  });

  it("кука уже верная — не переписывается", () => {
    const r = runBootstrap({ storage: mode("dark"), server: "dark", cookie: `${THEME_COOKIE}=dark` });
    assert.equal(r.cookie, `${THEME_COOKIE}=dark`);
  });

  it("устройство ничего не выбирало — остаётся тема сервера", () => {
    const r = runBootstrap({ storage: {}, server: "dark" });
    assert.equal(r.theme, "dark");
    assert.equal(r.cookie, "");
  });
});
