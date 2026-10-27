import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { readRememberValue, rememberCookieName } from "@/lib/qr-remember";
import { passEmployeeIdFromCookie } from "@/lib/qr-object-pass";
import { db } from "@/lib/db";
import { verifyEquipmentQrToken } from "@/lib/equipment-qr-token";
import { resolveEquipmentFillTargets, resolveFryerFillTarget } from "@/lib/equipment-fill-targets";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { orgTodayKey } from "@/lib/timezone";
import { redirect } from "next/navigation";
import { normalizeQrFillMode, sessionEmployeeForQr } from "@/lib/qr-fill-actor";
import { listEquipmentSiblings } from "@/lib/qr-fill-siblings";
import { filterAllowedFillers } from "@/lib/object-fillers";
import { stampFor } from "@/lib/quick-values";
import { getUserDisplayTitle } from "@/lib/user-roles";
import { EquipmentFillClient } from "./equipment-fill-client";
import { UvLampClient } from "./uv-lamp-client";
import { FryerFillClient } from "./fryer-fill-client";
import { isFryerEquipmentType } from "@/lib/fryer-oil-equipment-link";
import { formatTime, FRYER_OIL_TEMPLATE_CODE } from "@/lib/fryer-oil-document";
import { isUvLampEquipment } from "@/lib/uv-lamp";
import { employeeWorksAtQrPoint, filterByQrPoint, loadQrPointScope } from "@/lib/qr-point-roster";
import { qrRosterPosition } from "@/lib/point-assignments";
import { UV_LAMP_RUNTIME_TEMPLATE_CODE } from "@/lib/uv-lamp-runtime-document";
import { lampState, listLampOperators } from "@/lib/uv-lamp-runs";
import { hasPaidPlan } from "@/lib/plan-limits.server";
import { getReadingPhotoSettings } from "@/lib/reading-photo-fixation.server";
import { decodeRouteParam } from "@/lib/route-param";
import type { ReactNode } from "react";
import { OtherPointScreen } from "@/components/qr-fill/other-point-screen";
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
  const equipmentId = decodeRouteParam((await params).equipmentId);
  const { token } = await searchParams;
  if (!token) notFound();

  const verify = verifyEquipmentQrToken(token);
  if (!verify.ok || verify.equipmentId !== equipmentId) {
    const messages = await loadMessages(await getSiteLocale());
    console.warn(
      `[qr-fill] sticker rejected kind=equipment reason=${verify.ok ? "id-mismatch" : verify.reason}`
    );
    return (
      <main className="min-h-screen bg-[#fafbff] flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(11,16,36,0.2)]">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#fff4f2] text-[#a13a32] text-2xl">
            !
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {messages.equipmentFill.page.invalidTitle}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
            {messages.equipmentFill.page.invalidDescription}
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
      type: true,
      fillerUserIds: true,
      area: {
        select: {
          id: true,
          name: true,
          organizationId: true,
          buildingId: true,
          organization: { select: { name: true, timezone: true, qrFillMode: true, locale: true } },
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
  const [session, jar, customNames] = await Promise.all([getServerSession(authOptions), cookies(), getOrgCustomNames(organizationId)]);
  const locale = resolveLocale({ authenticated: Boolean(session), userLocale: session?.user.locale, cookieLocale: jar.get(SITE_LOCALE_COOKIE)?.value, organizationLocale: equipment.area.organization.locale });
  const messages = await loadMessages(locale);
  const wrap = (children: ReactNode) => <SiteLocaleProvider locale={locale} messages={pickMessages(messages, ["equipmentFill", "language"])} timeZone={equipment.area.organization.timezone || "Europe/Moscow"}><QrFillPresentationProvider locale={locale} messages={messages.equipmentFill} authenticated={Boolean(session)}>{children}</QrFillPresentationProvider></SiteLocaleProvider>;
  const position = (person: Parameters<typeof getUserDisplayTitle>[0]) => {
    if (person?.jobPosition?.name?.trim() || person?.positionTitle?.trim()) return getUserDisplayTitle(person);
    const role = normalizeUserRole(person?.role);
    return Object.hasOwn(messages.staffManagement.roleLabels, role) ? messages.staffManagement.roleLabels[role as keyof typeof messages.staffManagement.roleLabels] : getUserDisplayTitle(person);
  };
  // Режим QR-форм организации: в «auth» без сессии — на вход и обратно.
  const qrMode = normalizeQrFillMode(equipment.area.organization.qrFillMode);
  let sessionEmployee: { id: string; name: string; positionTitle: string | null; canPickOthers: boolean } | null = null;
  if (qrMode === "auth") {
    const resolved = await sessionEmployeeForQr(organizationId);
    if (!resolved.ok && resolved.reason === "no-session") {
      redirect(`/login?next=${encodeURIComponent(`/equipment-fill/${encodeURIComponent(equipmentId)}?token=${encodeURIComponent(token)}`)}`);
    }
    if (resolved.ok) sessionEmployee = resolved.employee;
  }

  // Пропуск после PIN в cookie организации (30 минут): F5 и соседняя
  // наклейка — без PIN, если выбран тот же сотрудник.
  const passEmployeeId = qrMode === "auth" ? null : await passEmployeeIdFromCookie(organizationId);

  // Точка оборудования — точка его цеха: в списке только её сотрудники.
  const pointScope = await loadQrPointScope(organizationId, equipment.area.buildingId);
  if (sessionEmployee && !sessionEmployee.canPickOthers && !(await employeeWorksAtQrPoint(pointScope, sessionEmployee.id))) {
    return wrap(
      <OtherPointScreen
        title={messages.equipmentFill.page.otherPointTitle}
        description={messages.equipmentFill.page.otherPointDescription}
        pointName={pointScope?.buildingName ?? ""}
      />
    );
  }

  // УФ-лампа: «Я включил / Я выключил» вместо замера (2026-09-22).
  if (isUvLampEquipment(equipment)) {
    const lampTz = equipment.area.organization.timezone || "Europe/Moscow";
    const [operators, state] = await Promise.all([
      listLampOperators({ organizationId, fillerUserIds: equipment.fillerUserIds, documentResponsibleId: null, pointScope }),
      lampState(equipment.id, lampTz),
    ]);
    const list = sessionEmployee && !sessionEmployee.canPickOthers ? operators.filter((e) => e.id === sessionEmployee!.id) : operators;
    return wrap(
      <UvLampClient
        token={token}
        organizationName={equipment.area.organization.name}
        lamp={{ id: equipment.id, name: equipment.name, areaName: equipment.area.name }}
        employees={list.map((e) => ({ id: e.id, name: e.name, positionTitle: qrRosterPosition(pointScope?.substituteUserIds, e.id, position(e), messages.equipmentFill.page.substitute) || null, hasPin: Boolean(e.qrPinHash) }))}
        journalTitle={customJournalName(customNames, UV_LAMP_RUNTIME_TEMPLATE_CODE) ?? messages.equipmentFill.uv.title}
        mode={qrMode}
        sessionEmployee={sessionEmployee}
        rememberedEmployeeId={qrMode === "auth" ? null : readRememberValue(organizationId, (await cookies()).get(rememberCookieName(organizationId))?.value)?.employeeId ?? null}
        passEmployeeId={passEmployeeId}
        initialState={state ?? { running: null, lifetimeHours: null, usedHours: 0, remainingHours: null }}
      />
    );
  }

  // Фритюрница: форма журнала фритюрных жиров вместо замера (2026-10-17).
  // Цель записи решает тот же код, что и POST (`resolveFryerFillTarget`).
  if (isFryerEquipmentType(equipment.type)) {
    const fryerTz = equipment.area.organization.timezone || "Europe/Moscow";
    const fryerDay = new Date(`${orgTodayKey(fryerTz, new Date())}T00:00:00.000Z`);
    const [roster, target] = await Promise.all([
      db.user.findMany({
        where: { organizationId, ...ORG_ROSTER_WHERE },
        select: { id: true, name: true, role: true, positionTitle: true, qrPinHash: true, canManageSettings: true, buildingIds: true, jobPosition: { select: { name: true } } },
        orderBy: { name: "asc" },
      }),
      resolveFryerFillTarget({
        equipment: { id: equipment.id, name: equipment.name, buildingId: equipment.area.buildingId },
        organizationId,
        day: fryerDay,
      }),
    ]);
    const startedRow = target && target.row.kind === "existing" && target.phase === "end" ? target.row.entry.data : null;
    // Прошлый жир/продукция могли уйти из списка документа — показываем и их.
    const withLast = (list: string[], last: string | undefined) =>
      last && !list.includes(last) ? [last, ...list] : list;
    return wrap(
      <FryerFillClient
        token={token}
        organizationName={equipment.area.organization.name}
        journalTitle={customJournalName(customNames, FRYER_OIL_TEMPLATE_CODE) ?? messages.equipmentFill.fryer.title}
        fryer={{ id: equipment.id, name: equipment.name }}
        employees={(sessionEmployee && !sessionEmployee.canPickOthers
          ? roster.filter((e) => e.id === sessionEmployee!.id)
          : filterAllowedFillers(filterByQrPoint(roster, pointScope), equipment.fillerUserIds)
        ).map((e) => ({ id: e.id, name: e.name, positionTitle: qrRosterPosition(pointScope?.substituteUserIds, e.id, position(e), messages.equipmentFill.page.substitute) || null, hasPin: Boolean(e.qrPinHash) }))}
        mode={qrMode}
        sessionEmployee={sessionEmployee}
        rememberedEmployeeId={qrMode === "auth" ? null : readRememberValue(organizationId, (await cookies()).get(rememberCookieName(organizationId))?.value)?.employeeId ?? null}
        passEmployeeId={passEmployeeId}
        target={
          target
            ? {
                phase: target.phase,
                fatTypes: withLast(target.config.lists.fatTypes, target.last?.fatType),
                productTypes: withLast(target.config.lists.productTypes, target.last?.productType),
                defaults: {
                  fatType: target.last?.fatType || target.config.lists.fatTypes[0] || "",
                  productType: target.last?.productType || target.config.lists.productTypes[0] || "",
                },
                started: startedRow
                  ? { time: formatTime(startedRow.startHour, startedRow.startMinute), fatType: startedRow.fatType, productType: startedRow.productType }
                  : null,
              }
            : null
        }
      />
    );
  }

  // Employees who can be named as the reader. Набор тот же, что проверяет
  // POST (`ORG_ROSTER_WHERE`): иначе ROOT попадал в список, а сохранение
  // отвечало «Сотрудник не найден».
  // Цели записи считаем тем же кодом, что и POST: человек должен увидеть
  // «журнала на сегодня нет» до ввода, а не после «Сохранить» (409).
  const timezone = equipment.area.organization.timezone || "Europe/Moscow";
  const day = new Date(`${orgTodayKey(timezone, new Date())}T00:00:00.000Z`);
  const [employees, targets, photoAutofill, photoFixation] = await Promise.all([
    db.user.findMany({
      where: { organizationId, ...ORG_ROSTER_WHERE },
      select: { id: true, name: true, role: true, positionTitle: true, qrPinHash: true, canManageSettings: true, buildingIds: true, jobPosition: { select: { name: true } } },
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
    // «Фото» у температуры — всем; автоввод показания со снимка — на платном тарифе.
    hasPaidPlan(organizationId),
    // «Фотофиксация показаний»: «Сфотографируйте показание» первым действием / выключена / фото обязательно.
    getReadingPhotoSettings(organizationId, "cold_equipment_control"),
  ]);

  // Смены объекта на наклейке нет (владелец, 2026-09-22): замер — только у
  // этого холодильника. Список соседей нужен лишь для сегодняшнего значения.
  const siblings = await listEquipmentSiblings({
    organizationId,
    currentEquipmentId: equipment.id,
    currentEquipmentName: equipment.name,
    day,
  });

  return wrap(
    <EquipmentFillClient
      token={token}
      organizationName={equipment.area.organization.name}
      journalTitle={customJournalName(customNames, "cold_equipment_control") ?? messages.equipmentFill.page.journalTitle}
      todayValues={siblings.find((item) => item.current)?.values ?? null}
      stamp={stampFor(timezone)}
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
      rememberedEmployeeId={qrMode === "auth" ? null : readRememberValue(organizationId, (await cookies()).get(rememberCookieName(organizationId))?.value)?.employeeId ?? null}
      passEmployeeId={passEmployeeId}
      photoAutofill={photoAutofill}
      photoFixation={photoFixation}
      employees={(sessionEmployee && !sessionEmployee.canPickOthers
        ? employees.filter((e) => e.id === sessionEmployee!.id)
        : filterAllowedFillers(filterByQrPoint(employees, pointScope), equipment.fillerUserIds)
      ).map((e) => ({
        id: e.id,
        name: e.name,
        positionTitle: qrRosterPosition(pointScope?.substituteUserIds, e.id, position(e), messages.equipmentFill.page.substitute) || null,
        hasPin: Boolean(e.qrPinHash),
      }))}
    />
  );
}
