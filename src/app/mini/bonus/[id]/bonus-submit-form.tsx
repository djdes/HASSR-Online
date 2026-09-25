"use client";

import { useRef, useState } from "react";
import { useMainButton } from "@/app/mini/_components/use-main-button";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2 } from "lucide-react";
import {
  checkPhotoBeforeUpload,
  PHOTO_RULES_HINT,
} from "@/components/journals/photo-field";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

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

    // Тип и размер проверяем ДО отправки — теми же правилами, что и на
    // сервере. Иначе человек ждёт загрузку ради отказа.
    const problem = checkPhotoBeforeUpload(file);
    if (problem) {
      setError(problem);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

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
      setError(humanizeFetchError(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!photoUrl) {
      setError("Снимите фото результата — без него премия не начислится");
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
        setError(data.error ?? "Не получилось отправить. Попробуйте ещё раз");
        return;
      }
      router.push("/journals");
      router.refresh();
    } catch (err) {
      setError(humanizeFetchError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="mini-ok-note" style={{ color: "var(--mini-text)" }}>
        Премия зафиксирована:{" "}
        <strong style={{ color: "var(--mini-ok)" }}>+{amountRubles} ₽</strong>
      </div>

      <section className="space-y-2">
        {/* Бейдж «обязательно» вместо звёздочки — как в остальных формах:
            звёздочку на телефоне не замечают. */}
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="text-[16px] font-semibold"
            style={{ color: "var(--mini-text)" }}
          >
            Фото результата
          </label>
          <span className="mini-pill" data-tone="danger" style={{ minHeight: 26, fontSize: 12.5 }}>
            обязательно
          </span>
        </div>
        {/* Правило — ЗАРАНЕЕ, а не после отказа сервера: из галереи
            фото не подойдёт, проверяется время съёмки. */}
        <div
          className="text-[14.5px] leading-snug"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Снимите прямо сейчас, на месте: система смотрит время съёмки и
          принимает фото не старше 5 минут. Снимок из галереи не подойдёт.
          {" "}
          {PHOTO_RULES_HINT}.
        </div>

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
              className="mini-btn-secondary mini-btn-sm mini-press"
            >
              {uploading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Загрузка…
                </>
              ) : (
                <>
                  <Camera className="size-4" />
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
            className="mini-press flex h-32 w-full flex-col items-center justify-center gap-2 rounded-[20px] text-[17px] font-semibold disabled:opacity-50"
            style={{
              background: "var(--mini-accent-soft)",
              border: "1px dashed var(--mini-accent-line)",
              color: "var(--mini-accent-ink)",
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
          className="block text-[16px] font-semibold"
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
          className="mini-input"
          style={{ minHeight: 96, resize: "vertical" }}
        />
      </section>

      {error ? (
        <div className="mini-err">{error}</div>
      ) : null}

      {/* Внутри Telegram отправка живёт в родной кнопке клиента — она
          ниже нашего полотна и не уезжает под клавиатуру. Две кнопки
          «Готово» на одном экране хуже любой одной, поэтому свою прячем.
          В браузере и на старых клиентах остаётся эта. */}
      <button
        type="submit"
        hidden={mainButtonTaken}
        disabled={submitting || uploading || !photoUrl}
        className="mini-btn-primary mini-press w-full"
      >
        {submitting ? (
          <>
            <Loader2 className="size-5 animate-spin" />
            Отправляем…
          </>
        ) : (
          <>
            <Check className="size-5" strokeWidth={2.4} />
            Готово, забрать премию
          </>
        )}
      </button>
    </form>
  );
}
