"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2 } from "lucide-react";
import { useMainButton } from "@/app/mini/_components/use-main-button";
import { checkPhotoBeforeUpload } from "@/components/journals/photo-field";
import { FORMAT_LOCALES, isLocale } from "@/i18n/locales";
import { bonusErrorKey, type BonusErrorKey } from "./bonus-error-presentation";

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
  const localeValue = useLocale();
  const locale = isLocale(localeValue) ? localeValue : "ru";
  const t = useTranslations("miniBonus");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(existingPhotoUrl);
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<BonusErrorKey | null>(null);

  const amountRubles = (amountKopecks / 100).toLocaleString(FORMAT_LOCALES[locale], {
    minimumFractionDigits: amountKopecks % 100 === 0 ? 0 : 2,
  });

  const mainButtonTaken = useMainButton({
    text: submitting ? t("submit.loading") : t("submit.action"),
    enabled: Boolean(photoUrl) && !uploading,
    loading: submitting,
    onClick: () => void handleSubmit(),
  });

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const problem = checkPhotoBeforeUpload(file);
    if (problem) {
      setError(bonusErrorKey(problem));
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
        setError(bonusErrorKey(data.error));
        return;
      }
      setPhotoUrl(data.url);
    } catch {
      setError("errors.network");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (submitting || uploading) return;
    if (!photoUrl) {
      setError("errors.photoRequired");
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
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      if (!resp.ok) {
        setError(bonusErrorKey(data.error));
        return;
      }
      router.push("/journals");
      router.refresh();
    } catch {
      setError("errors.network");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="mini-ok-note" style={{ color: "var(--mini-text)" }}>
        {t.rich("amount", {
          amount: amountRubles,
          value: (chunks) => <strong style={{ color: "var(--mini-ok)" }}>{chunks}</strong>,
        })}
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="bonus-result-photo"
            className="text-[16px] font-semibold"
            style={{ color: "var(--mini-text)" }}
          >
            {t("photo.label")}
          </label>
          <span className="mini-pill" data-tone="danger" style={{ minHeight: 26, fontSize: 12.5 }}>
            {t("photo.required")}
          </span>
        </div>
        <div
          className="text-[14.5px] leading-snug"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {t("photo.rules", { minutes: 5, megabytes: 5 })}
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
                alt={t("photo.alt")}
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
                  {t("photo.uploading")}
                </>
              ) : (
                <>
                  <Camera className="size-4" />
                  {t("photo.change")}
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
                {t("photo.uploading")}
              </>
            ) : (
              <>
                <Camera className="size-6" strokeWidth={1.6} />
                {t("photo.take")}
              </>
            )}
          </button>
        )}

        <input
          id="bonus-result-photo"
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          aria-label={t("photo.inputLabel")}
          onChange={handleFileChange}
          className="hidden"
        />
      </section>

      <section className="space-y-2">
        <label
          htmlFor="bonus-note"
          className="block text-[16px] font-semibold"
          style={{ color: "var(--mini-text)" }}
        >
          {t("note.label")}
        </label>
        <textarea
          id="bonus-note"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder={t("note.placeholder")}
          className="mini-input"
          style={{ minHeight: 96, resize: "vertical" }}
        />
      </section>

      {error ? (
        <div className="mini-err" role="alert">
          {error === "errors.photoTooOld" ? t(error, { minutes: 5 }) : t(error)}
        </div>
      ) : null}

      <button
        type="submit"
        hidden={mainButtonTaken}
        disabled={submitting || uploading || !photoUrl}
        className="mini-btn-primary mini-press w-full"
      >
        {submitting ? (
          <>
            <Loader2 className="size-5 animate-spin" />
            {t("submit.loading")}
          </>
        ) : (
          <>
            <Check className="size-5" strokeWidth={2.4} />
            {t("submit.action")}
          </>
        )}
      </button>
    </form>
  );
}
