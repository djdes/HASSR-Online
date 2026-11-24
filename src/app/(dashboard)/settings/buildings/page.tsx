import { forbidden } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { BuildingsClient } from "./buildings-client";
import { PageGuide } from "@/components/ui/page-guide";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { PageActions } from "@/components/layout/page-actions";
import { QrActions } from "@/components/layout/qr-actions";
import { listPersonBuildings } from "@/lib/active-building";
import { isOfficeBuilding } from "@/lib/building-scope";
import { isPointScoped, staffScopeWhere } from "@/lib/point-scope";

export const dynamic = "force-dynamic";

export default async function BuildingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const orgId = getActiveOrgId(session);
  const tPoint = await getTranslations("navigation.shell.point");
  const t = await getTranslations("settingsUi.buildingsPage");
  // Консультант уровня «просмотр» видит точки, но не меняет их:
  // отказ по клику выглядел бы как поломка.
  const readOnly = session.user.partnerAccess?.level === "view";
  // Руководитель точки (фаза 2 «Офис и точки») ведёт только свои точки.
  const pointManager = isPointScoped(session.user);

  const [allBuildings, users, organization, personBuildings] = await Promise.all([
    db.building.findMany({
    where: { organizationId: orgId, ...(pointManager ? { id: { in: session.user.pointScope ?? [] } } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      rooms: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          kind: true,
          sortOrder: true,
          // 2026-09-04: кто убирает / кто проверяет помещение.
          cleanerUserIds: true,
          verifierUserIds: true,
          fillerUserIds: true,
          // Cleaning unification 2026-05-08: Room теперь хранит scope/days/
          // detergent — RoomEditorDialog в buildings-client использует.
          detergent: true,
          currentScope: true,
          generalScope: true,
          currentDays: true,
          generalDays: true,
          currentScheduleType: true,
          generalScheduleType: true,
          currentMonthDays: true,
          generalMonthDays: true,
          requirePhoto: true,
          // Климат помещения: без норм окно помещения показывало «не контролируется»
          // и при сохранении стирало нормы из журнала климата (2026-11-23).
          climateNorms: true,
        },
      },
    },
    }),
    // Сотрудники для мультивыбора «Кто убирает / Кто проверяет».
    db.user.findMany({
      where: { organizationId: orgId, isActive: true, archivedAt: null, ...staffScopeWhere(session.user) },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        isRoot: true,
        positionTitle: true,
        jobPosition: { select: { name: true } },
        // Точки: кто где работает — для блока «Сотрудники точки».
        buildingIds: true,
      },
    }),
    db.organization.findUnique({
      where: { id: orgId },
      select: { perLocationJournals: true },
    }),
    // Чью страницу точки человек откроет — у тех «Открыть точку».
    listPersonBuildings(session),
  ]);
  // Скрепка (личное, 2026-11-23): закреплённые объекты — первыми.
  const pinnedBuildingIds =
    (await db.user.findUnique({ where: { id: session.user.id }, select: { pinnedBuildingIds: true } }))
      ?.pinnedBuildingIds ?? [];
  // Только объекты (скан 98, 2026-10-28): офис — в «Моя компания → Офис».
  // Офис с заведёнными помещениями остаётся: править их больше негде
  // (страница точки для офиса уводит на «Офис»).
  const buildings = allBuildings.filter((building) => !isOfficeBuilding(building) || building.rooms.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
          {t("title")}
        </h1>
        <p className="mt-1.5 max-w-[640px] text-[14px] leading-[1.6] text-[#6f7282]">
          {t("description")}
        </p>
      </div>
      {/* QR и «Добавить» — одной строкой на телефоне; уехали вверх при
          прокрутке — закрепляются снизу (`PageActions`, владелец 2026-11-23). */}
      <PageActions dock>
      {buildings.some((building) => building.rooms.length > 0) ? (
        <QrActions
          items={[{ key: "rooms", href: "/settings/qr-posters?kind=rooms", label: t("qrPosters"), hint: t("qrPostersHint") }]}
          phoneLabel={t("qrPostersShort")}
        />
      ) : null}
      {/* Мастер новой точки — главное действие страницы (меню: «+ Добавить точку»). */}
      {readOnly || pointManager ? null : (
        <Link
          href="/settings/buildings/new"
          data-add-point-header
          title={tPoint("addHint")}
          className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          <Plus className="size-4 shrink-0" />
          <span className="truncate">{tPoint("add")}</span>
        </Link>
      )}
      </PageActions>
      </div>
      <PageGuide
        title={t("guideTitle")}
        storageKey="settings-buildings-v4"
        bullets={[
          { title: t("guide1Title"), body: t("guide1Body") },
          { title: t("guide2Title"), body: t("guide2Body") },
          { title: t("guide3Title"), body: t("guide3Body") },
        ]}
        qa={[
          { q: t("qa1Q"), a: t("qa1A") },
          { q: t("qa2Q"), a: t("qa2A") },
        ]}
      />
      <BuildingsClient
        initial={buildings}
        pinnedIds={pinnedBuildingIds}
        users={users}
        perLocationJournals={organization?.perLocationJournals === true}
        // Делить журналы есть что при двух зданиях и больше; при офисе (офис у
        // всех по умолчанию, 2026-11-24) журналы ведутся по объектам всегда —
        // тумблера нет: выключить значило бы сломать офис.
        canSplitJournals={allBuildings.length >= 2 && !allBuildings.some(isOfficeBuilding)}
        userBuildingIds={Object.fromEntries(users.map((u) => [u.id, u.buildingIds]))}
        readOnly={readOnly}
        pointManager={pointManager}
        openableIds={personBuildings.map((building) => building.id)}
        unnamedCount={buildings.filter((b) => /^Точка \d+$/.test(b.name)).length}
      />
    </div>
  );
}
