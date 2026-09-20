import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMiniShellClearCookie,
  buildMiniShellCookie,
  hasMiniShellCookie,
  isMiniPath,
  miniShellSignInHref,
  shouldDropMiniShell,
  shouldSetMiniShell,
} from "./mini-shell-cookie";

test("на https кука переживает фрейм Telegram", () => {
  const value = buildMiniShellCookie(true);
  assert.match(value, /^ws-shell=mini;/);
  assert.match(value, /SameSite=None/);
  assert.match(value, /Secure/);
  // Сессионная: закрыл приложение — режим забыли.
  assert.ok(!/Max-Age/i.test(value));
});

test("на http SameSite=Lax и без Secure", () => {
  const value = buildMiniShellCookie(false);
  assert.match(value, /SameSite=Lax/);
  assert.ok(!/Secure/.test(value));
});

test("снятие куки обнуляет срок", () => {
  assert.match(buildMiniShellClearCookie(true), /Max-Age=0/);
  assert.match(buildMiniShellClearCookie(false), /Max-Age=0/);
});

test("куку узнаём среди соседей", () => {
  assert.equal(hasMiniShellCookie("a=1; ws-shell=mini; b=2"), true);
  assert.equal(hasMiniShellCookie("ws-shell=mini"), true);
  assert.equal(hasMiniShellCookie("ws-shell=site"), false);
  assert.equal(hasMiniShellCookie("xws-shell=mini"), false);
  assert.equal(hasMiniShellCookie(""), false);
  assert.equal(hasMiniShellCookie(null), false);
});

test("пути мини-приложения отличаются от сайтовых", () => {
  assert.equal(isMiniPath("/mini"), true);
  assert.equal(isMiniPath("/mini/sections"), true);
  assert.equal(isMiniPath("/mini-report"), false);
  assert.equal(isMiniPath("/journals"), false);
});

const base = {
  pathname: "/journals",
  insideTelegram: false,
  standalone: false,
  viewportWidth: 390,
};

test("режим включается в Telegram, в установленном приложении и на экранах /mini", () => {
  assert.equal(shouldSetMiniShell({ ...base, insideTelegram: true }), true);
  assert.equal(shouldSetMiniShell({ ...base, standalone: true }), true);
  assert.equal(shouldSetMiniShell({ ...base, pathname: "/mini" }), true);
  assert.equal(shouldSetMiniShell(base), false);
});

test("на компьютере режим снимается", () => {
  assert.equal(
    shouldDropMiniShell({ ...base, viewportWidth: 1440 }),
    true
  );
});

test("телефон в браузере оболочку сохраняет", () => {
  assert.equal(shouldDropMiniShell({ ...base, viewportWidth: 390 }), false);
});

test("внутри Telegram и в установленном приложении не снимаем никогда", () => {
  assert.equal(
    shouldDropMiniShell({ ...base, viewportWidth: 1440, insideTelegram: true }),
    false
  );
  assert.equal(
    shouldDropMiniShell({ ...base, viewportWidth: 1440, standalone: true }),
    false
  );
});

test("на экранах /mini широкое окно оболочку не снимает", () => {
  assert.equal(
    shouldDropMiniShell({
      ...base,
      pathname: "/mini/sections",
      viewportWidth: 1920,
    }),
    false
  );
});

test("неавторизованного возвращаем на любой свой внутренний адрес", () => {
  assert.equal(miniShellSignInHref("/mini/today"), "/mini?next=%2Fmini%2Ftoday");
  // Страницы кабинета открываются в оболочке приложения (П-3), поэтому
  // возврат на них после входа обязателен.
  assert.equal(
    miniShellSignInHref("/settings/users"),
    "/mini?next=%2Fsettings%2Fusers"
  );
  assert.equal(miniShellSignInHref("/mini"), "/mini");
});

test("чужой адрес и обработчики API в возврат не попадают", () => {
  assert.equal(miniShellSignInHref("//evil.example"), "/mini");
  assert.equal(miniShellSignInHref("https://evil.example"), "/mini");
  assert.equal(miniShellSignInHref("/api/auth/signout"), "/mini");
  assert.equal(miniShellSignInHref(null), "/mini");
});
