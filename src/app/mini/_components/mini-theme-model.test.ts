import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

import { SiteThemeBootstrap } from "@/components/theme/site-theme";
import { chooseThemeTile } from "@/components/theme/theme-tiles-model";

import {
  THEME_CHANGE_EVENT,
  THEME_KEYS,
  choiceStorageEntries,
  deviceTheme,
  effectiveMiniTheme,
  miniThemeBootstrapCode,
  readStoredChoice,
  resolveMiniThemeChoice,
  themeForHour,
  type MiniTheme,
} from "./mini-theme-model";
import { isInsideTelegram, type TelegramWebApp } from "./telegram-web-app";

type Storage = Record<string, string>;
type FakeTelegram = Partial<Pick<TelegramWebApp, "platform" | "initData" | "colorScheme">>;
type Env = {
  storage: Storage;
  /** `window.Telegram.WebApp`; `null` — скрипта Telegram нет вовсе. */
  telegram?: FakeTelegram | null;
  prefersDark?: boolean;
  hour?: number;
};

const get = (storage: Storage) => (key: string) => (key in storage ? storage[key] : null);

/**
 * Прогнать скрипт до гидрации в песочнице: localStorage, Telegram,
 * `prefers-color-scheme` и час — подставные. Возвращает атрибуты,
 * которые скрипт поставил корню (`#mini-root` или `.app-shell`).
 */
function runBootstrap(code: string, env: Env): Record<string, string> {
  const attrs: Record<string, string> = {};
  const root = {
    setAttribute: (name: string, value: string) => {
      attrs[name] = value;
    },
  };
  const localStorage = { getItem: get(env.storage) };
  const window: Record<string, unknown> = {
    localStorage,
    matchMedia: (query: string) => ({
      matches: query.includes("dark") ? Boolean(env.prefersDark) : false,
    }),
  };
  if (env.telegram) window.Telegram = { WebApp: env.telegram };
  const hour = env.hour ?? 12;
  class FixedDate extends Date {
    getHours() {
      return hour;
    }
  }
  vm.runInNewContext(code, {
    window,
    localStorage,
    Date: FixedDate,
    document: {
      getElementById: (id: string) => (id === "mini-root" ? root : null),
      querySelectorAll: (selector: string) => (selector === ".app-shell" ? [root] : []),
      querySelector: () => null,
    },
  });
  return attrs;
}

/** Код сайтового скрипта до гидрации — тот, что стоит в layout'ах кабинета. */
function siteBootstrapCode(): string {
  const element = SiteThemeBootstrap() as unknown as {
    props: { dangerouslySetInnerHTML: { __html: string } };
  };
  return element.props.dangerouslySetInnerHTML.__html;
}

/** Внутри ли Telegram — настоящей функцией приложения на подставном `window`. */
function insideTelegram(telegram: FakeTelegram | null | undefined): boolean {
  const holder = globalThis as unknown as { window?: unknown };
  const had = "window" in holder;
  const previous = holder.window;
  holder.window = telegram ? { Telegram: { WebApp: telegram } } : {};
  try {
    return isInsideTelegram();
  } finally {
    if (had) holder.window = previous;
    else delete holder.window;
  }
}

function telegramScheme(telegram: FakeTelegram | null | undefined): MiniTheme | null {
  if (!insideTelegram(telegram)) return null;
  const scheme = telegram?.colorScheme;
  return scheme === "light" || scheme === "dark" ? scheme : null;
}

/** Тема, которую покажет провайдер после гидрации. */
function providerTheme(env: Env, profileTheme: MiniTheme | null, fallback: MiniTheme): MiniTheme {
  const tg = telegramScheme(env.telegram);
  const choice = resolveMiniThemeChoice({
    profileTheme,
    stored: readStoredChoice(get(env.storage)),
    telegramColorScheme: tg,
    fallback,
  });
  return effectiveMiniTheme(choice, {
    hour: env.hour ?? 12,
    device: deviceTheme({ telegramColorScheme: tg, prefersDark: Boolean(env.prefersDark) }),
  });
}

/** Что оставляет в localStorage выбор карточки в мини-приложении. */
function miniChoiceStorage(tile: "light" | "dark" | "system", device: MiniTheme): Storage {
  const next = chooseThemeTile({ autoBySchedule: false }, tile);
  const choice = { mode: next.mode, autoBySchedule: next.autoBySchedule };
  const effective = effectiveMiniTheme(choice, { hour: 12, device });
  return Object.fromEntries(choiceStorageEntries(choice, effective));
}

const IOS_DARK: FakeTelegram = { platform: "ios", initData: "", colorScheme: "dark" };
const ANDROID_LIGHT: FakeTelegram = { platform: "android", initData: "", colorScheme: "light" };
/** Обычная вкладка или приложение WeSetup: скрипт Telegram создал объект, но это не Telegram. */
const NOT_TELEGRAM: FakeTelegram = { platform: "unknown", initData: "", colorScheme: "light" };

describe("мини-приложение: «Как на устройстве»", () => {
  it("в Telegram — тема самого Telegram, вне его — тема системы", () => {
    assert.equal(deviceTheme({ telegramColorScheme: "dark", prefersDark: false }), "dark");
    assert.equal(deviceTheme({ telegramColorScheme: "light", prefersDark: true }), "light");
    assert.equal(deviceTheme({ telegramColorScheme: null, prefersDark: true }), "dark");
    assert.equal(deviceTheme({ telegramColorScheme: null, prefersDark: false }), "light");
  });

  it("действующая тема: «как на устройстве» — по устройству, светлая и тёмная — как выбраны", () => {
    for (const device of ["light", "dark"] as const) {
      assert.equal(effectiveMiniTheme({ mode: "system", autoBySchedule: false }, { hour: 12, device }), device);
      assert.equal(effectiveMiniTheme({ mode: "light", autoBySchedule: false }, { hour: 3, device }), "light");
      assert.equal(effectiveMiniTheme({ mode: "dark", autoBySchedule: false }, { hour: 12, device }), "dark");
    }
  });

  it("смена по времени суток главнее выбора: 7:00–19:00 светлая", () => {
    const at = (hour: number) =>
      effectiveMiniTheme({ mode: "dark", autoBySchedule: true }, { hour, device: "dark" });
    assert.equal(at(6), "dark");
    assert.equal(at(7), "light");
    assert.equal(at(18), "light");
    assert.equal(at(19), "dark");
  });

  it("часы смены те же, что у сайта (сверка с его скриптом до гидрации)", () => {
    const site = siteBootstrapCode();
    for (let hour = 0; hour < 24; hour += 1) {
      const attrs = runBootstrap(site, { storage: { [THEME_KEYS.auto]: "1" }, hour });
      assert.equal(attrs["data-app-theme"], themeForHour(hour), `час ${hour}`);
    }
  });
});

describe("мини-приложение: какой выбор действует", () => {
  const fallback = "dark" as const;
  const resolve = (storage: Storage, profileTheme: MiniTheme | null, tg: MiniTheme | null = null) =>
    resolveMiniThemeChoice({ profileTheme, stored: readStoredChoice(get(storage)), telegramColorScheme: tg, fallback });

  it("«Как на устройстве» этого устройства главнее темы профиля", () => {
    assert.deepEqual(resolve({ [THEME_KEYS.mode]: "system" }, "light"), { mode: "system", autoBySchedule: false });
    assert.deepEqual(resolve({ [THEME_KEYS.mode]: "system", [THEME_KEYS.effective]: "light" }, "dark", "light"), {
      mode: "system",
      autoBySchedule: false,
    });
  });

  it("смена по времени суток этого устройства главнее всего; режим — к которому она вернёт", () => {
    assert.deepEqual(resolve({ [THEME_KEYS.auto]: "1", [THEME_KEYS.mode]: "system" }, "light"), {
      mode: "system",
      autoBySchedule: true,
    });
    assert.deepEqual(resolve({ [THEME_KEYS.auto]: "1" }, "light"), { mode: "light", autoBySchedule: true });
  });

  it("светлая / тёмная: профиль, затем выбор на устройстве, затем Telegram, затем по умолчанию", () => {
    assert.equal(resolve({ [THEME_KEYS.mode]: "light", [THEME_KEYS.effective]: "light" }, "dark").mode, "dark");
    assert.equal(resolve({ [THEME_KEYS.mode]: "light" }, null, "dark").mode, "light");
    assert.equal(resolve({ [THEME_KEYS.effective]: "light" }, null, "dark").mode, "light");
    assert.equal(resolve({ [THEME_KEYS.legacy]: "light" }, null, "dark").mode, "light");
    assert.equal(resolve({}, null, "light").mode, "light");
    assert.equal(resolve({}, null, null).mode, fallback);
    assert.equal(resolve({ [THEME_KEYS.auto]: "0", [THEME_KEYS.mode]: "dark" }, null).autoBySchedule, false);
  });

  it("мусор в localStorage не считается выбором", () => {
    const stored = readStoredChoice(get({ [THEME_KEYS.mode]: "auto", [THEME_KEYS.effective]: "blue", [THEME_KEYS.auto]: "yes" }));
    assert.deepEqual(stored, { mode: null, auto: false, effective: null });
  });
});

describe("мини-приложение: выбор записывается так же, как на сайте", () => {
  it("карточка пишет режим, выключенную смену по времени и действующую тему", () => {
    assert.deepEqual(miniChoiceStorage("system", "dark"), {
      [THEME_KEYS.mode]: "system",
      [THEME_KEYS.auto]: "0",
      [THEME_KEYS.effective]: "dark",
    });
    assert.deepEqual(miniChoiceStorage("light", "dark"), {
      [THEME_KEYS.mode]: "light",
      [THEME_KEYS.auto]: "0",
      [THEME_KEYS.effective]: "light",
    });
  });

  it("сайт читает выбор мини-приложения: «Светлая» и «Тёмная» — как выбраны", () => {
    const site = siteBootstrapCode();
    for (const tile of ["light", "dark"] as const) {
      for (const prefersDark of [false, true]) {
        const attrs = runBootstrap(site, { storage: miniChoiceStorage(tile, "dark"), prefersDark });
        assert.equal(attrs["data-app-theme"], tile, `${tile}, система тёмная: ${prefersDark}`);
      }
    }
  });

  it("сайт читает «Как на устройстве» из мини-приложения — и следует системе, а не записанной теме", () => {
    const site = siteBootstrapCode();
    const storage = miniChoiceStorage("system", "light");
    assert.equal(runBootstrap(site, { storage, prefersDark: true })["data-app-theme"], "dark");
    assert.equal(runBootstrap(site, { storage, prefersDark: false })["data-app-theme"], "light");
  });

  it("мини-приложение читает выбор сайта (то, что сайт оставляет в localStorage)", () => {
    // site-theme.tsx: setMode → режим и "0"; пересчёт → действующая тема.
    const siteSystem = { [THEME_KEYS.mode]: "system", [THEME_KEYS.auto]: "0", [THEME_KEYS.effective]: "light" };
    const siteDark = { [THEME_KEYS.mode]: "dark", [THEME_KEYS.auto]: "0", [THEME_KEYS.effective]: "dark" };
    // setAutoBySchedule(true) → "1"; режим остаётся прежним.
    const siteAuto = { [THEME_KEYS.mode]: "light", [THEME_KEYS.auto]: "1", [THEME_KEYS.effective]: "light" };

    const resolveNoProfile = (storage: Storage) =>
      resolveMiniThemeChoice({ profileTheme: null, stored: readStoredChoice(get(storage)), telegramColorScheme: null, fallback: "dark" });
    assert.deepEqual(resolveNoProfile(siteSystem), { mode: "system", autoBySchedule: false });
    assert.deepEqual(resolveNoProfile(siteDark), { mode: "dark", autoBySchedule: false });
    assert.deepEqual(resolveNoProfile(siteAuto), { mode: "light", autoBySchedule: true });

    // «Как на устройстве» с сайта в Telegram — по теме Telegram, даже если в профиле другая.
    assert.equal(providerTheme({ storage: siteSystem, telegram: IOS_DARK }, "light", "light"), "dark");
    assert.equal(runBootstrap(miniThemeBootstrapCode(true), { storage: siteSystem, telegram: IOS_DARK })["data-theme"], "dark");
    // …а в приложении WeSetup и браузере — по системе.
    assert.equal(providerTheme({ storage: siteSystem, telegram: NOT_TELEGRAM, prefersDark: true }, "light", "light"), "dark");
    // Смена по времени с сайта — по часу, даже поверх темы профиля.
    assert.equal(runBootstrap(miniThemeBootstrapCode(true), { storage: siteAuto, hour: 23 })["data-theme"], "dark");
    assert.equal(runBootstrap(miniThemeBootstrapCode(true), { storage: siteAuto, hour: 9 })["data-theme"], "light");
  });

  it("ключи и событие — те же, что у сайта", () => {
    const source = readFileSync("src/components/theme/site-theme.tsx", "utf8");
    for (const key of [THEME_KEYS.effective, THEME_KEYS.mode, THEME_KEYS.auto, THEME_KEYS.legacy, THEME_CHANGE_EVENT]) {
      assert.ok(source.includes(`"${key}"`), `у сайта нет ${key}`);
    }
  });
});

describe("мини-приложение: скрипт до гидрации", () => {
  it("вошедший без настроек устройства — разметку в теме профиля не трогает", () => {
    const attrs = runBootstrap(miniThemeBootstrapCode(true), {
      storage: { [THEME_KEYS.mode]: "light", [THEME_KEYS.effective]: "light" },
      telegram: IOS_DARK,
    });
    assert.deepEqual(attrs, {});
  });

  it("«Как на устройстве»: в Telegram — его тема, в обычной вкладке — системная", () => {
    const storage = { [THEME_KEYS.mode]: "system" };
    const inTelegram = runBootstrap(miniThemeBootstrapCode(true), { storage, telegram: IOS_DARK, prefersDark: false });
    assert.deepEqual(inTelegram, { "data-theme": "dark", "data-app-theme": "dark" });
    const inBrowser = runBootstrap(miniThemeBootstrapCode(true), { storage, telegram: NOT_TELEGRAM, prefersDark: true });
    assert.deepEqual(inBrowser, { "data-theme": "dark", "data-app-theme": "dark" });
  });

  it("совпадает с провайдером во всех сочетаниях — тема после гидрации не мигает", () => {
    const storages: Storage[] = [
      {},
      { [THEME_KEYS.mode]: "light", [THEME_KEYS.auto]: "0", [THEME_KEYS.effective]: "light" },
      { [THEME_KEYS.mode]: "dark" },
      { [THEME_KEYS.mode]: "system", [THEME_KEYS.auto]: "0", [THEME_KEYS.effective]: "light" },
      { [THEME_KEYS.effective]: "dark" },
      { [THEME_KEYS.legacy]: "light" },
      { [THEME_KEYS.mode]: "light", [THEME_KEYS.auto]: "1" },
      { [THEME_KEYS.mode]: "system", [THEME_KEYS.auto]: "1" },
    ];
    const telegrams: Array<FakeTelegram | null> = [null, NOT_TELEGRAM, IOS_DARK, ANDROID_LIGHT];
    let cases = 0;
    for (const storage of storages) {
      for (const profileTheme of [null, "light", "dark"] as const) {
        for (const telegram of telegrams) {
          for (const prefersDark of [false, true]) {
            for (const hour of [3, 12]) {
              const env: Env = { storage, telegram, prefersDark, hour };
              // Сервер рисует тему профиля, до входа — тёмную (mini-shell-data.ts).
              const server = profileTheme ?? "dark";
              const attrs = runBootstrap(miniThemeBootstrapCode(profileTheme !== null), env);
              const painted = attrs["data-theme"] ?? server;
              assert.equal(attrs["data-theme"], attrs["data-app-theme"]);
              assert.equal(
                painted,
                providerTheme(env, profileTheme, server),
                JSON.stringify({ storage, profileTheme, telegram, prefersDark, hour })
              );
              cases += 1;
            }
          }
        }
      }
    }
    assert.equal(cases, 8 * 3 * 4 * 2 * 2);
  });
});
