import type { MarketingContact, Prisma } from "@prisma/client";

import { recordAuditLog } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { checkEmail } from "@/lib/email-validation";
import { ORG_SPHERES } from "@/lib/org-profile";

import { contactWhere, CONTACT_STATUSES, type ContactFilters } from "./audience";
import { MailingError, PLATFORM_ORG_ID, type MailingActor } from "./campaigns.server";
import {
  classifyImport,
  decodeCsvBytes,
  MAX_IMPORT_BYTES,
  parseContacts,
  parseTags,
  type ColumnMapping,
  type ImportClass,
  type ParsedContacts,
} from "./csv";

/**
 * Загруженные контакты и стоп-лист (ROOT → «Рассылка»).
 *
 * Загрузка — в два шага: предпросмотр (разбор, сопоставление колонок,
 * проверка адресов, дубли, стоп-лист) и запись той же функцией разбора.
 * Источник и основание обязательны для всей партии: реклама по email —
 * только с согласия (38-ФЗ, ст. 18), и через полгода должно быть видно,
 * откуда адрес.
 */

const CONTACT_ENTITY = "MarketingContact";
const SUPPRESSION_ENTITY = "EmailSuppression";

async function audit(actor: MailingActor, action: string, entity: string, entityId: string | null, details: Record<string, unknown>) {
  await recordAuditLog({
    request: actor.request,
    session: actor.session,
    organizationId: PLATFORM_ORG_ID,
    action,
    entity,
    entityId,
    details,
  });
}

export type ImportInput = {
  text?: string | null;
  /** Файл целиком в base64 — кодировку определяем по байтам. */
  fileBase64?: string | null;
  fileName?: string | null;
  mapping?: ColumnMapping | null;
};

function decodeInput(input: ImportInput): { text: string; encoding: ParsedContacts["encoding"] } {
  if (input.fileBase64) {
    const bytes = Buffer.from(input.fileBase64, "base64");
    if (bytes.length > MAX_IMPORT_BYTES) throw new MailingError("Файл больше 5 МБ — разбейте его на части");
    return decodeCsvBytes(new Uint8Array(bytes));
  }
  const text = (input.text ?? "").slice(0, MAX_IMPORT_BYTES);
  return { text, encoding: "text" };
}

export type ImportPreview = Omit<ParsedContacts, "rows"> & {
  rows: Array<ParsedContacts["rows"][number] & { cls: ImportClass }>;
  counts: Record<ImportClass, number>;
  /** Строк в ответе меньше, чем в файле, — показываем первые. */
  shown: number;
};

async function classify(parsed: ParsedContacts) {
  const emails = parsed.rows.filter((r) => r.status === "ok").map((r) => r.email);
  const [existing, suppressed] = await Promise.all([
    emails.length
      ? db.marketingContact.findMany({ where: { email: { in: emails } }, select: { email: true } })
      : Promise.resolve([]),
    emails.length
      ? db.emailSuppression.findMany({ where: { email: { in: emails } }, select: { email: true } })
      : Promise.resolve([]),
  ]);
  return classifyImport(parsed.rows, new Set(existing.map((e) => e.email)), new Set(suppressed.map((s) => s.email)));
}

export async function previewImport(input: ImportInput, showRows = 200): Promise<ImportPreview> {
  const decoded = decodeInput(input);
  if (!decoded.text.trim()) throw new MailingError("Пусто: выберите файл CSV или вставьте адреса");
  const parsed = parseContacts(decoded, { mapping: input.mapping ?? null });
  const { rows, counts } = await classify(parsed);
  return { ...parsed, rows: rows.slice(0, showRows), counts, shown: Math.min(showRows, rows.length) };
}

export type ImportCommit = ImportInput & {
  source: string;
  basis: string;
  /** Теги на всю партию — добавляются к тегам из файла. */
  tags?: string | null;
};

export async function commitImport(
  input: ImportCommit,
  actor: MailingActor
): Promise<{ created: number; counts: Record<ImportClass, number>; source: string }> {
  const source = (input.source ?? "").trim().slice(0, 200);
  const basis = (input.basis ?? "").trim().slice(0, 200);
  if (!source) throw new MailingError("Укажите источник: откуда эти адреса (например, «выгрузка 2ГИС 29.09»)");
  if (!basis) throw new MailingError("Укажите основание: почему им можно писать (например, «согласие на сайте»)");
  const decoded = decodeInput(input);
  const parsed = parseContacts(decoded, { mapping: input.mapping ?? null });
  const { rows, counts } = await classify(parsed);
  const batchTags = parseTags(input.tags);
  const fresh = rows.filter((r) => r.cls === "new");
  let created = 0;
  for (let i = 0; i < fresh.length; i += 1000) {
    const chunk = fresh.slice(i, i + 1000);
    const r = await db.marketingContact.createMany({
      data: chunk.map((row) => ({
        email: row.email,
        name: row.name,
        company: row.company,
        sphere: row.sphere,
        city: row.city,
        phone: row.phone,
        tags: [...new Set([...row.tags, ...batchTags])].slice(0, 20),
        source,
        basis,
        createdById: actor.session.user.id,
      })),
      skipDuplicates: true,
    });
    created += r.count;
  }
  const details = {
    source,
    basis,
    fileName: input.fileName ?? null,
    encoding: parsed.encoding,
    delimiter: parsed.delimiter,
    rows: parsed.summary.total,
    created,
    exists: counts.exists,
    suppressed: counts.suppressed,
    duplicates: counts.duplicate,
    invalid: counts.invalid,
  };
  console.info(`[mailing] contacts import: +${created} by ${actor.session.user.email ?? actor.session.user.id}`, details);
  await audit(actor, "mailing.contacts.import", CONTACT_ENTITY, null, details);
  return { created, counts, source };
}

// ---------------------------------------------------------------- list

export type ContactDto = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  sphere: string | null;
  city: string | null;
  phone: string | null;
  tags: string[];
  source: string;
  basis: string;
  status: string;
  lastSentAt: string | null;
  note: string | null;
  createdAt: string;
};

function toDto(c: MarketingContact): ContactDto {
  return {
    id: c.id,
    email: c.email,
    name: c.name,
    company: c.company,
    sphere: c.sphere,
    city: c.city,
    phone: c.phone,
    tags: c.tags,
    source: c.source,
    basis: c.basis,
    status: c.status,
    lastSentAt: c.lastSentAt?.toISOString() ?? null,
    note: c.note,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function listContacts(
  filters: ContactFilters,
  options: { offset?: number; limit?: number; idsOnly?: boolean } = {}
): Promise<{ total: number; rows: ContactDto[]; ids?: string[]; sources: string[]; tags: string[] }> {
  const where = contactWhere(filters) as Prisma.MarketingContactWhereInput;
  const [total, sourceRows, tagRows] = await Promise.all([
    db.marketingContact.count({ where }),
    db.marketingContact.findMany({ distinct: ["source"], select: { source: true }, orderBy: { source: "asc" }, take: 200 }),
    db.$queryRaw<Array<{ tag: string }>>`SELECT DISTINCT unnest(tags) AS tag FROM "MarketingContact" ORDER BY tag LIMIT 200`,
  ]);
  const sources = sourceRows.map((s) => s.source);
  const tags = tagRows.map((t) => t.tag);
  if (options.idsOnly) {
    const ids = await db.marketingContact.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" }, take: 20_000 });
    return { total, rows: [], ids: ids.map((i) => i.id), sources, tags };
  }
  const rows = await db.marketingContact.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip: Math.max(0, options.offset ?? 0),
    take: Math.min(500, Math.max(1, options.limit ?? 100)),
  });
  return { total, rows: rows.map(toDto), sources, tags };
}

export type ContactPatch = {
  name?: string | null;
  company?: string | null;
  sphere?: string | null;
  city?: string | null;
  phone?: string | null;
  tags?: string[] | string | null;
  source?: string;
  basis?: string;
  status?: string;
  note?: string | null;
};

const SPHERE_CODES = new Set<string>(ORG_SPHERES.map((s) => s.value));

function text(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().slice(0, max);
  return v || null;
}

export async function updateContact(id: string, patch: ContactPatch, actor: MailingActor): Promise<ContactDto> {
  const before = await db.marketingContact.findUnique({ where: { id } });
  if (!before) throw new MailingError("Контакт не найден", 404);
  const data: Prisma.MarketingContactUpdateInput = {};
  if (patch.name !== undefined) data.name = text(patch.name, 200);
  if (patch.company !== undefined) data.company = text(patch.company, 200);
  if (patch.city !== undefined) data.city = text(patch.city, 120);
  if (patch.phone !== undefined) data.phone = text(patch.phone, 40);
  if (patch.note !== undefined) data.note = text(patch.note, 500);
  if (patch.sphere !== undefined) {
    if (patch.sphere && !SPHERE_CODES.has(patch.sphere)) throw new MailingError("Неизвестная сфера");
    data.sphere = patch.sphere || null;
  }
  if (patch.tags !== undefined) {
    data.tags = Array.isArray(patch.tags) ? parseTags(patch.tags.join(",")) : parseTags(patch.tags);
  }
  if (patch.source !== undefined) {
    const v = text(patch.source, 200);
    if (!v) throw new MailingError("Источник обязателен");
    data.source = v;
  }
  if (patch.basis !== undefined) {
    const v = text(patch.basis, 200);
    if (!v) throw new MailingError("Основание обязательно");
    data.basis = v;
  }
  if (patch.status !== undefined) {
    if (!(CONTACT_STATUSES as readonly string[]).includes(patch.status)) throw new MailingError("Неизвестный статус");
    // Вернуть «активен» можно только если адреса нет в стоп-листе: иначе
    // отписавшемуся снова уйдёт реклама.
    if (patch.status === "active" && before.status !== "active") {
      const stop = await db.emailSuppression.findUnique({ where: { email: before.email } });
      if (stop) throw new MailingError("Адрес в стоп-листе — сначала уберите его оттуда (вкладка «Стоп-лист»)");
    }
    data.status = patch.status;
  }
  const row = await db.marketingContact.update({ where: { id }, data });
  const changed = Object.keys(data);
  console.info(`[mailing] contact ${id} updated (${changed.join(", ")}) by ${actor.session.user.email ?? actor.session.user.id}`);
  await audit(actor, "mailing.contact.update", CONTACT_ENTITY, id, { email: row.email, changed });
  return toDto(row);
}

export async function deleteContacts(ids: string[], actor: MailingActor): Promise<number> {
  const unique = [...new Set(ids)].slice(0, 20_000);
  if (unique.length === 0) return 0;
  const emails = await db.marketingContact.findMany({ where: { id: { in: unique } }, select: { email: true }, take: 20 });
  const r = await db.marketingContact.deleteMany({ where: { id: { in: unique } } });
  console.info(`[mailing] contacts deleted: ${r.count} by ${actor.session.user.email ?? actor.session.user.id}`);
  await audit(actor, "mailing.contacts.delete", CONTACT_ENTITY, unique.length === 1 ? unique[0] : null, {
    count: r.count,
    sample: emails.map((e) => e.email),
  });
  return r.count;
}

// ---------------------------------------------------------------- stop-list

export type SuppressionDto = {
  id: string;
  email: string;
  reason: string;
  note: string | null;
  campaignId: string | null;
  campaignTitle: string | null;
  createdAt: string;
};

export async function listSuppressions(search: string, limit = 200): Promise<{ total: number; rows: SuppressionDto[] }> {
  const q = search.trim().toLowerCase();
  const where: Prisma.EmailSuppressionWhereInput = q ? { email: { contains: q } } : {};
  const [total, rows] = await Promise.all([
    db.emailSuppression.count({ where }),
    db.emailSuppression.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(500, limit) }),
  ]);
  const campaignIds = [...new Set(rows.map((r) => r.campaignId).filter((id): id is string => Boolean(id)))];
  const campaigns = campaignIds.length
    ? await db.mailingCampaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, title: true } })
    : [];
  const titles = new Map(campaigns.map((c) => [c.id, c.title]));
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      email: r.email,
      reason: r.reason,
      note: r.note,
      campaignId: r.campaignId,
      campaignTitle: r.campaignId ? titles.get(r.campaignId) ?? null : null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function addSuppression(emailRaw: string, note: string | null, actor: MailingActor): Promise<SuppressionDto> {
  const email = emailRaw.trim().toLowerCase();
  const check = checkEmail(email);
  if (check.status === "empty" || check.status === "invalid") throw new MailingError(check.message);
  const existing = await db.emailSuppression.findUnique({ where: { email } });
  if (existing) throw new MailingError("Этот адрес уже в стоп-листе", 409);
  const row = await db.emailSuppression.create({
    data: { email, reason: "manual", note: text(note, 300), createdById: actor.session.user.id },
  });
  await db.marketingContact.updateMany({ where: { email, status: "active" }, data: { status: "unsubscribed" } });
  console.info(`[mailing] stop-list + ${email} (manual) by ${actor.session.user.email ?? actor.session.user.id}`);
  await audit(actor, "mailing.suppression.add", SUPPRESSION_ENTITY, row.id, { email, note: row.note });
  return { ...row, campaignTitle: null, createdAt: row.createdAt.toISOString() };
}

export async function removeSuppression(id: string, actor: MailingActor): Promise<void> {
  const row = await db.emailSuppression.findUnique({ where: { id } });
  if (!row) throw new MailingError("Адрес не найден в стоп-листе", 404);
  await db.emailSuppression.delete({ where: { id } });
  // Ручное добавление само выключало контакт — ручное удаление его
  // возвращает. Отписку самого человека так не отменить: статус контакта
  // после неё меняется только явной правкой.
  if (row.reason === "manual") {
    await db.marketingContact.updateMany({ where: { email: row.email, status: "unsubscribed" }, data: { status: "active" } });
  }
  console.info(`[mailing] stop-list − ${row.email} (was ${row.reason}) by ${actor.session.user.email ?? actor.session.user.id}`);
  await audit(actor, "mailing.suppression.remove", SUPPRESSION_ENTITY, id, { email: row.email, reason: row.reason });
}
