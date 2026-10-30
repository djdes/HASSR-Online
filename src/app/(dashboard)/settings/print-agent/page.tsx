import { forbidden } from "next/navigation";
import { Download, Printer, Tag } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { isAgentOnline } from "@/lib/print-agent-auth";
import { brandQrSvg } from "@/lib/brand-qr";
import { compareAppVersions, setupHelperDownloadUrl } from "@/lib/setup-helper";
import { readSetupHelperRelease } from "@/lib/setup-helper-release";
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
  const [t, labels, locale] = await Promise.all([
    getTranslations("printAgent.settings.page"),
    getTranslations("printAgent.labelPrinters"),
    getLocale(),
  ]);

  const [agents, labelPrinters, helperDevices, organization, release] = await Promise.all([
    db.printAgent.findMany({
      where: { organizationId, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        name: true,
        printerName: true,
        agentVersion: true,
        lastSeenAt: true,
        createdAt: true,
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
  const helperUserIds = [
    ...new Set([
      ...helperDevices.map((device) => device.userId),
      ...labelPrinters.flatMap((printer) => (printer.connectedById ? [printer.connectedById] : [])),
    ]),
  ];
  const helperUsers = helperUserIds.length
    ? await db.user.findMany({
        where: { id: { in: helperUserIds }, organizationId },
        select: { id: true, name: true },
      })
    : [];
  const userName = new Map(helperUsers.map((user) => [user.id, user.name]));
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
        agents={agents.map((a) => ({
          id: a.id,
          name: a.name,
          printerName: a.printerName,
          agentVersion: a.agentVersion,
          lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
          online: isAgentOnline(a.lastSeenAt),
        }))}
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
        devices={helperDevices.map((device) => ({
          id: device.id,
          name: device.name,
          userName: userName.get(device.userId) ?? null,
          appVersion: device.appVersion,
          lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
          outdated: Boolean(release && device.appVersion && compareAppVersions(device.appVersion, release.versionName) < 0),
        }))}
      />
    </div>
    </DomainMessagesBoundary>
  );
}
