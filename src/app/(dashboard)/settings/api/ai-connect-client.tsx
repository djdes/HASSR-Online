"use client";

import { useState, useTransition } from "react";
import { Check, ClipboardCheck, Compass, Copy, FileText, KeyRound, Loader2, PencilLine, ShieldAlert, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { ApiKeyView } from "@/lib/public-api/key-admin";
import { AiClientGuides } from "./ai-client-guides";
import { ApiKeysList } from "./api-keys-list";

type ToolInfo = { name: string; access: "read" | "write" };
type Created = { key: ApiKeyView; secret: string; mcpUrl: string };

const TOOL_ICONS: Record<string, typeof Compass> = {
  get_context: Compass,
  list_journals: ClipboardCheck,
  get_journal_document: FileText,
  fill_journal_cells: PencilLine,
  list_employees: Users,
  add_employee: UserPlus,
};

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6";
const STEP = "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#5566f6]";

export function useCopy() {
  const t = useTranslations("settingsManagement.aiConnect");
  return async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("secret.copied"));
    } catch {
      // В Telegram буфер обмена бывает недоступен — подсказываем выделить вручную.
      toast.error(t("secret.copyFailed"));
    }
  };
}

export function AiConnectClient({
  baseUrl,
  initialKeys,
  tools,
}: {
  baseUrl: string;
  initialKeys: ApiKeyView[];
  tools: ToolInfo[];
}) {
  const t = useTranslations("settingsManagement.aiConnect");
  const copy = useCopy();
  const [keys, setKeys] = useState(initialKeys);
  const [created, setCreated] = useState<Created | null>(null);
  const [name, setName] = useState(t("create.nameDefault"));
  const [access, setAccess] = useState<"write" | "read">("write");
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings/api-keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim() || t("create.nameDefault"), access }),
        });
        const body = (await res.json().catch(() => ({}))) as Partial<Created> & { error?: string };
        if (!res.ok || !body.key || !body.secret || !body.mcpUrl) throw new Error(body.error || t("create.failed"));
        const fresh = { key: body.key, secret: body.secret, mcpUrl: body.mcpUrl };
        setCreated(fresh);
        setKeys((list) => [fresh.key, ...list]);
        toast.success(t("create.created"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("create.failed"));
      }
    });

  const accessOptions = [
    { value: "write" as const, label: t("create.accessWrite"), hint: t("create.accessWriteHint"), recommended: true },
    { value: "read" as const, label: t("create.accessRead"), hint: t("create.accessReadHint"), recommended: false },
  ];

  return (
    <div className="space-y-5">
      <section className={CARD}>
        <div className={STEP}>{t("create.step")}</div>
        <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("create.title")}</h2>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <label className="block">
            <span className="text-[13px] font-medium text-[#3c4053]">{t("create.nameLabel")}</span>
            <input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <span className="mt-1.5 block text-[12.5px] text-[#6f7282]">{t("create.nameHint")}</span>
          </label>

          <fieldset>
            <legend className="text-[13px] font-medium text-[#3c4053]">{t("create.accessLabel")}</legend>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              {accessOptions.map((option) => {
                const active = access === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAccess(option.value)}
                    aria-pressed={active}
                    className={`rounded-2xl border px-4 py-3 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
                      active
                        ? "border-[#5566f6] bg-[#f5f6ff] shadow-[0_10px_30px_-18px_rgba(85,102,246,0.55)]"
                        : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[14px] font-semibold text-[#0b1024]">
                      <span className={`flex size-4 items-center justify-center rounded-full border ${active ? "border-[#5566f6] bg-[#5566f6]" : "border-[#dcdfed]"}`}>
                        {active ? <Check className="size-3 text-white" /> : null}
                      </span>
                      {option.label}
                      {option.recommended ? (
                        <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">{t("create.recommended")}</span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[12.5px] leading-[1.45] text-[#6f7282]">{option.hint}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <button
          type="button"
          onClick={create}
          disabled={pending}
          className="mt-5 inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          {pending ? t("create.creating") : t("create.submit")}
        </button>

        {created ? (
          <div className="mt-5 rounded-2xl border border-[#5566f6]/30 bg-[#f5f6ff] p-4 sm:p-5">
            <div className="text-[14px] font-semibold text-[#0b1024]">{t("secret.title")}</div>
            <p className="mt-1 text-[13px] text-[#3c4053]">{t("secret.hint")}</p>
            <code className="mt-3 block break-all rounded-xl border border-[#dcdfed] bg-white px-3 py-2.5 font-mono text-[13px] text-[#0b1024]">
              {created.secret}
            </code>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copy(created.secret)}
                className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
              >
                <Copy className="size-4" />
                {t("secret.copyKey")}
              </button>
              <button
                type="button"
                onClick={() => copy(created.mcpUrl)}
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <Copy className="size-4 text-[#5566f6]" />
                {t("secret.copyLink")}
              </button>
            </div>
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#fff8eb] px-3 py-2 text-[12.5px] text-[#9a4a06]">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              {t("secret.warning")}
            </p>
          </div>
        ) : null}
      </section>

      <AiClientGuides baseUrl={baseUrl} secret={created?.secret ?? null} />

      <section className={CARD}>
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("tools.title")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => {
            const Icon = TOOL_ICONS[tool.name] ?? Compass;
            return (
              <div key={tool.name} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-[#eef1ff]">
                    <Icon className="size-[18px] text-[#5566f6]" />
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
                      tool.access === "write" ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#f5f6ff] text-[#3848c7]"
                    }`}
                  >
                    {tool.access === "write" ? t("tools.write") : t("tools.read")}
                  </span>
                </div>
                <div className="mt-3 text-[14px] font-semibold text-[#0b1024]">{t(`tools.${tool.name}.title` as never)}</div>
                <p className="mt-1 text-[12.5px] leading-[1.5] text-[#6f7282]">{t(`tools.${tool.name}.text` as never)}</p>
              </div>
            );
          })}
        </div>
      </section>

      <ApiKeysList keys={keys} onRevoked={(id) => setKeys((list) => list.filter((k) => k.id !== id))} />
    </div>
  );
}
