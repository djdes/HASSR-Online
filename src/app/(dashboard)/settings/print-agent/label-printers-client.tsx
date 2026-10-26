"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Bluetooth, Loader2, Smartphone, Unplug } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDate, type Locale } from "@/i18n/locales";

/**
 * Принтеры этикеток и телефоны приложения «Сетап помощник».
 *
 * Принтеры приходят с телефона событиями: приложение работает офлайн и
 * сообщает о подключении, когда появится сеть. Отключить можно телефон —
 * его ключ перестаёт работать, и приложение выходит из аккаунта при первой
 * связи с сервером (до неё оно продолжает печатать: принтеру сервер не
 * нужен). Это и сказано в подтверждении.
 *
 * Даты — в часовом поясе организации, а не браузера: иначе разметка
 * сервера и браузера разойдётся (ошибка гидрации), а время подключения у
 * управляющей в другом поясе съедет.
 *
 * Телефон со старой версией помечен: приложение само скачает с сайта новую
 * и поставит её, как только будет интернет.
 */

export type LabelPrinterView = {
  id: string;
  name: string;
  model: string | null;
  address: string;
  transport: string;
  connectedAt: string;
  deviceName: string | null;
  connectedBy: string | null;
  lastPrintAt: string | null;
  lastTemplate: string | null;
};

export type HelperDeviceView = {
  id: string;
  name: string;
  userName: string | null;
  appVersion: string | null;
  lastSeenAt: string | null;
  /** Версия старее выложенной на сайте — приложение обновится само. */
  outdated?: boolean;
};

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/** Коды шаблонов приложения → ключи подписей. Неизвестный код показываем как есть. */
const TEMPLATE_KEYS = {
  "test-58x40": "test58x40",
  product: "product",
  "semi-finished": "semiFinished",
  dish: "dish",
  defrost: "defrost",
  freeze: "freeze",
  "daily-sample": "dailySample",
  incoming: "incoming",
  allergens: "allergens",
  reject: "reject",
  opened: "opened",
  "free-text": "freeText",
} as const;

export function LabelPrintersClient({
  printers,
  devices,
  timeZone,
  latestVersion = null,
}: {
  printers: LabelPrinterView[];
  devices: HelperDeviceView[];
  timeZone: string;
  latestVersion?: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("printAgent.labelPrinters");
  const locale = useLocale() as Locale;
  const currentTranslations = useRef(t);
  useEffect(() => { currentTranslations.current = t; }, [t]);
  const [revoking, setRevoking] = useState<HelperDeviceView | null>(null);
  const [busy, setBusy] = useState(false);

  const when = (iso: string) => formatDate(locale, new Date(iso), timeZone, DATE_TIME);
  const templateLabel = (code: string) =>
    Object.hasOwn(TEMPLATE_KEYS, code) ? t(`templates.${TEMPLATE_KEYS[code as keyof typeof TEMPLATE_KEYS]}`) : code;

  async function revoke(device: HelperDeviceView) {
    setBusy(true);
    try {
      const res = await fetch(`/api/setup-helper/devices/${device.id}/revoke`, { method: "POST" });
      if (!res.ok) {
        toast.error(currentTranslations.current(res.status === 403 ? "errors.forbidden" : res.status === 404 ? "errors.notFound" : "errors.failed"));
        return;
      }
      toast.success(currentTranslations.current("devices.disconnected", { name: device.name }));
      router.refresh();
    } catch {
      toast.error(currentTranslations.current("errors.failed"));
    } finally {
      setBusy(false);
      setRevoking(null);
    }
  }

  return (
    <>
      <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="border-b border-[#eef0f6] px-6 py-4">
          <div className="text-[16px] font-semibold text-[#0b1024]">{t("printers.heading")}</div>
        </div>
        {printers.length === 0 ? (
          <div className="px-6 py-10 text-center text-[14px] text-[#6f7282]">{t("printers.empty")}</div>
        ) : (
          <ul className="divide-y divide-[#eef0f6]">
            {printers.map((printer) => (
              <li key={printer.id} className="flex items-start gap-3 px-6 py-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                  <Bluetooth className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[14px] font-medium text-[#0b1024]">
                    <span>{printer.name}</span>
                    {printer.model && printer.model !== printer.name ? (
                      <span className="text-[13px] font-normal text-[#6f7282]">{printer.model}</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[#6f7282]">
                    {printer.address} · {printer.transport === "ble" ? t("printers.transport.ble") : t("printers.transport.classic")}
                  </div>
                  <div className="mt-1 text-[12px] text-[#3c4053]">
                    {printer.deviceName
                      ? t("printers.connectedVia", { when: when(printer.connectedAt), device: printer.deviceName })
                      : t("printers.connected", { when: when(printer.connectedAt) })}
                    {printer.connectedBy ? ` · ${printer.connectedBy}` : null}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[#6f7282]">
                    {printer.lastPrintAt
                      ? t("printers.lastPrint", { when: when(printer.lastPrintAt), template: templateLabel(printer.lastTemplate ?? "") })
                      : t("printers.neverPrinted")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="border-b border-[#eef0f6] px-6 py-4">
          <div className="text-[16px] font-semibold text-[#0b1024]">{t("devices.heading")}</div>
          <p className="mt-0.5 text-[13px] text-[#6f7282]">{t("devices.description")}</p>
        </div>
        {devices.length === 0 ? (
          <div className="px-6 py-10 text-center text-[14px] text-[#6f7282]">{t("devices.empty")}</div>
        ) : (
          <ul className="divide-y divide-[#eef0f6]">
            {devices.map((device) => {
              const user = device.userName ?? t("devices.unknownUser");
              return (
                <li key={device.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[#f4f5fb] text-[#6f7282]">
                    <Smartphone className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-[#0b1024]">{device.name}</div>
                    <div className="mt-0.5 text-[12px] text-[#6f7282]">
                      {device.lastSeenAt
                        ? t("devices.lastSeen", { user, when: when(device.lastSeenAt) })
                        : t("devices.neverSeen", { user })}
                      {device.appVersion ? ` · ${t("devices.version", { version: device.appVersion })}` : null}
                    </div>
                    {device.outdated && latestVersion ? (
                      <div className="mt-0.5 text-[12px] text-[#a65f00]">
                        {t("devices.updatePending", { version: latestVersion })}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRevoking(device)}
                    aria-label={t("devices.disconnectAria", { name: device.name })}
                    className="inline-flex h-9 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#6f7282] transition-colors hover:border-[#ff8d7d] hover:bg-[#fff4f2] hover:text-[#a13a32]"
                  >
                    <Unplug className="size-4" />
                    {t("devices.disconnect")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(revoking)}
        onClose={() => !busy && setRevoking(null)}
        onConfirm={async () => {
          if (revoking) await revoke(revoking);
        }}
        variant="warn"
        title={t("confirm.title", { name: revoking?.name ?? "" })}
        description={t("confirm.description")}
        bullets={[{ label: t("confirm.offline") }, { label: t("confirm.printers") }]}
        confirmLabel={t("devices.disconnect")}
      />

      {busy ? (
        <div className="flex items-center gap-2 text-[13px] text-[#6f7282]">
          <Loader2 className="size-4 animate-spin" />
          {t("devices.disconnecting")}
        </div>
      ) : null}
    </>
  );
}
