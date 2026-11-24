import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { ackKnowledgeId, formatAckMoment } from "@/lib/ppk/acknowledge";
import { isTextDoc } from "@/lib/ppk/text-docs";
import { revisionDocKey } from "@/lib/ppk/revisions";
import { loadRevisionStates } from "@/lib/ppk/revisions.server";
import { ackDocForUser } from "@/lib/ppk/acknowledge.server";
import { parsePpkRecords } from "@/lib/ppk/records";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { teamRegulationSections } from "@/lib/ppk/team-regulation-document";
import { PPK_BUTTON_OUTLINE_CLASS } from "@/components/production-control/ppk-ui";
import { AcknowledgeButton } from "./acknowledge-button";
import { ppkScopeForSession } from "@/lib/ppk/scope.server";
import { ppkWhere } from "@/lib/ppk/scope";

export const dynamic = "force-dynamic";

const ROLE_ORDER = { leader: 0, deputy: 1, member: 2, secretary: 3 } as const;

/** Документ для ознакомления: текст политики, положение с составом группы или файл инструкции. */
export default async function AcknowledgeDocPage({ params }: { params: Promise<{ docKey: string }> }) {
  const { docKey: rawKey } = await params;
  let docKey = rawKey;
  try {
    docKey = decodeURIComponent(rawKey);
  } catch {
    notFound();
  }
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);
  const userId = session.user.id;
  // Политика и положение о группе — ППК точки человека (2026-11-01).
  const scope = await ppkScopeForSession(session);
  const doc = await ackDocForUser(scope, userId, docKey);
  if (!doc) notFound();

  const [org, mark, t] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, timezone: true } }),
    db.ppkAcknowledgement.findUnique({
      where: {
        organizationId_docKey_version_userId: { organizationId, docKey: doc.docKey, version: doc.version, userId },
      },
      select: { acknowledgedAt: true },
    }),
    getTranslations("acknowledge"),
  ]);
  const roleLabel = (role: keyof typeof ROLE_ORDER) => {
    switch (role) {
      case "leader":
        return t("roleLeader");
      case "deputy":
        return t("roleDeputy");
      case "member":
        return t("roleMember");
      case "secretary":
        return t("roleSecretary");
    }
  };
  const moment = mark ? formatAckMoment(mark.acknowledgedAt.toISOString(), org?.timezone ?? "Europe/Moscow") : null;

  let body: React.ReactNode = null;
  if (doc.docKey === "policy") {
    const row = await db.ppkRecord.findFirst({
      where: { ...ppkWhere(scope), block: "policy" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
    });
    const text = row ? (parsePpkRecords("policy", [row])[0]?.data.text ?? "") : "";
    const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    body = (
      <div className="space-y-3 text-[15px] leading-[1.65] text-[#0b1024]">
        {paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    );
  } else if (doc.docKey === "team-regulation") {
    const [rows, staff] = await Promise.all([
      db.ppkRecord.findMany({
        where: { ...ppkWhere(scope), block: "team" },
        select: { id: true, data: true, sortOrder: true, updatedAt: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      loadPpkStaff(scope),
    ]);
    const staffById = new Map(staff.map((person) => [person.id, person]));
    const members = parsePpkRecords("team", rows)
      .map((row) => row.data)
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
    body = (
      <div className="space-y-5 text-[15px] leading-[1.65] text-[#0b1024]">
        {teamRegulationSections(org?.name ?? "").map((section) => (
          <section key={section.title}>
            <h2 className="mb-1.5 text-[16px] font-semibold">{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mb-1.5">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
        {members.length ? (
          <section>
            <h2 className="mb-1.5 text-[16px] font-semibold">{t("membersTitle")}</h2>
            <ul className="space-y-1">
              {members.map((member) => (
                <li key={member.userId}>
                  {staffById.get(member.userId)?.name ?? "—"} — {roleLabel(member.role)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  } else if (doc.docKey === "ppk") {
    // Программа производственного контроля (лист ознакомления, пункт 3.7
    // структуры ППК): версия и должностные лица — группа ХАССП.
    const [rows, staff] = await Promise.all([
      db.ppkRecord.findMany({
        where: { ...ppkWhere(scope), block: "team" },
        select: { id: true, data: true, sortOrder: true, updatedAt: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      loadPpkStaff(scope),
    ]);
    const staffById = new Map(staff.map((person) => [person.id, person]));
    const members = parsePpkRecords("team", rows)
      .map((row) => row.data)
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
    // Версия — номер утверждённой версии («v3»); программа без утверждения — загруженный файл.
    const version = doc.version.startsWith("v") ? doc.version.slice(1) : null;
    body = (
      <div className="space-y-4 text-[15px] leading-[1.65] text-[#0b1024]">
        <p>{version ? t("ppkLead", { version }) : t("ppkLeadFile")}</p>
        {/* В той же вкладке: в Mini App Telegram новая вкладка открылась бы без входа. */}
        <a href="/api/acknowledgements/ppk/file" className={PPK_BUTTON_OUTLINE_CLASS}>
          <ExternalLink className="size-4" aria-hidden />
          {t("ppkOpen")}
        </a>
        {members.length ? (
          <section>
            <h2 className="mb-1.5 text-[16px] font-semibold">{t("ppkOfficials")}</h2>
            <ul className="space-y-1">
              {members.map((member) => (
                <li key={member.userId}>
                  {staffById.get(member.userId)?.name ?? "—"} — {roleLabel(member.role)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  } else if (ackKnowledgeId(doc.docKey)) {
    // Инструкция текстом (написана в кабинете) — текст прямо на странице.
    const file = await db.knowledgeDocument.findFirst({
      where: { id: ackKnowledgeId(doc.docKey)!, organizationId },
      select: { mimeType: true, content: true },
    });
    const ownText = file && isTextDoc(file.mimeType) ? Buffer.from(file.content).toString("utf8") : null;
    body = (
      <div className="space-y-4">
        {ownText !== null ? (
          <div className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-[#0b1024]" data-ack-text>
            {ownText}
          </div>
        ) : (
          <p className="text-[14px] text-[#6f7282]">{t("fileHint")}</p>
        )}
        <a
          href={`/api/knowledge-documents/${ackKnowledgeId(doc.docKey)}/file`}
          className={PPK_BUTTON_OUTLINE_CLASS}
        >
          <ExternalLink className="size-4" aria-hidden />
          {t("openFile")}
        </a>
      </div>
    );
  }

  // Номер утверждённой редакции документа (spec, Р5: сотрудник видит номер), если текст с тех пор не менялся.
  const revisionKey = ackKnowledgeId(doc.docKey)
    ? doc.docKey
    : doc.docKey === "policy"
      ? revisionDocKey({ kind: "policy" }, scope.buildingId)
      : doc.docKey === "team-regulation"
        ? revisionDocKey({ kind: "text", block: "text-team-regulation" }, scope.buildingId)
        : null;
  const revision = revisionKey ? (await loadRevisionStates(scope, [revisionKey])).get(revisionKey) : undefined;
  const revisionLine =
    revision?.status === "approved" && revision.latest
      ? t("revision", { code: revision.latest.code, date: formatAckMoment(revision.latest.approvedAt, org?.timezone ?? "Europe/Moscow").date })
      : null;

  return (
    <div className="space-y-5">
      <Link
        href="/acknowledge"
        className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <PageHeader title={doc.title} />
      {revisionLine ? (
        <p className="-mt-3 text-[13.5px] font-medium text-[#116b2a]" data-ack-revision>
          {revisionLine}
        </p>
      ) : null}
      <article className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-7">{body}</article>
      <AcknowledgeButton
        withSignature={doc.docKey === "ppk"}
        docKey={doc.docKey}
        doneText={moment ? t("done", { date: moment.date, time: moment.time }) : null}
      />
    </div>
  );
}
