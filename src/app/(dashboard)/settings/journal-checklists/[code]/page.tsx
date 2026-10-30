import { forbidden, notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { ChecklistEditor } from "./checklist-editor";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * /settings/journal-checklists/[code] — редактор плоского чек-листа
 * для конкретного журнала. Per-organization. Каждый пункт: label,
 * required, hint, sortOrder.
 *
 * Сотрудник видит чек-лист в TaskFill (загружается через
 * /api/task-fill/[taskId]/checklist) и отмечает галочки. Required
 * блокирует submit. Каждая отметка → AuditLog (видно ROOT'у).
 */
export default async function JournalChecklistEditorPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const t = await getTranslations("settingsUi.journalChecklistsCodePage");
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) {
    forbidden();
  }
  const organizationId = getActiveOrgId(session);

  const meta = ACTIVE_JOURNAL_CATALOG.find((j) => j.code === code);
  if (!meta) notFound();

  // Per-room support: для cleaning-журналов админ может задавать
  // отдельные пункты под каждую комнату. Список комнат орги.
  const isCleaningJournal =
    code === "cleaning" ||
    code === "general_cleaning" ||
    code === "equipment_cleaning" ||
    code === "cleaning_ventilation_checklist" ||
    code === "sanitary_day_checklist";

  const [items, rooms, cleaningDoc] = await Promise.all([
    db.journalChecklistItem.findMany({
      where: { organizationId, journalCode: code, archivedAt: null },
      orderBy: [{ roomId: "asc" }, { sortOrder: "asc" }],
    }),
    isCleaningJournal
      ? db.room.findMany({
          where: { building: { organizationId } },
          select: { id: true, name: true, kind: true },
          orderBy: [{ kind: "asc" }, { name: "asc" }],
        })
      : Promise.resolve([] as { id: string; name: string; kind: string }[]),
    // Найдём текущий cleaning документ для UI auto-switch.
    isCleaningJournal && code === "cleaning"
      ? db.journalDocument.findFirst({
          where: {
            organizationId,
            template: { code: "cleaning" },
            status: { not: "closed" },
          },
          orderBy: { dateFrom: "desc" },
          select: { id: true, title: true, config: true },
        })
      : Promise.resolve(null),
  ]);

  // Извлекаем текущий cleaningMode для подсветки в UI.
  const cleaningDocMode =
    cleaningDoc?.config &&
    typeof cleaningDoc.config === "object" &&
    !Array.isArray(cleaningDoc.config) &&
    "cleaningMode" in cleaningDoc.config
      ? (cleaningDoc.config as { cleaningMode?: unknown }).cleaningMode
      : undefined;
  const cleaningDocInfo:
    | { docId: string; title: string; currentMode: "pairs" | "rooms" }
    | null =
    isCleaningJournal && code === "cleaning" && cleaningDoc
      ? {
          docId: cleaningDoc.id,
          title: cleaningDoc.title,
          currentMode: cleaningDocMode === "rooms" ? "rooms" : "pairs",
        }
      : null;

  return (
    <div className="space-y-5">
      {/* Тёмный hero снят: редактор пунктов должен начинаться сразу.
          Надстрочная подпись оставлена — она не дублирует название
          журнала, а объясняет, чей это чек-лист. */}
      <PageHeader
        eyebrow={t("eyebrow")}
        title={meta.name}
        description={t("description")}
      />

      {code === "cleaning" ? (
        <div className="rounded-3xl border border-[#ffe9b0] bg-[#fff8eb] p-5 text-[13px] text-[#7a5500]">
          <div className="text-[14px] font-semibold mb-1 text-[#0b1024]">
            {t("cleaningTitle")}
          </div>
          <p className="mt-1.5">
            {t.rich("cleaningBody", {
              link: (chunks) => (
                <Link
                  href="/settings/buildings"
                  className="font-medium text-[#3848c7] underline underline-offset-2"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      ) : null}

      <ChecklistEditor
        journalCode={code}
        rooms={rooms}
        isCleaningJournal={isCleaningJournal}
        cleaningDocInfo={cleaningDocInfo}
        initial={items.map((i) => ({
          id: i.id,
          label: i.label,
          required: i.required,
          hint: i.hint,
          sortOrder: i.sortOrder,
          roomId: i.roomId,
          frequency: i.frequency,
          weekDays: i.weekDays,
          monthDay: i.monthDay,
        }))}
      />
    </div>
  );
}
