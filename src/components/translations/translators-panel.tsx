"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, UserPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TranslatorRow = { id: string; name: string; email: string; organization: { name: string } | null };

/** ROOT выдаёт и снимает право `canEditTranslations` по почте. */
export function TranslatorsPanel({ initial }: { initial: TranslatorRow[] }) {
  const t = useTranslations("translationEditor");
  const [rows, setRows] = useState(initial);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const change = async (target: string, enabled: boolean) => {
    setBusy(target);
    try {
      const response = await fetch("/api/root/translators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target, enabled }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(body?.error === "user_not_found" ? t("errors.user_not_found") : t("errors.generic"));
        return;
      }
      const translator = body.translator as TranslatorRow;
      setRows((previous) =>
        enabled
          ? [...previous.filter((row) => row.id !== translator.id), translator].sort((a, b) => a.email.localeCompare(b.email))
          : previous.filter((row) => row.id !== translator.id),
      );
      if (enabled) setEmail("");
      toast.success(enabled ? t("translators.granted") : t("translators.revoked"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5" data-testid="translators-panel">
      <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("translators.title")}</h2>
      <p className="mt-1 text-[13px] text-[#6f7282]">{t("translators.description")}</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim()) void change(email.trim(), true);
        }}
      >
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t("translators.emailPlaceholder")}
          className="h-10 max-w-[320px] rounded-xl border-[#ececf4]"
          data-testid="translator-email"
        />
        <Button type="submit" disabled={!email.trim() || busy !== null} data-testid="translator-grant">
          {busy === email.trim() ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {t("translators.grant")}
        </Button>
      </form>
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-[#9b9fb3]">{t("translators.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-[#ececf4]">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="translator-row">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium text-[#0b1024]">{row.name}</div>
                <div className="truncate text-[12px] text-[#6f7282]">
                  {row.email}
                  {row.organization ? ` · ${row.organization.name}` : ""}
                </div>
              </div>
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void change(row.email, false)}>
                {busy === row.email ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                {t("translators.revoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
