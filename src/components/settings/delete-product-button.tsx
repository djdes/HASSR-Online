"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { productErrorKey, productUsageMessages, type ProductUsageMessage } from "@/lib/settings-products-presentation";
import { useSettingsProductsFeedback } from "./settings-products-feedback";
import { Button } from "@/components/ui/button";
import { confirmAsync } from "@/components/ui/confirm-async";

export function DeleteProductButton({
  productId,
  productName,
}: {
  productId: string;
  productName?: string;
}) {
  const router = useRouter();
  const common = useTranslations("common");
  const feedback = useSettingsProductsFeedback();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    // Раньше: window.confirm без единой цифры — менеджер не знал, потеряет
    // ли он заполненные журналы. Сначала спрашиваем сервер, где продукт
    // используется, и показываем это в диалоге.
    let warnings: ProductUsageMessage[] = [];
    try {
      const usageResponse = await fetch(`/api/products/usage?id=${productId}`);
      if (usageResponse.ok) {
        const usage = await usageResponse.json();
        warnings = productUsageMessages(usage);
      }
    } catch {
      /* последствия не показали — подтверждение всё равно спросим */
    }

    const copy = feedback.current();
    const bullets = warnings.map((warning) => ({
      label: warning.key === "usage.existingDocuments"
        ? copy.t(warning.key, { name: warning.params.name, count: String(warning.params.count) })
        : copy.t(warning.key),
      tone: "warn" as const,
    }));
    const ok = await confirmAsync({
      locale: copy.locale,
      title: copy.t("delete.title"),
      description: productName
        ? copy.t("delete.descriptionNamed", { name: productName })
        : copy.t("delete.description"),
      bullets,
      variant: "danger",
      confirmLabel: copy.t("delete.confirm"),
    });
    if (!ok) {
      setIsDeleting(false);
      return;
    }

    try {
      const res = await fetch(`/api/products?id=${productId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        feedback.success("delete.success");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => null);
      feedback.error(productErrorKey(body, "DELETE", res.status) ?? "delete.failed");
    } catch {
      feedback.error("delete.network");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={common("delete")}
      onClick={handleDelete}
      disabled={isDeleting}
      className="size-8 text-muted-foreground hover:text-destructive"
    >
      {isDeleting ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Trash2 className="size-4" />
      )}
    </Button>
  );
}
