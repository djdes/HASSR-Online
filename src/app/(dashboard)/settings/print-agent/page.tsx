import Link from "next/link";
import { forbidden } from "next/navigation";
import { ArrowRight, Download, Printer, Tag, Tags } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { buildingInScope, isPointScoped, staffInScope } from "@/lib/point-scope";
import { loadBuildingContext } from "@/lib/active-building";
import { viewedPointId } from "@/lib/building-scope";
import { canManageAgentPoint } from "@/lib/print-point-routing";
import { db } from "@/lib/db";
import { isAgentOnline } from "@/lib/print-agent-auth";
import { brandQrSvg } from "@/lib/brand-qr";
import { compareAppVersions, setupHelperDownloadUrl } from "@/lib/setup-helper";
import { readSetupHelperRelease } from "@/lib/setup-helper-release";
import { LABEL_EXPIRED_WINDOW_MS, LABEL_SOON_MS } from "@/lib/label-prints";
import { orgDayStartInstant } from "@/lib/timezone";
import { PageHeader } from "@/components/ui/page-header";
import { PrintAgentCard } from "@/components/dashboard/print-agent-card";
import { PrintAgentSettingsClient } from "./print-agent-settings-client";
import { LabelPrintersClient } from "./label-printers-client";
import { getLocale, getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { isLocale } from "@/i18n/locales";

export const dynamic = "force-dynamic";

/**
 * Подключение программы «Онлайн принтер».
 *
 * Токен здесь НЕ выдаётся и не показывается: программа получает его сама,
 * когда человек вводит в ней свой обычный логин и пароль от Wesetup. Одна
 * копипаста секрета — одна возможность его потерять, поэтому её тут нет.
 * Страница нужна для другого: скачать программу, увидеть подключённые
 * машины и отключить лишнюю.
 */
export default async function PrintAgentSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // Точка в шапке (аудит 2026-11-01): принтеры и счётчики этикеток — её и
  // общие, как на «Этикетках»; «Вся организация» — всё.
  const viewedPoint = viewedPointId(await loadBuildingContext(session));
  const atPoint = viewedPoint ? { OR: [{ buildingId: viewedPoint }, { buildingId: null }] } : {};
  const [t, labels, labelLog, locale] = await Promise.all([
    getTranslations("printAgent.settings.page"),
    getTranslations("printAgent.labelPrinters"),
    getTranslations("printAgent.labelLog"),
    getLocale(),
  ]);

  const [agents, labelPrinters, helperDevices, organization, release] = await Promise.all([
    db.printAgent.findMany({
      where: { organizationId, revokedAt: null, ...atPoint },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        name: true,
        printerName: true,
        agentVersion: true,
        lastSeenAt: true,
        createdAt: true,
        buildingId: true,
        building: { select: { name: true } },
      },
    }),
    // Принтеры этикеток из «Сетап помощника» — сюда их пишет телефон
    // (`/api/setup-helper/sync`), как только у него появится сеть.
    db.labelPrinter.findMany({
      where: { organizationId, removedAt: null },
      orderBy: { connectedAt: "desc" },
      select: {
        id: true,
        name: true,
        model: true,
        address: true,
        transport: true,
        connectedAt: true,
        connectedById: true,
        lastPrintAt: true,
        lastTemplate: true,
        device: { select: { name: true } },
      },
    }),
    db.setupHelperDevice.findMany({
      where: { organizationId, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, name: true, userId: true, appVersion: true, lastSeenAt: true },
    }),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    // Версия APK на сайте: её же видит приложение и обновляется само.
    readSetupHelperRelease(),
  ]);
  // Сводка журнала маркировки: этикетки из приложения (`label_printed`).
  const now = new Date();
  const [printedToday, expiringSoon, expiredRecently] = await Promise.all([
    db.labelPrint.aggregate({
      where: { organizationId, printedAt: { gte: orgDayStartInstant(organization?.timezone || "Europe/Moscow", now) }, ...atPoint },
      _count: { _all: true },
      _sum: { copies: true },
    }),
    db.labelPrint.count({
      where: { organizationId, until: { gt: now, lte: new Date(now.getTime() + LABEL_SOON_MS) }, ...atPoint },
    }),
    db.labelPrint.count({
      where: { organizationId, until: { gt: new Date(now.getTime() - LABEL_EXPIRED_WINDOW_MS), lte: now }, ...atPoint },
    }),
  ]);
  const helperUserIds = [
    ...new Set([
      ...helperDevices.map((device) => device.userId),
      ...labelPrinters.flatMap((printer) => (printer.connectedById ? [printer.connectedById] : [])),
    ]),
  ];
  const helperUsers = helperUserIds.length
    ? await db.user.findMany({
        where: { id: { in: helperUserIds }, organizationId },
        select: { id: true, name: true, buildingIds: true },
      })
    : [];
  const userName = new Map(helperUsers.map((user) => [user.id, user.name]));
  // Руководитель точки видит и отключает телефоны только людей своих точек
  // (аудит точек, 2026-11-01) — как `/api/setup-helper/devices/[id]/revoke`.
  const userPoints = new Map(helperUsers.map((user) => [user.id, user.buildingIds]));
  const visibleHelperDevices = helperDevices.filter((device) => staffInScope(session.user, userPoints.get(device.userId) ?? []));
  // Принтер своей точки (2026-11-01): руководитель точки видит и ставит на
  // точку только принтеры своих точек; выбор точки — когда журналы ведутся
  // по точкам.
  const pointScope = session.user.pointScope ?? null;
  const visibleAgents = agents.filter((agent) => canManageAgentPoint({ scope: pointScope, current: agent.buildingId }));
  const buildingContext = await loadBuildingContext(session);
  const agentPoints = buildingContext.enabled
    ? buildingContext.buildings
        .filter((building) => buildingInScope(session.user, building.id))
        .map((building) => ({ id: building.id, name: building.name }))
    : [];
  // Ссылку открывают с телефона, поэтому QR рядом с кнопкой: навёл камеру —
  // скачал. SVG собирает brandQrSvg из адреса сайта, ввода пользователя в нём нет.
  const downloadQr = await brandQrSvg(setupHelperDownloadUrl(), { locale: isLocale(locale) ? locale : "ru" });

  return (
    <DomainMessagesBoundary namespaces={["printAgent", "journalControls"]}>
    <div className="space-y-5">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
      />

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Printer className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
              {t("how")}
            </h2>
            <ol className="mt-3 space-y-2 text-[14px] leading-[1.55] text-[#3c4053]">
              <li>
                <b>1.</b> {t("downloadStep")}
              </li>
              <li>
                <b>2.</b> {t.rich("installStep", { filename: "Установить.bat", file: chunks => <b>{chunks}</b> })}
              </li>
              <li>
                <b>3.</b> {t("printStep")}
              </li>
            </ol>
            <p className="mt-3 rounded-2xl bg-[#fff8eb] px-4 py-2.5 text-[13px] leading-snug text-[#7a4a00]">
              {t.rich("windows", { shortcut: "Win+R → netplwiz", command: chunks => <b>{chunks}</b> })}
            </p>
            <p className="mt-2 text-[13px] leading-snug text-[#6f7282]">
              {t("credentials")}
            </p>
          </div>
        </div>
      </section>

      <PrintAgentSettingsClient
        agents={visibleAgents.map((a) => ({
          id: a.id,
          name: a.name,
          printerName: a.printerName,
          agentVersion: a.agentVersion,
          lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
          online: isAgentOnline(a.lastSeenAt),
          buildingId: a.buildingId ?? null,
          buildingName: a.building?.name ?? null,
        }))}
        points={agentPoints}
        canChooseOrganization={!isPointScoped(session.user)}
      />

      {/* Последние задания печати — раньше их показывала «Настройка точек»,
          которая стала меню раздела. Подключение и машины — выше. */}
      <PrintAgentCard historyOnly />

      {/* Принтеры этикеток по Bluetooth: Android-приложение «Сетап помощник»
          печатает с телефона без компьютера и без интернета. */}
      <section
        id="label-printers"
        className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
              <Tag className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
                {labels("heading")}
              </h2>
              <p className="mt-1 text-[14px] leading-[1.55] text-[#3c4053]">{labels("description")}</p>
              <div className="mt-3 text-[14px] font-medium text-[#0b1024]">{labels("how")}</div>
              <ol className="mt-2 space-y-2 text-[14px] leading-[1.55] text-[#3c4053]">
                <li>
                  <b>1.</b> {labels("downloadStep")}
                </li>
                <li>
                  <b>2.</b> {labels("loginStep")}
                </li>
                <li>
                  <b>3.</b> {labels("addStep")}
                </li>
                <li>
                  <b>4.</b> {labels("resultStep")}
                </li>
              </ol>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                  href="/api/setup-helper/download"
                  className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
                >
                  <Download className="size-4" />
                  {labels("download")}
                </a>
                <span className="text-[13px] text-[#6f7282]">
                  {release ? `${labels("version", { version: release.versionName })} · ` : null}
                  {labels("downloadHint")}
                </span>
              </div>
              <p className="mt-2 text-[13px] leading-snug text-[#6f7282]">{labels("autoUpdate")}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2 sm:w-[148px]">
            <div
              className="size-[132px] [&>svg]:size-full"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: downloadQr }}
            />
            <p className="text-center text-[12px] leading-snug text-[#6f7282]">{labels("qrHint")}</p>
          </div>
        </div>
      </section>

      <LabelPrintersClient
        timeZone={organization?.timezone ?? "Europe/Moscow"}
        latestVersion={release?.versionName ?? null}
        printers={labelPrinters.map((printer) => ({
          id: printer.id,
          name: printer.name,
          model: printer.model,
          address: printer.address,
          transport: printer.transport,
          connectedAt: printer.connectedAt.toISOString(),
          deviceName: printer.device?.name ?? null,
          connectedBy: printer.connectedById ? userName.get(printer.connectedById) ?? null : null,
          lastPrintAt: printer.lastPrintAt?.toISOString() ?? null,
          lastTemplate: printer.lastTemplate,
        }))}
        devices={visibleHelperDevices.map((device) => ({
          id: device.id,
          name: device.name,
          userName: userName.get(device.userId) ?? null,
          appVersion: device.appVersion,
          lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
          outdated: Boolean(release && device.appVersion && compareAppVersions(device.appVersion, release.versionName) < 0),
        }))}
      />

      {/* Журнал маркировки: каждая этикетка из приложения — что, когда
          изготовлено и до какого времени годно. */}
      <section
        id="label-log"
        className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
        data-label-log-summary
      >
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Tags className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{labelLog("summary.heading")}</h2>
            <p className="mt-1 text-[14px] leading-[1.55] text-[#3c4053]">{labelLog("summary.description")}</p>
            <dl className="mt-4 grid gap-2.5 sm:grid-cols-3">
              <div className="rounded-2xl bg-[#f5f6ff] px-4 py-3">
                <dt className="text-[12.5px] text-[#6f7282]">{labelLog("summary.today")}</dt>
                <dd className="mt-0.5 text-[16px] font-semibold text-[#0b1024]">
                  {labelLog("summary.todayValue", {
                    labels: labelLog("labels", { count: printedToday._count._all }),
                    copies: labelLog("copies", { count: printedToday._sum.copies ?? 0 }),
                  })}
                </dd>
              </div>
              <div className={`rounded-2xl px-4 py-3 ${expiringSoon > 0 ? "bg-[#fff8eb]" : "bg-[#f5f6ff]"}`}>
                <dt className="text-[12.5px] text-[#6f7282]">{labelLog("summary.soon")}</dt>
                <dd className={`mt-0.5 text-[16px] font-semibold ${expiringSoon > 0 ? "text-[#7a4a00]" : "text-[#0b1024]"}`}>
                  {labelLog("labels", { count: expiringSoon })}
                </dd>
              </div>
              <div className={`rounded-2xl px-4 py-3 ${expiredRecently > 0 ? "bg-[#fff4f2]" : "bg-[#f5f6ff]"}`}>
                <dt className="text-[12.5px] text-[#6f7282]">{labelLog("summary.expired")}</dt>
                <dd className={`mt-0.5 text-[16px] font-semibold ${expiredRecently > 0 ? "text-[#a13a32]" : "text-[#0b1024]"}`}>
                  {labelLog("labels", { count: expiredRecently })}
                </dd>
              </div>
            </dl>
            <Link
              href="/settings/print-agent/labels"
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3848c7] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              {labelLog("summary.open")}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <p className="mt-3 text-[13px] leading-snug text-[#6f7282]">{labelLog("summary.catalog")}</p>
          </div>
        </div>
      </section>
    </div>
    </DomainMessagesBoundary>
  );
}
