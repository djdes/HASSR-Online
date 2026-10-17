// Стенд «Пришла проверка → журнал посещений» (inspection-visits-2026-10).
// СВОИ организации e2e-org-visits (A) и e2e-org-visits-b (B): руководитель,
// заведующая (повар с пресетом head_chef → tasks.verify), повар; QR для
// проверяющего (действующий), отозванный и истёкший токены; чек-листы,
// медкнижки, загруженный ППК; в организации B — посещение со сканом.
// Запуск: npx tsx .agent/tasks/inspection-visits-2026-10/e2e/setup.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { db } from "./db";
import { deriveInspectorQrToken } from "../../../../src/lib/inspector-qr";
import { hashInspectorToken } from "../../../../src/lib/inspector-tokens";
import { LEGAL_VERSION } from "../../../../src/lib/legal-consent";

export const PASSWORD = "E2eTest2026!";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORG_A = "e2e-org-visits";
const ORG_B = "e2e-org-visits-b";

async function pdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText(text, { x: 60, y: 760, size: 18, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

async function org(id: string, name: string) {
  const data = { name, isDemo: false, timezone: "Europe/Moscow", subscriptionPlan: "pro", inn: "7701234500", address: "г Москва, ул Тверская, д 9" };
  return db.organization.upsert({
    where: { id },
    update: data,
    create: { id, type: "restaurant", phone: "+79990000088", subscriptionEnd: new Date(Date.now() + 365 * 86400_000), ...data },
  });
}

async function user(organizationId: string, email: string, name: string, role: string, permissionPreset: string | null, passwordHash: string) {
  const position =
    (await db.jobPosition.findFirst({ where: { organizationId, name: role === "manager" ? "Управляющий" : "Повар" } })) ??
    (await db.jobPosition.create({ data: { organizationId, name: role === "manager" ? "Управляющий" : "Повар", categoryKey: role === "manager" ? "management" : "staff" } }));
  const data = {
    name,
    role,
    permissionPreset,
    organizationId,
    jobPositionId: position.id,
    isActive: true,
    archivedAt: null,
    isRoot: false,
    passwordHash,
    phone: "+79990000088",
    legalVersion: LEGAL_VERSION,
    showWhatsNew: false,
  };
  return db.user.upsert({ where: { email }, update: data, create: { email, ...data } });
}

async function qrToken(organizationId: string, opts: { revoked?: boolean; expired?: boolean; label: string }) {
  const row = await db.inspectorToken.create({
    data: {
      organizationId,
      tokenHash: `tmp-${Math.random()}`,
      label: opts.label,
      periodFrom: new Date("2000-01-01T00:00:00Z"),
      periodTo: new Date("2099-12-31T00:00:00Z"),
      expiresAt: opts.expired ? new Date(Date.now() - 3600_000) : new Date(Date.now() + 30 * 86400_000),
      revokedAt: opts.revoked ? new Date() : null,
    },
  });
  const raw = deriveInspectorQrToken(row.id);
  await db.inspectorToken.update({ where: { id: row.id }, data: { tokenHash: hashInspectorToken(raw) } });
  return { id: row.id, raw };
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const id of [ORG_A, ORG_B]) {
    await db.inspectionVisit.deleteMany({ where: { organizationId: id } });
    await db.inspectorToken.deleteMany({ where: { organizationId: id } });
    await db.checklistInspection.deleteMany({ where: { organizationId: id } });
    await db.checklistTemplate.deleteMany({ where: { organizationId: id } });
    await db.staffCompetency.deleteMany({ where: { organizationId: id } });
    await db.knowledgeDocument.deleteMany({ where: { organizationId: id } });
    await db.ppkRecord.deleteMany({ where: { organizationId: id } });
    await db.auditLog.deleteMany({ where: { organizationId: id } }).catch(() => null);
  }
  const a = await org(ORG_A, "Кафе «Визит»");
  const b = await org(ORG_B, "Столовая «Чужая»");

  const manager = await user(a.id, "visits-manager@e2e.local", "Марина Соколова", "manager", null, passwordHash);
  const headChef = await user(a.id, "visits-head@e2e.local", "Ольга Заведующая", "cook", "head_chef", passwordHash);
  const cook = await user(a.id, "visits-cook@e2e.local", "Пётр Повар", "cook", null, passwordHash);
  const managerB = await user(b.id, "visits-manager-b@e2e.local", "Иван Чужой", "manager", null, passwordHash);

  // Медкнижки: руководитель — действует, заведующая — истекает скоро (тоже «действует»), повар — просрочена.
  await db.staffCompetency.createMany({
    data: [
      { organizationId: a.id, userId: manager.id, skill: "med_book", expiresAt: new Date(Date.now() + 200 * 86400_000) },
      { organizationId: a.id, userId: headChef.id, skill: "med_book", expiresAt: new Date(Date.now() + 10 * 86400_000) },
      { organizationId: a.id, userId: cook.id, skill: "med_book", expiresAt: new Date(Date.now() - 5 * 86400_000) },
    ],
  });

  // Чек-листы: две завершённые проверки за последние дни и черновик (не показывается).
  const template = await db.checklistTemplate.create({ data: { organizationId: a.id, title: "Обход кухни", definition: { sections: [] } } });
  const base = { organizationId: a.id, templateId: template.id, templateVersion: 1, snapshot: {}, createdById: manager.id, createdByName: manager.name };
  await db.checklistInspection.createMany({
    data: [
      {
        ...base,
        title: "Обход кухни — утро",
        status: "completed",
        completedById: manager.id,
        completedByName: "Марина Соколова",
        completedAt: new Date(Date.now() - 2 * 86400_000),
        result: { score: { earned: 18, possible: 20 }, violations: [{ questionId: "q1" }], critical: [], stopped: false, zeroScore: false },
      },
      {
        ...base,
        title: "Санитарный день",
        status: "completed",
        completedById: headChef.id,
        completedByName: "Ольга Заведующая",
        completedAt: new Date(Date.now() - 1 * 86400_000),
        result: { score: { earned: 10, possible: 10 }, violations: [], critical: [], stopped: false, zeroScore: false },
      },
      { ...base, title: "Черновик проверки", status: "draft" },
    ],
  });

  // Загруженный подписанный ППК (KnowledgeDocument вида ppk).
  const ppkPdf = await pdf("PPK signed copy e2e");
  await db.knowledgeDocument.create({
    data: {
      organizationId: a.id,
      title: "ППК подписанная",
      fileName: "ППК подписанная.pdf",
      mimeType: "application/pdf",
      sizeBytes: ppkPdf.length,
      content: Buffer.from(ppkPdf),
      uploadedByName: manager.name,
      kind: "ppk",
    },
  });

  const qr = await qrToken(a.id, { label: "QR e2e" });
  const revoked = await qrToken(a.id, { label: "отозван", revoked: true });
  const expired = await qrToken(a.id, { label: "истёк", expired: true });
  const qrB = await qrToken(b.id, { label: "QR B" });

  // Организация B: посещение со сканом — руководитель A не должен его открыть.
  const scanB = await pdf("Foreign org decision");
  const visitB = await db.inspectionVisit.create({
    data: {
      organizationId: b.id,
      tokenId: qrB.id,
      source: "inspector",
      inspectorName: "Чужой Проверяющий",
      inspectorPosition: "Инспектор",
      authority: "Управление Роспотребнадзора по г. Москве",
      kind: "planned",
      files: { create: [{ organizationId: b.id, fileName: "чужое.pdf", mimeType: "application/pdf", sizeBytes: scanB.length, content: Buffer.from(scanB) }] },
    },
    select: { id: true, files: { select: { id: true } } },
  });

  const state = {
    password: PASSWORD,
    orgA: a.id,
    orgB: b.id,
    users: { manager: manager.email, headChef: headChef.email, cook: cook.email, managerB: managerB.email },
    tokens: { qr: qr.raw, qrId: qr.id, revoked: revoked.raw, expired: expired.raw, qrB: qrB.raw },
    foreignFileId: visitB.files[0].id,
  };
  fs.writeFileSync(path.join(HERE, "state.json"), JSON.stringify(state, null, 2));
  console.log("stand ready", { orgA: a.id, orgB: b.id, qrId: qr.id });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
