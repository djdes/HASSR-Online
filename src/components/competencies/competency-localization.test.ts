/* eslint-disable react/no-children-prop -- React 19 provider typings require children in props. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { CompetencyCell } from "./competency-cell";
import { COMPETENCY_LEVELS, COMPETENCY_SKILLS, competencyPositionLabel, saveCompetencyLevel } from "./competency-presentation";
import { loadMessages } from "@/i18n/messages";
import type { MessageContract } from "@/i18n/message-contract";

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

test("competency cells render all skills and levels in each language with accessible names", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages: messages as MessageContract, namespace: "competenciesManagement", onError: error => { throw error; } });
    for (const skill of COMPETENCY_SKILLS) for (const level of COMPETENCY_LEVELS) {
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
        locale, messages, timeZone: "Europe/Moscow", onError: error => { throw error; },
        children: createElement(AppRouterContext.Provider, {
          value: router, children: createElement(CompetencyCell, { userId: "user-original", userName: "Anvar Example", skill, level }),
        }),
      }));
      assert.ok(html.includes(`title="${t("levelTitle", { level })}"`));
      assert.ok(html.includes(t("cellLabel", { name: "Anvar Example", skill: t(`skills.${skill}`), level: t(`levels.${level}`) })));
      assert.ok(html.includes('aria-busy="false"'));
      if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
    }
    assert.ok(t("levelsSummary", { untrained: t("levels.0"), basic: t("levels.1"), intermediate: t("levels.2"), advanced: t("levels.3") }).includes(t("levels.3")));
    const roles = messages.competenciesManagement.roles;
    assert.equal(competencyPositionLabel({ name: "User", role: "owner" }, roles), roles.manager);
    assert.equal(competencyPositionLabel({ name: "User", role: "technologist" }, roles), roles.head_chef);
    assert.equal(competencyPositionLabel({ name: "User", role: "cook", positionTitle: "Личный титул" }, roles), "Личный титул");
    assert.equal(competencyPositionLabel({ name: "User", role: "cook", positionTitle: "Legacy title", jobPosition: { name: "O‘zbekcha lavozim", categoryKey: "staff" } }, roles), "O‘zbekcha lavozim");
  }
});

test("competency requests retain IDs, skill codes and numeric levels, and reject HTTP failures", async () => {
  for (const skill of COMPETENCY_SKILLS) for (const level of COMPETENCY_LEVELS) {
    const payload = { userId: "user-original-id", skill, level };
    const result = await saveCompetencyLevel(payload, async (url, init) => {
      assert.equal(url, "/api/competencies");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), payload);
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    assert.deepEqual(result, { ok: true });
  }
  const payload = { userId: "user-id", skill: "haccp", level: 2 };
  for (const [status, error, expected] of [
    [401, "Не авторизован", "unauthorized"], [403, "Это действие доступно руководителю", "forbidden"],
    [400, "Некорректные данные", "invalidData"], [404, "Сотрудник не найден", "userNotFound"],
    [500, "Database details", "saveFailed"],
  ] as const) {
    assert.deepEqual(await saveCompetencyLevel(payload, async () => new Response(JSON.stringify({ error }), { status })), { ok: false, error: expected });
  }
  assert.deepEqual(await saveCompetencyLevel(payload, async () => { throw new Error("Network unavailable"); }), { ok: false, error: "saveFailed" });
  assert.deepEqual(await saveCompetencyLevel(payload, async () => new Response("not JSON", { status: 403 })), { ok: false, error: "forbidden" });
});
