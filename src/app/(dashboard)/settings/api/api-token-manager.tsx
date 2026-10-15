"use client";

import { useState, useTransition } from "react";
import { Copy, KeyRound, RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

function mask(token: string): string {
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function ApiTokenManager({ initialToken }: { initialToken: string | null }) {
  const t = useTranslations("settingsManagement.apiToken");
  const [token, setToken] = useState<string | null>(initialToken);
  const [justGenerated, setJustGenerated] = useState<string | null>(null);
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const rotate = () =>
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings/external-token", { method: "POST" });
        const body = (await res.json()) as { token: string };
        if (!res.ok) throw new Error(t("createFailed"));
        setToken(body.token);
        setJustGenerated(body.token);
        toast.success(t("created"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("failed"));
      }
    });

  const revoke = () =>
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings/external-token", { method: "DELETE" });
        if (!res.ok) throw new Error(t("revokeFailed"));
        setToken(null);
        setJustGenerated(null);
        toast.success(t("revoked"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("failed"));
      }
    });

  const copy = async () => {
    const text = justGenerated ?? token ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
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
              {t("copy")}
            </Button>
          </div>
          {justGenerated ? (
            <p className="text-xs text-amber-700">
              {t("fullKeyWarning")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("maskedKeyHint")}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("notCreated")}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={rotate} disabled={pending}>
          <RefreshCcw className="size-4" />
          {token ? t("createNew") : t("create")}
        </Button>
        {token ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmRevokeOpen(true)}
            disabled={pending}
          >
            <Trash2 className="size-4" />
            {t("revoke")}
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
        title={t("confirmTitle")}
        description={t("confirmDescription")}
        bullets={[
          {
            label: t("confirmBulletIntegrations"),
            tone: "warn",
          },
          { label: t("confirmBulletIrreversible"), tone: "warn" },
        ]}
        confirmLabel={t("revokeKey")}
        cancelLabel={t("cancel")}
        variant="danger"
        typeToConfirm={t("typeToConfirm")}
      />
    </div>
  );
}
