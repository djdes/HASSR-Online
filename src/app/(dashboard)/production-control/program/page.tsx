import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkBundle } from "@/lib/ppk/assemble.server";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { loadDocVersions } from "@/lib/ppk/review.server";
import { approvalOf } from "@/lib/ppk/review";
import { moscowToday } from "@/lib/ppk/plan-done";
import { EMERGENCIES, MEDICAL_PHRASE } from "@/lib/ppk/program-content";
import { ppkBlock, type PpkBlockKey } from "@/lib/ppk/registry";
import { PpkPrintSheet } from "@/components/production-control/ppk-print-sheet";
import { PpkDocVersions } from "@/components/production-control/ppk-doc-versions";
import {
  PpkApproveBlock,
  PpkDocSection,
  PpkDocTable,
  ruDate,
  type PpkEmptyBanner,
} from "@/components/production-control/ppk-doc-ui";

export const dynamic = "force-dynamic";

const ROLE_RU = {
  leader: "Руководитель группы ХАССП",
  deputy: "Заместитель руководителя группы ХАССП",
  member: "Член группы ХАССП",
  secretary: "Секретарь группы ХАССП",
} as const;
const PEST_KIND_RU = { disinsection: "Дезинсекция", deratization: "Дератизация", disinfection: "Дезинфекция" } as const;
const LAB_OBJECT_RU = { product: "Продукция", swabs: "Смывы", water: "Вода", air: "Воздух", other: "Другое" } as const;
/** Лист ознакомления: строк не больше этого числа. */
const ACQUAINTANCE_MAX = 30;

/** Программа производственного контроля: собирается из заполненных блоков раздела. */
export default async function ProgramPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);

  const [bundle, versionRows, staff, t, nav] = await Promise.all([
    loadPpkBundle(organizationId),
    loadDocVersions(organizationId),
    loadPpkStaff(organizationId),
    getTranslations("productionControl.program"),
    getTranslations("navigation"),
  ]);
  const { org } = bundle;
  const requisites = org.snapshot;
  const banner = (key: PpkBlockKey): PpkEmptyBanner => ({
    href: ppkBlock(key).href,
    text: t("emptySection", { block: nav(`shell.menus.productionControl.items.${key}`) }),
    linkText: t("fill"),
  });

  const approval = approvalOf(versionRows.map((row) => row.data), "ppk", staff);
  const leader = bundle.team.find((member) => member.role === "leader");
  // Лист ознакомления: Ф. И. О. и должности — из списка сотрудников, даты и подписи ставят от руки.
  const acquaintanceRows = staff.slice(0, ACQUAINTANCE_MAX);

  return (
    <div className="space-y-4">
    <PpkDocVersions
      doc="ppk"
      initial={versionRows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))}
      staff={staff}
      today={moscowToday()}
    />
    <PpkPrintSheet
      pdfHref="/api/production-control/program/pdf"
      pdfLabel={t("downloadPdf")}
      org={org}
      title="Программа производственного контроля"
      subtitle={approval ? `Версия ${approval.version} от ${ruDate(approval.approvedAt)}` : org.orgName}
    >
      <PpkApproveBlock org={org} approval={approval} />

      <PpkDocSection title="1. Общие сведения">
        <PpkDocTable
          heads={["Показатель", "Значение"]}
          rows={[
            ["Полное наименование", requisites?.orgName || org.orgName || "—"],
            ["Краткое наименование", requisites?.orgShortName || "—"],
            ["ИНН", org.orgInn || "—"],
            ["Адрес", org.orgAddress || "—"],
            [
              "Руководитель",
              requisites?.directorName
                ? `${requisites.directorPost || "Руководитель"}, ${requisites.directorName}`
                : "—",
            ],
            [
              "Ответственный за производственный контроль",
              leader ? `${leader.name}${leader.title ? `, ${leader.title}` : ""}` : "—",
            ],
          ]}
        />
      </PpkDocSection>

      <PpkDocSection
        title="2. Перечень официально изданных санитарных правил и нормативных документов"
        empty={bundle.norms.length === 0 ? banner("norm-documents") : null}
      >
        <ol className="list-decimal space-y-1 pl-6">
          {bundle.norms.map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ol>
      </PpkDocSection>

      <PpkDocSection
        title="3. Должностные лица, на которых возложены функции производственного контроля"
        empty={bundle.team.length === 0 && bundle.responsibles.length === 0 ? banner("team") : null}
      >
        <PpkDocTable
          heads={["Ф. И. О.", "Должность", "Функция"]}
          rows={[
            ...bundle.team.map((member) => [
              member.name,
              member.title || "—",
              `${ROLE_RU[member.role]}${member.duties ? `. ${member.duties}` : ""}`,
            ]),
            ...bundle.responsibles.map((person) => [
              person.name,
              person.title || "—",
              `Ответственный за журналы: ${person.journals.join(", ")}`,
            ]),
          ]}
        />
      </PpkDocSection>

      <PpkDocSection title="4. Лабораторный контроль" empty={bundle.lab.length === 0 ? banner("lab") : null}>
        <PpkDocTable
          heads={["Объект", "Что исследуем", "Показатели", "Периодичность", "Лаборатория"]}
          rows={bundle.lab.map((item) => [
            LAB_OBJECT_RU[item.object],
            item.subject,
            item.indicator || "—",
            `Раз в ${item.everyMonths} мес.${item.nextDate ? `, следующий — ${ruDate(item.nextDate)}` : ""}`,
            item.laboratory || "—",
          ])}
        />
      </PpkDocSection>

      <PpkDocSection
        title="5. Перечень должностей, работники которых проходят медицинские осмотры и гигиеническую подготовку"
        empty={bundle.positions.length === 0 ? banner("team") : null}
      >
        <ul className="list-disc space-y-1 pl-6">
          {bundle.positions.map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ul>
        <p className="mt-2">{MEDICAL_PHRASE}</p>
      </PpkDocSection>

      <PpkDocSection
        title="6. Мероприятия по дезинсекции и дератизации"
        empty={bundle.pest.length === 0 ? banner("pest-control") : null}
      >
        <PpkDocTable
          heads={["Вид", "Объект", "Периодичность", "Исполнитель", "Последняя", "Следующая"]}
          rows={bundle.pest.map((item) => [
            PEST_KIND_RU[item.kind],
            item.object,
            item.frequency || "—",
            item.contractor || "—",
            ruDate(item.lastDate),
            ruDate(item.nextDate),
          ])}
        />
      </PpkDocSection>

      <PpkDocSection
        title="7. Формы учёта и отчётности"
        empty={bundle.journals.length === 0 ? banner("instructions") : null}
      >
        <ol className="list-decimal space-y-0.5 pl-6">
          {bundle.journals.map((journal) => (
            <li key={journal.code}>{journal.name}</li>
          ))}
        </ol>
      </PpkDocSection>

      <PpkDocSection title="8. Перечень возможных аварийных ситуаций и действий персонала">
        <ol className="list-decimal space-y-2 pl-6">
          {EMERGENCIES.map((item) => (
            <li key={item.title}>
              <span className="font-semibold">{item.title}.</span> {item.actions}
            </li>
          ))}
        </ol>
      </PpkDocSection>

      <PpkDocSection title="9. Лист ознакомления">
        <PpkDocTable
          heads={["Ф. И. О.", "Должность", "Дата", "Подпись"]}
          rows={
            acquaintanceRows.length
              ? acquaintanceRows.map((person) => [person.name, person.title, "", ""])
              : [[<span key="gap" className="block h-5" />, "", "", ""]]
          }
        />
      </PpkDocSection>
    </PpkPrintSheet>
    </div>
  );
}
