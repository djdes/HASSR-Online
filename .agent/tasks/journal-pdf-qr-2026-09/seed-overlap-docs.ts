/**
 * Одноразовая организация «QR overlap test» с НАСТОЯЩИМИ документами всех
 * журналов каталога на локальной базе стенда — с раздутым числом строк
 * (многостраничные полные листы: главный риск наложения QR).
 *
 *   npx tsx --env-file=.env .agent/tasks/journal-pdf-qr-2026-09/seed-overlap-docs.ts create
 *   npx tsx --env-file=.env .agent/tasks/journal-pdf-qr-2026-09/seed-overlap-docs.ts delete
 *
 * `create` печатает `ORG=<id>` и `DOCS=<id,id,...>` для check-qr-overlap.ts.
 */
import { db } from "@/lib/db";
import { SAMPLE_JOURNAL_CODES, SAMPLE_USERS, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";

const ORG_NAME = "QR overlap test (удалить)";
const USERS = 45;
const ROW_TARGET = 70;

function inflateArrays(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => inflateArrays(item, depth + 1));
    const objects = items.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    if (objects.length === items.length && items.length > 0 && items.length < ROW_TARGET && depth <= 2) {
      const out = [...items];
      let copy = 1;
      while (out.length < ROW_TARGET) {
        for (const item of items) {
          if (out.length >= ROW_TARGET) break;
          const clone = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
          if (typeof clone.id === "string") clone.id = `${clone.id}-c${copy}`;
          out.push(clone);
        }
        copy += 1;
      }
      return out;
    }
    return items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inflateArrays(v, depth + 1)]));
  }
  return value;
}

async function create() {
  const org = await db.organization.create({ data: { name: ORG_NAME, type: "restaurant", inn: "7700000000", address: "г. Тест, ул. Длинная, д. 1" } });
  const users = [];
  for (let i = 0; i < USERS; i += 1) {
    const sample = SAMPLE_USERS[i % SAMPLE_USERS.length];
    users.push(
      await db.user.create({
        data: {
          organizationId: org.id,
          email: `qr-overlap-${org.id}-${i}@example.test`,
          name: i < SAMPLE_USERS.length ? sample.name : `${sample.name.split(" ")[0]}-${i} ${sample.name.split(" ").slice(1).join(" ")}`,
          passwordHash: "x",
          role: sample.role,
          positionTitle: sample.positionTitle,
        },
      }),
    );
  }
  const idMap = new Map(SAMPLE_USERS.map((u, i) => [u.id, users[i].id]));
  const remapIds = (json: string) => json.replace(/sample-user-\d+/g, (id) => idMap.get(id) ?? users[0].id);

  const docIds: string[] = [];
  for (const code of SAMPLE_JOURNAL_CODES) {
    const template = await db.journalTemplate.findFirst({ where: { code } });
    if (!template) {
      console.warn("нет шаблона", code);
      continue;
    }
    const sample = buildJournalSampleInput(code);
    const config = inflateArrays(JSON.parse(remapIds(JSON.stringify(sample.document.config ?? {}))));
    const doc = await db.journalDocument.create({
      data: {
        organizationId: org.id,
        templateId: template.id,
        title: sample.document.title,
        config: config as object,
        dateFrom: sample.document.dateFrom,
        dateTo: sample.document.dateTo,
        status: "active",
        responsibleUserId: users[0].id,
      },
    });
    // Строки-записи (гигиена, здоровье, климат, холодильники): каждому из
    // USERS сотрудников — записи «его» образцового сотрудника.
    const entries = sample.document.entries as Array<{ employeeId: string; date: Date; data: unknown }>;
    if (entries.length > 0) {
      const perUser = code === "hygiene" || code === "health_check";
      const rows: { documentId: string; employeeId: string; date: Date; data: object }[] = [];
      const seen = new Set<string>();
      const targets = perUser ? users : [users[0]];
      targets.forEach((user, index) => {
        const sampleId = SAMPLE_USERS[index % SAMPLE_USERS.length].id;
        for (const entry of entries) {
          if (perUser && entry.employeeId !== sampleId) continue;
          const employeeId = perUser ? user.id : (idMap.get(entry.employeeId) ?? users[0].id);
          const key = `${employeeId}|${entry.date.toISOString()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({ documentId: doc.id, employeeId, date: entry.date, data: JSON.parse(remapIds(JSON.stringify(entry.data ?? {}))) });
        }
      });
      await db.journalDocumentEntry.createMany({ data: rows });
    }
    docIds.push(doc.id);
  }
  console.log(`ORG=${org.id}`);
  console.log(`DOCS=${docIds.join(",")}`);
}

async function remove() {
  const orgs = await db.organization.findMany({ where: { name: ORG_NAME }, select: { id: true } });
  for (const { id } of orgs) {
    await db.journalDocumentEntry.deleteMany({ where: { document: { organizationId: id } } });
    await db.journalDocument.deleteMany({ where: { organizationId: id } });
    await db.user.deleteMany({ where: { organizationId: id } });
    await db.organization.delete({ where: { id } });
    console.log("удалена", id);
  }
}

(process.argv[2] === "delete" ? remove() : create())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
