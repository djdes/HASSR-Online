import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { ackKnowledgeId, ackKnowledgeKey, formatAckMoment, isAckDocKey, type AckDocKey } from "./acknowledge";
import { parsePpkRecords } from "./records";
import { ppkWhere, type PpkScope } from "./scope";

export type AckAudience = "staff" | "team";
export type AckDoc = { docKey: AckDocKey; title: string; version: string; audience: AckAudience };

export const POLICY_ACK_TITLE = "Политика в области качества и безопасности пищевой продукции";
export const TEAM_REGULATION_ACK_TITLE = "Положение о группе ХАССП";

/**
 * Описание документа для ознакомления или null: документа нет в организации
 * (политика не заполнена, файл удалён или это документ раздела ППК).
 * Версия меняется при правке документа — прежние отметки перестают считаться.
 * Политика и положение о группе — ППК точки человека (2026-11-01, «ППК на
 * точку»); инструкции базы знаний — общие для организации.
 */
export async function ackDocument(scope: PpkScope, docKey: string): Promise<AckDoc | null> {
  const { organizationId } = scope;
  if (!isAckDocKey(docKey)) return null;
  if (docKey === "policy") {
    const row = await db.ppkRecord.findFirst({
      where: { ...ppkWhere(scope), block: "policy" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
    });
    if (!row) return null;
    const parsed = parsePpkRecords("policy", [row])[0];
    if (!parsed || !parsed.data.text.trim()) return null;
    return { docKey, title: POLICY_ACK_TITLE, version: policyTextVersion(parsed.data.text), audience: "staff" };
  }
  if (docKey === "team-regulation") {
    return { docKey, title: TEAM_REGULATION_ACK_TITLE, version: "1", audience: "team" };
  }
  const id = ackKnowledgeId(docKey);
  if (!id) return null;
  const doc = await db.knowledgeDocument.findFirst({
    where: { id, organizationId, kind: null, folder: null },
    select: { title: true, updatedAt: true },
  });
  if (!doc) return null;
  return { docKey, title: doc.title, version: doc.updatedAt.toISOString(), audience: "staff" };
}

/**
 * Версия политики для ознакомления — отпечаток её текста: заново знакомиться
 * нужно, только когда изменили сам текст, а не «кто утвердил» или дату.
 */
export function policyTextVersion(text: string): string {
  return createHash("sha256").update(text.trim().replace(/\s+/g, " ")).digest("hex").slice(0, 16);
}

/** Члены группы ХАССП этой точки (или организации). */
async function teamMemberIds(scope: PpkScope): Promise<string[]> {
  const rows = await db.ppkRecord.findMany({
    where: { ...ppkWhere(scope), block: "team" },
    select: { id: true, data: true, sortOrder: true, updatedAt: true },
  });
  return parsePpkRecords("team", rows).map((row) => row.data.userId);
}

/**
 * Условие на людей для сводок руководителя: точка видит только своих
 * (`visibleStaffWhere` из people-scope.server.ts). Пусто — все.
 */
export type AckStaffWhere = Prisma.UserWhereInput;

/** Живые сотрудники организации (кандидаты в аудиторию). */
async function rosterUsers(organizationId: string, staffWhere: AckStaffWhere = {}) {
  return db.user.findMany({
    // ORG_ROSTER_WHERE сам занимает `AND` — условие точки кладём рядом, не поверх.
    where: { AND: [{ organizationId, ...ORG_ROSTER_WHERE }, staffWhere] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export type AckListItem = AckDoc & { acknowledgedAt: string | null };

/** Документы, с которыми этому человеку нужно ознакомиться (или уже ознакомлен). */
export async function listAckDocsForUser(scope: PpkScope, userId: string): Promise<AckListItem[]> {
  const { organizationId } = scope;
  const me = await db.user.findFirst({
    where: { id: userId, organizationId, ...ORG_ROSTER_WHERE },
    select: { id: true },
  });
  if (!me) return [];

  const [policy, regulation, knowledge, teamIds] = await Promise.all([
    ackDocument(scope, "policy"),
    ackDocument(scope, "team-regulation"),
    db.knowledgeDocument.findMany({
      where: { organizationId, kind: null, folder: null },
      select: { id: true, title: true, updatedAt: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    teamMemberIds(scope),
  ]);
  const knowledgeDocs: AckDoc[] = knowledge.map((doc) => ({
    docKey: ackKnowledgeKey(doc.id),
    title: doc.title,
    version: doc.updatedAt.toISOString(),
    audience: "staff",
  }));
  const docs = [
    policy,
    ...(regulation && teamIds.includes(userId) ? [regulation] : []),
    ...knowledgeDocs,
  ].filter((doc): doc is AckDoc => doc !== null);
  if (!docs.length) return [];

  const marks = await db.ppkAcknowledgement.findMany({
    where: { organizationId, userId, docKey: { in: docs.map((doc) => doc.docKey) } },
    select: { docKey: true, version: true, acknowledgedAt: true },
  });
  return docs.map((doc) => {
    const mark = marks.find((m) => m.docKey === doc.docKey && m.version === doc.version);
    return { ...doc, acknowledgedAt: mark ? mark.acknowledgedAt.toISOString() : null };
  });
}

/** Входит ли человек в аудиторию документа (для отметки «Ознакомлен»). */
export async function ackDocForUser(scope: PpkScope, userId: string, docKey: string): Promise<AckDoc | null> {
  const { organizationId } = scope;
  const doc = await ackDocument(scope, docKey);
  if (!doc) return null;
  const user = await db.user.findFirst({
    where: { id: userId, organizationId, ...ORG_ROSTER_WHERE },
    select: { id: true },
  });
  if (!user) return null;
  if (doc.audience === "team" && !(await teamMemberIds(scope)).includes(userId)) return null;
  return doc;
}

/** Сколько документов ждут отметки этого человека. */
export async function countPendingAckForUser(scope: PpkScope, userId: string): Promise<number> {
  return (await listAckDocsForUser(scope, userId)).filter((doc) => !doc.acknowledgedAt).length;
}

export type AckStats = {
  version: string;
  acknowledged: { userId: string; name: string; at: string }[];
  pending: { userId: string; name: string }[];
};

/** Кто ознакомился с текущей версией документа, а кто ещё нет. */
export async function ackStats(
  scope: PpkScope,
  docKey: string,
  staffWhere: AckStaffWhere = {},
): Promise<AckStats | null> {
  return (await ackStatsMany(scope, [docKey], staffWhere))[docKey] ?? null;
}

/**
 * Статистика сразу по нескольким документам: ростер и отметки читаются одним
 * заходом (страница инструкций спрашивает по всем файлам разом).
 */
export async function ackStatsMany(
  scope: PpkScope,
  docKeys: string[],
  staffWhere: AckStaffWhere = {},
): Promise<Record<string, AckStats>> {
  const { organizationId } = scope;
  const knowledgeIds = docKeys.map(ackKnowledgeId).filter((id): id is string => id !== null);
  const [fixed, knowledge] = await Promise.all([
    Promise.all(docKeys.filter((key) => ackKnowledgeId(key) === null).map((key) => ackDocument(scope, key))),
    knowledgeIds.length
      ? db.knowledgeDocument.findMany({
          where: { id: { in: knowledgeIds }, organizationId, kind: null, folder: null },
          select: { id: true, title: true, updatedAt: true },
        })
      : Promise.resolve([]),
  ]);
  const docs: AckDoc[] = [
    ...fixed.filter((doc): doc is AckDoc => doc !== null),
    ...knowledge.map((doc) => ({
      docKey: ackKnowledgeKey(doc.id),
      title: doc.title,
      version: doc.updatedAt.toISOString(),
      audience: "staff" as const,
    })),
  ];
  if (!docs.length) return {};
  const [staff, teamIds, marks] = await Promise.all([
    rosterUsers(organizationId, staffWhere),
    docs.some((doc) => doc.audience === "team") ? teamMemberIds(scope) : Promise.resolve<string[]>([]),
    db.ppkAcknowledgement.findMany({
      where: { organizationId, docKey: { in: docs.map((doc) => doc.docKey) } },
      select: { docKey: true, version: true, userId: true, acknowledgedAt: true },
    }),
  ]);
  const out: Record<string, AckStats> = {};
  for (const doc of docs) {
    const users = doc.audience === "team" ? staff.filter((user) => teamIds.includes(user.id)) : staff;
    const byUser = new Map(
      marks.filter((m) => m.docKey === doc.docKey && m.version === doc.version).map((m) => [m.userId, m.acknowledgedAt]),
    );
    const acknowledged: AckStats["acknowledged"] = [];
    const pending: AckStats["pending"] = [];
    for (const user of users) {
      const at = byUser.get(user.id);
      if (at) acknowledged.push({ userId: user.id, name: user.name, at: at.toISOString() });
      else pending.push({ userId: user.id, name: user.name });
    }
    out[doc.docKey] = { version: doc.version, acknowledged, pending };
  }
  return out;
}

/** Сводка для руководителя: даты уже отформатированы в поясе организации. */
export async function ackSummaryFor(
  scope: PpkScope,
  docKey: string,
  timeZone: string,
  staffWhere: AckStaffWhere = {},
) {
  const stats = await ackStats(scope, docKey, staffWhere);
  if (!stats) return null;
  return {
    acknowledged: stats.acknowledged.map((row) => ({
      userId: row.userId,
      name: row.name,
      date: formatAckMoment(row.at, timeZone).date,
    })),
    pending: stats.pending,
  };
}
