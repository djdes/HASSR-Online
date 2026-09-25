// Документы журналов (через API, как руководитель) и одна взятая поваром
// задача — чтобы на снимках были список журналов, бланк и форма заполнения.
// Запуск (dev на 3041): npx tsx .agent/tasks/mini-qr-style-2026-09/e2e/prepare.ts
import fs from "node:fs";
import path from "node:path";

import { db } from "./db";
import { ORG_ID, USERS } from "./fixtures";
import { BASE, HERE, openTelegram } from "./tg";

function monthBounds() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { dateFrom: `${y}-${pad(m + 1)}-01`, dateTo: `${y}-${pad(m + 1)}-${pad(last)}` };
}

async function main() {
  const cook = await db.user.findUniqueOrThrow({ where: { email: USERS.cook.email }, select: { id: true } });
  const existing = await db.journalDocument.findMany({ where: { organizationId: ORG_ID, status: "active" }, select: { id: true, template: { select: { code: true } } } });
  const docs: Record<string, string> = Object.fromEntries(existing.map((d) => [d.template.code, d.id]));

  const manager = await openTelegram({ role: "manager", theme: "light" });
  try {
    for (const code of ["hygiene", "cold_equipment_control", "climate_control", "cleaning", "finished_product"]) {
      if (docs[code]) continue;
      const res = await manager.page.request.post(`${BASE}/api/journal-documents`, {
        data: { ...monthBounds(), force: true, templateCode: code, responsibleUserId: cook.id },
        timeout: 180000,
      });
      const json = (await res.json().catch(() => null)) as { document?: { id: string } } | null;
      console.log("doc", code, res.status(), json?.document?.id ?? JSON.stringify(json).slice(0, 160));
      if (json?.document?.id) docs[code] = json.document.id;
    }
  } finally {
    await manager.close();
  }

  // Повар берёт одну задачу холодильников — это экран «заполнение журнала».
  let claimId = (await db.journalTaskClaim.findFirst({ where: { organizationId: ORG_ID, userId: cook.id, status: "active" }, select: { id: true } }))?.id ?? null;
  if (!claimId) {
    const cookSession = await openTelegram({ role: "cook", theme: "light" });
    try {
      const today = await cookSession.page.request.get(`${BASE}/api/mini/today`);
      const payload = (await today.json()) as { dateKey: string; groups: Array<{ code: string; scopes: Array<{ scopeKey: string; scopeLabel: string; journalCode: string; availability: string }> }> };
      console.log("today groups", payload.groups.map((g) => `${g.code}:${g.scopes.length}`).join(", "));
      const pick =
        payload.groups.find((g) => g.code === "cold_equipment_control")?.scopes.find((s) => s.availability === "available") ??
        payload.groups.flatMap((g) => g.scopes).find((s) => s.availability === "available");
      if (pick) {
        const res = await cookSession.page.request.post(`${BASE}/api/journal-task-claims`, {
          data: { journalCode: pick.journalCode, scopeKey: pick.scopeKey, scopeLabel: pick.scopeLabel, dateKey: payload.dateKey, parentHint: pick.scopeLabel },
        });
        const json = (await res.json().catch(() => null)) as { claim?: { id: string } } | null;
        console.log("claim", res.status(), json?.claim?.id ?? JSON.stringify(json).slice(0, 200));
        claimId = json?.claim?.id ?? null;
      }
    } finally {
      await cookSession.close();
    }
  }

  const state = { docs, claimId };
  fs.writeFileSync(path.join(HERE, "state.json"), JSON.stringify(state, null, 2));
  console.log("state", JSON.stringify(state));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
