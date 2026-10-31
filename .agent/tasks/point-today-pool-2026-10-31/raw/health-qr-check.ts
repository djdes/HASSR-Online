/**
 * e2e-БД (НЕ прод): крон «Не отметились по QR» — список по каждой точке.
 * Нужен dev на 3020 с CRON_SECRET=e2e-cron и fixture.json.
 * DATABASE_URL=…/wesetup_e2e node --import tsx .agent/tasks/point-today-pool-2026-10-31/raw/health-qr-check.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";
import { orgTodayKey } from "@/lib/timezone";

const DIR = ".agent/tasks/point-today-pool-2026-10-31/raw";
const out: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const fx = JSON.parse(readFileSync(`${DIR}/fixture.json`, "utf8"));
  const org = await db.organization.update({
    where: { id: fx.orgId },
    data: { healthQrRequired: true },
    select: { timezone: true },
  });
  const todayKey = orgTodayKey(org.timezone || "Europe/Moscow");
  const day = new Date(`${todayKey}T00:00:00.000Z`);
  const template = await db.journalTemplate.findFirstOrThrow({ where: { code: "hygiene" }, select: { id: true } });
  // Документ гигиены на сегодня у каждой точки.
  const docs: Record<string, string> = {};
  for (const [key, buildingId] of [["A", fx.pointA], ["B", fx.pointB]] as const) {
    const existing = await db.journalDocument.findFirst({
      where: { organizationId: fx.orgId, buildingId, status: "active", templateId: template.id, dateFrom: { lte: day }, dateTo: { gte: day } },
      select: { id: true },
    });
    docs[key] =
      existing?.id ??
      (
        await db.journalDocument.create({
          data: { organizationId: fx.orgId, templateId: template.id, buildingId, title: `Проверка 31.10 · гигиена точки ${key}`, status: "active", dateFrom: day, dateTo: day },
          select: { id: true },
        })
      ).id;
  }
  await db.notification.deleteMany({ where: { organizationId: fx.orgId, dedupeKey: { startsWith: `health-qr-missing:${todayKey}` } } });

  const res = await fetch("http://localhost:3020/api/cron/health-qr-missing?force=1", { headers: { authorization: "Bearer e2e-cron", "x-cron-secret": "e2e-cron" } });
  const body = await res.text();
  check("крон отвечает 200", res.ok, `${res.status} ${body.slice(0, 160)}`);

  const notes = await db.notification.findMany({
    where: { organizationId: fx.orgId, dedupeKey: { startsWith: `health-qr-missing:${todayKey}` } },
    select: { dedupeKey: true, title: true, linkHref: true, items: true },
  });
  const forDoc = (id: string) => notes.filter((note) => note.dedupeKey.endsWith(id));
  const labels = (list: typeof notes) => list.flatMap((note) => (note.items as Array<{ label: string }>).map((item) => item.label)).join("\n");
  const a = forDoc(docs.A);
  const b = forDoc(docs.B);
  check("точка А: своё уведомление со ссылкой на её документ", a.length > 0 && a.every((note) => note.linkHref?.endsWith(docs.A)), a.map((n) => n.title).join(" | "));
  check("точка А: в заголовке название точки", a.every((note) => note.title.includes("Точка А")));
  check("точка А: в списке повар А", labels(a).includes(fx.names.cookA));
  check("точка А: повара Б в списке нет", !labels(a).includes(fx.names.cookB));
  check("точка Б: своё уведомление, в нём повар Б", b.length > 0 && labels(b).includes(fx.names.cookB), b.map((n) => n.title).join(" | "));
  check("точка Б: повара А в списке нет", !labels(b).includes(fx.names.cookA));

  writeFileSync(`${DIR}/health-qr-check.txt`, out.join("\n") + "\n");
  const failed = out.filter((line) => line.startsWith("FAIL")).length;
  console.log(failed === 0 ? `ALL PASS (${out.length})` : `FAILED ${failed}/${out.length}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().finally(() => db.$disconnect());
