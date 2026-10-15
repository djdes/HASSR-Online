import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { TELEGRAM_SIGN_IN_MESSAGES } from "@/lib/telegram-auth-messages";
import { miniEntryErrorPresentation } from "./mini-entry-error-presentation";
import { miniNavItems, type MiniNavItem } from "@/app/mini/_lib/nav-items";

type Dict = Record<string, unknown>;
type Locale = "ru" | "en" | "uz";

const repo = process.cwd();
const sourceRoot = path.resolve(process.env.MINI_HOME_SOURCE_ROOT ?? path.join(repo, "src"));
const miniBatch = path.join(repo, ".agent/tasks/english-version-1375e736/batches/mini-home");

function deepMerge(base: Dict, overlay: Dict): Dict {
  const merged: Dict = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge((base[key] as Dict | undefined) ?? {}, value as Dict)
      : value;
  }
  return merged;
}

function loadLocale(locale: Locale): Dict {
  const current = JSON.parse(readFileSync(path.join(repo, `src/i18n/messages/${locale}.json`), "utf8")) as Dict;
  if (sourceRoot !== path.join(repo, "src")) {
    const staged = JSON.parse(readFileSync(path.join(miniBatch, `${locale}.json`), "utf8")) as Dict;
    return deepMerge(current, staged);
  }
  return current;
}

function atPath(object: Dict, messagePath: string): unknown {
  return messagePath.split(".").reduce<unknown>((value, segment) => {
    return value && typeof value === "object" ? (value as Dict)[segment] : undefined;
  }, object);
}

function elementText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join(" ");
  if (typeof node === "object" && "props" in node) {
    return elementText((node as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function findElement(node: unknown, predicate: (value: Dict) => boolean): Dict | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
    return null;
  }
  const value = node as Dict;
  if (predicate(value)) return value;
  return findElement((value.props as Dict | undefined)?.children, predicate);
}

function compileSource(relativePath: string): string {
  const source = readFileSync(path.join(sourceRoot, relativePath), "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

type EntryOptions = {
  locale?: Locale;
  status?: string;
  session?: { user?: { role?: string } } | null;
  next?: string | null;
  nps?: string | null;
  signedOut?: boolean;
  cookie?: boolean;
  telegram?: { initData: string } | null;
  signInResult?: { error?: string } | null;
  deferred?: boolean;
};

function createEntry(options: EntryOptions = {}) {
  const context = {
    locale: options.locale ?? "en",
    status: options.status ?? "unauthenticated",
    session: options.session ?? null,
    next: options.next ?? null,
    nps: options.nps ?? null,
    signedOut: options.signedOut ?? false,
    cookie: options.cookie ?? false,
    telegram: options.telegram === undefined ? { initData: "signed-init-data" } : options.telegram,
    signInResult: options.signInResult ?? { error: "unknown server prose" },
    deferred: options.deferred ?? false,
  };
  const calls = { signIn: 0, replace: [] as string[], close: 0, timers: [] as Array<{ callback: () => void; delay: number }> };
  const hooks: Array<{ value?: unknown; deps?: unknown[] }> = [];
  let hookIndex = 0;
  let pendingEffects: Array<() => void> = [];
  let resolveSignIn: ((value: { error?: string } | null) => void) | undefined;
  const react = {
    useState(initial: unknown) {
      const index = hookIndex++;
      hooks[index] ??= { value: initial };
      return [hooks[index].value, (value: unknown) => {
        hooks[index].value = typeof value === "function"
          ? (value as (current: unknown) => unknown)(hooks[index].value)
          : value;
      }] as const;
    },
    useRef(initial: unknown) {
      const index = hookIndex++;
      hooks[index] ??= { value: { current: initial } };
      return hooks[index].value;
    },
    useEffect(effect: () => void, dependencies?: unknown[]) {
      const index = hookIndex++;
      const previous = hooks[index];
      if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        hooks[index] = { deps: dependencies };
        pendingEffects.push(effect);
      }
    },
  };
  const jsx = (type: unknown, props?: Dict) => ({ type, props: props ?? {} });
  const resolveTranslator = (namespace: string) => (key: string) => {
    const value = atPath(loadLocale(context.locale), `${namespace}.${key}`);
    if (typeof value !== "string") throw new Error(`Missing staged Mini message ${namespace}.${key}`);
    return value;
  };
  const mocks: Record<string, unknown> = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/link": { __esModule: true, default: "a" },
    "next-auth/react": {
      useSession: () => ({ data: context.session, status: context.status }),
      signIn: async () => {
        calls.signIn += 1;
        if (context.deferred) return new Promise((resolve) => { resolveSignIn = resolve; });
        return context.signInResult;
      },
    },
    "next/navigation": {
      useRouter: () => ({ replace: (value: string) => calls.replace.push(value) }),
      useSearchParams: () => ({ get: (key: string) => key === "next" ? context.next : key === "nps" ? context.nps : null }),
    },
    "next-intl": { useTranslations: resolveTranslator },
    "lucide-react": { Loader2: "Loader2", ShieldAlert: "ShieldAlert" },
    "./_lib/cookie-session": { adoptCookieSession: async () => context.cookie },
    "./_lib/signed-out-mark": {
      isSignedOutManually: () => context.signedOut,
      miniEntryStep: ({ hasInitData, signedOut }: { hasInitData: boolean; signedOut: boolean }) => signedOut
        ? "login-screen"
        : hasInitData ? "telegram-login" : "cookie-or-login",
    },
    "@/lib/journal-obligation-links": {
      sanitizeMiniAppRedirectPath: (value: string) => value.startsWith("/") && !value.startsWith("//") ? value : null,
    },
    "@/lib/nps": {
      NPS_PREVIEW_PARAM: "nps",
      isNpsPreviewRequested: (value: string | null) => value === "1",
      withNpsPreview: (value: string) => `${value}${value.includes("?") ? "&" : "?"}nps=1`,
    },
    "@/app/mini/_lib/nav-items": {
      miniHomeHref: (actor: { role?: string } | null) => actor?.role === "manager" ? "/dashboard" : "/mini/today",
    },
    "./_components/telegram-web-app": {
      getTelegramWebApp: () => context.telegram && { ...context.telegram, close: () => { calls.close += 1; } },
    },
    "@/lib/mini-entry-error-presentation": { miniEntryErrorPresentation },
  };
  const compiledModule: { exports: Record<string, (...args: never[]) => unknown> } = { exports: {} };
  const execute = vm.runInNewContext(`(function(require,module,exports){${compileSource("app/mini/page.tsx")}\n})`, {
    setTimeout: (callback: () => void, delay: number) => {
      const timer = { callback, delay };
      calls.timers.push(timer);
      return timer;
    },
    window: {
      location: { pathname: "/mini", search: "" },
      setTimeout: (callback: () => void, delay: number) => {
        const timer = { callback, delay };
        calls.timers.push(timer);
        return timer;
      },
    },
  }) as (require: (id: string) => unknown, module: typeof compiledModule, exports: typeof compiledModule.exports) => void;
  execute((id) => {
    if (!(id in mocks)) throw new Error(`Unexpected staged import ${id}`);
    return mocks[id];
  }, compiledModule, compiledModule.exports);
  const render = () => {
    hookIndex = 0;
    pendingEffects = [];
    const tree = compiledModule.exports.default() as unknown;
    const effects = pendingEffects;
    pendingEffects = [];
    effects.forEach((effect) => effect());
    return tree;
  };
  return {
    context,
    calls,
    render,
    resolveSignIn: (result: { error?: string } | null) => resolveSignIn?.(result),
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("Mini entry keeps auth single-shot across locale changes and translates delayed errors", async () => {
  const entry = createEntry({ deferred: true });
  assert.match(elementText(entry.render()), /Opening your workspace/);
  assert.equal(entry.calls.signIn, 1);

  entry.context.locale = "uz";
  entry.render();
  assert.equal(entry.calls.signIn, 1);
  entry.resolveSignIn({ error: "unknown server prose" });
  await flushAsync();

  const tree = entry.render();
  assert.match(elementText(tree), /Kirish amalga oshmadi/);
  assert.doesNotMatch(elementText(tree), /unknown server prose/);
  const phone = findElement(tree, (node) => node.type === "a" && (node.props as Dict).href === "/mini/login");
  assert.ok(phone);
  assert.match(elementText(phone), /Telefon orqali kirish/);

  const retry = findElement(tree, (node) => node.type === "button" && elementText(node).includes("Qayta urinish"));
  assert.ok(retry);
  ((retry.props as Dict).onClick as () => void)();
  entry.render();
  assert.equal(entry.calls.signIn, 2);
});

test("Mini entry preserves timeout, expired recovery, redirects, NPS and manual/cookie login", async () => {
  const timed = createEntry({ deferred: true });
  timed.render();
  const timer = timed.calls.timers.find((item) => item.delay === 12000);
  assert.ok(timer);
  timed.context.locale = "uz";
  timer.callback();
  await flushAsync();
  assert.match(elementText(timed.render()), /Telegram javobi kutilganidan uzoqroq/);

  const expired = createEntry({ signInResult: { error: TELEGRAM_SIGN_IN_MESSAGES.expired } });
  expired.render();
  await flushAsync();
  const expiredTree = expired.render();
  const close = findElement(expiredTree, (node) => node.type === "button");
  assert.ok(close);
  assert.match(elementText(close), /Close app/);
  ((close.props as Dict).onClick as () => void)();
  assert.equal(expired.calls.close, 1);

  const safe = createEntry({ status: "authenticated", session: { user: { role: "manager" } }, next: "/journals/hygiene", nps: "1" });
  safe.render();
  assert.deepEqual(safe.calls.replace, ["/journals/hygiene?nps=1"]);
  const unsafe = createEntry({ status: "authenticated", session: { user: { role: "manager" } }, next: "https://evil.example" });
  unsafe.render();
  assert.deepEqual(unsafe.calls.replace, ["/dashboard"]);

  const manual = createEntry({ signedOut: true });
  manual.render();
  assert.deepEqual(manual.calls.replace, ["/mini/login?next=%2Fmini"]);
  assert.equal(manual.calls.signIn, 0);
  const cookie = createEntry({ telegram: null, cookie: false });
  cookie.render();
  await flushAsync();
  assert.deepEqual(cookie.calls.replace, ["/mini/login?next=%2Fmini"]);
  assert.equal(cookie.calls.signIn, 0);
});

test("Mini navigation translates stable built-ins and preserves explicit organization labels", () => {
  const items: MiniNavItem[] = [
    { href: "/mini/today", label: "Сегодня", labelKey: "today", icon: "CalendarCheck" },
    { href: "/mini/sections", label: "Разделы", labelKey: "sections", icon: "LayoutGrid" },
    { href: "/mini/me", label: "Профиль", labelKey: "profile", icon: "UserRound" },
  ];
  const source = compileSource("app/mini/_components/mini-nav.tsx");
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = loadLocale(locale);
    const jsx = (type: unknown, props?: Dict) => ({ type, props: props ?? {} });
    const mocks: Record<string, unknown> = {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "next/link": { __esModule: true, default: "Link" },
      "next/navigation": { usePathname: () => "/mini/today" },
      "next-intl": {
        useTranslations: (namespace: string) => (key: string) => {
          const value = atPath(messages, `${namespace}.${key}`);
          if (typeof value !== "string") throw new Error(`Missing ${namespace}.${key}`);
          return value;
        },
      },
      "lucide-react": Object.fromEntries(["CalendarCheck", "ClipboardList", "Home", "LayoutGrid", "UserRound"].map((key) => [key, key])),
      "@/app/mini/_lib/nav-items": { activeMiniNavHref: () => "/mini/today" },
      "./use-haptic": { haptic: () => undefined },
    };
    const compiledModule: { exports: Record<string, (props: { items: MiniNavItem[] }) => unknown> } = { exports: {} };
    const execute = vm.runInNewContext(`(function(require,module,exports){${source}\n})`);
    (execute as (require: (id: string) => unknown, module: typeof compiledModule, exports: typeof compiledModule.exports) => void)(
      (id) => {
        if (!(id in mocks)) throw new Error(`Unexpected staged import ${id}`);
        return mocks[id];
      },
      compiledModule,
      compiledModule.exports,
    );
    const tree = compiledModule.exports.MiniNav({ items }) as unknown;
    const displayed: string[] = [];
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      const value = node as Dict;
      if (value.type === "span") displayed.push(elementText(value));
      visit((value.props as Dict | undefined)?.children);
    };
    visit(tree);
    const expected = ["today", "sections", "profile"].map((key) => atPath(messages, `navigation.mini.${key}`));
    assert.deepEqual(displayed, expected);
    assert.equal((tree as Dict).props && ((tree as Dict).props as Dict)["aria-label"], atPath(messages, "miniHome.navigation.landmark"));
    if (locale !== "ru") assert.doesNotMatch(displayed.join(" "), /[А-Яа-яЁё]/);

    const coveredKeys = new Set<string>();
    for (const actor of [
      { role: "manager", permissionPreset: "admin" },
      { role: "head_chef", permissionPreset: "head_chef" },
      { role: "cook", permissionPreset: "cook" },
      { role: "cook", permissionPreset: "admin" },
    ]) {
      const actualItems = miniNavItems(actor);
      const actorTree = compiledModule.exports.MiniNav({ items: actualItems });
      for (const item of actualItems) {
        coveredKeys.add(item.labelKey);
        const namespace = item.labelKey === "dashboard" || item.labelKey === "journals" ? "routes" : "mini";
        assert.ok(elementText(actorTree).includes(String(atPath(messages, `navigation.${namespace}.${item.labelKey}`))));
      }
    }
    assert.deepEqual([...coveredKeys].sort(), ["dashboard", "journals", "profile", "sections", "today"]);

    const customTree = compiledModule.exports.MiniNav({
      items: [{ ...items[1], label: "Company QA", customLabel: true }],
    }) as unknown;
    const customLabel = findElement(customTree, (node) => node.type === "span");
    assert.equal(elementText(customLabel), "Company QA");

    const customDefaultCollision = compiledModule.exports.MiniNav({
      items: [{ ...items[1], label: "Разделы", customLabel: true }],
    }) as unknown;
    const collidingLabel = findElement(customDefaultCollision, (node) => node.type === "span");
    assert.equal(elementText(collidingLabel), "Разделы", "custom text equal to a Russian default must remain user-provided");
  }
});

test("legacy Telegram auth errors retain their safe semantic compatibility mapping", () => {
  const expired = miniEntryErrorPresentation(TELEGRAM_SIGN_IN_MESSAGES.expired);
  assert.equal(expired.key, "expired");
  assert.equal(expired.problem, "expired");
  const unknown = miniEntryErrorPresentation("private server diagnostic");
  assert.equal(unknown.key, "generic");
  assert.equal(unknown.problem, null);
});
