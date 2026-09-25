import { recordAuditLog } from "@/lib/audit-log";
import { resolveJournalDisplayName } from "@/lib/org-custom-names";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { closeExpiredDocuments, createFirstDocumentForTemplate, restoreBrokenChainForTemplate, type CreateReport } from "@/lib/journal-auto-create";
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
 *
 * Первый документ (журналом ещё не пользовались, 2026-09-23) — только с
 * `allowFirstDocument`, который передаёт лишь скан собственного основного
 * QR журнала (`decideQrFirstDocument`). Хаб, QR документов, пара здоровья,
 * JSON-API и submit его не передают никогда.
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
  /** Первый документ журнала (не новый период): свой аудит и заголовок. */
  first?: boolean;
}): Promise<void> {
  const document = await db.journalDocument
    .findUnique({ where: { id: args.documentId }, select: { title: true, dateFrom: true, dateTo: true, buildingId: true } })
    .catch(() => null);
  const period = document
    ? `${document.dateFrom.toISOString().slice(0, 10)} — ${document.dateTo.toISOString().slice(0, 10)}`
    : null;
  await recordAuditLog({
    organizationId: args.organizationId,
    action: args.first ? "journal_document.qr_first_document" : "journal_document.qr_rollover",
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
  // В колокольчике — название журнала, как его зовут в организации.
  const journalName = await resolveJournalDisplayName(
    args.organizationId,
    args.templateCode,
    args.journalName
  );
  await notifyManagement({
    organizationId: args.organizationId,
    kind: args.first ? "journal.qr-first-document" : "journal.qr-rollover",
    dedupeKey: `${args.first ? "qr-first" : "qr-rollover"}:${args.documentId}`,
    title: args.first
      ? `Создан первый документ «${journalName}» — по скану QR-кода журнала. Проверьте ответственных и состав журнала`
      : `Начат новый период «${journalName}» — документ создан при записи по QR`,
    linkHref: `/journals/${args.templateCode}/documents/${args.documentId}`,
    linkLabel: "Открыть документ",
    items: [{ id: args.documentId, label: document?.title ?? journalName, ...(period ? { hint: period } : {}) }],
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
  /**
   * Документов журнала нет совсем — создать первый. Только скан
   * собственного основного QR журнала (`decideQrFirstDocument`).
   */
  allowFirstDocument?: boolean;
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
  allowFirstDocument?: boolean;
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
  const firstDocumentIds = new Set<string>();
  const templateRef = { id: template.id, code: template.code, name: template.name };
  for (const buildingId of uncovered) {
    let report = await restoreBrokenChainForTemplate(db, { organizationId, template: templateRef, buildingId, now });
    // Журналом не пользовались ни разу — первый документ, если разрешено.
    if (report.reason === "no-previous-document" && params.allowFirstDocument) {
      report = await createFirstDocumentForTemplate(db, { organizationId, template: templateRef, buildingId, now });
      if (report.created && report.documentId) firstDocumentIds.add(report.documentId);
    }
    reports.push(report);
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
        first: firstDocumentIds.has(report.documentId),
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
  /**
   * `pinned` — дополнительный QR документа со сроком (2026-09-23): только
   * свой активный документ, без перехода в новый период.
   */
  mode?: "lineage" | "pinned";
}): { documents: T[]; reason?: TokenDocumentsReason } {
  const { tokenDocument, activeDocuments, todayKey } = args;
  if (!tokenDocument) return { documents: [], reason: "token-document-missing" };
  const own = activeDocuments.find((doc) => doc.id === tokenDocument.id);
  if (own) return { documents: [own] };
  const coversToday = tokenDocument.dateFrom <= todayKey && tokenDocument.dateTo >= todayKey;
  const noneReason: TokenDocumentsReason = tokenDocument.status === "closed" && coversToday ? "period-closed" : "no-successor";
  if (args.mode === "pinned") return { documents: [], reason: noneReason };
  const building = tokenDocument.buildingId ?? null;
  const sameLine = activeDocuments.filter((doc) => (doc.buildingId ?? null) === building);
  if (sameLine.length > 0) return { documents: sameLine };
  if (building !== null) {
    const shared = activeDocuments.filter((doc) => doc.buildingId === null);
    if (shared.length > 0) return { documents: shared };
  } else if (activeDocuments.length > 0) {
    return { documents: activeDocuments };
  }
  return { documents: [], reason: noneReason };
}

/** То же с запросами: id документов для плаката документа `tokenDocumentId`. */
export async function resolveTokenDocumentIds(params: {
  organizationId: string;
  templateCode: string;
  todayKey: string;
  tokenDocumentId: string;
  mode?: "lineage" | "pinned";
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
    mode: params.mode,
  });
  return { documentIds: resolved.documents.map((doc) => doc.id), reason: resolved.reason };
}

/**
 * Документ `candidate` — из линии документа токена (сверка в submit и
 * JSON-API): тот же документ; для документа точки — та же точка или общий;
 * общий документ — вся линия журнала (организация могла перейти на точки).
 * Организация и журнал уже отфильтрованы запросом вызывающего.
 */
export function documentInTokenLine(
  tokenDocument: { id: string; buildingId: string | null },
  candidate: { id: string; buildingId: string | null }
): boolean {
  if (candidate.id === tokenDocument.id) return true;
  if (tokenDocument.buildingId === null) return true;
  return candidate.buildingId === null || candidate.buildingId === tokenDocument.buildingId;
}

/**
 * Можно ли по этому скану создать ПЕРВЫЙ документ журнала (C4, 2026-09-23).
 * Только собственный основной QR журнала: хаб (правкой адреса наплодили
 * бы документы во всех журналах) и QR документов — никогда. В организации
 * с точками — только QR, привязанный к её точке: старый основной QR без
 * точки не знает, на какую точку заводить документ.
 */
export function decideQrFirstDocument(args: {
  hub: boolean;
  documentId: string | null;
  buildingId: string | null;
  /** `buildingTargets(org)`: `[null]` — организация без точек. */
  orgTargets: Array<string | null>;
}): boolean {
  if (args.hub || args.documentId) return false;
  const withoutLocations = args.orgTargets.length === 1 && args.orgTargets[0] === null;
  if (withoutLocations) return true;
  return args.buildingId !== null && args.orgTargets.includes(args.buildingId);
}

/**
 * Текст для сотрудника у плаката, когда документа на сегодня нет.
 * `responsible` — «ФИО, должность» ответственного (`journal-responsible-person.ts`).
 */
export function qrRolloverMessage(reason: QrRolloverReason | TokenDocumentsReason | undefined, responsible?: string | null): string {
  if (reason === "period-closed") {
    return "Документ за этот период закрыт руководителем — попросите вернуть его в активные.";
  }
  if (reason === "org-paused") {
    return "Кабинет организации приостановлен — запись по QR снова заработает, когда руководитель возобновит его.";
  }
  if (reason === "journal-disabled") return "Этот журнал отключён в организации.";
  if (responsible && responsible !== "руководитель") {
    return `На сегодня нет активного документа этого журнала. Ответственный за журнал — ${responsible} — должен войти в кабинет и создать документ, после этого форма заработает сразу.`;
  }
  return "На сегодня нет активного документа этого журнала. Попросите руководителя создать документ в кабинете — форма заработает сразу.";
}
