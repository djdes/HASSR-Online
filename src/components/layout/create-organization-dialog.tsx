"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ORG_SPHERES } from "@/lib/org-profile";

/**
 * Модалка «Новая организация».
 *
 * Живёт отдельным файлом, потому что вызывается из двух мест: пункт
 * «+ Добавить организацию» в меню профиля и одноимённая кнопка на
 * `/settings/users`. Форма одна — иначе два экрана начали бы
 * расходиться в полях и текстах.
 */
export function CreateOrganizationDialog({
  currentSphere,
  currentName,
  organizationsCount,
  onClose,
}: {
  /** Сфера текущей точки — разумный дефолт для второй такой же. */
  currentSphere: string;
  /** Название текущей организации для подписи чекбокса копирования. */
  currentName: string;
  organizationsCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("layoutUi.createOrganizationDialog");
  const tc = useTranslations("common");
  const router = useRouter();
  const [name, setName] = useState("");
  const [sphere, setSphere] = useState(currentSphere);
  const [copy, setCopy] = useState(true);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2 || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sphere,
          // Копируем структуру текущей точки: у сети должности и набор
          // журналов почти всегда одинаковые, и набивать их заново —
          // самая скучная часть открытия второго заведения.
          copyFrom: copy ? "current" : undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? t("createFailed"));
      toast.success(t("created", { name: name.trim() }));
      onClose();
      router.push("/dashboard?welcome-org=1");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[#0b1024]/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <BodyScrollLock />
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[440px] rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_30px_80px_-30px_rgba(11,16,36,0.5)]"
      >
        <h2 className="text-[18px] font-semibold text-[#0b1024]">
          {t("title")}
        </h2>
        <p className="mt-1 text-[13px] text-[#6f7282]">
          {t("description")}
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
            {t("nameLabel")}
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            placeholder={t("namePlaceholder")}
            maxLength={200}
            className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
            {t("sphereLabel")}
          </span>
          <select
            value={sphere}
            onChange={(event) => setSphere(event.target.value)}
            className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          >
            {ORG_SPHERES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {currentName ? (
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-2xl bg-[#f5f6ff] p-3">
            <input
              type="checkbox"
              checked={copy}
              onChange={(event) => setCopy(event.target.checked)}
              className="mt-0.5 size-4 accent-[#5566f6]"
            />
            <span className="text-[13px] leading-snug text-[#3c4053]">
              {t("copyLabel", { name: currentName })}
            </span>
          </label>
        ) : null}

        <p className="mt-3 text-[12px] text-[#9b9fb3]">
          {t("afterCreate", { count: organizationsCount + 1 })}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-2xl px-4 text-[15px] text-[#6f7282] transition-colors hover:bg-[#f5f6ff]"
          >
            {tc("cancel")}
          </button>
          <button
            type="submit"
            disabled={saving || name.trim().length < 2}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c9cef7]"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
