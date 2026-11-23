"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { nextPinned } from "@/lib/pinned-buildings";
import { cn } from "@/lib/utils";

/**
 * Скрепка у объекта (владелец, 2026-11-23): закреплённые — первыми в шапке и
 * на странице «Объекты». Состояние сразу меняется на экране, запрос — следом;
 * не вышло — возвращаем как было и показываем ошибку.
 */
export function usePinnedBuildings(initial: readonly string[]) {
  const router = useRouter();
  const t = useTranslations("navigation.shell.point");
  const [pinned, setPinned] = useState<string[]>([...initial]);
  // Сервер прислал новый список (обновление страницы) — берём его.
  const initialKey = initial.join(",");
  const [syncedKey, setSyncedKey] = useState(initialKey);
  if (initialKey !== syncedKey) {
    setSyncedKey(initialKey);
    setPinned([...initial]);
  }

  async function toggle(buildingId: string) {
    const nextValue = !pinned.includes(buildingId);
    const previous = pinned;
    setPinned(nextPinned(pinned, buildingId, nextValue));
    try {
      const response = await fetch("/api/me/pinned-buildings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId, pinned: nextValue }),
      });
      const data = (await response.json().catch(() => null)) as { pinnedBuildingIds?: string[] } | null;
      if (!response.ok || !Array.isArray(data?.pinnedBuildingIds)) throw new Error("pin failed");
      setPinned(data.pinnedBuildingIds);
      router.refresh();
    } catch {
      setPinned(previous);
      toast.error(t("pinFailed"));
    }
  }

  return { pinned, toggle, isPinned: (buildingId: string) => pinned.includes(buildingId) };
}

/**
 * Кнопка-скрепка. Закреплённый — скрепка видна всегда (тоном акцента), не
 * закреплённый — только при наведении на строку (`group`) или с клавиатуры.
 */
export function PinButton({
  pinned,
  onToggle,
  name,
  className,
}: {
  pinned: boolean;
  onToggle: () => void;
  /** Название объекта — для подписи диктору. */
  name: string;
  className?: string;
}) {
  const t = useTranslations("navigation.shell.point");
  const label = pinned ? t("unpin", { name }) : t("pin", { name });
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pinned}
      title={label}
      data-pin-building
      data-pinned={pinned ? "" : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      onKeyDown={(event) => {
        // Enter и пробел — у кнопки, а не у пункта меню вокруг неё.
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg transition-[color,opacity,background-color] duration-150 hover:bg-[var(--app-veil-hover)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        pinned ? "text-[#5566f6] opacity-100" : "text-[#9b9fb3] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-lg:opacity-100",
        className,
      )}
    >
      <Paperclip className="size-4" aria-hidden />
    </button>
  );
}
