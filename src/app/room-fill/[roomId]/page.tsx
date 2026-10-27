import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { readRememberValue, rememberCookieName } from "@/lib/qr-remember";
import { passEmployeeIdFromCookie } from "@/lib/qr-object-pass";

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
import { ensureQrPeriodDocuments } from "@/lib/journal-qr-rollover";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { verifyQrFillTokenFor } from "@/lib/qr-fill-token";
import { orgTodayKey } from "@/lib/timezone";
import { getUserDisplayTitle } from "@/lib/user-roles";
import { redirect } from "next/navigation";
import { normalizeQrFillMode, sessionEmployeeForQr } from "@/lib/qr-fill-actor";
import { listRoomSiblings } from "@/lib/qr-fill-siblings";
import { filterAllowedFillers } from "@/lib/object-fillers";
import { stampFor } from "@/lib/quick-values";
import { hasPaidPlan } from "@/lib/plan-limits.server";
import { getReadingPhotoSettings } from "@/lib/reading-photo-fixation.server";
import { RoomFillClient } from "./room-fill-client";
import { composeRoomQrMessages } from "./room-fill-presentation";
import { decodeRouteParam } from "@/lib/route-param";
import { cache, type ReactNode } from "react";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { resolveLocale } from "@/i18n/locales";
import { SITE_LOCALE_COOKIE } from "@/i18n/site-locale";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { loadMessages, pickMessages } from "@/i18n/messages";
import { SiteLocaleProvider } from "@/components/i18n/site-locale-provider";
import { QrFillPresentationProvider } from "@/components/qr-fill/qr-fill-presentation";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { customJournalName } from "@/lib/custom-names";
import { normalizeUserRole } from "@/lib/user-roles";
import { employeeWorksAtQrPoint, filterByQrPoint, loadQrPointScope } from "@/lib/qr-point-roster";
import { OtherPointScreen } from "@/components/qr-fill/other-point-screen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ссылка с подписанным токеном плаката — не индексировать.
async function selectedLocale(organizationLocale: string | null) {
  const [session, jar] = await Promise.all([getServerSession(authOptions), cookies()]);
  return { authenticated: Boolean(session), locale: resolveLocale({ authenticated: Boolean(session), userLocale: session?.user.locale, cookieLocale: jar.get(SITE_LOCALE_COOKIE)?.value, organizationLocale }) };
}

const findRoom = cache(async (roomId: string) => db.room.findUnique({
  where: { id: roomId },
  select: {
    id: true, name: true, climateNorms: true, buildingId: true, fillerUserIds: true,
    building: { select: { name: true, organizationId: true, organization: { select: { name: true, timezone: true, qrFillMode: true, locale: true } } } },
  },
}));

type PageProps = { params: Promise<{ roomId: string }>; searchParams: Promise<{ token?: string }> };

export async function generateMetadata({ params, searchParams }: PageProps) {
  const roomId = decodeRouteParam((await params).roomId);
  const { token } = await searchParams;
  const room = token && verifyQrFillTokenFor(token, "room", roomId).ok ? await findRoom(roomId) : null;
  const locale = room ? (await selectedLocale(room.building.organization.locale)).locale : await getSiteLocale();
  const messages = await loadMessages(locale);
  return { title: messages.roomFill.page.metadataTitle, robots: { index: false, follow: false } };
}

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
  const roomId = decodeRouteParam((await params).roomId);
  const { token } = await searchParams;
  if (!token) notFound();

  const verify = verifyQrFillTokenFor(token, "room", roomId);
  if (!verify.ok) {
    const messages = await loadMessages(await getSiteLocale());
    console.warn(`[qr-fill] poster rejected kind=room reason=${verify.reason}`);
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafbff] px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(11,16,36,0.2)]">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#fff4f2] text-2xl text-[#a13a32]">
            !
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {messages.equipmentFill.page.invalidTitle}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
            {messages.roomFill.page.invalidDescription}
          </p>
        </div>
      </main>
    );
  }

  const room = await findRoom(roomId);
  if (!room) notFound();

  const organizationId = room.building.organizationId;
  const timezone = room.building.organization.timezone || "Europe/Moscow";
  const [{ locale, authenticated }, customNames] = await Promise.all([selectedLocale(room.building.organization.locale), getOrgCustomNames(organizationId)]);
  const messages = await loadMessages(locale);
  const roomCopy = composeRoomQrMessages(messages);
  const wrap = (children: ReactNode) => <SiteLocaleProvider locale={locale} messages={pickMessages(messages, ["roomFill", "equipmentFill", "language"])} timeZone={timezone}><QrFillPresentationProvider locale={locale} messages={roomCopy} authenticated={authenticated}>{children}</QrFillPresentationProvider></SiteLocaleProvider>;
  const position = (person: Parameters<typeof getUserDisplayTitle>[0]) => {
    if (person?.jobPosition?.name?.trim() || person?.positionTitle?.trim()) return getUserDisplayTitle(person);
    const role = normalizeUserRole(person?.role);
    return Object.hasOwn(messages.staffManagement.roleLabels, role) ? messages.staffManagement.roleLabels[role as keyof typeof messages.staffManagement.roleLabels] : getUserDisplayTitle(person);
  };
  // Режим QR-форм организации: в «auth» без сессии — на вход и обратно.
  const qrMode = normalizeQrFillMode(room.building.organization.qrFillMode);
  let sessionEmployee: { id: string; name: string; positionTitle: string | null; canPickOthers: boolean } | null = null;
  if (qrMode === "auth") {
    const resolved = await sessionEmployeeForQr(organizationId);
    if (!resolved.ok && resolved.reason === "no-session") {
      redirect(`/login?next=${encodeURIComponent(`/room-fill/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`)}`);
    }
    if (resolved.ok) sessionEmployee = resolved.employee;
  }
  // Точка помещения: в списке только её сотрудники.
  const pointScope = await loadQrPointScope(organizationId, room.buildingId);
  if (sessionEmployee && !sessionEmployee.canPickOthers && !(await employeeWorksAtQrPoint(pointScope, sessionEmployee.id))) {
    return wrap(
      <OtherPointScreen
        title={messages.roomFill.page.otherPointTitle}
        description={messages.equipmentFill.page.otherPointDescription}
        pointName={pointScope?.buildingName ?? ""}
      />
    );
  }
  const now = new Date();
  const dateKey = orgTodayKey(timezone, now);
  const day = new Date(`${dateKey}T00:00:00.000Z`);

  // Первый скан нового периода: документ климата точки создаётся по
  // образцу прошлого (те же помещения и сроки), форма работает как обычно.
  await ensureQrPeriodDocuments({
    organizationId,
    templateCode: CLIMATE_DOCUMENT_TEMPLATE_CODE,
    todayKey: dateKey,
    anchor: { buildingId: room.buildingId },
    source: "room-fill",
  });
  const [employees, documents, photoAutofill, photoFixation] = await Promise.all([
    db.user.findMany({
      where: { organizationId, ...ORG_ROSTER_WHERE },
      select: { id: true, name: true, role: true, positionTitle: true, qrPinHash: true, canManageSettings: true, buildingIds: true, jobPosition: { select: { name: true } } },
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
    // «Фото» у температуры — всем; автоввод показания со снимка — на платном тарифе.
    hasPaidPlan(organizationId),
    // «Фотофиксация показаний»: «Сфотографируйте показание» первым действием / выключена / фото обязательно.
    getReadingPhotoSettings(organizationId, "climate_control"),
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

  return wrap(
    <RoomFillClient
      token={token}
      journalTitle={customJournalName(customNames, CLIMATE_DOCUMENT_TEMPLATE_CODE) ?? messages.roomFill.page.journalTitle}
      todayValues={siblings.find((item) => item.current)?.values ?? null}
      stamp={stampFor(timezone, now)}
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
      rememberedEmployeeId={qrMode === "auth" ? null : readRememberValue(organizationId, (await cookies()).get(rememberCookieName(organizationId))?.value)?.employeeId ?? null}
      passEmployeeId={qrMode === "auth" ? null : await passEmployeeIdFromCookie(organizationId)}
      photoAutofill={photoAutofill}
      photoFixation={photoFixation}
      employees={(sessionEmployee && !sessionEmployee.canPickOthers
        ? employees.filter((employee) => employee.id === sessionEmployee!.id)
        : filterAllowedFillers(filterByQrPoint(employees, pointScope), room.fillerUserIds)
      ).map((employee) => ({
        id: employee.id,
        name: employee.name,
        position: position(employee),
        hasPin: Boolean(employee.qrPinHash),
      }))}
    />
  );
}
