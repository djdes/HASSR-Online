import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { ackKnowledgeId, formatAckMoment } from "@/lib/ppk/acknowledge";
import { ackDocForUser } from "@/lib/ppk/acknowledge.server";
import { parsePpkRecords } from "@/lib/ppk/records";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { teamRegulationSections } from "@/lib/ppk/team-regulation-document";
import { PPK_BUTTON_OUTLINE_CLASS } from "@/components/production-control/ppk-ui";
import { AcknowledgeButton } from "./acknowledge-button";

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
  const doc = await ackDocForUser(organizationId, userId, docKey);
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
      where: { organizationId, block: "policy" },
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
        where: { organizationId, block: "team" },
        select: { id: true, data: true, sortOrder: true, updatedAt: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      loadPpkStaff(organizationId),
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
  } else if (ackKnowledgeId(doc.docKey)) {
    body = (
      <div className="space-y-4">
        <p className="text-[14px] text-[#6f7282]">{t("fileHint")}</p>
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
      <article className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-7">{body}</article>
      <AcknowledgeButton
        docKey={doc.docKey}
        doneText={moment ? t("done", { date: moment.date, time: moment.time }) : null}
      />
    </div>
  );
}
