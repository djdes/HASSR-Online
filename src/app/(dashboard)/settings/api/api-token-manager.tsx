"use client";

import { useState, useTransition } from "react";
import { Copy, KeyRound, RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

function mask(token: string): string {
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function ApiTokenManager({ initialToken }: { initialToken: string | null }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [justGenerated, setJustGenerated] = useState<string | null>(null);
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const rotate = () =>
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings/external-token", { method: "POST" });
        const body = (await res.json()) as { token: string };
        if (!res.ok) throw new Error("Не удалось создать ключ");
        setToken(body.token);
        setJustGenerated(body.token);
        toast.success("Новый ключ сгенерирован. Сохраните его — полную версию мы покажем только один раз.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Ошибка");
      }
    });

  const revoke = () =>
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings/external-token", { method: "DELETE" });
        if (!res.ok) throw new Error("Не удалось удалить ключ");
        setToken(null);
        setJustGenerated(null);
        toast.success("Ключ отозван.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Ошибка");
      }
    });

  const copy = async () => {
    const text = justGenerated ?? token ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Скопировано в буфер обмена.");
    } catch {
      toast.error("Не удалось скопировать — выделите и скопируйте вручную.");
    }
  };

  return (
    <div className="space-y-5">
      {token ? (
        <div className="space-y-3 rounded-xl border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-3">
            <KeyRound className="size-5 text-[#5464ff]" />
            <code className="text-sm">
              {justGenerated ? justGenerated : mask(token)}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={copy}
              disabled={!justGenerated && !token}
            >
              <Copy className="size-4" />
              Копировать
            </Button>
          </div>
          {justGenerated ? (
            <p className="text-xs text-amber-700">
              Это последний раз, когда вы видите ключ целиком. Закройте страницу — останется только последние 4 символа.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Показаны только первые и последние символы. Чтобы получить новый — сгенерируйте заново.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Ключ не создан.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={rotate} disabled={pending}>
          <RefreshCcw className="size-4" />
          {token ? "Сгенерировать новый" : "Создать ключ"}
        </Button>
        {token ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmRevokeOpen(true)}
            disabled={pending}
          >
            <Trash2 className="size-4" />
            Отозвать
          </Button>
        ) : null}
      </div>

      {/* Нативный confirm() в приложении Telegram может не показаться —
          кнопка тогда молча не срабатывает (CLAUDE.md §6). */}
      <ConfirmDialog
        open={confirmRevokeOpen}
        onClose={() => setConfirmRevokeOpen(false)}
        onConfirm={() => {
          setConfirmRevokeOpen(false);
          revoke();
        }}
        title="Отозвать ключ доступа?"
        description="Ключ перестанет работать сразу же."
        bullets={[
          {
            label: "Все интеграции, где прописан этот ключ, перестанут работать",
            tone: "warn",
          },
          { label: "Вернуть отозванный ключ нельзя — только создать новый", tone: "warn" },
        ]}
        confirmLabel="Отозвать ключ"
        cancelLabel="Отмена"
        variant="danger"
        typeToConfirm="ОТОЗВАТЬ"
      />
    </div>
  );
}
