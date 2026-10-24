"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmAsync } from "@/components/ui/confirm-async";

interface DeleteButtonProps {
  id: string;
  endpoint: string;
  entityName: string;
  /// GET-эндпоинт, отвечающий `{ bullets: string[] }` — что именно
  /// затронет удаление. Без него диалог спрашивает «точно?» вслепую, а
  /// человек не знает, потеряет ли он заполненные журналы.
  usageEndpoint?: string;
}

export function DeleteButton({
  id,
  endpoint,
  entityName,
  usageEndpoint,
}: DeleteButtonProps) {
  const t = useTranslations("settingsUi.deleteButton");
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  async function handleClick() {
    setIsBusy(true);
    try {
      let bullets: Array<{ label: string; tone?: "default" | "warn" | "info" }> = [];
      if (usageEndpoint) {
        try {
          const usageResponse = await fetch(usageEndpoint);
          if (usageResponse.ok) {
            const usage = await usageResponse.json();
            if (Array.isArray(usage?.bullets)) {
              bullets = usage.bullets
                .filter((line: unknown) => typeof line === "string")
                .map((label: string) => ({ label, tone: "warn" as const }));
            }
          }
        } catch {
          /* последствия не показали — диалог всё равно спросит подтверждение */
        }
      }

      const ok = await confirmAsync({
        title: t("confirmTitle"),
        description: t("confirmDescription", { entityName }),
        bullets,
        variant: "danger",
        confirmLabel: t("confirmLabel"),
      });
      if (!ok) return;

      const response = await fetch(`${endpoint}/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || t("deleteError"));
      }
      toast.success(t("deleted"));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("deleteError"));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={isBusy}
      // Кнопка из одной иконки: без подписи скринридер читал «кнопка».
      aria-label={t("ariaDelete", { entityName })}
      title={t("titleDelete")}
      className="text-destructive hover:text-destructive"
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
