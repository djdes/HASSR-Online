import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Building2 } from "lucide-react";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { getPipelineForJournal } from "@/lib/journal-pipelines";
import { PipelineEditor } from "./pipeline-editor";

export const dynamic = "force-dynamic";

export default async function JournalPipelineEditorPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const t = await getTranslations("settingsUi.journalPipelinesCodePage");
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!hasCapability(session.user, "admin.full")) forbidden();
  const organizationId = getActiveOrgId(session);

  // Cleaning unification 2026-05-08: для cleaning журнала pipeline
  // настраивается ПЕРЕАДРЕСНО — через Room.currentScope/generalScope
  // в /settings/buildings (см. spec). PipelineEditor здесь не работает
  // для cleaning (две параллельные системы pipeline'а раньше создавали
  // конфликты). Показываем плашку с deeplink'ом.
  if (code === "cleaning") {
    return (
      <div className="space-y-5">
        <div className="rounded-3xl border border-[#ffe9b0] bg-[#fff8eb] p-6">
          <div className="flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#fff4e6] text-[#a16d32]">
              <Building2 className="size-5" />
            </span>
            <div>
              <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
                {t("cleaningTitle")}
              </h2>
              <p className="mt-2 max-w-[640px] text-[14px] leading-[1.55] text-[#7a5500]">
                {t("cleaningBody")}
              </p>
              <Link
                href="/settings/buildings"
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-[#5566f6] px-4 py-2.5 text-[14px] font-medium text-white shadow-[0_8px_24px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
              >
                {t("openBuildings")}
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pipeline = await getPipelineForJournal(organizationId, code);
  return <PipelineEditor code={code} initial={pipeline} />;
}
