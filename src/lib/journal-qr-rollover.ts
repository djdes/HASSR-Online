import { recordAuditLog } from "@/lib/audit-log";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { closeExpiredDocuments, restoreBrokenChainForTemplate, type CreateReport } from "@/lib/journal-auto-create";
import { notifyManagement } from "@/lib/notifications";

/**
 * QR работает через смену периода (2026-09-22).
 *
 * Было: 1 октября прошлый документ кончился 30 сентября, автосоздание
 * выключено — сотрудник сканирует плакат и видит «На сегодня нет
 * активного документа». Запись терялась, пока руководитель не зайдёт в
 * кабинет, а ночной крон доходит только в 04:00.
 *
 * Стало: каждый путь QR перед поиском «документа на сегодня» зовёт
 * `ensureQrPeriodDocuments`. Если цепочка прервалась, документ нового
 * периода создаётся тем же правилом, что у ночного крона
 * (`restoreBrokenChainForTemplate`): ответственные — из прошлого,
 * структура — «по образцу прошлого», и сотрудник пишет «как ни в чём не
 * бывало».
 *
 * Страховки — документ рождается из публичного GET по QR:
 *   • организация — только из проверенного HMAC-токена (передаёт вызывающий);
 *   • без прошлого документа не создаём никогда;
 *   • журнал выключен в наборе или кабинет приостановлен — не создаём;
 *   • закрытый руководителем документ текущего периода — не обходим;
 *   • создание идемпотентно: advisory-замок «журнал × точка» + повторная
 *     проверка под ним (пять первых сканов после полуночи — один бланк);
 *   • каждое создание — в журнал аудита и колокольчик руководству.
 */

export type QrRolloverReason =
  | "journal-disabled"
  | "org-paused"
  | "org-missing"
  | "template-missing"
  | "no-previous-document"
  | "period-closed"
  | "perpetual-manual-only"
  | "busy"
  | "no-document"
  | "error";

export type QrRolloverResult = {
  /** active — документ уже был; created — создан сейчас; none — нет и не будет. */
  status: "active" | "created" | "none";
  /** Активные на сегодня документы журнала в области точек запроса. */
  documentIds: string[];
  reason?: QrRolloverReason;
};

export type QrRolloverAnchor = {
  /** Документ, от которого идёт скан (плакат документа): его точка. */
  documentId?: string | null;
  /** Точка объекта (помещение склада): документ этой точки. */
  buildingId?: string | null;
};

/** Кабинеты, в которых автоматика не создаёт документы. */
const PAUSED_PLANS = new Set(["paused", "cancelled"]);

type ActiveDoc = { id: string; buildingId: string | null };

function dayStart(todayKey: string): Date {
  return new Date(`${todayKey}T00:00:00.000Z`);
}

/** Документ `doc` виден на точке `target` (общий — на всех). */
function covers(doc: ActiveDoc, target: string | null): boolean {
  return target === null || doc.buildingId === null || doc.buildingId === target;
}

function inScope(docs: ActiveDoc[], targets: Array<string | null>): string[] {
  return docs.filter((doc) => targets.some((target) => covers(doc, target))).map((doc) => doc.id);
}

async function resolveTargets(args: {
  organizationId: string;
  templateId: string;
  perLocation: boolean;
  anchor?: QrRolloverAnchor;
}): Promise<Array<string | null>> {
  const orgTargets = args.perLocation ? await buildingTargets(args.organizationId) : [null];
  if (orgTargets.length === 1 && orgTargets[0] === null) return orgTargets;
  let anchorBuilding: string | null = args.anchor?.buildingId ?? null;
  if (args.anchor?.documentId) {
    const anchorDoc = await db.journalDocument.findFirst({
      where: { id: args.anchor.documentId, organizationId: args.organizationId, templateId: args.templateId },
      select: { buildingId: true },
    });
    anchorBuilding = anchorDoc?.buildingId ?? anchorBuilding;
  }
  return anchorBuilding && orgTargets.includes(anchorBuilding) ? [anchorBuilding] : orgTargets;
}

/**
 * Документ создан по QR — в журнал аудита и колокольчик руководству
 * (dedupe по документу: повторных уведомлений не будет).
 */
export async function announceQrRollover(args: {
  organizationId: string;
  templateCode: string;
  journalName: string;
  documentId: string;
  source?: string;
}): Promise<void> {
  const document = await db.journalDocument
    .findUnique({ where: { id: args.documentId }, select: { title: true, dateFrom: true, dateTo: true, buildingId: true } })
    .catch(() => null);
  const period = document
    ? `${document.dateFrom.toISOString().slice(0, 10)} — ${document.dateTo.toISOString().slice(0, 10)}`
    : null;
  await recordAuditLog({
    organizationId: args.organizationId,
    action: "journal_document.qr_rollover",
    entity: "JournalDocument",
    entityId: args.documentId,
    details: {
      templateCode: args.templateCode,
      title: document?.title ?? null,
      period,
      buildingId: document?.buildingId ?? null,
      source: args.source ?? "qr",
    },
  });
  await notifyManagement({
    organizationId: args.organizationId,
    kind: "journal.qr-rollover",
    dedupeKey: `qr-rollover:${args.documentId}`,
    title: `Начат новый период «${args.journalName}» — документ создан при записи по QR`,
    linkHref: `/journals/${args.templateCode}/documents/${args.documentId}`,
    linkLabel: "Открыть документ",
    items: [{ id: args.documentId, label: document?.title ?? args.journalName, ...(period ? { hint: period } : {}) }],
  }).catch((error) => console.warn("[journal-qr-rollover] notify failed", error));
}

export async function ensureQrPeriodDocuments(params: {
  organizationId: string;
  templateCode: string;
  /** Сегодня в зоне организации, `YYYY-MM-DD`. */
  todayKey: string;
  anchor?: QrRolloverAnchor;
  /** Откуда скан — в детали аудита. */
  source?: string;
}): Promise<QrRolloverResult> {
  try {
    return await ensureInner(params);
  } catch (error) {
    // Переход периода — помощь, а не условие записи: при сбое QR ведёт
    // себя как раньше (ищет активный документ).
    console.error("[journal-qr-rollover] ensure failed", params.templateCode, error);
    return { status: "none", documentIds: [], reason: "error" };
  }
}

async function ensureInner(params: {
  organizationId: string;
  templateCode: string;
  todayKey: string;
  anchor?: QrRolloverAnchor;
  source?: string;
}): Promise<QrRolloverResult> {
  const { organizationId, templateCode, todayKey } = params;
  const day = dayStart(todayKey);
  const [org, template] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { disabledJournalCodes: true, subscriptionPlan: true, perLocationJournals: true },
    }),
    db.journalTemplate.findFirst({
      where: { code: templateCode },
      select: { id: true, code: true, name: true, isActive: true },
    }),
  ]);
  if (!org) return { status: "none", documentIds: [], reason: "org-missing" };
  if (!template) return { status: "none", documentIds: [], reason: "template-missing" };

  const listActive = (): Promise<ActiveDoc[]> =>
    db.journalDocument.findMany({
      where: { organizationId, templateId: template.id, status: "active", dateFrom: { lte: day }, dateTo: { gte: day } },
      select: { id: true, buildingId: true },
      orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    });

  const [active, targets] = await Promise.all([
    listActive(),
    resolveTargets({ organizationId, templateId: template.id, perLocation: org.perLocationJournals === true, anchor: params.anchor }),
  ]);
  const uncovered = targets.filter((target) => !active.some((doc) => covers(doc, target)));
  if (uncovered.length === 0) return { status: "active", documentIds: inScope(active, targets) };

  const partial = (reason: QrRolloverReason): QrRolloverResult => {
    const ids = inScope(active, targets);
    return ids.length > 0 ? { status: "active", documentIds: ids, reason } : { status: "none", documentIds: [], reason };
  };
  if (parseDisabledCodes(org.disabledJournalCodes).has(templateCode)) return partial("journal-disabled");
  if (PAUSED_PLANS.has(org.subscriptionPlan ?? "")) return partial("org-paused");
  if (!template.isActive) return partial("template-missing");

  // Полдень «сегодня» организации: период считается по её дате, а не по UTC.
  const now = new Date(`${todayKey}T12:00:00.000Z`);
  const reports: CreateReport[] = [];
  for (const buildingId of uncovered) {
    reports.push(
      await restoreBrokenChainForTemplate(db, {
        organizationId,
        template: { id: template.id, code: template.code, name: template.name },
        buildingId,
        now,
      })
    );
  }
  const created = reports.filter((report) => report.created && report.documentId);
  if (created.length > 0) {
    // Прошлый период с преемником — в «Закрытые», как делает ночной крон.
    await closeExpiredDocuments(db, { organizationId, templateId: template.id, now }).catch((error) => {
      console.warn("[journal-qr-rollover] closeExpired failed", error);
      return { closed: 0, documentIds: [] };
    });
    for (const report of created) {
      await announceQrRollover({
        organizationId,
        templateCode,
        journalName: template.name,
        documentId: report.documentId,
        source: params.source,
      }).catch((error) => console.warn("[journal-qr-rollover] announce failed", error));
    }
  }

  const documentIds = inScope(await listActive(), targets);
  if (created.length > 0) return { status: "created", documentIds };
  if (documentIds.length > 0) return { status: "active", documentIds };

  // Почему документа нет — чтобы сотрудник у плаката понял, что делать.
  if (reports.some((report) => report.reason === "period-closed")) {
    return { status: "none", documentIds: [], reason: "period-closed" };
  }
  const closedToday = await db.journalDocument.findFirst({
    where: {
      organizationId,
      templateId: template.id,
      status: "closed",
      dateFrom: { lte: day },
      dateTo: { gte: day },
      ...(targets.includes(null) ? {} : { OR: [{ buildingId: null }, { buildingId: { in: targets as string[] } }] }),
    },
    select: { id: true },
  });
  if (closedToday) return { status: "none", documentIds: [], reason: "period-closed" };
  const known = ["no-previous-document", "perpetual-manual-only", "busy"] as const;
  const reason = known.find((candidate) => reports.some((report) => report.reason === candidate)) ?? "no-document";
  return { status: "none", documentIds: [], reason };
}

// ---------------------------------------------------------------------------
// Плакат конкретного документа: токен несёт id документа прошлого периода.

export type TokenDocumentInfo = {
  id: string;
  status: string;
  buildingId: string | null;
  /** `YYYY-MM-DD` */
  dateFrom: string;
  dateTo: string;
};

export type TokenDocumentsReason = "token-document-missing" | "period-closed" | "no-successor";

/**
 * Документы, в которые ведёт плакат документа (чистая функция):
 *   • документ токена активен сегодня — он;
 *   • иначе преемник той же «линии»: активный документ той же точки,
 *     затем общий (без точки); плакат общего документа в организации,
 *     перешедшей на точки, — все активные (сотрудник выберет);
 *   • иначе пусто и причина (закрыт руководителем / преемника нет).
 */
export function resolveTokenDocuments<T extends { id: string; buildingId: string | null }>(args: {
  tokenDocument: TokenDocumentInfo | null;
  activeDocuments: T[];
  todayKey: string;
}): { documents: T[]; reason?: TokenDocumentsReason } {
  const { tokenDocument, activeDocuments, todayKey } = args;
  if (!tokenDocument) return { documents: [], reason: "token-document-missing" };
  const own = activeDocuments.find((doc) => doc.id === tokenDocument.id);
  if (own) return { documents: [own] };
  const building = tokenDocument.buildingId ?? null;
  const sameLine = activeDocuments.filter((doc) => (doc.buildingId ?? null) === building);
  if (sameLine.length > 0) return { documents: sameLine };
  if (building !== null) {
    const shared = activeDocuments.filter((doc) => doc.buildingId === null);
    if (shared.length > 0) return { documents: shared };
  } else if (activeDocuments.length > 0) {
    return { documents: activeDocuments };
  }
  const coversToday = tokenDocument.dateFrom <= todayKey && tokenDocument.dateTo >= todayKey;
  return { documents: [], reason: tokenDocument.status === "closed" && coversToday ? "period-closed" : "no-successor" };
}

/** То же с запросами: id документов для плаката документа `tokenDocumentId`. */
export async function resolveTokenDocumentIds(params: {
  organizationId: string;
  templateCode: string;
  todayKey: string;
  tokenDocumentId: string;
}): Promise<{ documentIds: string[]; reason?: TokenDocumentsReason }> {
  const day = dayStart(params.todayKey);
  const [tokenDocument, active] = await Promise.all([
    db.journalDocument.findFirst({
      where: { id: params.tokenDocumentId, organizationId: params.organizationId, template: { code: params.templateCode } },
      select: { id: true, status: true, buildingId: true, dateFrom: true, dateTo: true },
    }),
    db.journalDocument.findMany({
      where: {
        organizationId: params.organizationId,
        status: "active",
        template: { code: params.templateCode },
        dateFrom: { lte: day },
        dateTo: { gte: day },
      },
      select: { id: true, buildingId: true },
      orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const resolved = resolveTokenDocuments({
    tokenDocument: tokenDocument
      ? {
          id: tokenDocument.id,
          status: tokenDocument.status,
          buildingId: tokenDocument.buildingId,
          dateFrom: tokenDocument.dateFrom.toISOString().slice(0, 10),
          dateTo: tokenDocument.dateTo.toISOString().slice(0, 10),
        }
      : null,
    activeDocuments: active,
    todayKey: params.todayKey,
  });
  return { documentIds: resolved.documents.map((doc) => doc.id), reason: resolved.reason };
}

/** Текст для сотрудника у плаката, когда документа на сегодня нет. */
export function qrRolloverMessage(reason: QrRolloverReason | TokenDocumentsReason | undefined): string {
  if (reason === "period-closed") {
    return "Документ за этот период закрыт руководителем — попросите вернуть его в активные.";
  }
  if (reason === "org-paused") {
    return "Кабинет организации приостановлен — запись по QR снова заработает, когда руководитель возобновит его.";
  }
  if (reason === "journal-disabled") return "Этот журнал отключён в организации.";
  return "На сегодня нет активного документа этого журнала. Попросите руководителя создать документ в кабинете — форма заработает сразу.";
}
