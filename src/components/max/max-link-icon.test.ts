/* eslint-disable react/no-children-prop -- Explicit provider children for SSR tests. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import { MaxLinkIcon } from "./max-link-icon";
import { MaxConnectButton } from "./max-connect-button";

/*
 * Значок MAX со значком связи (владелец, 2026-11-22): цепь — привязать MAX к
 * аккаунту, галочка — уже привязан. Везде, где значок ведёт к привязке.
 */

test("MaxLinkIcon: MAX mark plus a chain badge, or a green check when linked", () => {
  const unlinked = renderToStaticMarkup(createElement(MaxLinkIcon, { className: "size-7" }));
  assert.match(unlinked, /data-max-link-icon="unlinked"/);
  assert.match(unlinked, /M508\.211 878\.328/, "official MAX mark");
  assert.match(unlinked, /lucide-link2|lucide-link-2/);
  const linked = renderToStaticMarkup(createElement(MaxLinkIcon, { linked: true, className: "size-7" }));
  assert.match(linked, /data-max-link-icon="linked"/);
  assert.match(linked, /lucide-check/);
  assert.match(linked, /bg-\[#16a34a\]/);
  // Значок отделён от знака кольцом цвета фона и не выходит за коробку кнопки (40px − 28px).
  assert.match(unlinked, /ring-2 ring-\[var\(--app-surface,#fff\)\]/);
  assert.match(unlinked, /-right-\[3px\] -bottom-\[3px\]/);
});

test("MaxConnectButton says what it does in every language", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const linked of [false, true]) {
      const html = renderToStaticMarkup(
        createElement(NextIntlClientProvider, {
          locale,
          messages: { sharedUi: messages.sharedUi },
          timeZone: "Europe/Moscow",
          onError: (error) => {
            throw error;
          },
          children: createElement(MaxConnectButton, { linked }),
        }),
      );
      const label = linked ? messages.sharedUi.maxLink.linked : messages.sharedUi.maxLink.connect;
      assert.ok(label.trim(), `${locale} label`);
      assert.ok(html.includes(`aria-label="${label}"`), `${locale} ${linked}`);
      assert.match(html, new RegExp(`data-max-connect="${linked ? "linked" : "unlinked"}"`));
    }
  }
});

test("the dashboard header knows whether MAX is linked; every «connect MAX» place uses the new icon", () => {
  const layout = readFileSync("src/app/(dashboard)/layout.tsx", "utf8");
  assert.match(layout, /db\.maxIdentity\.findUnique\(\{ where: \{ userId: session\.user\.id \}/);
  assert.match(layout, /maxLinked=\{Boolean\(maxIdentity\)\}/);
  const header = readFileSync("src/components/layout/header.tsx", "utf8");
  assert.match(header, /<MaxConnectButton linked=\{maxLinked\} \/>/);
  for (const file of ["src/app/mini/_components/mini-shell.tsx", "src/components/qr-fill/qr-page-shell.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /<MaxConnectButton dark \/>/, file);
  }
  const button = readFileSync("src/components/max/max-connect-button.tsx", "utf8");
  assert.match(button, /<MaxLinkIcon/);
  assert.doesNotMatch(button, /<MaxIcon/);
  assert.match(readFileSync("src/app/(dashboard)/more/page.tsx", "utf8"), /<MaxLinkIcon /);
});

test("/max/connect shows the bot code next to the link", () => {
  const client = readFileSync("src/components/max/max-connect-client.tsx", "utf8");
  assert.match(client, /\{!request\.command&&request\.code\?<MaxLinkCode code=\{request\.code\}\/>:null\}/);
  assert.match(client, /useTranslations\("sharedUi\.maxLink"\)/);
  const route = readFileSync("src/app/api/max/link/route.ts", "utf8");
  assert.match(route, /url:`https:\/\/max\.ru\/\$\{cfg\.username\}\?start=link_\$\{result\.token\}`,code:result\.code/);
  const bot = readFileSync("src/lib/max/bot.ts", "utf8");
  assert.match(bot, /const linkCode = !identity && event\.kind === "message" \? parseMaxLinkCode\(event\.payload\) : null;/);
});

test("QR fill pages that replace the message set still carry the MAX button labels", () => {
  // `SiteLocaleProvider` заменяет сообщения корня: без `sharedUi` кнопка MAX в шапке QR-страницы показала бы ключ.
  for (const file of ["src/app/equipment-fill/[equipmentId]/page.tsx", "src/app/room-fill/[roomId]/page.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /<SiteLocaleProvider[^>]*pickMessages\(messages, \[[^\]]*"sharedUi"\]\)/, file);
  }
});
