import Link from "next/link";
import { BookOpen, FileText, Lightbulb } from "lucide-react";
import { notFound } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { JOURNAL_HELP } from "@/lib/journal-help";
import { JournalPageCrumbs } from "@/components/journals/journal-breadcrumbs";
import { getJournalCrumbMenu } from "@/lib/journal-crumb-menu";
import { getCrumbOrganizationName } from "@/lib/crumb-organization";

export const dynamic = "force-dynamic";

/**
 * J10 — Контекстная help-страница для каждого журнала.
 *
 * Показывает: краткое описание, какой нормативом регулируется,
 * пример как заполнять, ссылка на shared SanPiN reference.
 *
 * Контент — статический, в src/lib/journal-help.ts. Если для
 * журнала нет записи в JOURNAL_HELP — показываем generic-help.
 */
export default async function JournalHelpPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await requireAuth();
  const { code } = await params;

  const template = await db.journalTemplate.findFirst({
    where: { code, isActive: true },
    select: { name: true, description: true, isMandatorySanpin: true, isMandatoryHaccp: true },
  });
  if (!template) notFound();

  const help = JOURNAL_HELP[code];

  // Рукописная ссылка «← К журналу» убрана: наверх ведут крошки, назад —
  // общая кнопка из layout'а раздела.
  const [crumbOrganizationName, journalMenu] = await Promise.all([
    getCrumbOrganizationName(getActiveOrgId(session)),
    getJournalCrumbMenu(session, code),
  ]);

  return (
    <div className="space-y-5">
      <JournalPageCrumbs
        organizationName={crumbOrganizationName}
        journalName={template.name}
        journalCode={code}
        journalMenu={journalMenu}
        tail={[{ label: "Справка" }]}
      />
      <div>
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <BookOpen className="size-6" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
              {template.name}
            </h1>
            <p className="mt-1 text-[13px] text-[#6f7282]">
              Справка как заполнять журнал
              {template.isMandatorySanpin ? " · обязательный по СанПиН" : ""}
              {template.isMandatoryHaccp ? " · обязательный по ХАССП" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Зачем нужен */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <h2 className="text-[16px] font-semibold text-[#0b1024]">Зачем</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[#3c4053]">
          {help?.purpose ??
            template.description ??
            "Журнал ведётся в соответствии с требованиями производственного контроля."}
        </p>
      </section>

      {/* Как заполнять */}
      {help?.howToFill && (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">
            Как заполнять
          </h2>
          <ol className="mt-3 space-y-2 text-[14px] leading-relaxed text-[#3c4053]">
            {help.howToFill.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="size-6 shrink-0 rounded-full bg-[#f5f6ff] text-center text-[12px] font-semibold leading-6 text-[#3848c7]">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Норматив */}
      {help?.regulation && (
        <section className="rounded-3xl border border-[#ececf4] bg-[#fff8eb] p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="flex items-start gap-3">
            <FileText className="size-5 shrink-0 text-[#b25f00]" />
            <div>
              <h2 className="text-[15px] font-semibold text-[#0b1024]">
                Норматив
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-[#3c4053]">
                {help.regulation}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Совет */}
      {help?.tip && (
        <section className="rounded-3xl border border-[#86efac] bg-[#ecfdf5] p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="flex items-start gap-3">
            <Lightbulb className="size-5 shrink-0 text-[#116b2a]" />
            <div>
              <h2 className="text-[15px] font-semibold text-[#0b1024]">
                Совет от опытных рестораторов
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-[#3c4053]">
                {help.tip}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Generic CTA when no help yet */}
      {!help && (
        <section className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center">
          <p className="text-[14px] text-[#6f7282]">
            Подробной справки по этому журналу пока нет. Используйте{" "}
            <Link
              href="/sanpin"
              className="text-[#3848c7] underline"
            >
              справочник СанПиН
            </Link>{" "}
            или ИИ-помощника для конкретных вопросов.
          </p>
        </section>
      )}

      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <Link
          href={`/journals/${code}`}
          className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
        >
          К журналу «{template.name}» →
        </Link>
      </div>
    </div>
  );
}
