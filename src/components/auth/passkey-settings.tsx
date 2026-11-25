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
    // Кнопку заранее не блокируем: о неподдерживаемом устройстве говорим
    // только тому, кто действительно попробовал добавить ключ.
    if (supported === false) {
      toast.error(currentT.current("unsupported"));
      return;
    }
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
      // Пояснение, что даёт ключ, — в момент подключения, а не под заголовком.
      toast.success(currentT.current("registrationSuccess"), {
        description: currentT.current("registrationHint"),
      });
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
      {/* В мини-приложении (`dark`) — общая строка карточки профиля
          (`.mini-row` в mini-theme.css): заголовок того же кегля, что у
          соседних карточек, кнопка по центру, отступ — только под списком. */}
      <div className={dark ? "mini-row" : "mb-3 flex items-center justify-between gap-3"}>
        {/* Заголовок понятен сам; что даёт ключ — в тосте после «Добавить». */}
        {dark ? (
          <h2 className="mini-card-title">{t("title")}</h2>
        ) : (
          <div className="text-[14px] font-semibold" style={{ color: text }}>
            {t("title")}
          </div>
        )}
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className={
            dark
              ? "mini-row-btn mini-press"
              : "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white disabled:opacity-50"
          }
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />} {t("add")}
        </button>
      </div>
      {creds && creds.length > 0 ? (
        <ul className={dark ? "mini-row-body" : "space-y-1.5"}>
          {creds.map((c) => (
            <li
              key={c.id}
              className={dark ? "mini-row mini-row-item" : "flex items-center gap-2 rounded-xl px-3 py-2"}
              style={dark ? undefined : { background: "#f5f6ff" }}
            >
              <Fingerprint className={dark ? "size-5 shrink-0" : "size-4 text-[#5566f6]"} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className={dark ? "truncate text-[15px] font-semibold" : "text-[13px] font-medium"} style={{ color: text }}>{c.deviceLabel === null ? t("deviceFallback") : c.deviceLabel}</div>
                <div className={dark ? "text-[13px]" : "text-[11px]"} style={{ color: muted }}>
                  {t("credentialDates", {
                    createdDate: formatPasskeyDate(c.createdAt, locale),
                    hasLastUsed: c.lastUsedAt ? "yes" : "no",
                    lastUsedDate: c.lastUsedAt ? formatPasskeyDate(c.lastUsedAt, locale) : "",
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRemove(c)}
                className={dark ? "mini-row-icon-btn mini-press" : "rounded-lg p-1.5 text-[#a13a32]"}
                aria-label={t("deleteLabel")}
              >
                <Trash2 className={dark ? "size-5" : "size-4"} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
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
