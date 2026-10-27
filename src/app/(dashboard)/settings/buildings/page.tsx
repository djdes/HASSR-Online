import { redirect } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { BuildingsClient } from "./buildings-client";
import { PageGuide } from "@/components/ui/page-guide";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, QrCode } from "lucide-react";
import { listPersonBuildings } from "@/lib/active-building";
import { isPointScoped, staffScopeWhere } from "@/lib/point-scope";

export const dynamic = "force-dynamic";

export default async function BuildingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const orgId = getActiveOrgId(session);
  const tPoint = await getTranslations("navigation.shell.point");
  const t = await getTranslations("settingsUi.buildingsPage");
  // Консультант уровня «просмотр» видит точки, но не меняет их:
  // отказ по клику выглядел бы как поломка.
  const readOnly = session.user.partnerAccess?.level === "view";
  // Руководитель точки (фаза 2 «Офис и точки») ведёт только свои точки.
  const pointManager = isPointScoped(session.user);

  const [buildings, users, organization, personBuildings] = await Promise.all([
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
          {t("title")}
        </h1>
        <p className="mt-1.5 max-w-[640px] text-[14px] leading-[1.6] text-[#6f7282]">
          {t("description")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
      {buildings.some((building) => building.rooms.length > 0) ? (
        <Link
          href="/settings/qr-posters?kind=rooms"
          className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          title={t("qrPostersHint")}
        >
          <QrCode className="size-4 text-[#5566f6]" />
          {t("qrPosters")}
        </Link>
      ) : null}
      {/* Мастер новой точки — главное действие страницы (меню: «+ Добавить точку»). */}
      {readOnly || pointManager ? null : (
        <Link
          href="/settings/buildings/new"
          data-add-point-header
          title={tPoint("addHint")}
          className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          <Plus className="size-4" />
          {tPoint("add")}
        </Link>
      )}
      </div>
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
        users={users}
        perLocationJournals={organization?.perLocationJournals === true}
        userBuildingIds={Object.fromEntries(users.map((u) => [u.id, u.buildingIds]))}
        readOnly={readOnly}
        pointManager={pointManager}
        openableIds={personBuildings.map((building) => building.id)}
        unnamedCount={buildings.filter((b) => /^Точка \d+$/.test(b.name)).length}
      />
    </div>
  );
}
