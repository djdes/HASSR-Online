// Живая проверка после проверки 2 (M1): отказ по местам в ИИ-помощнике (add_staff) и во внешнем
// API/MCP (add_employee) называет следующий тариф; в приложении WeSetup — только факт; API — 402.
// Только чтение: все попытки упираются в лимит, сотрудники не создаются (счётчик до/после).
// Строки аудита public_api.call, которые пишет runTool, удаляются в конце.
// Запуск: DATABASE_URL=... NEXTAUTH_SECRET=<любой> npx tsx .agent/tasks/tariffs-limits-ui-2026-10/raw/ai-api-seat-check.ts
import { executeProposedAction } from "@/lib/ai-assistant/actions";
import { db } from "@/lib/db";
import { findTool } from "@/lib/public-api/tools";
import { runTool } from "@/lib/public-api/run-tool";
import type { ApiCallContext } from "@/lib/public-api/context";

async function main() {
  console.info = () => {};
  const startedAt = new Date();
  let ok = true;
  const accounts = [
    { owner: "lim-std-full", expect: /«Премиум»|Premium/ },
    { owner: "lim-prem-full", expect: /по согласованию|by arrangement|kelishuv/ },
  ] as const;
  for (const { owner, expect } of accounts) {
    const u = await db.user.findUnique({
      where: { email: `${owner}@example.test` },
      select: { id: true, name: true, role: true, organizationId: true, organization: { select: { name: true } } },
    });
    if (!u) throw new Error(`нет ${owner}`);
    const input = { fullName: "Проверка ИИ Мест", jobPositionId: `limpos-${owner}` };
    const actor = { id: u.id, name: u.name, role: u.role, isRoot: false };
    const before = await db.user.count({ where: { organizationId: u.organizationId } });
    for (const locale of ["ru", "en", "uz"] as const) {
      const web = await executeProposedAction({ kind: "add_staff", input }, { orgId: u.organizationId, actor, locale }, { audit: false });
      const app = await executeProposedAction({ kind: "add_staff", input }, { orgId: u.organizationId, actor, locale, inApp: true }, { audit: false });
      const webText = web.ok ? "" : web.error;
      const appText = app.ok ? "" : app.error;
      const good = !web.ok && !app.ok && expect.test(webText) && !/Премиум|Premium|согласован|arrangement|kelishuv/.test(appText);
      ok = ok && good;
      console.log(`${good ? "ok  " : "FAIL"} ИИ-помощник ${owner} ${locale}: «${webText}» · в приложении: «${appText}»`);
    }
    const ctx: ApiCallContext = {
      keyId: "seat-check",
      keyName: "Проверка мест",
      access: "write",
      via: "rest",
      orgId: u.organizationId,
      orgName: u.organization.name,
      timezone: "Europe/Moscow",
      actor,
      locale: "ru",
      baseUrl: "http://localhost:3000",
    };
    const tool = findTool("add_employee");
    if (!tool) throw new Error("нет add_employee");
    const res = await runTool(tool, { ...input, allowDuplicate: true }, ctx);
    const apiGood = !res.ok && res.status === 402 && expect.test(res.error);
    ok = ok && apiGood;
    console.log(`${apiGood ? "ok  " : "FAIL"} API add_employee ${owner}: ${res.ok ? "200" : `${res.status} «${res.error}»`}`);
    const after = await db.user.count({ where: { organizationId: u.organizationId } });
    if (after !== before) ok = false;
    console.log(`     сотрудников в организации: ${before} → ${after}`);
  }
  const audit = await db.auditLog.deleteMany({ where: { action: "public_api.call", createdAt: { gte: startedAt } } });
  console.log(`\nудалено строк аудита public_api.call: ${audit.count}`);
  console.log(`ИТОГ: ${ok ? "отказ называет следующий тариф, в приложении — только факт, API — 402" : "есть отклонения"}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
