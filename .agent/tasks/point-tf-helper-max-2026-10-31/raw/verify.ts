/**
 * e2e-БД (НЕ прод): организация с двумя точками, сотрудники А / Б / без точек.
 * Проверяет на реальном коде и БД:
 *  - «Отправить всем» (превью dryRun, внутренний вызов маршрута) — получатели
 *    гигиены точки А без сотрудника точки Б и наоборот; TasksFlow не вызывается
 *    (baseUrl — локальная заглушка, считаем запросы);
 *  - строки адаптера гигиены из реестра по точке документа;
 *  - справочники «Сетап помощника» сотрудника точки А;
 *  - документы бота Max и проверка точки при записи из мессенджера.
 *
 * DATABASE_URL=<e2e> NEXTAUTH_SECRET=<…> node --import tsx .agent/tasks/point-tf-helper-max-2026-10-31/raw/verify.ts
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/integration-crypto";
import { listJournalFillDocuments } from "@/lib/journal-fill";
import { employeeWorksAtQrPoint, loadQrPointScope } from "@/lib/qr-point-roster";
import { loadHelperCatalog } from "@/lib/setup-helper-catalog.server";
import { listAdapters } from "@/lib/tasksflow-adapters";
import { documentInWorkerScope, loadWorkerPointScope } from "@/lib/worker-point-scope";

const ORG_NAME = "Проверка точек TF 31.10";
const results: string[] = [];
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

let closeStub: () => void = () => undefined;

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  process.env.INTERNAL_TRIGGER_SECRET = "verify-internal-secret";

  // Заглушка TasksFlow: в превью к ней не должно быть ни одного запроса.
  let tfRequests = 0;
  const stub = createServer((req, res) => {
    tfRequests += 1;
    res.writeHead(500).end("stub");
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  closeStub = () => stub.close();
  const stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

  const old = await db.organization.findMany({ where: { name: ORG_NAME }, select: { id: true } });
  for (const org of old) await db.organization.delete({ where: { id: org.id } }).catch(() => undefined);

  const templates = await db.journalTemplate.findMany({ where: { isActive: true }, select: { code: true } });
  const org = await db.organization.create({
    data: {
      name: ORG_NAME,
      type: "cafe",
      perLocationJournals: true,
      // Только гигиена: превью не создаёт документы остальных журналов.
      disabledJournalCodes: templates.map((t) => t.code).filter((code) => code !== "hygiene") as never,
    },
    select: { id: true },
  });
  const pointA = await db.building.create({ data: { organizationId: org.id, name: "Точка А" }, select: { id: true } });
  const pointB = await db.building.create({ data: { organizationId: org.id, name: "Точка Б" }, select: { id: true } });
  const mkUser = (key: string, name: string, role: string, buildingIds: string[]) =>
    db.user.create({
      data: { organizationId: org.id, email: `verify-tf-3110-${key}@verify.local`, name, role, passwordHash: "x", buildingIds },
      select: { id: true, name: true },
    });
  const manager = await mkUser("m", "Проверка Руководитель", "manager", []);
  const anna = await mkUser("a", "Проверка Анна (точка А)", "cook", [pointA.id]);
  const boris = await mkUser("b", "Проверка Борис (точка Б)", "cook", [pointB.id]);
  const vera = await mkUser("v", "Проверка Вера (все точки)", "cook", []);

  const integration = await db.tasksFlowIntegration.create({
    data: {
      organizationId: org.id,
      baseUrl: stubUrl,
      apiKeyEncrypted: encryptSecret("tfk_verify_only"),
      apiKeyPrefix: "tfk_ve",
      webhookSecret: "verify",
      enabled: true,
    },
    select: { id: true },
  });
  let tfId = 9100;
  for (const user of [manager, anna, boris, vera]) {
    await db.tasksFlowUserLink.create({
      data: { integrationId: integration.id, wesetupUserId: user.id, phone: `+7999000${tfId}`, tasksflowUserId: tfId++, source: "manual" },
    });
  }

  // 1. «Отправить всем» — превью.
  const { POST } = await import("@/app/api/integrations/tasksflow/bulk-assign-today/route");
  const response = await POST(
    new Request("http://localhost/api/integrations/tasksflow/bulk-assign-today", {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-trigger": "verify-internal-secret" },
      body: JSON.stringify({ organizationId: org.id, dryRun: true }),
    }),
  );
  const body = (await response.json()) as {
    byJournal?: Array<{ code: string; label: string; recipients?: Array<{ name: string }> }>;
    error?: string;
  };
  check("превью «Отправить всем» отвечает 200", response.status === 200, `${response.status} ${body.error ?? ""}`);
  const hygiene = (body.byJournal ?? []).filter((report) => report.code === "hygiene");
  const names = (suffix: string) =>
    (hygiene.find((report) => report.label.endsWith(suffix))?.recipients ?? []).map((r) => r.name).sort();
  const atA = names("Точка А");
  const atB = names("Точка Б");
  results.push(`  гигиена · Точка А → ${atA.join(", ") || "—"}`);
  results.push(`  гигиена · Точка Б → ${atB.join(", ") || "—"}`);
  check("гигиена точки А: Анна и Вера, без Бориса", atA.includes(anna.name) && atA.includes(vera.name) && !atA.includes(boris.name));
  check("гигиена точки Б: Борис и Вера, без Анны", atB.includes(boris.name) && atB.includes(vera.name) && !atB.includes(anna.name));
  check("TasksFlow в превью не вызывался", tfRequests === 0, `запросов: ${tfRequests}`);

  // 2. Строки адаптера гигиены из реестра.
  const docs = await db.journalDocument.findMany({
    where: { organizationId: org.id, template: { code: "hygiene" }, status: "active" },
    select: { id: true, buildingId: true },
  });
  const docA = docs.find((doc) => doc.buildingId === pointA.id);
  const docB = docs.find((doc) => doc.buildingId === pointB.id);
  check("превью создало документы гигиены обеих точек", Boolean(docA && docB));
  const hygieneAdapter = (await listAdapters()).find((adapter) => adapter.meta.templateCode === "hygiene");
  const adapterDocs = hygieneAdapter ? await hygieneAdapter.listDocumentsForOrg(org.id) : [];
  const rowUsers = (docId?: string) =>
    (adapterDocs.find((doc) => doc.documentId === docId)?.rows ?? []).map((row) => row.responsibleUserId);
  check(
    "строки адаптера, документ точки А: без Бориса",
    !rowUsers(docA?.id).includes(boris.id) && rowUsers(docA?.id).includes(anna.id) && rowUsers(docA?.id).includes(vera.id),
  );
  check("строки адаптера, документ точки Б: без Анны", !rowUsers(docB?.id).includes(anna.id) && rowUsers(docB?.id).includes(boris.id));

  // 3. «Сетап помощник».
  const fpTemplate = await db.journalTemplate.findFirstOrThrow({ where: { code: "finished_product" }, select: { id: true } });
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  for (const [buildingId, dish] of [
    [pointA.id, "Проверка Блюдо А"],
    [pointB.id, "Проверка Блюдо Б"],
    [null, "Проверка Блюдо общее"],
  ] as const) {
    await db.journalDocument.create({
      data: {
        organizationId: org.id,
        templateId: fpTemplate.id,
        buildingId,
        title: `Проверка бракераж ${dish}`,
        status: "active",
        dateFrom: from,
        dateTo: to,
        config: { itemsCatalog: [dish] } as never,
      },
    });
  }
  const catalogA = await loadHelperCatalog(org.id, now, { userId: anna.id });
  check(
    "помощник Анны: сотрудники без Бориса",
    catalogA.staff.includes(anna.name) && catalogA.staff.includes(vera.name) && !catalogA.staff.includes(boris.name),
    catalogA.staff.join(", "),
  );
  check(
    "помощник Анны: блюда точки А и общие, без точки Б",
    catalogA.dishes.includes("Проверка Блюдо А") && catalogA.dishes.includes("Проверка Блюдо общее") && !catalogA.dishes.includes("Проверка Блюдо Б"),
    catalogA.dishes.join(", "),
  );
  const catalogVera = await loadHelperCatalog(org.id, now, { userId: vera.id });
  check("помощник Веры (все точки): все сотрудники и блюда", catalogVera.staff.includes(boris.name) && catalogVera.dishes.includes("Проверка Блюдо Б"));

  // 4. Бот Max.
  const todayKey = now.toISOString().slice(0, 10);
  const scopeAnna = await loadWorkerPointScope(org.id, anna.id);
  const fillDocs = (await listJournalFillDocuments(org.id, "hygiene", todayKey)).filter((doc) => documentInWorkerScope(scopeAnna, doc.buildingId));
  check("Max, Анна: только гигиена точки А", fillDocs.length === 1 && fillDocs[0].buildingId === pointA.id, fillDocs.map((d) => d.building).join(", "));
  const scopeVera = await loadWorkerPointScope(org.id, vera.id);
  check("Max, Вера: без ограничения", scopeVera === null);
  check(
    "запись из мессенджера: Борис в документ точки А — отказ",
    !(await employeeWorksAtQrPoint(await loadQrPointScope(org.id, docA?.buildingId ?? null), boris.id)) && Boolean(docA),
  );
  check(
    "запись из мессенджера: Анна в документ точки А — можно",
    await employeeWorksAtQrPoint(await loadQrPointScope(org.id, pointA.id), anna.id),
  );

  stub.close();
  console.log(results.join("\n"));
  console.log(failed === 0 ? "ALL PASS" : `FAILED: ${failed}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeStub();
    return db.$disconnect();
  });
