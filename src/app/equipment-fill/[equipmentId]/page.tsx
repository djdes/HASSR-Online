import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { verifyEquipmentQrToken } from "@/lib/equipment-qr-token";
import { resolveEquipmentFillTargets } from "@/lib/equipment-fill-targets";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { orgTodayKey } from "@/lib/timezone";
import { redirect } from "next/navigation";
import { normalizeQrFillMode, sessionEmployeeForQr } from "@/lib/qr-fill-actor";
import { listEquipmentSiblings } from "@/lib/qr-fill-siblings";
import { getUserDisplayTitle } from "@/lib/user-roles";
import { EquipmentFillClient } from "./equipment-fill-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// QR-sticker URL с HMAC-токеном — не индексировать.
export const metadata = {
  robots: { index: false, follow: false },
};

/**
 * Public page opened when someone scans the QR sticker on a fridge /
 * chamber. No WeSetup session — auth is the HMAC `?token=…` from the
 * sticker.
 *
 * Worker picks their name once (cached in localStorage for next scan),
 * enters today's temperature, taps «Сохранить» — and today's
 * cold_equipment_control row is upserted under their name.
 */
export default async function EquipmentFillPage({
  params,
  searchParams,
}: {
  params: Promise<{ equipmentId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { equipmentId } = await params;
  const { token } = await searchParams;
  if (!token) notFound();

  const verify = verifyEquipmentQrToken(token);
  if (!verify.ok || verify.equipmentId !== equipmentId) {
    return (
      <main className="min-h-screen bg-[#fafbff] flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(11,16,36,0.2)]">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#fff4f2] text-[#a13a32] text-2xl">
            !
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            Ссылка недействительна
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
            Наклейка повреждена или не подходит к этому оборудованию.
          </p>
        </div>
      </main>
    );
  }

  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId },
    select: {
      id: true,
      name: true,
      tempMin: true,
      tempMax: true,
      area: {
        select: {
          id: true,
          name: true,
          organizationId: true,
          organization: { select: { timezone: true, qrFillMode: true } },
        },
      },
      sensorMappings: {
        select: {
          id: true,
          readingType: true,
          fieldKey: true,
          template: { select: { code: true, name: true } },
        },
      },
    },
  });
  if (!equipment) notFound();

  // Если у оборудования есть sensor mapping на climate_control с
  // readingType=humidity — добавляем поле «Влажность» в форму. По
  // тому же принципу можно расширить на другие journal-templates.
  const hasHumidityField = equipment.sensorMappings.some(
    (m) =>
      m.readingType === "humidity" && m.template.code === "climate_control"
  );

  const organizationId = equipment.area.organizationId;
  // Режим QR-форм организации: в «auth» без сессии — на вход и обратно.
  const qrMode = normalizeQrFillMode(equipment.area.organization.qrFillMode);
  let sessionEmployee: { id: string; name: string; positionTitle: string | null; canPickOthers: boolean } | null = null;
  if (qrMode === "auth") {
    const resolved = await sessionEmployeeForQr(organizationId);
    if (!resolved.ok && resolved.reason === "no-session") {
      redirect(`/login?next=${encodeURIComponent(`/equipment-fill/${equipmentId}?token=${encodeURIComponent(token)}`)}`);
    }
    if (resolved.ok) sessionEmployee = resolved.employee;
  }

  // Employees who can be named as the reader. Набор тот же, что проверяет
  // POST (`ORG_ROSTER_WHERE`): иначе ROOT попадал в список, а сохранение
  // отвечало «Сотрудник не найден».
  // Цели записи считаем тем же кодом, что и POST: человек должен увидеть
  // «журнала на сегодня нет» до ввода, а не после «Сохранить» (409).
  const timezone = equipment.area.organization.timezone || "Europe/Moscow";
  const day = new Date(`${orgTodayKey(timezone, new Date())}T00:00:00.000Z`);
  const [employees, targets] = await Promise.all([
    db.user.findMany({
      where: { organizationId, ...ORG_ROSTER_WHERE },
      select: { id: true, name: true, role: true, positionTitle: true, jobPosition: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    resolveEquipmentFillTargets({
      equipment: {
        id: equipment.id,
        areaId: equipment.area.id,
        areaName: equipment.area.name,
      },
      organizationId,
      day,
    }),
  ]);

  const siblings = await listEquipmentSiblings({
    organizationId,
    currentEquipmentId: equipment.id,
    currentEquipmentName: equipment.name,
    day,
  });

  return (
    <EquipmentFillClient
      token={token}
      siblings={siblings}
      hasActiveDocument={targets.hasActiveDocument}
      humidityNorm={
        targets.climate?.row.humidity.enabled
          ? {
              min: targets.climate.row.humidity.min,
              max: targets.climate.row.humidity.max,
            }
          : null
      }
      equipment={{
        id: equipment.id,
        name: equipment.name,
        tempMin: equipment.tempMin ?? null,
        tempMax: equipment.tempMax ?? null,
        areaName: equipment.area.name,
        hasHumidityField,
      }}
      mode={qrMode}
      sessionEmployee={sessionEmployee}
      employees={(sessionEmployee && !sessionEmployee.canPickOthers ? employees.filter((e) => e.id === sessionEmployee!.id) : employees).map((e) => ({
        id: e.id,
        name: e.name,
        positionTitle: getUserDisplayTitle(e) || null,
      }))}
    />
  );
}
