import { redirect } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { BuildingsClient } from "./buildings-client";
import { PageGuide } from "@/components/ui/page-guide";
import Link from "next/link";
import { QrCode } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BuildingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const orgId = getActiveOrgId(session);

  const [buildings, users, organization] = await Promise.all([
    db.building.findMany({
    where: { organizationId: orgId },
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
      where: { organizationId: orgId, isActive: true, archivedAt: null },
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
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
          Точки и помещения
        </h1>
        <p className="mt-1.5 max-w-[640px] text-[14px] leading-[1.6] text-[#6f7282]">
          Точки бизнеса (здания с адресом) и помещения внутри них. По
          помещениям раздаются задачи в журналах уборки — одна задача на
          помещение в день. Если точек несколько, журналы можно вести
          отдельно по каждой: включается тумблером ниже.
        </p>
      </div>
      {buildings.some((building) => building.rooms.length > 0) ? (
        <Link
          href="/settings/qr-posters?kind=rooms"
          className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          title="Плакат A4 с QR-кодом на каждое помещение: сотрудник сканирует и вносит температуру и влажность без входа"
        >
          <QrCode className="size-4 text-[#5566f6]" />
          QR-плакаты помещений
        </Link>
      ) : null}
      </div>
      <PageGuide
        title="Как настроить точки и помещения"
        storageKey="settings-buildings-v4"
        bullets={[
          { title: "Точка — это адрес", body: "Кафе на Ленина и кафе на Мира — две точки. Внутри каждой — помещения: кухня, зал, мойка, склад. По помещениям раздаются задачи уборки, по ним же печатаются журналы климата." },
          { title: "Минимум для запуска", body: "Одна точка и 2–3 помещения. Если точек несколько — заведите каждую и включите «Вести журналы отдельно по точкам»: документы будут создаваться на каждую, а в шапке появится выбор точки." },
          { title: "Сотрудники общие", body: "Сотрудники, должности и настройки одни на организацию. В карточке сотрудника чипами «Точки» можно ограничить, с каких точек ему приходят задачи; пусто — со всех." },
        ]}
        qa={[
          { q: "Что будет с документами, если включить режим точек?", a: "Уже созданные документы останутся общими и будут видны на каждой точке. Со следующего периода документы создаются отдельно на каждую точку." },
          { q: "А если удалить точку?", a: "Помещения точки удалятся, а документы журналов останутся в организации и станут общими." },
        ]}
      />
      <BuildingsClient
        initial={buildings}
        users={users}
        perLocationJournals={organization?.perLocationJournals === true}
        userBuildingIds={Object.fromEntries(users.map((u) => [u.id, u.buildingIds]))}
        // Консультант уровня «просмотр» видит точки, но не меняет их:
        // отказ по клику выглядел бы как поломка.
        readOnly={session.user.partnerAccess?.level === "view"}
        unnamedCount={buildings.filter((b) => /^Точка \d+$/.test(b.name)).length}
      />
    </div>
  );
}
