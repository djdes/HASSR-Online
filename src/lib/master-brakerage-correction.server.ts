import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { MasterCorrectionError, planMasterCorrection, recoverMasterDelivery } from "@/lib/master-brakerage-correction";
import { batchReachedObject, masterBrakerageHistoryInputSchema, type MasterBrakerageHistoryBatch, type MasterBrakerageHistoryInput } from "@/lib/master-brakerage-history";
import { addMasterBrakerageToPool, type MasterBrakerageOrgResult } from "@/lib/master-brakerage";
import { normalizeTypedTime } from "@/lib/finished-product-bulk";
import { isPoolObjectInPool } from "@/lib/master-directory";

/** Ключ получателя: объект пула (организация или её точка), у старых выгрузок — организация. */
function recipientKey(recipient: { organizationId: string; targetId?: string }): string {
  return recipient.targetId ?? recipient.organizationId;
}

export type MasterCorrectionScope = "history" | "all" | "selected";

export async function correctMasterDistribution(params: {
  masterOrgId: string; batchId: string; updatedAt: string;
  input: MasterBrakerageHistoryInput; scope: MasterCorrectionScope; organizationIds: string[];
  userId: string; userName: string;
}) {
  return db.$transaction(async tx => {
    const master = await tx.organization.findUniqueOrThrow({ where: { id: params.masterOrgId }, select: { linkedServiceCode: true, serviceCode: true } });
    const code = master.linkedServiceCode ?? master.serviceCode;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`master-pool:${code ?? params.masterOrgId}`})::bigint)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`master-brakerage:${params.batchId}`})::bigint)`;
    const current = await tx.masterBrakerageBatch.findFirst({ where: { id: params.batchId, organizationId: params.masterOrgId } });
    if (!current) return null;
    if (current.updatedAt.toISOString() !== params.updatedAt) throw new MasterCorrectionError("Выгрузка изменена в другой вкладке. Откройте её из истории заново.");
    const savedResult = current.result && typeof current.result === "object" && !Array.isArray(current.result) ? current.result as Record<string, Prisma.JsonValue> : {};
    const organizations = (Array.isArray(savedResult.organizations) ? structuredClone(savedResult.organizations) : []) as unknown as NonNullable<MasterBrakerageHistoryBatch["result"]>["organizations"];
    const recipients = organizations.filter(org => org.added > 0 && org.documentId);
    const requested = params.scope === "all" ? recipients.map(recipientKey) : params.scope === "selected" ? params.organizationIds : [];
    const ids = [...new Set(requested)];
    if (params.scope !== "history" && !ids.length) throw new MasterCorrectionError("Выберите хотя бы один пищеблок, в который была выполнена выгрузка.");
    if (ids.some(id => !recipients.some(org => recipientKey(org) === id))) throw new MasterCorrectionError("Выбран пищеблок, которого нет среди получателей этой выгрузки.");
    const changed: Array<{ organizationId: string; documentId: string; rowIds: string[] }> = [];
    // A stable lock order prevents two histories targeting the same documents from deadlocking.
    const selected = recipients.filter(org => ids.includes(recipientKey(org))).sort((a, b) => a.documentId!.localeCompare(b.documentId!));
    for (const recipient of selected) {
      if (!code || !(await isPoolObjectInPool(recipient, code))) throw new MasterCorrectionError(`«${recipient.organizationName}» больше не подключён к этому мастер-кабинету.`);
      const documentId = recipient.documentId!;
      await tx.$queryRaw`SELECT id FROM "JournalDocument" WHERE id = ${documentId} FOR UPDATE`;
      const doc = await tx.journalDocument.findFirst({ where: { id: documentId, organizationId: recipient.organizationId }, include: { template: { select: { code: true } } } });
      if (!doc || doc.template.code !== "finished_product") throw new MasterCorrectionError(`Журнал «${recipient.organizationName}» не найден.`);
      const date = new Date(`${params.input.date}T00:00:00.000Z`);
      if (date < doc.dateFrom || date > doc.dateTo) throw new MasterCorrectionError(`Дата не входит в период журнала «${recipient.organizationName}». Для другой даты за пределами периода создайте новую выгрузку.`);
      const signatureEvents = await tx.signatureEvent.findMany({ where: { organizationId: recipient.organizationId, documentId }, select: { rowId: true } });
      const originalInput = masterBrakerageHistoryInputSchema.parse(Array.isArray(current.revisions) && current.revisions.length ? (current.revisions[0] as { input?: unknown }).input : current.input);
      const delivery = recipient.delivery ?? recoverMasterDelivery(doc.config, originalInput, recipient.skippedNames);
      const peopleIds = [doc.responsibleUserId, doc.verifierUserId].filter((id): id is string => Boolean(id));
      const people = peopleIds.length ? await tx.user.findMany({ where: { organizationId: recipient.organizationId, id: { in: peopleIds } }, select: { id: true, name: true } }) : [];
      const nameOf = (id: string | null) => { const name = people.find(person => person.id === id)?.name ?? ""; return name.includes("@") ? "" : name; };
      const plan = planMasterCorrection({ rawConfig: doc.config, delivery, next: params.input, people: { responsibleName: nameOf(doc.responsibleUserId), verifierName: nameOf(doc.verifierUserId) }, protectedRowIds: new Set(signatureEvents.flatMap(event => event.rowId ? [event.rowId] : [])) });
      if (plan.changedRowIds.length) {
        if (doc.status !== "active") throw new MasterCorrectionError(`Журнал «${recipient.organizationName}» закрыт. Изменение недоступно.`);
        if (doc.verificationDecidedAt || doc.verificationStatus === "approved" || doc.verificationStatus === "rejected") throw new MasterCorrectionError(`Журнал «${recipient.organizationName}» уже проверен. Изменение пока недоступно.`);
        const dates = [...new Set([delivery.input.date, params.input.date])].map(day => new Date(`${day}T00:00:00.000Z`));
        await tx.$queryRaw`SELECT id FROM "JournalDocumentEntry" WHERE "documentId" = ${documentId} FOR UPDATE`;
        const checkedEntry = await tx.journalDocumentEntry.findFirst({ where: { documentId, date: { in: dates }, OR: [{ verificationDecidedAt: { not: null } }, { verificationStatus: { in: ["approved", "rejected"] } }] }, select: { id: true } });
        if (checkedEntry) throw new MasterCorrectionError(`Записи за эту дату в «${recipient.organizationName}» уже проверены. Изменение пока недоступно.`);
        await tx.journalDocument.update({ where: { id: documentId }, data: { config: plan.config as Prisma.InputJsonValue } });
        changed.push({ organizationId: recipient.organizationId, documentId, rowIds: plan.changedRowIds });
        await tx.auditLog.create({ data: { organizationId: recipient.organizationId, userId: params.userId, userName: params.userName, action: "master_brakerage.corrected", entity: "JournalDocument", entityId: documentId, details: { masterOrgId: params.masterOrgId, batchId: params.batchId, rowIds: plan.changedRowIds } } });
      }
      recipient.delivery = plan.delivery;
    }
    const revisions = Array.isArray(current.revisions) ? current.revisions : [];
    const batch = await tx.masterBrakerageBatch.update({ where: { id: current.id }, data: {
      input: params.input,
      updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
      result: { ...savedResult, organizations } as unknown as Prisma.InputJsonValue,
      revisions: [...revisions, { input: current.input, changedAt: new Date().toISOString(), changedByName: params.userName, scope: params.scope, organizationIds: ids }] as Prisma.InputJsonValue,
    } });
    await tx.auditLog.create({ data: { organizationId: params.masterOrgId, userId: params.userId, userName: params.userName, action: "master_brakerage.input_edited", entity: "MasterBrakerageBatch", entityId: batch.id, details: { scope: params.scope, organizationIds: ids, date: params.input.date, changedDocuments: changed.length } } });
    return { batch, changed };
  }, { timeout: 30_000 });
}

/**
 * Дослать прошлую выгрузку объектам пула, подключённым после неё: те же
 * строки и дата, что в истории сейчас, — обычной записью в их журналы.
 * Получившие её раньше объекты пропускаются, итог дописывается в историю.
 */
export async function sendMasterBatchToNewObjects(params: { batchId: string; masterOrgId: string; organizationIds: string[] }) {
  const current = await db.masterBrakerageBatch.findFirst({ where: { id: params.batchId, organizationId: params.masterOrgId } });
  if (!current) throw new MasterCorrectionError("Выгрузка не найдена.");
  const input = masterBrakerageHistoryInputSchema.parse(current.input);
  const recipientsOf = (result: Prisma.JsonValue) => {
    const saved = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, Prisma.JsonValue> : {};
    return { saved, organizations: (Array.isArray(saved.organizations) ? saved.organizations : []) as unknown as MasterBrakerageOrgResult[] };
  };
  const fresh = [...new Set(params.organizationIds)].filter(id => !batchReachedObject(recipientsOf(current.result).organizations, id));
  if (!fresh.length) throw new MasterCorrectionError("Отмеченные пищеблоки уже получили эту выгрузку.");
  const sent = await addMasterBrakerageToPool({
    masterOrgId: params.masterOrgId,
    rows: input.rows,
    common: { ...input.common, date: input.date, time: normalizeTypedTime(input.common.time) },
    dryRun: false,
    organizationIds: fresh,
  });
  // Итог — в историю выгрузки: дальнейшие исправления пойдут и в эти пищеблоки.
  const batch = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "MasterBrakerageBatch" WHERE id = ${current.id} FOR UPDATE`;
    const latest = await tx.masterBrakerageBatch.findUniqueOrThrow({ where: { id: current.id } });
    const { saved, organizations } = recipientsOf(latest.result);
    const merged = [...organizations.filter(org => !sent.organizations.some(next => recipientKey(next) === recipientKey(org))), ...sent.organizations];
    return tx.masterBrakerageBatch.update({ where: { id: current.id }, data: {
      updatedAt: new Date(Math.max(Date.now(), latest.updatedAt.getTime() + 1)),
      result: JSON.parse(JSON.stringify({
        ...saved,
        organizations: merged,
        totals: {
          added: merged.reduce((sum, org) => sum + org.added, 0),
          skipped: merged.reduce((sum, org) => sum + (org.skipped ?? 0), 0),
          organizations: merged.filter(org => org.added > 0).length,
          failed: merged.filter(org => org.error).length,
        },
      })) as Prisma.InputJsonValue,
    } });
  });
  return { batch, organizations: sent.organizations };
}
