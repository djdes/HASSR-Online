// Живая проверка после проверки 3 (NIT-1): вход по QR («Пригласить по ссылке» → /join/<токен>) на
// занятых местах — 402, текст для приглашённого называет лимит тарифа и просьбу к руководителю.
// Создаёт временные ссылки EmployeeJoinToken и удаляет их в конце; сотрудники не создаются.
// Нужны next dev на :3000 и локальная БД.
// Запуск: DATABASE_URL=... npx tsx .agent/tasks/tariffs-limits-ui-2026-10/raw/join-qr-check.ts
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { hashInviteToken } from "@/lib/invite-tokens";

async function main() {
  const ids: string[] = [];
  let ok = true;
  try {
    for (const [owner, expect] of [
      ["lim-std-full", /На тарифе организации «Стандарт» — до 25 сотрудников на точку, все места заняты\. Попросите руководителя перейти на «Премиум»/],
      ["lim-prem-full", /На тарифе организации «Премиум» — до 100 сотрудников на точку, все места заняты\. Попросите руководителя связаться с поддержкой/],
    ] as const) {
      const u = await db.user.findUnique({ where: { email: `${owner}@example.test` }, select: { id: true, organizationId: true } });
      if (!u) throw new Error(`нет ${owner}`);
      const raw = crypto.randomBytes(24).toString("base64url");
      const row = await db.employeeJoinToken.create({
        data: { organizationId: u.organizationId, tokenHash: hashInviteToken(raw), createdById: u.id, expiresAt: new Date(Date.now() + 3600_000) },
        select: { id: true },
      });
      ids.push(row.id);
      const before = await db.user.count({ where: { organizationId: u.organizationId } });
      const res = await fetch(`http://localhost:3000/api/join/${raw}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 200) + 20}` },
        body: JSON.stringify({ fullName: "Проверка Входа QR", phone: "+79990001122", jobPositionId: `limpos-${owner}`, password: "TestPass123!" }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      const after = await db.user.count({ where: { organizationId: u.organizationId } });
      const good = res.status === 402 && typeof body.error === "string" && expect.test(body.error) && after === before;
      ok = ok && good;
      console.log(`${good ? "ok  " : "FAIL"} ${owner}: HTTP ${res.status} · tier=${String(body.tier)} · nextTier=${String(body.nextTier)} · «${String(body.error)}» · сотрудников ${before} → ${after}`);
    }
  } finally {
    const removed = await db.employeeJoinToken.deleteMany({ where: { id: { in: ids } } });
    console.log(`\nудалено временных ссылок: ${removed.count}`);
  }
  console.log(`ИТОГ: ${ok ? "текст входа по QR называет лимит и просьбу к руководителю" : "есть отклонения"}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
