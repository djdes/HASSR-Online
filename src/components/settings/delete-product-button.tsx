"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    // Раньше: window.confirm без единой цифры — менеджер не знал, потеряет
    // ли он заполненные журналы. Сначала спрашиваем сервер, где продукт
    // используется, и показываем это в диалоге.
    let bullets: Array<{ label: string; tone?: "default" | "warn" | "info" }> = [];
    try {
      const usageResponse = await fetch(`/api/products/usage?id=${productId}`);
      if (usageResponse.ok) {
        const usage = await usageResponse.json();
        if (Array.isArray(usage?.bullets)) {
          bullets = usage.bullets
            .filter((line: unknown) => typeof line === "string")
            .map((label: string) => ({ label, tone: "warn" as const }));
        }
      }
    } catch {
      /* последствия не показали — подтверждение всё равно спросим */
    }

    const ok = await confirmAsync({
      title: "Удалить продукт из справочника?",
      description: productName
        ? `Продукт «${productName}» пропадёт из справочника. Действие нельзя отменить.`
        : "Продукт пропадёт из справочника. Действие нельзя отменить.",
      bullets,
      variant: "danger",
      confirmLabel: "Да, удалить",
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
        toast.success("Продукт удалён.");
        router.refresh();
        return;
      }
      // Раньше при не-ok ответе кнопка молча гасла — юзер тапал ещё раз
      // и снова молчание. Теперь показываем ошибку из тела (например
      // «Продукт используется в N записях, удалить нельзя»).
      const body = await res.json().catch(() => null);
      const message =
        (body && typeof body === "object" && body !== null && "error" in body
          ? String((body as Record<string, unknown>).error)
          : null) ?? "Не удалось удалить продукт.";
      toast.error(message);
    } catch {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
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
