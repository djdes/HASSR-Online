import { redirect } from "next/navigation";
import { MapPin, Sparkles } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { buildingTargets, getActiveBuildingId } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { sortJournalsByName } from "@/lib/journal-sort";
import { AutoJournalsClient } from "./auto-journals-client";
import { PageGuide } from "@/components/ui/page-guide";
import {
  getJournalAutomation,
  isAutomationSupported,
} from "@/lib/journal-automation";

export const dynamic = "force-dynamic";

export default async function AutoJournalsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    redirect("/settings");
  }
  const organizationId = getActiveOrgId(session);

  const [templates, org, activeDocs] = await Promise.all([
    db.journalTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        isMandatorySanpin: true,
        isMandatoryHaccp: true,
      },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        autoJournalCodes: true,
        disabledJournalCodes: true,
        journalAutomationJson: true,
      },
    }),
    db.journalDocument.findMany({
      where: {
        organizationId,
        status: "active",
        dateFrom: { lte: new Date() },
        dateTo: { gte: new Date() },
        ...buildingWhere(await getActiveBuildingId(session)),
      },
      select: { templateId: true },
      distinct: ["templateId"],
    }),
  ]);

  const disabledSet = new Set<string>(
    Array.isArray(org?.disabledJournalCodes)
      ? (org.disabledJournalCodes as unknown[]).filter(
          (c): c is string => typeof c === "string"
        )
      : []
  );
  const activeTemplateIds = new Set(activeDocs.map((d) => d.templateId));

  // Журналы по алфавиту.
  const items = sortJournalsByName(templates, (t) => t.name)
    .filter((t) => !disabledSet.has(t.code))
    .map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      description: t.description ?? null,
      isMandatory: t.isMandatorySanpin || t.isMandatoryHaccp,
      enabled: getJournalAutomation(org, t.code).autoCreate,
      // Автозаполнение умеет только «кадровая» механика (строка на
      // сотрудника × день) — для остальных журналов колонка неактивна.
      autoFill: getJournalAutomation(org, t.code).autoFill,
      autoFillSupported: isAutomationSupported(t.code),
      hasActiveDocumentToday: activeTemplateIds.has(t.id),
    }));

  // Точки: документы создаются на каждую точку — скажем об этом прямо
  // над списком, чтобы «N журналов» не превратились неожиданно в 3N.
  const locationsCount = (await buildingTargets(organizationId)).filter(Boolean).length;

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Sparkles className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
              Автосоздание и автозаполнение журналов
            </h1>
            <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              Отметьте журналы, для которых WeSetup должен сам заводить
              новый документ на текущий период. Вторая галочка —
              ежедневное автозаполнение: каждый день в 06:00 сайт
              проставит сотрудникам «Здоров, t&nbsp;&lt;&nbsp;37», а
              выходные, отпуска и больничные отметит сам.
            </p>
          </div>
        </div>
      </div>

      {locationsCount >= 2 ? (
        <div className="flex items-center gap-2.5 rounded-2xl border border-[#dfe3ff] bg-[#f5f6ff] px-4 py-2.5 text-[13px] text-[#3848c7]">
          <MapPin className="size-4 shrink-0" />
          <span>
            Точек: <b className="font-semibold tabular-nums">{locationsCount}</b> — каждый
            отмеченный журнал создаётся на каждую точку отдельно.
          </span>
        </div>
      ) : null}

      <PageGuide
        title="Как настроить авто-создание"
        storageKey="settings-auto-journals-v1"
        bullets={[
          { title: "Отметьте журналы", body: "Поставьте галочку на тех, что должны создаваться автоматически каждый месяц/период (СанПиН, ХАССП, ежедневные)." },
          { title: "Cron делает остальное", body: "Каждое утро проверяется: есть ли активный документ. Если нет — создаётся на весь текущий период." },
          { title: "Меньше ручной работы", body: "1-го числа месяца не нужно создавать документ по каждому журналу — система сама. Менеджер только следит за заполнением." },
        ]}
        qa={[
          { q: "А если я создал документ вручную раньше?", a: "Cron не дублирует — найдёт существующий active doc и пропустит. Создаёт только когда documentов нет." },
          { q: "Когда создаются документы со следующего периода?", a: "За 7 дней до окончания текущего — чтобы был запас." },
        ]}
      />
      <AutoJournalsClient items={items} />
    </div>
  );
}
