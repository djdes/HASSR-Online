import { redirect } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { getActiveBuildingId } from "@/lib/active-building";
import { db } from "@/lib/db";
import { sortJournalsByName } from "@/lib/journal-sort";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { getFillMode } from "@/lib/journal-routing";
import { JournalsSettingsClient } from "./journals-settings-client";
import { PageGuide } from "@/components/ui/page-guide";
import { normalizeSphere } from "@/lib/org-profile";
import { paperJournalsFor } from "@/lib/sphere-journal-rules";
import { SAMPLE_JOURNAL_CODES } from "@/lib/journal-sample-fixtures";
import { getJournalPreviewMap } from "@/lib/journal-preview/service";

export const dynamic = "force-dynamic";

export default async function JournalsSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/dashboard");
  const organizationId = getActiveOrgId(session);

  const [templates, organization, positions, users, positionAccess] =
    await Promise.all([
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
          fillMode: true,
          defaultAssigneeId: true,
          bonusAmountKopecks: true,
        },
      }),
      db.organization.findUnique({
        where: { id: organizationId },
        select: {
          disabledJournalCodes: true,
          disabledPaperJournalIds: true,
          type: true,
        },
      }),
      db.jobPosition.findMany({
        where: { organizationId },
        orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, categoryKey: true },
      }),
      db.user.findMany({
        where: {
          organizationId,
          isActive: true,
          archivedAt: null,
          isRoot: false,
        },
        orderBy: [{ name: "asc" }],
        select: { id: true, name: true, jobPositionId: true },
      }),
      db.jobPositionJournalAccess.findMany({
        where: { organizationId },
        select: { templateId: true, jobPositionId: true },
      }),
    ]);

  // Сколько активных документов у каждого журнала: выключение прячет их
  // из всех списков, и человек должен увидеть число заранее.
  const activeDocuments = await db.journalDocument.groupBy({
    by: ["templateId"],
    where: { organizationId, status: "active" },
    _count: { _all: true },
  });
  const activeDocsByTemplate = new Map(
    activeDocuments.map((row) => [row.templateId, row._count._all])
  );

  const disabled = parseDisabledCodes(organization?.disabledJournalCodes);
  const disabledPaper = parseDisabledCodes(organization?.disabledPaperJournalIds);
  const sphere = normalizeSphere(organization?.type);
  const accessByTemplate = new Map<string, string[]>();
  for (const row of positionAccess) {
    const list = accessByTemplate.get(row.templateId) ?? [];
    list.push(row.jobPositionId);
    accessByTemplate.set(row.templateId, list);
  }

  // Снимки реальных документов — те же, что на дашборде и в /journals.
  const previewUrls = await getJournalPreviewMap(organizationId, await getActiveBuildingId(session));

  // Журналы по алфавиту: клиент раскладывает их по группам
  // («обязательные», «рекомендуем», остальные) с сохранением порядка.
  const items = sortJournalsByName(templates, (t) => t.name).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    isMandatorySanpin: t.isMandatorySanpin,
    isMandatoryHaccp: t.isMandatoryHaccp,
    previewUrl: previewUrls.get(t.code) ?? null,
    enabled: !disabled.has(t.code),
    fillMode: getFillMode(t),
    defaultAssigneeId: t.defaultAssigneeId,
    allowedPositionIds: accessByTemplate.get(t.id) ?? [],
    bonusAmountKopecks: t.bonusAmountKopecks,
    activeDocumentCount: activeDocsByTemplate.get(t.id) ?? 0,
  }));

  // Бумажные бланки сферы с тем же признаком enabled, что у
  // электронных: хранение негативное, поэтому новый бланк в каталоге
  // сразу включён.
  const paperItems = sortJournalsByName(paperJournalsFor(sphere), (j) => j.name).map((journal) => ({
    ...journal,
    enabled: !disabledPaper.has(journal.id),
  }));

  return (
    <div className="space-y-5">
      <PageGuide
        title="Как выбрать набор журналов"
        storageKey="settings-journals-v2"
        bullets={[
          { title: "Начните со сферы", body: "Набор строится от вида заведения: для ресторана обязательный минимум Роспотребнадзора — несколько журналов, а не весь каталог. Смените сферу — пересчитаем." },
          { title: "Остальное — по желанию", body: "Рекомендованные журналы выключены, но под рукой. «Остальные» свёрнуты: включайте, если реально ведёте." },
          { title: "Бумажные — отдельно", body: "Инструктажи по охране труда закон разрешает вести только на бумаге. Пожарные журналы можно и электронно с подписью — печатную форму даём для тех, кому привычнее бумага." },
        ]}
        qa={[
          { q: "Почему включено всего несколько журналов?", a: "Это обязательный минимум для вашей сферы. Всё остальное вы решаете сами — набор в любой момент можно расширить." },
          { q: "Что будет, если выключить обязательный?", a: "Журнал исчезнет из дашборда и задач, готовность считаться по нему не будет. Санитарные правила требуют фиксировать эти показатели: для организаций общепита штраф по ст. 6.6 КоАП РФ до 50 000 ₽ или приостановка до 90 суток, для детских организаций добавляется ст. 6.7 (до 150 000 ₽ при повторном), для пищевого производства — ст. 14.43 (до 600 000 ₽)." },
          { q: "Чем «требует СанПиН» отличается от «просят при проверках»?", a: "Первое — прямая норма санитарных правил, за неё штрафуют. Второе — методические рекомендации Роспотребнадзора: закон не обязывает, но инспекторы такие журналы спрашивают почти всегда. Мы помечаем основание у каждого журнала, чтобы вы решали осознанно." },
          { q: "Почему часть журналов только на бумаге?", a: "Инструктажи по охране труда выведены из электронного документооборота Трудовым кодексом (ст. 22.1), их подписывают от руки. А вот пожарный инструктаж и журнал огнетушителей вести электронно можно — с электронной подписью; печатную форму мы даём для привычного бумажного ведения." },
        ]}
      />
      <JournalsSettingsClient
        items={items}
        paperItems={paperItems}
        sampleCodes={SAMPLE_JOURNAL_CODES}
        positions={positions}
        users={users}
        sphere={sphere}
      />
    </div>
  );
}
