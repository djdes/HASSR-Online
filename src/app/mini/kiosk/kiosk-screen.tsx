"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Delete, Fingerprint, Loader2, Search, UserRound } from "lucide-react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { kioskError, kioskPasskeyError, type KioskError } from "./kiosk-error-presentation";

type Employee = { id: string; name: string; positionTitle: string | null; hasPin: boolean; photoConsent: boolean };
type Roster = { organization: { name: string }; employees: Employee[]; idleLockSeconds: number; photoRequired: boolean };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * Кадр с фронтальной камеры для подписи. Любая ошибка (нет камеры, отказ в
 * доступе) → null: фото — доказательство, а не преграда для работы.
 */
async function captureFrontPhoto(): Promise<Blob | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    // Даём автоэкспозиции секунду, иначе первый кадр тёмный.
    await new Promise((r) => setTimeout(r, 800));
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(video, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8));
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

export function KioskScreen() {
  const t = useTranslations("miniKiosk");
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<KioskError | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Employee | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pinError, setPinError] = useState<KioskError | null>(null);
  /** Сотрудник вошёл, но ещё не дал согласия на фото — показываем вопрос. */
  const [consentFor, setConsentFor] = useState<Employee | null>(null);
  const [stage, setStage] = useState<"savingConsent" | "photo" | null>(null);

  function errorText(value: KioskError | null) {
    if (!value) return "";
    if (value.key === "errors.pinWrong") return t(value.key, { attempts: value.attempts });
    if (value.key === "errors.pinLocked") return t(value.key, { minutes: value.minutes });
    return t(value.key);
  }

  useEffect(() => {
    let alive = true;
    fetch("/api/kiosk/roster")
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 401) {
          setError({ key: "device.notLinked" });
          return;
        }
        const data = await r.json();
        if (r.ok) setRoster(data);
        else setError(kioskError(data.error ?? "Не удалось загрузить список"));
      })
      .catch(() => alive && setError({ key: "device.network" }));
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = roster?.employees ?? [];
    return q ? list.filter((e) => e.name.toLowerCase().includes(q)) : list;
  }, [roster, query]);

  const closeSheet = useCallback(() => {
    setPicked(null);
    setPin("");
    setPinError(null);
  }, []);

  function goToJournals() {
    // Сессия сотрудника выдана — полный переход, чтобы cookie подхватил сервер.
    window.location.href = "/journals";
  }

  async function takePhotoAndGo() {
    setStage("photo");
    const blob = await captureFrontPhoto();
    if (blob) {
      const form = new FormData();
      form.append("file", blob, "signature.jpg");
      await fetch("/api/kiosk/signature-photo", { method: "POST", body: form }).catch(() => null);
    }
    goToJournals();
  }

  async function submitPin() {
    if (!picked || pin.length < 4) return;
    setSubmitting(true);
    setPinError(null);
    try {
      const res = await fetch("/api/kiosk/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: picked.id, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPinError(kioskError(data.error ?? "Неверный ПИН"));
        setPin("");
        return;
      }
      if (roster?.photoRequired) {
        if (!picked.photoConsent) {
          // Сначала спрашиваем согласие — ПИН уже подтвердил, что это он.
          setConsentFor(picked);
          setPicked(null);
          return;
        }
        await takePhotoAndGo();
        return;
      }
      goToJournals();
    } catch {
      setPinError({ key: "errors.network" });
    } finally {
      setSubmitting(false);
    }
  }

  async function decideConsent(agree: boolean) {
    setStage(agree ? "savingConsent" : null);
    if (agree) {
      await fetch("/api/kiosk/photo-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agree: true }),
      }).catch(() => null);
      await takePhotoAndGo();
      return;
    }
    goToJournals();
  }

  function tapDigit(d: string) {
    setPinError(null);
    setPin((p) => (p.length >= 6 ? p : p + d));
  }

  /**
   * Вход своим Face ID / отпечатком: ключ сотрудника лежит в его телефоне,
   * планшет только передаёт вызов (браузер покажет QR или Bluetooth-связку).
   * Подпись при этом — «passkey», сильнее ПИН.
   */
  async function submitPasskey() {
    if (!picked) return;
    setSubmitting(true);
    setPinError(null);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const opt = await fetch("/api/webauthn/authenticate/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: picked.id }),
      });
      const optJson = (await opt.json()) as { challengeId: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"]; error?: string };
      if (!opt.ok) {
        setPinError(kioskError(optJson.error ?? "Ключ не найден"));
        return;
      }
      const response = await startAuthentication({ optionsJSON: optJson.options });
      const ver = await fetch("/api/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: optJson.challengeId, response }),
      });
      const verJson = (await ver.json()) as { error?: string };
      if (!ver.ok) {
        setPinError(kioskError(verJson.error ?? "Подпись не подтверждена"));
        return;
      }
      goToJournals();
    } catch (e) {
      setPinError(kioskPasskeyError(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        <p className="text-[16px] text-[var(--mini-text,#e7e9f3)]" role="alert">{errorText(error)}</p>
      </div>
    );
  }

  if (!roster) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center" role="status" aria-label={t("device.loading")}>
        <Loader2 className="size-7 animate-spin text-[var(--mini-accent,#5566f6)]" />
        <span className="sr-only">{t("device.loading")}</span>
      </div>
    );
  }

  return (
    <div className="py-1">
      <div className="mb-4 px-1">
        <div className="mini-eyebrow">{roster.organization.name}</div>
        <h1 className="mini-h1 mt-1">{t("page.title")}</h1>
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--mini-muted,#9b9fb3)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("page.searchLabel")}
          placeholder={t("page.searchPlaceholder")}
          className="mini-input"
          style={{ paddingLeft: 46 }}
        />
      </div>

      {/* Плитки сотрудников — карточки QR-страниц. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {filtered.map((e) => (
          <button
            key={e.id}
            disabled={!e.hasPin}
            onClick={() => setPicked(e)}
            className="mini-card flex flex-col items-center gap-2 p-4 text-center transition-transform active:scale-[0.97] disabled:opacity-50"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-[#5566f6] text-[19px] font-semibold text-white">
              {initials(e.name)}
            </span>
            <span className="line-clamp-2 text-[16px] font-semibold text-[var(--mini-text,#e7e9f3)]">{e.name}</span>
            {!e.hasPin ? <span className="text-[13px] text-[var(--mini-muted,#9b9fb3)]">{t("page.noPin")}</span> : null}
          </button>
        ))}
        {filtered.length === 0 ? (
          <p className="col-span-full py-10 text-center text-[16px] text-[var(--mini-muted,#9b9fb3)]">{t("page.empty")}</p>
        ) : null}
      </div>

      {stage ? (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-[#0b1024]/90 text-white" role="status" aria-live="polite">
          <Camera className="size-8 text-[#a3adff]" />
          <p className="text-[17px]">{stage === "savingConsent" ? t("stage.savingConsent") : t("stage.photo")}</p>
        </div>
      ) : null}

      <BottomSheet
        open={Boolean(consentFor)}
        onClose={() => decideConsent(false)}
        title={t("consent.title")}
        subtitle={consentFor?.name ?? ""}
      >
        <div className="space-y-4 pb-2">
          <p className="text-[16px] leading-relaxed text-[var(--app-text,#0b1024)]">
            {t("consent.explanation")}
          </p>
          <p className="text-[15px] leading-relaxed text-[var(--app-text-muted,#6f7282)]">
            {t("consent.optional")}
          </p>
          <button
            onClick={() => decideConsent(true)}
            className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[14px] bg-[#5566f6] px-4 text-[17px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)]"
          >
            <Camera className="size-5" /> {t("consent.agree")}
          </button>
          <button
            onClick={() => decideConsent(false)}
            className="min-h-12 w-full rounded-[14px] text-[16px] font-medium text-[var(--app-text-muted,#6f7282)]"
          >
            {t("consent.decline")}
          </button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={Boolean(picked)}
        onClose={closeSheet}
        title={picked ? picked.name : ""}
        subtitle={t("pin.subtitle")}
      >
        <div className="flex flex-col items-center gap-4 pb-2">
          <div className="flex gap-3">
            {[0, 1, 2, 3, 4, 5].slice(0, Math.max(4, pin.length)).map((i) => (
              <span
                key={i}
                className={`size-4 rounded-full ${i < pin.length ? "bg-[#5566f6]" : "bg-[var(--app-border-strong,#dcdfed)]"}`}
              />
            ))}
          </div>
          {pinError ? (
            <p className="text-[15px] font-medium text-[var(--app-warn-fg,#a13a32)]" role="alert">{errorText(pinError)}</p>
          ) : null}
          {/* Клавиши — как поле PIN QR-страниц: крупные, индиго-подложка. */}
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button
                key={d}
                onClick={() => tapDigit(d)}
                className="size-16 rounded-2xl bg-[var(--app-tint-indigo,#f5f6ff)] text-[26px] font-semibold text-[var(--app-text,#0b1024)] transition-transform active:scale-95"
              >
                {d}
              </button>
            ))}
            <button
              onClick={() => setPin("")}
              className="size-16 rounded-2xl text-[15px] font-medium text-[var(--app-text-muted,#6f7282)]"
            >
              {t("pin.reset")}
            </button>
            <button
              onClick={() => tapDigit("0")}
              className="size-16 rounded-2xl bg-[var(--app-tint-indigo,#f5f6ff)] text-[26px] font-semibold text-[var(--app-text,#0b1024)] transition-transform active:scale-95"
            >
              0
            </button>
            <button
              onClick={() => setPin((p) => p.slice(0, -1))}
              aria-label={t("pin.erase")}
              className="flex size-16 items-center justify-center rounded-2xl text-[var(--app-text-muted,#6f7282)]"
            >
              <Delete className="size-6" />
            </button>
          </div>
          <button
            onClick={submitPin}
            disabled={pin.length < 4 || submitting}
            className="mt-1 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[14px] bg-[#5566f6] px-4 text-[17px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] disabled:opacity-50"
          >
            {submitting ? <Loader2 className="size-5 animate-spin" /> : <UserRound className="size-5" />} {t("pin.login")}
          </button>
          <button
            onClick={submitPasskey}
            disabled={submitting}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-[var(--app-border-strong,#dcdfed)] px-4 text-[16px] font-medium text-[var(--app-text,#0b1024)] disabled:opacity-50"
          >
            <Fingerprint className="size-5 text-[#5566f6]" /> {t("pin.passkey")}
          </button>
          <p className="text-center text-[14px] leading-relaxed text-[var(--app-text-muted,#6f7282)]">
            {t("pin.explainer")}
          </p>
        </div>
      </BottomSheet>
    </div>
  );
}
