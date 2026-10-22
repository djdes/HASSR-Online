"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Fingerprint, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatPasskeyDate } from "./passkey-date-presentation";

type Cred = { id: string; deviceLabel: string | null; createdAt: string; lastUsedAt: string | null };

/**
 * Face ID / отпечаток своего телефона как подпись в WeSetup.
 *
 * Регистрация делается на самом устройстве сотрудника (браузер вызовет
 * системную биометрию). Потом этим ключом можно входить на сайт и
 * разблокировать общий планшет — подпись будет «passkey», сильнее ПИН.
 * Библиотеку подгружаем лениво: на страницу профиля она нужна не всем.
 */
export function PasskeySettings({ dark = false }: { dark?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("passkeySettings");
  const currentT = useRef(t);
  useEffect(() => {
    currentT.current = t;
  }, [locale, t]);
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [remove, setRemove] = useState<Cred | null>(null);

  async function load() {
    const r = await fetch("/api/webauthn/credentials").catch(() => null);
    if (r?.ok) setCreds(((await r.json()) as { credentials: Cred[] }).credentials);
    else setCreds([]);
  }

  useEffect(() => {
    void load();
    import("@simplewebauthn/browser")
      .then(async (m) => setSupported(m.browserSupportsWebAuthn() && (await m.platformAuthenticatorIsAvailable())))
      .catch(() => setSupported(false));
  }, []);

  async function add() {
    setBusy(true);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const opt = await fetch("/api/webauthn/register/options", { method: "POST" });
      const optJson = (await opt.json()) as { challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"]; error?: string };
      if (!opt.ok) throw new Error(optJson.error ?? "passkey_registration_options_failed");
      const response = await startRegistration({ optionsJSON: optJson.options });
      const ver = await fetch("/api/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: optJson.challengeId, response }),
      });
      const verJson = (await ver.json()) as { error?: string };
      if (!ver.ok) throw new Error(verJson.error ?? "passkey_registration_verification_failed");
      toast.success(currentT.current("registrationSuccess"));
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      toast.error(
        /NotAllowed|cancel|abort/i.test(message)
          ? currentT.current("registrationCancelled")
          : currentT.current("operationFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function doRemove() {
    if (!remove) return;
    await fetch("/api/webauthn/credentials", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: remove.id }),
    });
    setRemove(null);
    toast.success(currentT.current("deleteSuccess"));
    await load();
  }

  const text = dark ? "var(--mini-text)" : "#0b1024";
  const muted = dark ? "var(--mini-text-muted)" : "#6f7282";

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold" style={{ color: text }}>
            {t("title")}
          </div>
          <div className="mt-0.5 text-[12px] leading-relaxed" style={{ color: muted }}>
            {t("description")}
          </div>
        </div>
        <button
          onClick={add}
          disabled={busy || supported === false}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} {t("add")}
        </button>
      </div>
      {supported === false ? (
        <p className="text-[12px]" style={{ color: muted }}>
          {t("unsupported")}
        </p>
      ) : null}
      {creds && creds.length > 0 ? (
        <ul className="space-y-1.5">
          {creds.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: dark ? "var(--mini-surface-2)" : "#f5f6ff" }}>
              <Fingerprint className="size-4 text-[#5566f6]" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium" style={{ color: text }}>{c.deviceLabel === null ? t("deviceFallback") : c.deviceLabel}</div>
                <div className="text-[11px]" style={{ color: muted }}>
                  {t("credentialDates", {
                    createdDate: formatPasskeyDate(c.createdAt, locale),
                    hasLastUsed: c.lastUsedAt ? "yes" : "no",
                    lastUsedDate: c.lastUsedAt ? formatPasskeyDate(c.lastUsedAt, locale) : "",
                  })}
                </div>
              </div>
              <button onClick={() => setRemove(c)} className="rounded-lg p-1.5 text-[#a13a32]" aria-label={t("deleteLabel")}>
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : creds ? (
        <p className="text-[12px]" style={{ color: muted }}>{t("empty")}</p>
      ) : null}
      {remove ? (
        <ConfirmDialog
          open
          onClose={() => setRemove(null)}
          onConfirm={doRemove}
          title={t("deleteTitle")}
          description={t("deleteDescription", { deviceName: remove.deviceLabel === null ? t("deviceFallback") : remove.deviceLabel })}
          confirmLabel={t("deleteConfirm")}
          variant="danger"
        />
      ) : null}
    </div>
  );
}
