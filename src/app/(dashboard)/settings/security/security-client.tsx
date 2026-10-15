"use client";

import { LogOut, MessageCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LOGOUT_ALL_URL, signOutAndOpen } from "@/lib/sign-out";

type LoginRow = {
  id: string;
  at: string;
  ip: string;
  device: string;
  method: string;
  isNewDevice: boolean;
};

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const METHOD_KEYS = {
  password: "method.password",
  phone: "method.phone",
  telegram: "method.telegram",
  pair: "method.pair",
  register: "method.register",
  magic: "method.magic",
  passkey: "method.passkey",
} as const;

export function SecurityClient({
  logins,
  twoFactor,
}: {
  logins: LoginRow[];
  twoFactor: { enabled: boolean; telegramLinked: boolean };
}) {
  const t = useTranslations("settingsManagement.security");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeEnabled, setCodeEnabled] = useState(twoFactor.enabled);
  const [codeBusy, setCodeBusy] = useState(false);

  async function toggleCode(next: boolean) {
    setCodeBusy(true);
    try {
      const response = await fetch("/api/security/two-factor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) throw new Error(t("codeSaveFailed"));
      setCodeEnabled(next);
      toast.success(next ? t("codeEnabledToast") : t("codeDisabledToast"));
    } catch {
      toast.error(t("codeSaveFailed"));
    } finally {
      setCodeBusy(false);
    }
  }

  async function logoutAll() {
    setBusy(true);
    try {
      // Тот же полный выход, что у «Выйти» (`lib/sign-out.ts`), только
      // сервер ещё и отзывает сессии на всех устройствах. Дальше — полная
      // перезагрузка на /login: клиентское состояние про сессию уже врёт.
      await signOutAndOpen("/login", { logoutUrl: LOGOUT_ALL_URL });
    } catch {
      toast.error(t("logoutFailed"));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className={CARD}>
        <div className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("historyTitle")}</div>
        {logins.length === 0 ? (
          <p className="text-[13.5px] text-[#9b9fb3]">{t("historyEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]">
                  <th className="pb-2 font-medium">{t("when")}</th>
                  <th className="pb-2 font-medium">{t("device")}</th>
                  <th className="pb-2 font-medium">{t("methodLabel")}</th>
                  <th className="pb-2 font-medium">{t("ip")}</th>
                </tr>
              </thead>
              <tbody>
                {logins.map((row) => (
                  <tr key={row.id} className="border-t border-[#f2f3f8]">
                    <td className="py-2.5 text-[#0b1024]">{new Date(row.at).toLocaleString(locale)}</td>
                    <td className="py-2.5 text-[#0b1024]">
                      {row.device}
                      {row.isNewDevice ? (
                        <span className="ml-2 rounded-full bg-[#fff8eb] px-2 py-0.5 text-[11px] font-medium text-[#b25f00]">
                          {t("newDevice")}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 text-[#6f7282]">{t(METHOD_KEYS[row.method as keyof typeof METHOD_KEYS] ?? METHOD_KEYS.password)}</td>
                    <td className="py-2.5 tabular-nums text-[#6f7282]">{row.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-[12.5px] leading-relaxed text-[#9b9fb3]">
          {t("newDeviceNotice")}
        </p>
      </section>

      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <section className={CARD}>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
            <ShieldCheck className="size-4 text-[#5566f6]" />
            {t("logoutEverywhere")}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
            {t("logoutDescription")}
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#ef4444] to-[#f43f5e] px-5 text-[14px] font-medium text-white shadow-[0_12px_30px_-12px_rgba(244,63,94,0.6)] transition-opacity hover:opacity-90"
          >
            <LogOut className="size-4" />
            {t("logoutAll")}
          </button>
        </section>
        <section className={CARD}>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
            <MessageCircle className="size-4 text-[#5566f6]" />
            {t("telegramCodeTitle")}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
            {t("telegramCodeDescription")}
          </p>
          {twoFactor.telegramLinked ? (
            <button
              type="button"
              onClick={() => void toggleCode(!codeEnabled)}
              disabled={codeBusy}
              className={
                codeEnabled
                  ? "mt-4 inline-flex h-11 w-full items-center justify-center rounded-2xl border border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
                  : "mt-4 inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
              }
            >
              {codeEnabled ? t("disableCode") : t("enableCode")}
            </button>
          ) : (
            <p className="mt-3 rounded-2xl bg-[#fff8eb] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#b25f00]">
              {t("telegramNotLinked")}
            </p>
          )}
          {codeEnabled ? (
            <p className="mt-3 text-[12px] text-[#116b2a]">{t("codeEnabledNote")}</p>
          ) : null}
        </section>
      </aside>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={logoutAll}
        variant="danger"
        title={t("confirmTitle")}
        description={t("confirmDescription")}
        bullets={[
          { label: t("confirmBulletDevices"), tone: "warn" },
          { label: t("confirmBulletLogin") },
        ]}
        confirmLabel={busy ? t("confirmBusy") : t("logoutAll")}
        confirmDisabled={busy}
      />
    </div>
  );
}
