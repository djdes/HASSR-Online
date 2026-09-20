import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { buildingWhere } from "@/lib/building-scope";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  DEFAULT_CLIMATE_HUMIDITY,
  DEFAULT_CLIMATE_TEMPERATURE,
  normalizeClimateDocumentConfig,
  normalizeClimateRoomNorms,
} from "@/lib/climate-document";
import { findClimateRowForRoom, pickNearestControlTime } from "@/lib/climate-fill";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { verifyQrFillTokenFor } from "@/lib/qr-fill-token";
import { orgTodayKey } from "@/lib/timezone";
import { getUserDisplayTitle } from "@/lib/user-roles";
import { redirect } from "next/navigation";
import { normalizeQrFillMode, sessionEmployeeForQr } from "@/lib/qr-fill-actor";
import { listRoomSiblings } from "@/lib/qr-fill-siblings";
import { RoomFillClient } from "./room-fill-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ссылка с подписанным токеном плаката — не индексировать.
export const metadata = {
  title: "Замер температуры и влажности",
  robots: { index: false, follow: false },
};

/**
 * Публичная страница QR-плаката склада. Входа нет: доступ даёт токен из
 * ссылки. Сотрудник выбирает себя (запоминается на телефоне), вводит
 * температуру и влажность — запись ложится в журнал за сегодня.
 */
export default async function RoomFillPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { roomId } = await params;
  const { token } = await searchParams;
  if (!token) notFound();

  const verify = verifyQrFillTokenFor(token, "room", roomId);
  if (!verify.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafbff] px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(11,16,36,0.2)]">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#fff4f2] text-2xl text-[#a13a32]">
            !
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            Ссылка недействительна
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
            Плакат повреждён или не подходит к этому помещению.
          </p>
        </div>
      </main>
    );
  }

  const room = await db.room.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      name: true,
      climateNorms: true,
      buildingId: true,
      building: {
        select: {
          name: true,
          organizationId: true,
          organization: { select: { name: true, timezone: true, qrFillMode: true } },
        },
      },
    },
  });
  if (!room) notFound();

  const organizationId = room.building.organizationId;
  const timezone = room.building.organization.timezone || "Europe/Moscow";
  // Режим QR-форм организации: в «auth» без сессии — на вход и обратно.
  const qrMode = normalizeQrFillMode(room.building.organization.qrFillMode);
  let sessionEmployee: { id: string; name: string; positionTitle: string | null; canPickOthers: boolean } | null = null;
  if (qrMode === "auth") {
    const resolved = await sessionEmployeeForQr(organizationId);
    if (!resolved.ok && resolved.reason === "no-session") {
      redirect(`/login?next=${encodeURIComponent(`/room-fill/${roomId}?token=${encodeURIComponent(token)}`)}`);
    }
    if (resolved.ok) sessionEmployee = resolved.employee;
  }
  const now = new Date();
  const dateKey = orgTodayKey(timezone, now);
  const day = new Date(`${dateKey}T00:00:00.000Z`);

  const [employees, documents] = await Promise.all([
    db.user.findMany({
      where: { organizationId, ...ORG_ROSTER_WHERE },
      select: { id: true, name: true, role: true, positionTitle: true, jobPosition: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    db.journalDocument.findMany({
      where: {
        organizationId,
        status: "active",
        template: { code: CLIMATE_DOCUMENT_TEMPLATE_CODE },
        dateFrom: { lte: day },
        dateTo: { gte: day },
        ...buildingWhere(room.buildingId),
      },
      select: { id: true, config: true, buildingId: true },
      orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const document =
    documents.find((doc) => findClimateRowForRoom(normalizeClimateDocumentConfig(doc.config), roomId)) ??
    documents.find((doc) => doc.buildingId === room.buildingId) ??
    documents[0] ??
    null;
  const config = document ? normalizeClimateDocumentConfig(document.config) : null;
  const row = config ? findClimateRowForRoom(config, roomId) : null;
  const directoryNorms = normalizeClimateRoomNorms(room.climateNorms);
  const norms = {
    temperature: row?.temperature ?? directoryNorms?.temperature ?? DEFAULT_CLIMATE_TEMPERATURE,
    humidity: row?.humidity ?? directoryNorms?.humidity ?? DEFAULT_CLIMATE_HUMIDITY,
  };

  const siblings = await listRoomSiblings({
    organizationId,
    buildingId: room.buildingId,
    currentRoomId: room.id,
    currentRoomName: row?.name ?? room.name,
    day,
    now,
    timezone,
  });

  return (
    <RoomFillClient
      token={token}
      siblings={siblings}
      room={{
        id: room.id,
        name: row?.name ?? room.name,
        buildingName: room.building.name,
        organizationName: room.building.organization.name,
      }}
      norms={norms}
      hasActiveDocument={Boolean(document)}
      nextSlot={config ? pickNearestControlTime(config.controlTimes, now, timezone) : null}
      mode={qrMode}
      sessionEmployee={sessionEmployee}
      employees={(sessionEmployee && !sessionEmployee.canPickOthers
        ? employees.filter((employee) => employee.id === sessionEmployee!.id)
        : employees
      ).map((employee) => ({
        id: employee.id,
        name: employee.name,
        position: getUserDisplayTitle(employee),
      }))}
    />
  );
}
