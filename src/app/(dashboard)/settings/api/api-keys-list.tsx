"use client";

import { useState, useTransition } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ApiKeyView } from "@/lib/public-api/key-admin";

function formatWhen(locale: string, iso: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function ApiKeysList({
  keys,
  canManage = true,
  onRevoked,
}: {
  keys: ApiKeyView[];
  /** false — ROOT «войти как» или партнёр: список виден, отзыв недоступен. */
  canManage?: boolean;
  onRevoked: (id: string) => void;
}) {
  const t = useTranslations("settingsManagement.aiConnect.keys");
  const tCreate = useTranslations("settingsManagement.aiConnect.create");
  const locale = useLocale();
  const [target, setTarget] = useState<ApiKeyView | null>(null);
  const [pending, startTransition] = useTransition();

  const revoke = (key: ApiKeyView) =>
    startTransition(async () => {
      try {
        const res = await fetch(`/api/settings/api-keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error || t("revokeFailed"));
        onRevoked(key.id);
        toast.success(t("revoked", { name: key.name }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("revokeFailed"));
      }
    });

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6">
      <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h2>
      {keys.length === 0 ? (
        <div className="mt-4 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center text-[13.5px] text-[#6f7282]">
          {t("empty")}
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-[#ececf4]">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff]">
                  <KeyRound className="size-[18px] text-[#5566f6]" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[14.5px] font-semibold text-[#0b1024]">{key.name}</span>
                    <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 font-mono text-[11.5px] text-[#3848c7]">{key.displayPrefix}…</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
                        key.access === "write" ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#f3f4f6] text-[#3c4053]"
                      }`}
                    >
                      {key.access === "write" ? tCreate("accessWrite") : tCreate("accessRead")}
                    </span>
                  </div>
                  <div className="mt-1 text-[12.5px] leading-[1.5] text-[#6f7282]" suppressHydrationWarning>
                    {t("owner", { name: key.isMine ? `${key.owner.name} (${t("you")})` : key.owner.name })}
                    {" · "}
                    {t("created", { date: formatWhen(locale, key.createdAt) })}
                    {" · "}
                    {key.lastUsedAt
                      ? t("lastUsed", {
                          date: formatWhen(locale, key.lastUsedAt),
                          via: key.lastUsedVia === "rest" ? t("viaRest") : t("viaMcp"),
                        })
                      : t("neverUsed")}
                  </div>
                </div>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => setTarget(key)}
                  disabled={pending}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-2xl border border-[#f3c9c4] bg-[#fff4f2] px-3 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#ffe9e5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15 disabled:opacity-60 sm:self-auto"
                >
                  <Trash2 className="size-4" />
                  {t("revoke")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={() => {
          const key = target;
          setTarget(null);
          if (key) revoke(key);
        }}
        title={t("confirmTitle", { name: target?.name ?? "" })}
        description={t("confirmDescription")}
        bullets={[
          { label: t("confirmBullet1"), tone: "warn" },
          { label: t("confirmBullet2"), tone: "warn" },
        ]}
        confirmLabel={t("confirmLabel")}
        cancelLabel={t("cancel")}
        variant="danger"
        typeToConfirm={t("typeToConfirm")}
      />
    </section>
  );
}
