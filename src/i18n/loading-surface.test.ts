/* eslint-disable react/no-children-prop -- Typed provider children in a .ts test. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import Dashboard from "@/app/(dashboard)/dashboard/loading";
import Bonuses from "@/app/(dashboard)/bonuses/loading";
import Control from "@/app/(dashboard)/control-board/loading";
import Journals from "@/app/(dashboard)/journals/loading";
import Journal from "@/app/(dashboard)/journals/[code]/loading";
import Document from "@/app/(dashboard)/journals/[code]/documents/[docId]/loading";
import Progress from "@/app/(dashboard)/journals-progress/loading";
import Reports from "@/app/(dashboard)/reports/loading";
import Settings from "@/app/(dashboard)/settings/loading";
import Team from "@/app/(dashboard)/team/loading";
import Verifications from "@/app/(dashboard)/verifications/loading";
import Root from "@/app/root/loading";
import { loadMessages } from "./messages";

const routes: [ComponentType, string][] = [
  [Dashboard, "/dashboard"], [Dashboard, "/dashboard/audit"], [Bonuses, "/bonuses"],
  [Control, "/control-board"], [Journals, "/journals"], [Journal, "/journals/health_hygiene"],
  [Journal, "/journals/health_hygiene/documents"], [Document, "/journals/health_hygiene/documents/example"],
  [Document, "/journals/health_hygiene/documents/example/review"], [Progress, "/journals-progress"],
  [Reports, "/reports"], [Reports, "/reports/new"], [Settings, "/settings"],
  [Settings, "/settings/organization"], [Team, "/team"], [Verifications, "/verifications"], [Root, "/root"],
];

test("route loading screens render accessible translated status copy for root and nested paths", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const [Component, pathname] of routes) {
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
        locale, messages: { loadingSurfaces: messages.loadingSurfaces }, timeZone: "Europe/Moscow", onError: error => { throw error; },
        children: createElement(PathnameContext.Provider, { value: pathname, children: createElement(Component) }),
      }));
      assert.match(html, /aria-busy="true"|role="status"/, `${locale}: ${pathname}`);
      assert.ok(Object.values(messages.loadingSurfaces).some(text => html.includes(text)), `${locale}: ${pathname} missing loading copy`);
      if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u, `${locale}: ${pathname}`);
    }
  }
});
