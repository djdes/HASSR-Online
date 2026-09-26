# Приложения WeSetup для Android и iOS — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выпустить приложения WeSetup для Android и iOS — Capacitor-оболочку вокруг сайта с push, печатью, скачиванием, голосом и универсальными ссылками — плюс автоматическую сборку и пошаговую инструкцию для начальника.

**Architecture:** Приложение загружает `https://wesetup.ru/mini?src=app` (remote URL) и приписывает себя к User-Agent. Сайт по User-Agent включает мобильную оболочку и сам вызывает нативные плагины через `window.Capacitor.Plugins` (мост живёт в коде сайта, без npm-зависимостей Capacitor на сайте). Push идёт через Firebase Cloud Messaging из тех же мест, где рождаются уведомления колокольчика и личные сообщения бота. Сборка — GitHub Actions: Android AAB, iOS на macOS-раннере в TestFlight.

**Tech Stack:** Next.js 16 / Prisma / NextAuth (сайт); Capacitor (актуальная стабильная мажорная версия, одна на все `@capacitor/*`), `@capacitor-firebase/messaging`, `@capacitor/app`, `@capacitor/filesystem`, `@capacitor/share`, `@capacitor/splash-screen`, `@capacitor/status-bar`, `@capacitor-community/speech-recognition`, свой локальный плагин `WebPrint`; Firebase Cloud Messaging HTTP v1; GitHub Actions, fastlane; Playwright для проверки и скриншотов.

**Spec:** `docs/superpowers/specs/2026-09-26-mobile-apps-design.md`

## Global Constraints

- Идентификатор приложения на обеих платформах: `ru.wesetup.app`. Название: «WeSetup».
- Стартовый адрес приложения: `https://wesetup.ru/mini?src=app`.
- Приписка к User-Agent: `WeSetupApp/<версия> (<ios|android>)`, например `WeSetupApp/1.0.0 (android)`.
- В приложении нет функций, которых нет на сайте (решение владельца). Отдельного сканера QR нет.
- Заполнение журналов в обход TasksFlow не добавлять (П-3). Права — только проверки сайта (П-4).
- Все версии `@capacitor/*` одной мажорной версии; зафиксировать точные версии в `mobile/package.json` без `^`.
- Секреты только в GitHub Secrets и в `.env` сервера. В код и в git — никогда.
- UI-тексты по-русски, код и комментарии в стиле соседних файлов. Подтверждения — `ConfirmDialog`, не `window.confirm`.
- Тесты: `node:test` + `assert/strict`, файлы `*.test.ts` рядом с модулем; запуск `npx tsx --test <файл>`.
- Проверки перед коммитом: `npm run typecheck`, `npx eslint <файлы>`, тесты затронутых модулей. Хуки не обходить (`--no-verify` запрещён).
- Коммиты по-русски, после каждого — `git push origin master` (CLAUDE.md). Работать в отдельной рабочей копии `C:\wt\mobile-apps` (git worktree): в `D:\www\Wesetup.ru` параллельно работают другие сессии, а диск D: повреждает файлы. Перед каждым коммитом — `git fetch && git rebase origin/master`.
- Файлы проекта в CRLF: правки через Edit, окончания строк сохранять.
- Тестовый стенд: порт 3021, `NEXT_DIST_DIR=.next-e2e-sweep`, база `postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable`. Порт 3020 и `.env` (боевая база) не трогать. Скрипты стенда: `.agent/tasks/mini-sweep-2026-09/` (`tg-session.ts`, `tg-parity.ts`).

## Review Focus

1. **Кука оболочки на компьютере.** Сторож оболочки снимает куку `ws-shell` на широких экранах; в приложении на планшете (ширина ≥ 1024) он не должен её снимать и перезагружать страницу по кругу — тест в Task 1.
2. **Телефон передали другому сотруднику.** Push прошлого владельца не должны приходить новому: токен устройства переходит к последнему вошедшему — тест в Task 2.
3. **Ссылка push на экран, куда у человека нет прав.** Открывается домашний экран, а не ошибка; ссылки на чужой домен и `javascript:` отбрасываются — тест `normalizePushUrl` в Task 3.
4. **Скачивание файла из приложения.** Файлы, которые сайт отдаёт с `Content-Disposition: attachment` (отчёты, PDF журнала, CSV премий), и blob-ссылки `download` должны открываться «Поделиться», а не молча ничего не делать; обычные внутренние ссылки — не перехватываться — тест `classifyLink` в Task 7.
5. **Удаление аккаунта владельцем.** Удаление владельца не должно молча оставить компанию без руководителя: владелец ведётся в удаление компании с отсрочкой, сотрудник обезличивается — тест `planAccountDeletion` в Task 5.

---

## Структура файлов

**Сайт (создать):**
- `src/lib/mobile-app.ts` — распознавание приложения по User-Agent, сравнение версий.
- `src/lib/mobile-devices.ts` — чистая логика регистрации и переноса токенов.
- `src/app/api/mobile/devices/route.ts` — регистрация и удаление устройства.
- `src/lib/mobile-push.ts` — отправка через FCM HTTP v1, разбор ошибок, нормализация ссылки.
- `src/lib/account-deletion.ts` — план и выполнение удаления аккаунта.
- `src/app/api/account/delete/route.ts` — удаление аккаунта.
- `src/app/delete-account/page.tsx` — публичная страница удаления.
- `src/lib/app-links.ts` — содержимое файлов связи с доменом.
- `src/app/.well-known/apple-app-site-association/route.ts`, `src/app/.well-known/assetlinks.json/route.ts`.
- `src/lib/native-bridge.ts` — типы и обёртки над `window.Capacitor.Plugins`, чистая классификация ссылок.
- `src/app/mini/_components/native-app-bridge.tsx` — клиентский мост: печать, скачивание, внешние ссылки, «назад», push, ссылки из уведомлений.
- `src/app/mini/_components/app-update-gate.tsx` — экран «Обновите приложение».

**Сайт (изменить):** `prisma/schema.prisma`, `src/lib/mini-shell-cookie.ts`, `src/proxy.ts`, `src/app/mini/_components/mini-shell.tsx`, `src/app/mini/_components/mini-app-shell.tsx`, `src/lib/notifications.ts`, `src/lib/telegram.ts`, `src/app/mini/me/me-client.tsx`, `src/components/journals/voice-input.tsx`, `src/app/(auth)/login/login-client.tsx`, `src/components/public/app-stores-teaser.tsx` (только после решения владельца), `src/lib/whats-new-notes.ts`.

**Мобильный проект (создать):** `mobile/package.json`, `mobile/capacitor.config.ts`, `mobile/www/index.html`, `mobile/www/offline.html`, `mobile/assets/icon.png`, `mobile/assets/splash.png`, `mobile/android/**` и `mobile/ios/**` (генерирует `cap add`), локальный плагин `WebPrint` (Android: `mobile/android/app/src/main/java/ru/wesetup/app/WebPrintPlugin.java`; iOS: `mobile/ios/App/App/WebPrintPlugin.swift` + `.m`), `mobile/ios/App/fastlane/Fastfile`, `mobile/ios/App/fastlane/Appfile`, `.github/workflows/mobile-release.yml`.

**Документы:** `docs/mobile/00-overview.md` … `docs/mobile/11-updates.md`, `docs/mobile/store-listing.md`, `docs/mobile/secrets.md`; скриншоты `docs/mobile/screenshots/**`.

---

### Task 0: Рабочая копия

- [ ] **Step 1: Создать worktree на C:**

```bash
cd /d/www/Wesetup.ru && git fetch -q && git worktree add -b mobile-apps-work C:/wt/mobile-apps origin/master
cd C:/wt/mobile-apps && npm ci && npx prisma generate
```

Работаем в ветке `mobile-apps-work`, каждый завершённый task вливаем в master: `git fetch && git rebase origin/master && git push origin HEAD:master`.

---

### Task 1: Сайт распознаёт приложение

**Files:**
- Create: `src/lib/mobile-app.ts`, `src/lib/mobile-app.test.ts`
- Modify: `src/lib/mini-shell-cookie.ts` (тип `MiniShellEnvironment`, `shouldSetMiniShell`, `shouldDropMiniShell`), `src/lib/mini-shell-cookie.test.ts`, `src/proxy.ts` (`markMiniShell`), `src/app/mini/_components/mini-shell.tsx` (`MiniTelegramRuntime`)

**Interfaces:**
- Produces: `parseMobileAppUserAgent(ua: string | null | undefined): { platform: "ios" | "android"; version: string } | null`, `isMobileAppUserAgent(ua): boolean`, `compareAppVersion(a: string, b: string): -1 | 0 | 1`, `isInsideMobileApp(): boolean` (клиент, читает `navigator.userAgent`). В `MiniShellEnvironment` новое поле `insideApp: boolean`.

- [ ] **Step 1: Тест распознавания**

```ts
// src/lib/mobile-app.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { compareAppVersion, isMobileAppUserAgent, parseMobileAppUserAgent } from "@/lib/mobile-app";

test("распознаёт приписку приложения в User-Agent", () => {
  const ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile WeSetupApp/1.2.3 (android)";
  assert.deepEqual(parseMobileAppUserAgent(ua), { platform: "android", version: "1.2.3" });
  assert.deepEqual(parseMobileAppUserAgent("… Mobile/15E148 WeSetupApp/1.0.0 (ios)"), { platform: "ios", version: "1.0.0" });
  assert.equal(isMobileAppUserAgent("Mozilla/5.0 Telegram-iOS/11.2"), false);
  assert.equal(parseMobileAppUserAgent(null), null);
  assert.equal(parseMobileAppUserAgent("WeSetupApp/1.0.0 (windows)"), null);
});

test("сравнивает версии по числам, а не строкой", () => {
  assert.equal(compareAppVersion("1.10.0", "1.9.9"), 1);
  assert.equal(compareAppVersion("1.2.0", "1.2"), 0);
  assert.equal(compareAppVersion("0.9.0", "1.0.0"), -1);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx tsx --test src/lib/mobile-app.test.ts` — Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализация**

```ts
// src/lib/mobile-app.ts
/**
 * Приложение WeSetup (Capacitor) приписывает себя к User-Agent:
 * `WeSetupApp/<версия> (<ios|android>)`. По этой приписке сайт включает
 * мобильную оболочку и мост к нативным функциям.
 */
const APP_UA_RE = /\bWeSetupApp\/(\d+(?:\.\d+){0,2})\s*\((ios|android)\)/i;

export type MobileAppInfo = { platform: "ios" | "android"; version: string };

export function parseMobileAppUserAgent(ua: string | null | undefined): MobileAppInfo | null {
  if (!ua) return null;
  const match = APP_UA_RE.exec(ua);
  if (!match) return null;
  return { platform: match[2].toLowerCase() as "ios" | "android", version: match[1] };
}

export function isMobileAppUserAgent(ua: string | null | undefined): boolean {
  return parseMobileAppUserAgent(ua) !== null;
}

export function compareAppVersion(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function isInsideMobileApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return isMobileAppUserAgent(navigator.userAgent);
}
```

- [ ] **Step 4: Тест правил куки оболочки (Review Focus 1)**

Добавить в `src/lib/mini-shell-cookie.test.ts`:

```ts
test("в приложении кука оболочки ставится и не снимается даже на широком экране", () => {
  const env = { pathname: "/dashboard", insideTelegram: false, standalone: false, insideApp: true, viewportWidth: 1366 };
  assert.equal(shouldSetMiniShell(env), true);
  assert.equal(shouldDropMiniShell(env), false);
});
```

Во всех существующих вызовах теста добавить `insideApp: false`.

- [ ] **Step 5: Реализация правил**

В `src/lib/mini-shell-cookie.ts`: в `MiniShellEnvironment` добавить поле

```ts
  /** Открыто в приложении WeSetup (Capacitor, приписка к User-Agent). */
  insideApp: boolean;
```

`shouldSetMiniShell`: `return env.insideTelegram || env.standalone || env.insideApp || isMiniPath(env.pathname);`
`shouldDropMiniShell`: первая строка `if (env.insideTelegram || env.standalone || env.insideApp) return false;`

- [ ] **Step 6: Сервер ставит куку по User-Agent**

В `src/proxy.ts`, функция `markMiniShell`: заменить `if (!isMiniPath(pathname)) return;` на

```ts
  const inApp = isMobileAppUserAgent(req.headers.get("user-agent"));
  if (!inApp && !isMiniPath(pathname)) return;
```

(импорт `isMobileAppUserAgent` из `@/lib/mobile-app`). Для приложения кука ставится на любом пути: первая загрузка `/mini?src=app` сразу получает оболочку.

- [ ] **Step 7: Клиент**

В `src/app/mini/_components/mini-shell.tsx`, `MiniTelegramRuntime`, в объект `env` добавить `insideApp: isInsideMobileApp(),`. В этом же файле кнопка «назад» Telegram и `useNeedsOwnBackButton` не меняются: в приложении системная «назад» есть на Android, а на iOS своя кнопка показывается, т. к. `isInsideTelegram()` ложно — проверить, что `useNeedsOwnBackButton` при `isInsideMobileApp()` возвращает `true` для вложенных экранов (добавить условие `|| isInsideMobileApp()` к `standalone`).

- [ ] **Step 8: Проверить и закоммитить**

Run: `npx tsx --test src/lib/mobile-app.test.ts src/lib/mini-shell-cookie.test.ts && npm run typecheck`
Expected: PASS, 0 ошибок.

```bash
git add src/lib/mobile-app.ts src/lib/mobile-app.test.ts src/lib/mini-shell-cookie.ts src/lib/mini-shell-cookie.test.ts src/proxy.ts src/app/mini/_components/mini-shell.tsx
git commit -m "Приложение: сайт узнаёт приложение WeSetup по User-Agent и включает мобильную оболочку"
```

---

### Task 2: Устройства для push

**Files:**
- Modify: `prisma/schema.prisma` (новая модель + связи в `User` и `Organization`, рядом с `webPushSubscriptions` — строки ~419 и ~834)
- Create: `src/lib/mobile-devices.ts`, `src/lib/mobile-devices.test.ts`, `src/app/api/mobile/devices/route.ts`

**Interfaces:**
- Consumes: `parseMobileAppUserAgent` (Task 1).
- Produces: модель `MobileDevice`; `registerMobileDevice(input: { userId: string; organizationId: string; token: string; platform: "ios" | "android"; appVersion: string }): Promise<void>`; `removeMobileDevice(userId: string, token: string): Promise<void>`; `validateDeviceInput(body: unknown): { ok: true; token: string; platform: "ios" | "android" } | { ok: false; error: string }`.

- [ ] **Step 1: Модель**

```prisma
/// Телефон с приложением WeSetup, куда можно слать push через Firebase.
///
/// `token` уникален ГЛОБАЛЬНО: это адрес конкретной установки приложения.
/// Если телефон передали другому сотруднику и тот вошёл, запись
/// ПЕРЕЕЗЖАЕТ на него — иначе прошлый владелец получал бы чужие задачи.
model MobileDevice {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  platform       String       // "ios" | "android"
  token          String       @unique
  appVersion     String
  pushEnabled    Boolean      @default(true)
  failureCount   Int          @default(0)
  lastSeenAt     DateTime     @default(now())
  createdAt      DateTime     @default(now())

  @@index([userId])
  @@index([organizationId])
}
```

В `User` и `Organization`: `mobileDevices MobileDevice[]`. Затем `npx prisma generate` и на стенде `DATABASE_URL=<e2e> npx prisma db push`.

- [ ] **Step 2: Тест валидации**

```ts
// src/lib/mobile-devices.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { validateDeviceInput } from "@/lib/mobile-devices";

test("принимает токен и платформу, отвергает мусор", () => {
  assert.deepEqual(validateDeviceInput({ token: "a".repeat(40), platform: "android" }), { ok: true, token: "a".repeat(40), platform: "android" });
  assert.equal(validateDeviceInput({ token: "", platform: "ios" }).ok, false);
  assert.equal(validateDeviceInput({ token: "x".repeat(40), platform: "windows" }).ok, false);
  assert.equal(validateDeviceInput({ token: "x".repeat(5000), platform: "ios" }).ok, false);
  assert.equal(validateDeviceInput(null).ok, false);
});
```

- [ ] **Step 3: Реализация**

```ts
// src/lib/mobile-devices.ts
import { db } from "@/lib/db";

export type DevicePlatform = "ios" | "android";

export function validateDeviceInput(body: unknown):
  | { ok: true; token: string; platform: DevicePlatform }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Пустой запрос" };
  const { token, platform } = body as { token?: unknown; platform?: unknown };
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) {
    return { ok: false, error: "Некорректный ключ устройства" };
  }
  if (platform !== "ios" && platform !== "android") {
    return { ok: false, error: "Некорректная платформа" };
  }
  return { ok: true, token, platform };
}

/** Регистрация или перенос устройства на вошедшего сотрудника (upsert по токену). */
export async function registerMobileDevice(input: {
  userId: string;
  organizationId: string;
  token: string;
  platform: DevicePlatform;
  appVersion: string;
}): Promise<void> {
  await db.mobileDevice.upsert({
    where: { token: input.token },
    create: { ...input },
    update: {
      userId: input.userId,
      organizationId: input.organizationId,
      platform: input.platform,
      appVersion: input.appVersion,
      failureCount: 0,
      lastSeenAt: new Date(),
    },
  });
}

export async function removeMobileDevice(userId: string, token: string): Promise<void> {
  await db.mobileDevice.deleteMany({ where: { userId, token } });
}
```

- [ ] **Step 4: Тест переноса токена (Review Focus 2) — на стенде**

Скрипт `.agent/tasks/mobile-apps-2026-09/e2e/device-rebind.ts`: под `cookA` `POST /api/mobile/devices` с токеном T, затем под `cleanerA` тот же T; ожидать в базе одну запись с `userId = cleanerA`. Запускать с e2e-базой (см. Global Constraints).

- [ ] **Step 5: API**

```ts
// src/app/api/mobile/devices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { parseMobileAppUserAgent } from "@/lib/mobile-app";
import { registerMobileDevice, removeMobileDevice, validateDeviceInput } from "@/lib/mobile-devices";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const parsed = validateDeviceInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const app = parseMobileAppUserAgent(req.headers.get("user-agent"));
  await registerMobileDevice({
    userId: session.user.id,
    organizationId: getActiveOrgId(session),
    token: parsed.token,
    platform: parsed.platform,
    appVersion: app?.version ?? "0.0.0",
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const parsed = validateDeviceInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  await removeMobileDevice(session.user.id, parsed.token);
  return NextResponse.json({ ok: true });
}
```

(Проверить по соседним маршрутам точный путь импорта `getServerSession` — в проекте `@/lib/server-session`.)

- [ ] **Step 6: Проверить и закоммитить**

Run: `npx tsx --test src/lib/mobile-devices.test.ts && npm run typecheck`, затем скрипт Step 4 на стенде.

```bash
git add prisma/schema.prisma src/lib/mobile-devices.ts src/lib/mobile-devices.test.ts src/app/api/mobile/devices/route.ts .agent/tasks/mobile-apps-2026-09/e2e/device-rebind.ts
git commit -m "Приложение: устройства сотрудников для push, перенос телефона на нового владельца"
```

---

### Task 3: Отправка push через Firebase

**Files:**
- Create: `src/lib/mobile-push.ts`, `src/lib/mobile-push.test.ts`
- Modify: `src/lib/notifications.ts` (функция `pushNotification`), `src/lib/telegram.ts` (`notifyEmployee`), `.env.shared` (пустые ключи с комментарием)

**Interfaces:**
- Consumes: `MobileDevice` (Task 2).
- Produces: `sendMobilePushToUser(userId: string, msg: { title: string; body: string; url?: string | null; tag?: string }): Promise<{ sent: number; removed: number }>`; `normalizePushUrl(href: string | null | undefined): string`; `isDeadTokenError(fcmErrorBody: unknown): boolean`; `pushTextFromTelegramHtml(html: string): string`; `isMobilePushConfigured(): boolean`.

- [ ] **Step 1: Тесты чистых функций (Review Focus 3)**

```ts
// src/lib/mobile-push.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { isDeadTokenError, normalizePushUrl, pushTextFromTelegramHtml } from "@/lib/mobile-push";

test("ссылка push остаётся внутренней", () => {
  assert.equal(normalizePushUrl("/journals/hygiene"), "/journals/hygiene");
  assert.equal(normalizePushUrl("https://wesetup.ru/mini/today"), "/mini/today");
  assert.equal(normalizePushUrl("https://evil.example/x"), "/mini");
  assert.equal(normalizePushUrl("//evil.example"), "/mini");
  assert.equal(normalizePushUrl("javascript:alert(1)"), "/mini");
  assert.equal(normalizePushUrl("/api/secret"), "/mini");
  assert.equal(normalizePushUrl(null), "/mini");
});

test("мёртвый токен распознаётся по ответу FCM", () => {
  assert.equal(isDeadTokenError({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }), true);
  assert.equal(isDeadTokenError({ error: { status: "INVALID_ARGUMENT", details: [{ errorCode: "INVALID_ARGUMENT" }] } }), true);
  assert.equal(isDeadTokenError({ error: { status: "UNAVAILABLE" } }), false);
  assert.equal(isDeadTokenError(null), false);
});

test("текст бота без разметки и в разумной длине", () => {
  assert.equal(pushTextFromTelegramHtml("<b>Задача</b>: гигиена &amp; здоровье"), "Задача: гигиена & здоровье");
  assert.ok(pushTextFromTelegramHtml("а".repeat(500)).length <= 180);
});
```

- [ ] **Step 2: Убедиться, что падают** — `npx tsx --test src/lib/mobile-push.test.ts` → FAIL.

- [ ] **Step 3: Реализация**

```ts
// src/lib/mobile-push.ts
import crypto from "node:crypto";
import { db } from "@/lib/db";

/**
 * Push в приложение WeSetup через Firebase Cloud Messaging HTTP v1.
 * Ключ сервисного аккаунта — JSON в `FIREBASE_SERVICE_ACCOUNT_JSON`.
 * Без ключа отправка молча выключена: колокольчик и Telegram работают как раньше.
 */
type ServiceAccount = { project_id: string; client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

export function isMobilePushConfigured(): boolean {
  return serviceAccount() !== null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`FCM auth ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export function normalizePushUrl(href: string | null | undefined): string {
  if (!href) return "/mini";
  let path = href.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      const u = new URL(path);
      if (u.hostname !== "wesetup.ru" && u.hostname !== "www.wesetup.ru") return "/mini";
      path = `${u.pathname}${u.search}`;
    } catch {
      return "/mini";
    }
  }
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/api/")) return "/mini";
  return path;
}

export function isDeadTokenError(body: unknown): boolean {
  const err = (body as { error?: { status?: string; details?: Array<{ errorCode?: string }> } } | null)?.error;
  if (!err) return false;
  const codes = (err.details ?? []).map((d) => d.errorCode);
  return codes.includes("UNREGISTERED") || codes.includes("INVALID_ARGUMENT") || err.status === "NOT_FOUND";
}

export function pushTextFromTelegramHtml(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

export async function sendMobilePushToUser(
  userId: string,
  msg: { title: string; body: string; url?: string | null; tag?: string },
): Promise<{ sent: number; removed: number }> {
  const sa = serviceAccount();
  if (!sa) return { sent: 0, removed: 0 };
  const devices = await db.mobileDevice.findMany({ where: { userId, pushEnabled: true }, select: { id: true, token: true } });
  if (devices.length === 0) return { sent: 0, removed: 0 };
  const bearer = await accessToken(sa);
  const url = normalizePushUrl(msg.url);
  let sent = 0;
  let removed = 0;
  for (const device of devices) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: device.token,
          notification: { title: msg.title, body: msg.body },
          data: { url },
          android: { notification: { tag: msg.tag, channel_id: "default" } },
          apns: { payload: { aps: { sound: "default", "thread-id": msg.tag } } },
        },
      }),
    });
    if (res.ok) {
      sent++;
      await db.mobileDevice.update({ where: { id: device.id }, data: { failureCount: 0, lastSeenAt: new Date() } });
      continue;
    }
    const body = await res.json().catch(() => null);
    if (isDeadTokenError(body)) {
      await db.mobileDevice.delete({ where: { id: device.id } });
      removed++;
    } else {
      await db.mobileDevice.update({ where: { id: device.id }, data: { failureCount: { increment: 1 } } });
    }
  }
  return { sent, removed };
}
```

- [ ] **Step 4: Точки вызова**

В `src/lib/notifications.ts`, `pushNotification`, сразу после вызова `sendPushToUser(...)` внутри того же `try`:

```ts
      const { sendMobilePushToUser } = await import("@/lib/mobile-push");
      await sendMobilePushToUser(args.userId, {
        title: args.title,
        body: args.items.length > 1 ? `${first} и ещё ${args.items.length - 1}` : (first ?? "Откройте, чтобы посмотреть"),
        url: args.linkHref ?? null,
        tag: args.dedupeKey,
      });
```

(сбой веб-push не должен отменять мобильный: обернуть каждый вызов в свой `try/catch` с `console.error`).

В `src/lib/telegram.ts`, `notifyEmployee`: после проверки «пользователь активен» и после проверки snooze, но ДО проверки `telegramChatId` (сотрудник без Telegram тоже должен получить push):

```ts
  void import("@/lib/mobile-push")
    .then(({ sendMobilePushToUser, pushTextFromTelegramHtml }) =>
      sendMobilePushToUser(user.id, {
        title: "WeSetup",
        body: pushTextFromTelegramHtml(text),
        url: action?.miniAppUrl ?? null,
      }),
    )
    .catch((error) => console.error("[telegram] mobile push failed", error));
```

Прочитать функцию целиком перед правкой и поставить вызов так, чтобы он не срабатывал для неактивного пользователя и в окне snooze.

В `.env.shared` добавить с комментарием: `FIREBASE_SERVICE_ACCOUNT_JSON=""   # JSON сервисного аккаунта Firebase (push в приложения); без него push в приложения выключен`.

- [ ] **Step 5: Проверить и закоммитить**

Run: `npx tsx --test src/lib/mobile-push.test.ts && npm run typecheck`.

```bash
git add src/lib/mobile-push.ts src/lib/mobile-push.test.ts src/lib/notifications.ts src/lib/telegram.ts .env.shared
git commit -m "Приложение: push через Firebase из колокольчика и личных сообщений бота"
```

---

### Task 4: Push в профиле

**Files:**
- Create: `src/app/api/mobile/devices/preferences/route.ts`
- Modify: `src/app/mini/me/me-client.tsx` (новая секция перед секцией с «Выйти», ~стр. 416)

**Interfaces:**
- Consumes: `isInsideMobileApp()` (Task 1), `MobileDevice.pushEnabled` (Task 2), `getNativeBridge()` (Task 7 — если Task 7 ещё не сделан, секция читает токен из `window.__wesetupPushToken`, который выставляет мост; порядок выполнения: Task 7 раньше Task 4 допустим).
- Produces: `PATCH /api/mobile/devices/preferences` `{ token: string; pushEnabled: boolean }` → `{ ok: true }`.

- [ ] **Step 1: API**

```ts
// src/app/api/mobile/devices/preferences/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { token?: unknown; pushEnabled?: unknown } | null;
  if (typeof body?.token !== "string" || typeof body.pushEnabled !== "boolean") {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const res = await db.mobileDevice.updateMany({
    where: { token: body.token, userId: session.user.id },
    data: { pushEnabled: body.pushEnabled },
  });
  if (res.count === 0) return NextResponse.json({ error: "Устройство не найдено" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Секция профиля**

В `me-client.tsx` добавить секцию, видимую только при `isInsideMobileApp()`: заголовок «Уведомления на этом телефоне», переключатель (тот же компонент переключателя, что используется в профиле для темы/других настроек — найти в файле), подпись «Задачи смены, напоминания и ответы руководителя». Если разрешение ОС не выдано — строка «Уведомления запрещены в настройках телефона» и кнопка «Открыть настройки» (`bridge.openAppSettings()` из Task 7). Переключение → `PATCH /api/mobile/devices/preferences`, при ошибке — `toast.error` и откат переключателя.

- [ ] **Step 3: Проверить на стенде**

Скрипт `.agent/tasks/mobile-apps-2026-09/e2e/profile-push.ts` (заготовка `tg-session.ts`, но `userAgent` контекста с припиской `WeSetupApp/1.0.0 (android)` и заглушкой `window.Capacitor` через `addInitScript`): секция видна в приложении, не видна без приписки; переключение меняет `pushEnabled` в базе.

- [ ] **Step 4: Закоммитить**

```bash
git add src/app/api/mobile/devices/preferences/route.ts src/app/mini/me/me-client.tsx .agent/tasks/mobile-apps-2026-09/e2e/profile-push.ts
git commit -m "Приложение: переключатель уведомлений на телефоне в профиле"
```

---

### Task 5: Удаление аккаунта

**Files:**
- Create: `src/lib/account-deletion.ts`, `src/lib/account-deletion.test.ts`, `src/app/api/account/delete/route.ts`, `src/app/delete-account/page.tsx`, `src/app/delete-account/delete-account-client.tsx`
- Modify: `src/app/mini/me/me-client.tsx` (строка «Удалить аккаунт» в секции с «Выйти»)

**Interfaces:**
- Produces: `planAccountDeletion(user: { isRoot: boolean; isOwnerOfOrganization: boolean; otherManagersCount: number }): { kind: "anonymize" } | { kind: "organization"; href: string } | { kind: "forbidden"; reason: string }`; `anonymizedUserData(userId: string): { name: string; email: string; phone: null; telegramChatId: null; passwordHash: string; isActive: false; archivedAt: Date }`; `POST /api/account/delete` `{ confirm: "УДАЛИТЬ" }`.

- [ ] **Step 1: Тест плана (Review Focus 5)**

```ts
// src/lib/account-deletion.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { anonymizedUserData, planAccountDeletion } from "@/lib/account-deletion";

test("сотрудник обезличивается, владелец идёт в удаление компании, ROOT — нельзя", () => {
  assert.deepEqual(planAccountDeletion({ isRoot: false, isOwnerOfOrganization: false, otherManagersCount: 0 }), { kind: "anonymize" });
  assert.deepEqual(planAccountDeletion({ isRoot: false, isOwnerOfOrganization: true, otherManagersCount: 0 }), {
    kind: "organization",
    href: "/settings/organization#deletion",
  });
  assert.equal(planAccountDeletion({ isRoot: true, isOwnerOfOrganization: false, otherManagersCount: 0 }).kind, "forbidden");
});

test("обезличенные данные не содержат личного и не дают войти", () => {
  const data = anonymizedUserData("user123");
  assert.equal(data.name, "Удалённый сотрудник");
  assert.equal(data.phone, null);
  assert.equal(data.telegramChatId, null);
  assert.equal(data.isActive, false);
  assert.match(data.email, /^deleted-user123@deleted\.wesetup\.local$/);
  assert.ok(data.passwordHash.length >= 32);
});
```

- [ ] **Step 2: Реализация**

```ts
// src/lib/account-deletion.ts
import crypto from "node:crypto";

export function planAccountDeletion(user: { isRoot: boolean; isOwnerOfOrganization: boolean; otherManagersCount: number }):
  | { kind: "anonymize" }
  | { kind: "organization"; href: string }
  | { kind: "forbidden"; reason: string } {
  if (user.isRoot) return { kind: "forbidden", reason: "Аккаунт администратора платформы удаляется только вручную." };
  if (user.isOwnerOfOrganization) return { kind: "organization", href: "/settings/organization#deletion" };
  return { kind: "anonymize" };
}

export function anonymizedUserData(userId: string) {
  return {
    name: "Удалённый сотрудник",
    email: `deleted-${userId}@deleted.wesetup.local`,
    phone: null,
    telegramChatId: null,
    // Случайный хэш: войти по паролю больше нельзя.
    passwordHash: crypto.randomBytes(32).toString("hex"),
    isActive: false as const,
    archivedAt: new Date(),
  };
}
```

Прочитать `prisma/schema.prisma` (модель `User`) и дополнить `anonymizedUserData` всеми личными полями, которые у модели есть (например `contactEmail`, `positionTitle` оставить, `qrPinHash` → null). Поле «владелец компании» — посмотреть, как его определяет `src/app/api/settings/organization/deletion/route.ts` и `Account.ownerUserId`, и вычислять `isOwnerOfOrganization` тем же способом.

- [ ] **Step 3: API**

`POST /api/account/delete`: сессия обязательна; тело `{ confirm: "УДАЛИТЬ" }` (иначе 400 «Введите УДАЛИТЬ»); по `planAccountDeletion`: `forbidden` → 403 с `reason`; `organization` → 409 `{ redirect: href, error: "Вы владелец компании: удалите компанию — аккаунт удалится вместе с ней" }`; `anonymize` → в одной транзакции `db.user.update({ data: anonymizedUserData(id) })`, `db.mobileDevice.deleteMany({ userId })`, `db.webPushSubscription.deleteMany({ userId })`, отзыв сессий через `src/lib/session-version.ts` (найти экспортируемую функцию увеличения версии), запись в журнал действий тем же помощником, что используют соседние маршруты (`audit` — найти по grep `auditLog.create`), действие `account.deleted`. Ответ `{ ok: true }`; клиент после ответа делает выход (`signOut`) и уводит на `/mini/login?deleted=1`.

- [ ] **Step 4: Интерфейс**

В `me-client.tsx` — строка «Удалить аккаунт» (иконка `Trash2`, красный текст) под «Выйти»; `ConfirmDialog` вариант `danger`, `typeToConfirm="УДАЛИТЬ"`, последствия списком: «Вы не сможете войти в WeSetup», «Ваше имя и телефон будут удалены», «Записи журналов, которые вы заполняли, останутся у компании — это требование СанПиН и ХАССП». При ответе 409 — диалог «Сначала удалите компанию» с кнопкой перехода по `redirect`.
Страница `/delete-account`: публичная; без сессии — текст «Войдите, чтобы удалить аккаунт» и кнопка на `/mini/login?next=/delete-account`; с сессией — тот же сценарий, что в профиле (вынести кнопку с диалогом в общий клиентский компонент `delete-account-client.tsx` и использовать в обоих местах). Внизу — «Или напишите на support@wesetup.ru с телефона, указанного в аккаунте».

- [ ] **Step 5: Проверить и закоммитить**

Run: `npx tsx --test src/lib/account-deletion.test.ts && npm run typecheck`. На стенде: создать сотрудника «ZZM Удаляемый», войти, удалить — в базе `isActive=false`, имя обезличено, повторный вход невозможен; под владельцем — ответ 409 и переход.

```bash
git add src/lib/account-deletion.ts src/lib/account-deletion.test.ts src/app/api/account/delete/route.ts src/app/delete-account src/app/mini/me/me-client.tsx
git commit -m "Удаление аккаунта в профиле и на странице /delete-account (требование App Store и Google Play)"
```

---

### Task 6: Связь приложения с доменом

**Files:**
- Create: `src/lib/app-links.ts`, `src/lib/app-links.test.ts`, `src/app/.well-known/apple-app-site-association/route.ts`, `src/app/.well-known/assetlinks.json/route.ts`
- Modify: `.env.shared` (`APPLE_TEAM_ID=""`, `ANDROID_CERT_SHA256=""` с комментариями)

**Interfaces:**
- Produces: `buildAppleAppSiteAssociation(teamId: string, bundleId: string): object`; `buildAssetLinks(packageName: string, fingerprints: string[]): object[]`; `APP_LINK_PATHS: readonly string[]`.

- [ ] **Step 1: Тест**

```ts
// src/lib/app-links.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { APP_LINK_PATHS, buildAppleAppSiteAssociation, buildAssetLinks } from "@/lib/app-links";

test("файл Apple содержит приложение, пути и ключи доступа", () => {
  const aasa = buildAppleAppSiteAssociation("ABCDE12345", "ru.wesetup.app") as {
    applinks: { details: Array<{ appIDs: string[]; components: Array<{ "/": string }> }> };
    webcredentials: { apps: string[] };
  };
  assert.deepEqual(aasa.applinks.details[0].appIDs, ["ABCDE12345.ru.wesetup.app"]);
  assert.ok(aasa.applinks.details[0].components.some((c) => c["/"] === "/mini/*"));
  assert.deepEqual(aasa.webcredentials.apps, ["ABCDE12345.ru.wesetup.app"]);
  assert.ok(APP_LINK_PATHS.includes("/journal-fill/*"));
});

test("файл Android содержит пакет и отпечатки", () => {
  const links = buildAssetLinks("ru.wesetup.app", ["AA:BB", " CC:DD "]) as Array<{ target: { package_name: string; sha256_cert_fingerprints: string[] } }>;
  assert.equal(links[0].target.package_name, "ru.wesetup.app");
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, ["AA:BB", "CC:DD"]);
});
```

- [ ] **Step 2: Реализация**

```ts
// src/lib/app-links.ts
export const APP_LINK_PATHS = [
  "/mini/*", "/journals/*", "/join/*", "/journal-fill/*", "/equipment-fill/*",
  "/room-fill/*", "/task-fill/*", "/delete-account",
] as const;

export function buildAppleAppSiteAssociation(teamId: string, bundleId: string) {
  const appId = `${teamId}.${bundleId}`;
  return {
    applinks: { details: [{ appIDs: [appId], components: APP_LINK_PATHS.map((p) => ({ "/": p })) }] },
    webcredentials: { apps: [appId] },
  };
}

export function buildAssetLinks(packageName: string, fingerprints: string[]) {
  return [{
    relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
    target: {
      namespace: "android_app",
      package_name: packageName,
      sha256_cert_fingerprints: fingerprints.map((f) => f.trim()).filter(Boolean),
    },
  }];
}
```

- [ ] **Step 3: Маршруты**

```ts
// src/app/.well-known/apple-app-site-association/route.ts
import { NextResponse } from "next/server";
import { buildAppleAppSiteAssociation } from "@/lib/app-links";

export const dynamic = "force-dynamic";

export function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  if (!teamId) return NextResponse.json({ error: "not configured" }, { status: 404 });
  return NextResponse.json(buildAppleAppSiteAssociation(teamId, "ru.wesetup.app"));
}
```

```ts
// src/app/.well-known/assetlinks.json/route.ts
import { NextResponse } from "next/server";
import { buildAssetLinks } from "@/lib/app-links";

export const dynamic = "force-dynamic";

export function GET() {
  const prints = (process.env.ANDROID_CERT_SHA256 ?? "").split(",").filter((s) => s.trim());
  if (prints.length === 0) return NextResponse.json([], { status: 200 });
  return NextResponse.json(buildAssetLinks("ru.wesetup.app", prints));
}
```

Проверить на стенде: `curl -i http://localhost:3021/.well-known/apple-app-site-association` (с `APPLE_TEAM_ID=TEST123456` в окружении стенда) → 200 `application/json`, без редиректа и без авторизации; `…/assetlinks.json` → 200. Если `src/proxy.ts` перенаправляет эти пути — добавить их в исключения рядом с `isPublicImageRoute`.

- [ ] **Step 4: Закоммитить**

```bash
git add src/lib/app-links.ts src/lib/app-links.test.ts "src/app/.well-known" .env.shared
git commit -m "Приложение: файлы связи с доменом для универсальных ссылок и ключей доступа"
```

---

### Task 7: Мост к нативным функциям (сайт)

**Files:**
- Create: `src/lib/native-bridge.ts`, `src/lib/native-bridge.test.ts`, `src/app/mini/_components/native-app-bridge.tsx`
- Modify: `src/app/mini/_components/mini-app-shell.tsx` (смонтировать `<NativeAppBridge />` рядом с `MiniTelegramRuntime`)

**Interfaces:**
- Consumes: `isInsideMobileApp()` (Task 1), `POST /api/mobile/devices` (Task 2), `normalizePushUrl` (Task 3).
- Produces: `getNativeBridge(): NativeBridge | null`, где `NativeBridge = { platform: "ios" | "android"; print(): Promise<void>; shareFile(name: string, base64: string, mime: string): Promise<void>; openExternal(url: string): Promise<void>; openAppSettings(): Promise<void>; speech: SpeechBridge | null }`; `classifyLink(href: string, currentOrigin: string, hasDownloadAttr: boolean): "internal" | "download" | "external" | "system"`.

Плагины, которые мост ищет в `window.Capacitor.Plugins` (ставятся в Task 8–9): `App`, `Filesystem`, `Share`, `FirebaseMessaging`, `SpeechRecognition`, `WebPrint`.

- [ ] **Step 1: Тест классификации ссылок (Review Focus 4)**

```ts
// src/lib/native-bridge.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { classifyLink } from "@/lib/native-bridge";

const O = "https://wesetup.ru";

test("внутренние ссылки не перехватываются", () => {
  assert.equal(classifyLink("/journals/hygiene", O, false), "internal");
  assert.equal(classifyLink("https://wesetup.ru/settings", O, false), "internal");
});

test("файлы открываются через «Поделиться»", () => {
  assert.equal(classifyLink("/api/reports/pdf?template=hygiene", O, false), "download");
  assert.equal(classifyLink("/api/reports/excel?templateCode=hygiene", O, false), "download");
  assert.equal(classifyLink("/api/journal-documents/abc/pdf", O, false), "download");
  assert.equal(classifyLink("/exports/list.csv", O, false), "download");
  assert.equal(classifyLink("blob:https://wesetup.ru/123", O, true), "download");
  assert.equal(classifyLink("/journals/hygiene", O, true), "download");
});

test("чужие сайты — в браузер, почта и звонки — в систему", () => {
  assert.equal(classifyLink("https://tasksflow.ru/x", O, false), "external");
  assert.equal(classifyLink("mailto:support@wesetup.ru", O, false), "system");
  assert.equal(classifyLink("tel:+79990000000", O, false), "system");
});
```

- [ ] **Step 2: Реализация `native-bridge.ts`**

```ts
// src/lib/native-bridge.ts
/**
 * Мост сайта к нативным функциям приложения WeSetup.
 * Плагины Capacitor в приложении доступны странице как `window.Capacitor.Plugins`
 * (приложение грузит сайт с сервера), поэтому npm-зависимостей Capacitor на сайте нет.
 */
type AnyPlugin = Record<string, (...args: unknown[]) => Promise<unknown>> & {
  addListener?: (event: string, cb: (payload: unknown) => void) => Promise<{ remove: () => void }>;
};

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins: Record<string, AnyPlugin | undefined>;
};

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

const FILE_PATH_RE = /\/api\/reports\/(pdf|excel)|\/api\/journal-documents\/[^/]+\/pdf|\.(pdf|xlsx|xls|csv|zip|docx)(\?|$)/i;

export function classifyLink(href: string, currentOrigin: string, hasDownloadAttr: boolean): "internal" | "download" | "external" | "system" {
  if (/^(mailto|tel|sms):/i.test(href)) return "system";
  if (href.startsWith("blob:") || hasDownloadAttr) return "download";
  let url: URL;
  try {
    url = new URL(href, currentOrigin);
  } catch {
    return "internal";
  }
  if (url.origin !== currentOrigin) return "external";
  if (FILE_PATH_RE.test(url.pathname + url.search)) return "download";
  return "internal";
}

function plugin(name: string): AnyPlugin | null {
  if (typeof window === "undefined") return null;
  return window.Capacitor?.Plugins?.[name] ?? null;
}

export type NativeBridge = {
  platform: "ios" | "android";
  print(): Promise<void>;
  shareFile(name: string, base64: string, mime: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openAppSettings(): Promise<void>;
  plugin(name: string): AnyPlugin | null;
};

export function getNativeBridge(): NativeBridge | null {
  if (typeof window === "undefined" || !window.Capacitor?.isNativePlatform?.()) return null;
  const platform = window.Capacitor.getPlatform?.() === "ios" ? "ios" : "android";
  return {
    platform,
    plugin,
    async print() {
      await plugin("WebPrint")?.print({ jobName: document.title || "WeSetup" });
    },
    async shareFile(name, base64, mime) {
      const fs = plugin("Filesystem");
      const share = plugin("Share");
      if (!fs || !share) return;
      const written = (await fs.writeFile({ path: name, data: base64, directory: "CACHE" })) as { uri: string };
      await share.share({ title: name, files: [written.uri], dialogTitle: "Открыть или отправить" });
      void mime;
    },
    async openExternal(url) {
      await plugin("App")?.openUrl?.({ url });
    },
    async openAppSettings() {
      await plugin("App")?.openSettings?.({});
    },
  };
}
```

Прим.: имена методов плагинов сверить с документацией установленной версии (`@capacitor/app` — `openUrl` есть в `@capacitor/app-launcher`, а не в `App`; если так — добавить `@capacitor/app-launcher` в Task 8 и звать `AppLauncher.openUrl`). Для открытия настроек приложения использовать `NativeSettings` (`capacitor-native-settings`) или локальный метод `WebPrint.openSettings` (добавить в плагин Task 9) — выбрать одно и зафиксировать в Task 9.

- [ ] **Step 3: Клиентский мост `native-app-bridge.tsx`**

Компонент `"use client"`, рендерит `null`, работает только при `getNativeBridge() !== null`. В одном `useEffect`:

1. **Печать:** `const original = window.print; window.print = () => { void bridge.print(); };` — в cleanup вернуть `original`.
2. **Ссылки:** слушатель `click` на `document` в фазе захвата: найти ближайший `a[href]`; `classifyLink(a.href, location.origin, a.hasAttribute("download"))`:
   - `internal` — ничего не делать;
   - `system` / `external` — `event.preventDefault(); bridge.openExternal(a.href)`;
   - `download` — `event.preventDefault()`; скачать `fetch(a.href, { credentials: "include" })` → `blob` → `FileReader.readAsDataURL` → base64 без префикса; имя файла — из `Content-Disposition` (`filename*=` / `filename=`), иначе `a.download`, иначе последний сегмент пути; `bridge.shareFile(name, base64, blob.type)`; на время — `toast.loading("Готовим файл…")`, ошибка — `toast.error("Не удалось открыть файл. Проверьте интернет и попробуйте ещё раз")`.
   - Также перехватить `window.open(url)` для внешних адресов: `const originalOpen = window.open; window.open = (u) => { … classify → openExternal или location.assign … ; return null; }`.
3. **Кнопка «назад» (Android):** `App.addListener("backButton", ({ canGoBack }) => canGoBack ? history.back() : App.minimizeApp())`. Если на домашнем адресе (`isMiniRootPath(location.pathname)` из `mini-shell.tsx`) — сворачивать.
4. **Ссылки из системы:** `App.addListener("appUrlOpen", ({ url }) => { const path = normalizePushUrl(url); if (path !== location.pathname + location.search) location.assign(path); })`.
5. **Push:** если в сессии есть пользователь (`useSession`) и разрешение ещё не спрашивали на этом устройстве (`localStorage["wesetup.push.asked"]`), показать лист-объяснение (`BottomSheet` из `@/components/ui/bottom-sheet`): «Уведомления о задачах» / «Сюда придут задачи смены, напоминания и ответы руководителя» / кнопки «Включить» и «Не сейчас». «Включить» → `FirebaseMessaging.requestPermissions()` → при `granted` → `FirebaseMessaging.getToken()` → `POST /api/mobile/devices { token, platform }`; сохранить токен в `window.__wesetupPushToken` и `localStorage["wesetup.push.token"]`. При каждом запуске с разрешением — повторная регистрация (обновляет `lastSeenAt`, переносит устройство при смене пользователя). Слушатель `notificationActionPerformed` → `location.assign(normalizePushUrl(payload.notification.data.url))`. При выходе (`signOut` в профиле) — `DELETE /api/mobile/devices` с сохранённым токеном до вызова `signOut` (правка в `me-client.tsx`, функция выхода).

- [ ] **Step 4: Смонтировать** `<NativeAppBridge />` в `mini-app-shell.tsx` рядом с `<MiniTelegramRuntime …/>`.

- [ ] **Step 5: Проверить и закоммитить**

Run: `npx tsx --test src/lib/native-bridge.test.ts && npm run typecheck && npx eslint src/lib/native-bridge.ts src/app/mini/_components/native-app-bridge.tsx`.
Стенд: скрипт `.agent/tasks/mobile-apps-2026-09/e2e/bridge-stub.ts` — контекст с припиской в User-Agent и заглушкой `window.Capacitor` через `addInitScript` (плагины пишут вызовы в `window.__calls`): печать документа журнала → вызов `WebPrint.print`; «Скачать Excel» на `/reports` → `Filesystem.writeFile` + `Share.share` с именем `.xlsx`; ссылка `mailto:` → `openUrl`; внутренняя ссылка — без перехвата.

```bash
git add src/lib/native-bridge.ts src/lib/native-bridge.test.ts src/app/mini/_components/native-app-bridge.tsx src/app/mini/_components/mini-app-shell.tsx src/app/mini/me/me-client.tsx .agent/tasks/mobile-apps-2026-09/e2e/bridge-stub.ts
git commit -m "Приложение: мост к нативным функциям — печать, файлы, внешние ссылки, «назад», push"
```

---

### Task 8: Мобильный проект Capacitor

**Files:**
- Create: `mobile/package.json`, `mobile/capacitor.config.ts`, `mobile/www/index.html`, `mobile/www/offline.html`, `mobile/assets/icon.png` (1024×1024), `mobile/assets/splash.png` (2732×2732), `mobile/.gitignore`, `mobile/README.md`; сгенерированные `mobile/android/**`, `mobile/ios/**`

- [ ] **Step 1: Проект и зависимости**

```bash
cd C:/wt/mobile-apps && mkdir mobile && cd mobile && npm init -y
npm i --save-exact @capacitor/core@latest @capacitor/cli@latest @capacitor/android@latest @capacitor/ios@latest
# все плагины — той же мажорной версии, что @capacitor/core
npm i --save-exact @capacitor/app @capacitor/app-launcher @capacitor/filesystem @capacitor/share @capacitor/splash-screen @capacitor/status-bar @capacitor-firebase/messaging @capacitor-community/speech-recognition
npm i --save-exact -D @capacitor/assets
```

Сверить в `mobile/package.json`, что мажорные версии всех `@capacitor/*` и плагинов совместимы (таблица совместимости в README каждого плагина). Записать итоговые версии в `mobile/README.md`.

- [ ] **Step 2: Конфигурация**

```ts
// mobile/capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const pkg = require("./package.json") as { version: string };

const config: CapacitorConfig = {
  appId: "ru.wesetup.app",
  appName: "WeSetup",
  webDir: "www",
  server: {
    url: "https://wesetup.ru/mini?src=app",
    // Своя страница вместо белого экрана без интернета.
    errorPath: "offline.html",
    allowNavigation: ["wesetup.ru", "www.wesetup.ru"],
  },
  appendUserAgent: `WeSetupApp/${pkg.version}`,
  android: { appendUserAgent: `WeSetupApp/${pkg.version} (android)` },
  ios: { appendUserAgent: `WeSetupApp/${pkg.version} (ios)`, contentInset: "never" },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: "#0b1024", showSpinner: false },
    FirebaseMessaging: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
```

Проверить в документации установленной версии, что платформенный `appendUserAgent` перекрывает общий; если нет — оставить только платформенные.

`mobile/www/index.html` — минимальная страница-заглушка (Capacitor требует `webDir`), `mobile/www/offline.html` — экран «Нет связи с интернетом»: знак WeSetup, текст «Проверьте Wi-Fi или мобильный интернет», кнопка «Повторить» (`location.href = "https://wesetup.ru/mini?src=app"`), фон `#0b1024`, кнопка `#5566f6`, шрифт системный, всё встроено в файл.

- [ ] **Step 3: Платформы, иконки, заставка**

```bash
cd C:/wt/mobile-apps/mobile && npx cap add android && npx cap add ios
npx capacitor-assets generate --iconBackgroundColor "#0b1024" --splashBackgroundColor "#0b1024"
npx cap sync
```

Иконку 1024×1024 и заставку 2732×2732 собрать из `public/icons/icon-512.png` и фирменного знака (скрипт на Playwright/`sharp` в `mobile/scripts/make-assets.ts`, фон `#0b1024`, знак по центру, поля ≥ 20 %).

- [ ] **Step 4: Разрешения и тексты**

Android `mobile/android/app/src/main/AndroidManifest.xml`: `INTERNET`, `CAMERA`, `RECORD_AUDIO`, `POST_NOTIFICATIONS`; `<queries>` для `mailto`, `tel`, `https`.
iOS `mobile/ios/App/App/Info.plist`:
- `NSCameraUsageDescription` = «Камера нужна, чтобы фотографировать результат работы и сканировать штрихкоды в журналах»;
- `NSPhotoLibraryUsageDescription` = «Доступ к фото нужен, чтобы прикрепить снимок к записи журнала»;
- `NSMicrophoneUsageDescription` = «Микрофон нужен для голосового ввода в журналы»;
- `NSSpeechRecognitionUsageDescription` = «Распознавание речи превращает сказанное в текст записи»;
- `ITSAppUsesNonExemptEncryption` = `false` (только HTTPS — освобождение).
- `UIDeviceFamily` только iPhone (`TARGETED_DEVICE_FAMILY = 1` в проекте Xcode) — чтобы не требовались скриншоты iPad.

- [ ] **Step 5: Локальная сборка Android**

```bash
cd C:/wt/mobile-apps/mobile/android && set ANDROID_HOME=C:\Android\sdk && gradlew.bat assembleDebug
```

Expected: `BUILD SUCCESSFUL`, APK в `app/build/outputs/apk/debug/`. Без `google-services.json` плагин Firebase падает при сборке — для отладочной сборки положить заглушку из шаблона Firebase (`mobile/android/app/google-services.json` в `.gitignore`, реальный подставляет CI).

- [ ] **Step 6: Закоммитить**

```bash
git add mobile .gitignore
git commit -m "Приложение: проект Capacitor для Android и iOS, иконки, заставка, экран «нет связи»"
```

---

### Task 9: Нативные доработки: печать, голос, ссылки

**Files:**
- Create: `mobile/android/app/src/main/java/ru/wesetup/app/WebPrintPlugin.java`, `mobile/ios/App/App/WebPrintPlugin.swift`
- Modify: `mobile/android/app/src/main/java/ru/wesetup/app/MainActivity.java` (регистрация плагина), `mobile/ios/App/App/AppDelegate.swift` / `MainViewController` (регистрация), `mobile/android/app/src/main/AndroidManifest.xml` (App Links), `mobile/ios/App/App/App.entitlements` (Associated Domains, Push), `src/components/journals/voice-input.tsx`, `src/app/(auth)/login/login-client.tsx`

**Interfaces:**
- Produces: плагин `WebPrint` с методами `print({ jobName: string }): Promise<void>` и `openSettings(): Promise<void>` (используется `getNativeBridge().print/openAppSettings` из Task 7 — если в Task 7 выбран другой способ открыть настройки, метод `openSettings` не добавлять).

- [ ] **Step 1: Android WebPrint**

```java
// mobile/android/app/src/main/java/ru/wesetup/app/WebPrintPlugin.java
package ru.wesetup.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Системная печать текущей страницы: во встроенном браузере window.print() ничего не делает. */
@CapacitorPlugin(name = "WebPrint")
public class WebPrintPlugin extends Plugin {
  @PluginMethod
  public void print(PluginCall call) {
    String jobName = call.getString("jobName", "WeSetup");
    getActivity().runOnUiThread(() -> {
      PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
      pm.print(jobName, getBridge().getWebView().createPrintDocumentAdapter(jobName), new PrintAttributes.Builder().build());
      call.resolve();
    });
  }

  @PluginMethod
  public void openSettings(PluginCall call) {
    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getContext().startActivity(intent);
    call.resolve();
  }
}
```

В `MainActivity.onCreate` до `super.onCreate`: `registerPlugin(WebPrintPlugin.class);`

- [ ] **Step 2: iOS WebPrint**

```swift
// mobile/ios/App/App/WebPrintPlugin.swift
import Capacitor
import UIKit

@objc(WebPrintPlugin)
public class WebPrintPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "WebPrintPlugin"
  public let jsName = "WebPrint"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
  ]

  @objc func print(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      guard let webView = self.bridge?.webView else { return call.reject("Нет страницы для печати") }
      let info = UIPrintInfo(dictionary: nil)
      info.jobName = call.getString("jobName") ?? "WeSetup"
      info.outputType = .general
      let controller = UIPrintInteractionController.shared
      controller.printInfo = info
      controller.printFormatter = webView.viewPrintFormatter()
      controller.present(animated: true) { _, _, _ in call.resolve() }
    }
  }

  @objc func openSettings(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
      call.resolve()
    }
  }
}
```

Регистрация локального плагина — по документации установленной версии Capacitor (в Capacitor 6+ — подкласс `CAPBridgeViewController` с `override func capacitorDidLoad() { bridge?.registerPluginInstance(WebPrintPlugin()) }` и указание этого класса в `Main.storyboard`).

- [ ] **Step 3: Универсальные ссылки**

Android — в `<activity>` `MainActivity` intent-filter с `android:autoVerify="true"`, `scheme="https"`, `host="wesetup.ru"`, `pathPrefix` для каждого пути из `APP_LINK_PATHS` (Task 6) без `*`.
iOS — `App.entitlements`: `com.apple.developer.associated-domains` = `applinks:wesetup.ru`, `webcredentials:wesetup.ru`; `aps-environment` = `production`.

- [ ] **Step 4: Голосовой ввод**

В `src/components/journals/voice-input.tsx`: в начале обработчика нажатия — если `getNativeBridge()?.plugin("SpeechRecognition")` есть, использовать его:

```ts
const speech = getNativeBridge()?.plugin("SpeechRecognition");
if (speech) {
  const perm = (await speech.requestPermissions()) as { speechRecognition?: string };
  if (perm.speechRecognition !== "granted") {
    toast.error("Разрешите микрофон и распознавание речи в настройках телефона");
    return;
  }
  const res = (await speech.start({ language: "ru-RU", maxResults: 1, partialResults: false, popup: true })) as { matches?: string[] };
  const text = res.matches?.[0];
  if (text) onResult(text);   // имя колбэка — как у существующего компонента
  return;
}
```

Иначе — существующая логика `SpeechRecognition` браузера. Имена параметров плагина сверить с его README установленной версии.

- [ ] **Step 5: Вход по ключу на Android**

В `login-client.tsx` кнопку входа по ключу скрывать, если `getNativeBridge()?.platform === "android"` (WebView Android не гарантирует WebAuthn). На iOS — оставить.

- [ ] **Step 6: Сборка и проверка в эмуляторе Android**

```bash
cd C:/wt/mobile-apps/mobile && npx cap sync android && cd android && gradlew.bat assembleDebug
C:\Android\sdk\emulator\emulator.exe -avd <имя из `emulator -list-avds`, создать Pixel API 34 при отсутствии> &
C:\Android\sdk\platform-tools\adb.exe install -r app\build\outputs\apk\debug\app-debug.apk
```

Для проверки на стенде временно собрать с `server.url = "http://10.0.2.2:3021/mini?src=app"` и `cleartext: true` (НЕ коммитить). Пройти: вход повара по телефону и паролю; оболочка с нижним меню; печать документа гигиены (системное окно печати); «Скачать Excel» на `/reports` под владельцем (лист «Поделиться»); голосовой ввод (разрешение, распознанный текст); фото к задаче (камера/галерея); `mailto:` открывает почту; «назад» по экранам и сворачивание на домашнем; выключить сеть в эмуляторе и перезапустить → экран «Нет связи». Снимки — в `C:\Users\Yaroslav\AppData\Local\Temp\…\scratchpad\mobile-android\`.

- [ ] **Step 7: Закоммитить**

```bash
git add mobile src/components/journals/voice-input.tsx "src/app/(auth)/login/login-client.tsx"
git commit -m "Приложение: печать, голосовой ввод, универсальные ссылки; проверено в эмуляторе Android"
```

---

### Task 10: Экран «Обновите приложение»

**Files:**
- Create: `src/app/mini/_components/app-update-gate.tsx`
- Modify: `src/app/mini/_components/mini-app-shell.tsx`, `.env.shared` (`MOBILE_APP_MIN_VERSION=""`)

**Interfaces:**
- Consumes: `parseMobileAppUserAgent`, `compareAppVersion` (Task 1).

- [ ] **Step 1: Реализация.** Серверная часть оболочки читает `headers().get("user-agent")`; если это приложение и `MOBILE_APP_MIN_VERSION` задана и `compareAppVersion(version, min) < 0` — вместо содержимого страницы рендерит `<AppUpdateGate platform=… />`: «Обновите приложение», «Эта версия устарела. Обновите WeSetup в магазине — это займёт минуту», кнопка на магазин (`https://apps.apple.com/app/id<APPLE_APP_ID>` / `https://play.google.com/store/apps/details?id=ru.wesetup.app`; `APPLE_APP_ID` — из окружения, начальник вписывает после создания приложения). Без переменной — ничего не проверять.
- [ ] **Step 2: Проверить на стенде** (User-Agent `WeSetupApp/0.9.0 (android)` при `MOBILE_APP_MIN_VERSION=1.0.0` → экран обновления; `1.0.0` → обычная работа) и закоммитить: `git commit -m "Приложение: просьба обновиться, если версия устарела"`.

---

### Task 11: Автоматическая сборка и выпуск

**Files:**
- Create: `.github/workflows/mobile-release.yml`, `mobile/ios/App/fastlane/Fastfile`, `mobile/ios/App/fastlane/Appfile`, `mobile/ios/App/Gemfile`, `docs/mobile/secrets.md`

Секреты GitHub (добавляет владелец репозитория по `docs/mobile/secrets.md`): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `GOOGLE_SERVICES_JSON_BASE64`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`, `GOOGLE_SERVICE_INFO_PLIST_BASE64`.

- [ ] **Step 1: Ключ загрузки Android** (один раз, локально, в `C:\Users\Yaroslav\wesetup-android\`, не в репозитории):

```bash
keytool -genkeypair -v -keystore upload.jks -alias wesetup-upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=WeSetup, O=WeSetup, C=RU"
```

Пароль сгенерировать случайный, отдать владельцу вместе с файлом; base64 файла — в секрет `ANDROID_KEYSTORE_BASE64`. В `docs/mobile/secrets.md` — где лежит копия и почему её нельзя терять.

- [ ] **Step 2: Workflow**

```yaml
# .github/workflows/mobile-release.yml
name: Выпуск приложений
on:
  workflow_dispatch:
    inputs:
      platform:
        description: "Что собрать"
        type: choice
        options: [both, android, ios]
        default: both
      track:
        description: "Куда отправить Android"
        type: choice
        options: [internal, none]
        default: internal

jobs:
  android:
    if: inputs.platform != 'ios'
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: mobile } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }
      - run: npm ci
      - name: Номер версии
        run: echo "BUILD_NUMBER=${{ github.run_number }}" >> $GITHUB_ENV
      - name: Секреты сборки
        run: |
          echo "${{ secrets.GOOGLE_SERVICES_JSON_BASE64 }}" | base64 -d > android/app/google-services.json
          echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > android/app/upload.jks
      - run: npx cap sync android
      - name: Подписанный AAB
        working-directory: mobile/android
        run: ./gradlew bundleRelease -PversionCode=$BUILD_NUMBER
        env:
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with:
          name: wesetup-android-${{ github.run_number }}
          path: mobile/android/app/build/outputs/bundle/release/app-release.aab
      - name: Внутреннее тестирование Google Play
        if: inputs.track == 'internal'
        uses: r0adkll/upload-google-play@v1
        with:
          serviceAccountJsonPlainText: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}
          packageName: ru.wesetup.app
          releaseFiles: mobile/android/app/build/outputs/bundle/release/app-release.aab
          track: internal
          status: completed

  ios:
    if: inputs.platform != 'android'
    runs-on: macos-latest
    defaults: { run: { working-directory: mobile } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - name: Секреты сборки
        run: |
          echo "${{ secrets.GOOGLE_SERVICE_INFO_PLIST_BASE64 }}" | base64 -d > ios/App/App/GoogleService-Info.plist
          echo "${{ secrets.ASC_KEY_P8_BASE64 }}" | base64 -d > ios/App/asc_key.p8
      - run: npx cap sync ios
      - name: Сборка и TestFlight
        working-directory: mobile/ios/App
        run: bundle install && bundle exec fastlane beta
        env:
          BUILD_NUMBER: ${{ github.run_number }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
```

В `mobile/android/app/build.gradle` — `signingConfigs.release` из переменных окружения выше и `versionCode` из свойства `versionCode` (по умолчанию 1), `versionName` из `mobile/package.json`.

- [ ] **Step 3: Fastlane**

```ruby
# mobile/ios/App/fastlane/Fastfile
default_platform(:ios)

platform :ios do
  lane :beta do
    api_key = app_store_connect_api_key(
      key_id: ENV["ASC_KEY_ID"],
      issuer_id: ENV["ASC_ISSUER_ID"],
      key_filepath: "asc_key.p8",
    )
    increment_build_number(build_number: ENV["BUILD_NUMBER"], xcodeproj: "App.xcodeproj")
    build_app(
      workspace: "App.xcworkspace",
      scheme: "App",
      export_method: "app-store",
      xcargs: "-allowProvisioningUpdates DEVELOPMENT_TEAM=#{ENV['APPLE_TEAM_ID']}",
      export_options: { signingStyle: "automatic", teamID: ENV["APPLE_TEAM_ID"] },
    )
    upload_to_testflight(api_key: api_key, skip_waiting_for_build_processing: true)
  end
end
```

```ruby
# mobile/ios/App/fastlane/Appfile
app_identifier("ru.wesetup.app")
```

```ruby
# mobile/ios/App/Gemfile
source "https://rubygems.org"
gem "fastlane"
```

Автоматическая подпись на облачном Mac с ключом API требует роли ключа «Admin» или «App Manager» с доступом к сертификатам — указать это в инструкции (Task 13, раздел Apple).

- [ ] **Step 4: Проверка.** Без секретов владельца workflow не пройдёт — проверить синтаксис (`actionlint`, если установлен, иначе загрузить в ветку и посмотреть разбор в Actions) и что job `android` доходит до шага подписи. Полная проверка — после того как начальник выдаст ключи (Task 14).
- [ ] **Step 5: Закоммитить:** `git commit -m "Приложение: сборка и выпуск одной кнопкой — Android в Google Play, iOS в TestFlight"`.

---

### Task 12: Скриншоты и тексты для магазинов

**Files:**
- Create: `.agent/tasks/mobile-apps-2026-09/e2e/store-screenshots.ts`, `docs/mobile/screenshots/ios/*.png`, `docs/mobile/screenshots/android/*.png`, `docs/mobile/store-listing.md`, `docs/mobile/feature-graphic.png` (1024×500), `docs/mobile/icon-512.png`

- [ ] **Step 1: Скриншоты со стенда** под тестовой компанией, с User-Agent приложения: iPhone 6.9″ — 1320×2868 (`viewport 440×956`, `deviceScaleFactor 3`); Android — 1080×2400 (`412×915`, `deviceScaleFactor` ≈2.625). 6 экранов: домашний руководителя (`/dashboard`), «Сегодня» повара (`/mini/today`), документ гигиены (карточки), замер холодильников, «Все разделы», уведомления. Данные стенда подчистить от «ZZ»-мусора и почт вместо имён перед съёмкой.
- [ ] **Step 2: `store-listing.md`** — готовые тексты: название «WeSetup» (≤30), подзаголовок iOS (≤30) «Журналы СанПиН и ХАССП», короткое описание Google (≤80), полное описание (≤4000, абзацы: что это, для кого, что умеет, как начать), ключевые слова iOS (≤100, через запятую), категория (Бизнес), адреса: поддержка `https://wesetup.ru`, политика `https://wesetup.ru/privacy`, удаление аккаунта `https://wesetup.ru/delete-account`. Проверить длины скриптом.
- [ ] **Step 3: Закоммитить:** `git commit -m "Приложение: скриншоты и тексты карточек для магазинов"`.

---

### Task 13: Инструкция для начальника

**Files:**
- Create: `docs/mobile/00-overview.md`, `01-apple-developer.md`, `02-app-store-connect.md`, `03-google-play-console.md`, `04-firebase.md`, `05-handoff.md`, `06-store-listings.md`, `07-privacy-forms.md`, `08-review.md`, `09-release.md`, `10-rejections.md`, `11-updates.md`; веб-страница (Artifact).

- [ ] **Step 1: Проверить актуальность требований магазинов** (WebFetch официальных страниц Apple Developer Program enrollment, App Store Connect API keys, App Store Review Guidelines 4.2 и 5.1.1(v), Google Play Console developer account verification, Data safety, testing requirements for new personal accounts, Firebase Cloud Messaging setup) — зафиксировать в `00-overview.md` дату сверки и ссылки.
- [ ] **Step 2: Написать разделы** — пошагово, для не-программиста, по схеме «раздел консоли → поле → что вписать/выбрать → зачем». В каждом разделе: что понадобится заранее, сколько времени, типичные ошибки. `05-handoff.md` — таблица: значение → где взять → кому передать (Team ID, ключ API App Store Connect (Issuer ID, Key ID, файл .p8), ключ APNs (.p8, Key ID) — загрузить в Firebase, `GoogleService-Info.plist`, `google-services.json`, сервисный аккаунт Firebase (JSON) — на сервер `FIREBASE_SERVICE_ACCOUNT_JSON`, сервисный аккаунт Google Play (JSON), отпечаток SHA-256 ключа подписи приложения из Play Console → `ANDROID_CERT_SHA256`, Apple App ID → `APPLE_APP_ID`). `07-privacy-forms.md` — готовые ответы: собираемые данные (имя, телефон, почта, фото, идентификатор устройства для push; цель — работа приложения; не для рекламы; шифруются при передаче; удаление по запросу — страница `/delete-account`). `08-review.md` — тестовый вход (компания «Кафе «Демо»» на проде, отдельный аккаунт с телефоном и паролем, создаёт разработчик) и заметка для Apple: «Приложение для сотрудников предприятий питания… Нативные функции: push-уведомления о задачах, печать журналов через системную печать, голосовой ввод, камера для фото и штрихкодов, универсальные ссылки из QR-плакатов».
- [ ] **Step 3: Веб-страница.** Загрузить навык `artifact-design`, собрать одну страницу из `docs/mobile/*.md` (оглавление, отметки «сделано» по шагам с сохранением в `localStorage`, кнопки «скопировать» у готовых текстов), опубликовать через Artifact (приватно), ссылку отдать владельцу.
- [ ] **Step 4: Закоммитить** `docs/mobile/*.md`: `git commit -m "Инструкция для начальника: регистрация в App Store и Google Play, Firebase, карточки, анкеты, выпуск"`.

---

### Task 14: Демо-вход для проверяющих, проверка и выпуск

- [ ] **Step 1: Демо-компания на проде.** Только с согласия владельца: создать компанию «Кафе «Демо»» с заполненными журналами и аккаунт проверяющего (телефон + пароль) — через интерфейс регистрации, без прямых записей в базу. Данные входа — в `08-review.md` (не в git: в `docs/mobile/` оставить заглушку, данные — только в веб-странице для начальника).
- [ ] **Step 2: Полный прогон сайта с User-Agent приложения** — `tg-parity.ts` с `userAgent` приложения под `ownerA`, `headA`, `cookA`: все ~170 страниц в оболочке, ничего не шире экрана, без 500.
- [ ] **Step 3: Когда начальник выдаст ключи** (по `05-handoff.md`): владелец репозитория заносит секреты GitHub, на сервер — `FIREBASE_SERVICE_ACCOUNT_JSON`, `APPLE_TEAM_ID`, `ANDROID_CERT_SHA256`, `APPLE_APP_ID`; запуск «Выпуск приложений»; проверить: AAB во внутреннем тестировании, сборка в TestFlight; на телефоне владельца — вход, push (отправить тестовое напоминание с панели контроля), ссылка из бота и с QR-плаката открывает приложение, печать, скачивание отчёта, голос, камера.
- [ ] **Step 4: Что нового и CHANGES.md.** Дописать в `src/lib/whats-new-notes.ts` заметку о приложениях (в категорию «Интерфейс» или новую «Приложения» — иконку добавить в `CATEGORY_ICONS` в `whats-new-modal.tsx`), записать сделанное в `.agent/tasks/ux-sweep-2026-09/CHANGES.md` в формате «было. Теперь стало».
- [ ] **Step 5: Дата на сайте** (`MOBILE_APP_LAUNCH_DATE` в `src/components/public/app-stores-teaser.tsx`) — менять только по решению владельца; после выхода в магазины — заменить заглушку на настоящие ссылки на магазины.
