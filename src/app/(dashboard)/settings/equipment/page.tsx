import Link from "next/link";
import {
  AlertTriangle,
  MapPin,
  QrCode,
  Thermometer,
  Wifi,
  WifiOff,
  Wrench,
} from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { CopyIdButton } from "@/components/settings/copy-id-button";
import { EquipmentDialog } from "@/components/settings/equipment-dialog";
import { DeleteButton } from "@/components/settings/delete-button";
import { PageGuide } from "@/components/ui/page-guide";
import { isManagementRole } from "@/lib/user-roles";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  refrigerator: "Холодильник",
  freezer: "Морозильник",
  oven: "Печь",
  dishwasher: "Посудомоечная машина",
  scale: "Весы",
  thermometer: "Термометр",
  sensor: "Датчик",
  other: "Другое",
};

function tempRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${min}°C … ${max}°C`;
  if (min !== null) return `от ${min}°C`;
  if (max !== null) return `до ${max}°C`;
  return "—";
}

export default async function EquipmentSettingsPage() {
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);

  const [equipment, areas] = await Promise.all([
    db.equipment.findMany({
      where: { area: { organizationId: orgId } },
      orderBy: { name: "asc" },
      include: { area: { select: { id: true, name: true } } },
    }),
    db.area.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // IoT readings
  const iotIds = equipment.filter((e) => e.tuyaDeviceId).map((e) => e.id);
  const readings: Record<string, { temp: number; time: Date }> = {};
  for (const eqId of iotIds) {
    const entry = await db.journalEntry.findFirst({
      where: {
        equipmentId: eqId,
        data: { path: ["source"], string_contains: "tuya" },
      },
      orderBy: { createdAt: "desc" },
      select: { data: true, createdAt: true },
    });
    if (entry?.data && typeof entry.data === "object") {
      const d = entry.data as Record<string, unknown>;
      if (d.temperature != null)
        readings[eqId] = { temp: Number(d.temperature), time: entry.createdAt };
    }
  }

  const equipmentNames = equipment.map((item) => item.name);
  const canManage = isManagementRole(session.user.role);
  // Согласовано с DELETE /api/equipment/[id] на hasFullWorkspaceAccess.
  // Раньше head_chef видел список, но кнопка «Удалить» была скрыта.
  const canDelete = hasFullWorkspaceAccess({
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  });

  return (
    <div className="space-y-5">
      <PageGuide
        title="Как настроить оборудование"
        storageKey="settings-equipment-v1"
        bullets={[
          { title: "Сначала создайте цех", body: "Оборудование привязывается к помещению. Если цехов нет — откройте «Здания и помещения» (соседний раздел) и заведите хотя бы один." },
          { title: "Заполните min/max температуру", body: "Например, холодильник: 2°C - 6°C. Эти значения попадут в журнал температурного режима как нормативный диапазон. Сотрудник увидит «выход за пределы» сразу." },
          { title: "Tuya Device ID — опционально", body: "Если стоит WiFi-датчик температуры (HACCP/Aubess) — введите Device ID, и WeSetup сам будет писать показания в журнал каждый час." },
        ]}
        qa={[
          { q: "Что если у меня нет холодильников?", a: "Можно ничего не заводить — журнал температуры будет пустой. Но для большинства общепита нужен минимум 1 холодильник." },
          { q: "Tuya Device ID — где взять?", a: "В приложении Tuya / Smart Life: устройство → шестерёнка → Информация об устройстве → Виртуальный ID. Подробнее в /settings/integrations." },
        ]}
      />
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>

          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#f0edff] text-[#7a5cff]">
              <Wrench className="size-5" />
            </div>
            <div>
              <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
                Оборудование
              </h1>
              <p className="mt-0.5 text-[14px] text-[#6f7282]">
                Холодильники, датчики, печи — по цехам
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && equipment.length > 0 ? (
            <Link
              href="/settings/qr-posters?kind=equipment&layout=sheet"
              className="inline-flex h-10 items-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[14px] font-semibold text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
              title="Распечатать QR-наклейки для быстрой записи температуры с телефона"
            >
              <QrCode className="size-4" />
              QR-наклейки
            </Link>
          ) : null}
          {canManage && equipment.length > 0 ? (
            <Link
              href="/settings/qr-posters?kind=equipment"
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              title="Плакат A4 с QR-кодом на каждый холодильник: сотрудник сканирует и вносит температуру без входа"
            >
              <QrCode className="size-4 text-[#5566f6]" />
              Плакаты A4
            </Link>
          ) : null}
          {canManage && (
            <EquipmentDialog areas={areas} existingNames={equipmentNames} />
          )}
        </div>
      </div>

      {/* Content */}
      {equipment.length === 0 ? (
        <div className="rounded-2xl border border-[#ececf4] bg-white px-8 py-16 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#f0edff]">
            <Wrench className="size-7 text-[#7a5cff]" />
          </div>
          <h3 className="mt-5 text-[17px] font-semibold text-[#0b1024]">
            Оборудования пока нет
          </h3>
          <p className="mt-2 text-[14px] text-[#6f7282]">
            {canManage
              ? "Сначала добавьте цех, потом оборудование в нём."
              : "Администратор ещё не добавил оборудование."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full min-w-[720px] text-[15px]">
            <thead className="bg-[#f8f9fc] text-[13px] text-[#6f7282]">
              <tr>
                {/* Закреплена: на телефоне таблицу крутят вбок, и без
                    названия остаются безымянные строки. */}
                <th className="sticky left-0 z-10 bg-[#f8f9fc] px-6 py-3 text-left font-medium">
                  Название
                </th>
                <th className="px-6 py-3 text-left font-medium">Тип</th>
                <th className="px-6 py-3 text-left font-medium">Цех</th>
                <th className="px-6 py-3 text-left font-medium">T° диапазон</th>
                <th className="px-6 py-3 text-center font-medium">IoT</th>
                {canManage && (
                  <th className="w-[100px] px-6 py-3 text-right font-medium">
                    Действия
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {equipment.map((item) => {
                const reading = readings[item.id];
                const minutesAgo = reading
                  ? Math.round(
                      (Date.now() - reading.time.getTime()) / 60000
                    )
                  : null;
                const online =
                  minutesAgo !== null && minutesAgo <= 120;
                const outOfRange =
                  reading &&
                  ((item.tempMin != null && reading.temp < item.tempMin) ||
                    (item.tempMax != null && reading.temp > item.tempMax));

                return (
                  <tr
                    key={item.id}
                    className="border-t border-[#f0f1f8] transition-colors hover:bg-[#fafbff]"
                  >
                    <td className="sticky left-0 z-10 bg-white px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-lg bg-[#f5f3ff] text-[#7a5cff]">
                          <Thermometer className="size-4" />
                        </div>
                        <div>
                          <div className="font-medium text-[#0b1024]">
                            {item.name}
                          </div>
                          {item.serialNumber && (
                            <div className="text-[12px] text-[#9b9fb3]">
                              S/N {item.serialNumber}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[#6f7282]">
                      {TYPE_LABELS[item.type] ?? item.type}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 text-[14px] text-[#6f7282]">
                        <MapPin className="size-3" />
                        {item.area.name}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-[14px] text-[#0b1024]">
                      {tempRange(item.tempMin, item.tempMax)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {item.tuyaDeviceId ? (
                        <div className="inline-flex flex-col items-center gap-1">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                              online
                                ? "bg-[#ecfdf5] text-[#136b2a]"
                                : "bg-[#fff4f2] text-[#d2453d]"
                            }`}
                          >
                            {online ? (
                              <Wifi className="size-3" />
                            ) : (
                              <WifiOff className="size-3" />
                            )}
                            {online ? "Online" : "Offline"}
                          </span>
                          {reading && (
                            <span
                              className={`inline-flex items-center gap-1 text-[13px] font-semibold tabular-nums ${
                                outOfRange
                                  ? "text-[#d2453d]"
                                  : "text-[#136b2a]"
                              }`}
                            >
                              {outOfRange && (
                                <AlertTriangle className="size-3" />
                              )}
                              {reading.temp}°C
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[13px] text-[#c7ccea]">—</span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-1">
                          <CopyIdButton
                            id={item.id}
                            hint="Скопировать Equipment ID (для DIY-датчика, скрипта)"
                          />
                          <EquipmentDialog
                            areas={areas}
                            existingNames={equipmentNames}
                            equipment={{
                              id: item.id,
                              name: item.name,
                              type: item.type,
                              areaId: item.area.id,
                              serialNumber: item.serialNumber,
                              tempMin: item.tempMin,
                              tempMax: item.tempMax,
                              tuyaDeviceId: item.tuyaDeviceId ?? null,
                            }}
                          />
                          {canDelete && (
                            <DeleteButton
                              id={item.id}
                              endpoint="/api/equipment"
                              entityName={`оборудование «${item.name}»`}
                              usageEndpoint={`/api/equipment/${item.id}/usage`}
                            />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
