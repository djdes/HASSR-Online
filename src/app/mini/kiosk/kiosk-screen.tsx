"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, Delete, Loader2, Search, UserRound } from "lucide-react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { KIOSK_PIN_EXPLAINER } from "@/lib/kiosk-copy";

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
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Employee | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  /** Сотрудник вошёл, но ещё не дал согласия на фото — показываем вопрос. */
  const [consentFor, setConsentFor] = useState<Employee | null>(null);
  const [stage, setStage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/kiosk/roster")
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 401) {
          setError("Этот планшет не привязан. Откройте QR из настроек «Общий планшет».");
          return;
        }
        const data = await r.json();
        if (r.ok) setRoster(data);
        else setError(data.error ?? "Не удалось загрузить список");
      })
      .catch(() => alive && setError("Нет связи"));
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
    setStage("Снимаем фото для подписи…");
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
        setPinError(data.error ?? "Неверный ПИН");
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
      setPinError("Нет связи");
    } finally {
      setSubmitting(false);
    }
  }

  async function decideConsent(agree: boolean) {
    setStage(agree ? "Сохраняем согласие…" : null);
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

  if (error) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        <p className="text-[15px] text-[var(--mini-text,#e7e9f3)]">{error}</p>
      </div>
    );
  }

  if (!roster) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[var(--mini-muted,#9b9fb3)]" />
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-3">
        <div className="text-[13px] text-[var(--mini-muted,#9b9fb3)]">{roster.organization.name}</div>
        <h1 className="text-[20px] font-semibold text-[var(--mini-text,#e7e9f3)]">Кто заполняет?</h1>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--mini-muted,#9b9fb3)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по имени"
          className="h-11 w-full rounded-2xl border border-[var(--mini-border,#2a2c3a)] bg-[var(--mini-surface,#14161f)] pl-9 pr-3 text-[15px] text-[var(--mini-text,#e7e9f3)] placeholder:text-[var(--mini-muted,#9b9fb3)] focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {filtered.map((e) => (
          <button
            key={e.id}
            disabled={!e.hasPin}
            onClick={() => setPicked(e)}
            className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--mini-border,#2a2c3a)] bg-[var(--mini-surface,#14161f)] p-4 text-center transition-transform active:scale-[0.97] disabled:opacity-40"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-[#5566f6] text-[18px] font-semibold text-white">
              {initials(e.name)}
            </span>
            <span className="line-clamp-2 text-[14px] font-medium text-[var(--mini-text,#e7e9f3)]">{e.name}</span>
            {!e.hasPin ? <span className="text-[11px] text-[var(--mini-muted,#9b9fb3)]">нет ПИН</span> : null}
          </button>
        ))}
        {filtered.length === 0 ? (
          <p className="col-span-full py-10 text-center text-[14px] text-[var(--mini-muted,#9b9fb3)]">Никого не нашли</p>
        ) : null}
      </div>

      {stage ? (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-[#0a0b0f]/90 text-[#e7e9f3]">
          <Camera className="size-8 text-[#5566f6]" />
          <p className="text-[15px]">{stage}</p>
        </div>
      ) : null}

      <BottomSheet
        open={Boolean(consentFor)}
        onClose={() => decideConsent(false)}
        title="Фото при входе"
        subtitle={consentFor?.name ?? ""}
      >
        <div className="space-y-4 pb-2">
          <p className="text-[14px] leading-relaxed text-[#e7e9f3]">
            Организация включила фотофиксацию: при вводе ПИН планшет делает один кадр с фронтальной камеры и прикладывает его к вашей подписи в журнале — как подтверждение, что запись внесли именно вы. Это не распознавание лиц: кадр просто хранится вместе с записью для проверки.
          </p>
          <p className="text-[13px] leading-relaxed text-[#9b9fb3]">
            Согласие можно не давать — вы будете работать как обычно, без фото. Отозвать его можно у руководителя.
          </p>
          <button
            onClick={() => decideConsent(true)}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white"
          >
            <Camera className="size-5" /> Согласен, снимать фото при входе
          </button>
          <button onClick={() => decideConsent(false)} className="h-11 w-full rounded-2xl text-[14px] text-[#9b9fb3]">
            Не сейчас — продолжить без фото
          </button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={Boolean(picked)}
        onClose={closeSheet}
        title={picked ? picked.name : ""}
        subtitle="Введите свой ПИН"
      >
        <div className="flex flex-col items-center gap-4 pb-2">
          <div className="flex gap-3">
            {[0, 1, 2, 3, 4, 5].slice(0, Math.max(4, pin.length)).map((i) => (
              <span key={i} className={`size-4 rounded-full ${i < pin.length ? "bg-[#5566f6]" : "bg-[#2a2c3a]"}`} />
            ))}
          </div>
          {pinError ? <p className="text-[13px] text-[#ff8a8a]">{pinError}</p> : null}
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button
                key={d}
                onClick={() => tapDigit(d)}
                className="size-16 rounded-2xl bg-[#14161f] text-[24px] font-semibold text-[#e7e9f3] transition-transform active:scale-95"
              >
                {d}
              </button>
            ))}
            <button onClick={() => setPin("")} className="size-16 rounded-2xl text-[13px] text-[#9b9fb3]">Сброс</button>
            <button onClick={() => tapDigit("0")} className="size-16 rounded-2xl bg-[#14161f] text-[24px] font-semibold text-[#e7e9f3] transition-transform active:scale-95">0</button>
            <button onClick={() => setPin((p) => p.slice(0, -1))} className="flex size-16 items-center justify-center rounded-2xl text-[#9b9fb3]">
              <Delete className="size-6" />
            </button>
          </div>
          <button
            onClick={submitPin}
            disabled={pin.length < 4 || submitting}
            className="mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white disabled:opacity-50"
          >
            {submitting ? <Loader2 className="size-5 animate-spin" /> : <UserRound className="size-5" />} Войти и заполнять
          </button>
          <p className="text-center text-[12px] leading-relaxed text-[#9b9fb3]">{KIOSK_PIN_EXPLAINER}</p>
        </div>
      </BottomSheet>
    </div>
  );
}
