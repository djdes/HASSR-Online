"use client";

import { useRef, useState } from "react";
import { useMainButton } from "@/app/mini/_components/use-main-button";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2 } from "lucide-react";

/**
 * Photo-mandatory submit-форма для премиального obligation
 * (Phase 3, шаг 3.4). Минимальный набор полей — фото обязательно,
 * заметка опциональна. На submit идёт `POST /api/journals/[id]/submit-bonus`,
 * который создаёт JournalEntry + JournalEntryAttachment + обновляет
 * BonusEntry.photoUrl. Статус остаётся "pending" — переход в
 * "approved"/"rejected" живёт в шагах 3.5/3.7.
 */
export function BonusSubmitForm({
  obligationId,
  amountKopecks,
  templateName,
  existingPhotoUrl,
}: {
  obligationId: string;
  amountKopecks: number;
  templateName: string;
  existingPhotoUrl: string | null;
}) {
  void templateName;
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(existingPhotoUrl);
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountRubles = (amountKopecks / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: amountKopecks % 100 === 0 ? 0 : 2,
  });

  const mainButtonTaken = useMainButton({
    text: submitting ? "Отправляем…" : "Готово, забрать премию",
    enabled: Boolean(photoUrl) && !uploading,
    loading: submitting,
    onClick: () => {
      void handleSubmit();
    },
  });

  async function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch("/api/mini/attachments", {
        method: "POST",
        body: form,
      });
      const data = (await resp.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!resp.ok || !data.url) {
        setError(data.error ?? "Не удалось загрузить фото");
        return;
      }
      setPhotoUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Сетевая ошибка");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!photoUrl) {
      setError("Прикрепи фото-доказательство — это обязательно");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch(
        `/api/journals/${encodeURIComponent(obligationId)}/submit-bonus`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photoUrl,
            notes: notes.trim() || undefined,
          }),
        }
      );
      const data = (await resp.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!resp.ok) {
        setError(data.error ?? `HTTP ${resp.status}`);
        return;
      }
      router.push("/journals");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Сетевая ошибка");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div
        className="rounded-2xl px-4 py-3 text-[13px] leading-5"
        style={{
          background: "rgba(200,255,90,0.10)",
          border: "1px solid rgba(200,255,90,0.32)",
          color: "var(--mini-text)",
        }}
      >
        Премия зафиксирована:{" "}
        <strong style={{ color: "var(--mini-lime)" }}>
          +{amountRubles} ₽
        </strong>
      </div>

      <section className="space-y-2">
        <label
          className="block text-[13px] font-medium"
          style={{ color: "var(--mini-text)" }}
        >
          Фото-доказательство <span style={{ color: "var(--mini-crimson)" }}>*</span>
        </label>

        {photoUrl ? (
          <div className="space-y-2">
            <div
              className="overflow-hidden rounded-2xl"
              style={{ border: "1px solid var(--mini-divider)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt="Доказательство выполнения"
                className="block h-48 w-full object-cover"
              />
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium disabled:opacity-50"
              style={{
                background: "var(--mini-card-solid-bg)",
                color: "var(--mini-text-muted)",
                border: "1px solid var(--mini-divider)",
              }}
            >
              {uploading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Загрузка…
                </>
              ) : (
                <>
                  <Camera className="size-3.5" />
                  Сменить фото
                </>
              )}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="mini-press flex h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl text-[14px] font-medium disabled:opacity-50"
            style={{
              background: "rgba(200,255,90,0.06)",
              border: "1px dashed rgba(200,255,90,0.42)",
              color: "var(--mini-lime)",
            }}
          >
            {uploading ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Загружаем фото…
              </>
            ) : (
              <>
                <Camera className="size-6" strokeWidth={1.6} />
                Сделать фото
              </>
            )}
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
        />
      </section>

      <section className="space-y-2">
        <label
          className="block text-[13px] font-medium"
          style={{ color: "var(--mini-text)" }}
        >
          Заметка (необязательно)
        </label>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Что сделано, замечания, нюансы…"
          className="mini-press w-full rounded-2xl px-3 py-2.5 text-[14px]"
          style={{
            background: "var(--mini-card-solid-bg)",
            border: "1px solid var(--mini-divider)",
            color: "var(--mini-text)",
            outline: "none",
          }}
        />
      </section>

      {error ? (
        <div
          className="rounded-2xl px-3 py-2.5 text-[13px] leading-5"
          style={{
            background: "var(--mini-crimson-soft)",
            border: "1px solid rgba(255,82,104,0.24)",
            color: "var(--mini-crimson)",
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Внутри Telegram отправка живёт в родной кнопке клиента — она
          ниже нашего полотна и не уезжает под клавиатуру. Две кнопки
          «Готово» на одном экране хуже любой одной, поэтому свою прячем.
          В браузере и на старых клиентах остаётся эта. */}
      <button
        type="submit"
        hidden={mainButtonTaken}
        disabled={submitting || uploading || !photoUrl}
        className="mini-press inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[15px] font-semibold disabled:opacity-50"
        style={{
          background: "var(--mini-lime)",
          color: "var(--mini-bg)",
          boxShadow:
            "0 8px 24px -10px rgba(200,255,90,0.45), inset 0 -2px 0 rgba(0,0,0,0.06)",
        }}
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Отправляем…
          </>
        ) : (
          <>
            <Check className="size-4" strokeWidth={2.4} />
            Готово, забрать премию
          </>
        )}
      </button>
    </form>
  );
}
