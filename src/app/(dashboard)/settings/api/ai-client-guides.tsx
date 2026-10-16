"use client";

import { useState } from "react";
import { ArrowUpRight, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCopy } from "./ai-connect-client";
import { buildConnectionSnippets } from "./connection-snippets";

type Tab = "claude" | "chatgpt" | "dev" | "rest";
const TABS: Tab[] = ["claude", "chatgpt", "dev", "rest"];

function Snippet({ value, label }: { value: string; label: string }) {
  const copy = useCopy();
  return (
    <div className="mt-2 flex items-start gap-2 rounded-2xl border border-[#ececf4] bg-[#0b1024] p-3">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12.5px] leading-[1.6] text-[#e6e8f5]">{value}</pre>
      <button
        type="button"
        onClick={() => copy(value)}
        aria-label={label}
        title={label}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white transition-colors duration-150 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/40"
      >
        <Copy className="size-4" />
      </button>
    </div>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2">
      {items.map((text, index) => (
        <li key={index} className="flex gap-3 text-[14px] leading-[1.55] text-[#3c4053]">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[12px] font-semibold text-[#3848c7] tabular-nums">
            {index + 1}
          </span>
          <span>{text}</span>
        </li>
      ))}
    </ol>
  );
}

export function AiClientGuides({ baseUrl, secret }: { baseUrl: string; secret: string | null }) {
  const t = useTranslations("settingsManagement.aiConnect");
  const [tab, setTab] = useState<Tab>("claude");
  const snippets = buildConnectionSnippets({ baseUrl, secret, placeholder: t("connect.placeholder") });
  const copyLabel = t("connect.copy");

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6">
      <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#5566f6]">{t("connect.step")}</div>
      <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("connect.title")}</h2>
      {!secret ? <p className="mt-1 text-[13px] text-[#6f7282]">{t("connect.noKeyHint")}</p> : null}

      <div className="mt-4">
        {/* На телефоне — сетка 2×2: четыре вкладки в строку не помещаются. */}
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-2xl bg-[#f5f6ff] p-1 sm:inline-flex">
          {TABS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`h-9 truncate whitespace-nowrap rounded-xl px-3 text-[13.5px] sm:px-3.5 font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
                tab === value ? "bg-white text-[#0b1024] shadow-[0_4px_14px_-8px_rgba(11,16,36,0.35)]" : "text-[#6f7282] hover:text-[#3848c7]"
              }`}
            >
              {t(`connect.tabs.${value}`)}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" className="mt-4">
        {tab === "claude" ? (
          <>
            <Steps items={[t("connect.claude.s1"), t("connect.claude.s2"), t("connect.claude.s3")]} />
            <Snippet value={snippets.claudeUrl} label={copyLabel} />
            <p className="mt-2 text-[12.5px] text-[#6f7282]">{t("connect.plansNote")}</p>
          </>
        ) : null}
        {tab === "chatgpt" ? (
          <>
            <Steps items={[t("connect.chatgpt.s1"), t("connect.chatgpt.s2"), t("connect.chatgpt.s3")]} />
            <Snippet value={snippets.chatgptUrl} label={copyLabel} />
            <p className="mt-2 text-[12.5px] text-[#6f7282]">{t("connect.plansNote")}</p>
          </>
        ) : null}
        {tab === "dev" ? (
          <div className="space-y-4">
            <div>
              <Steps items={[t("connect.dev.s1")]} />
              <Snippet value={snippets.claudeCode} label={copyLabel} />
            </div>
            <div>
              <Steps items={[t("connect.dev.s2")]} />
              <Snippet value={snippets.cursorJson} label={copyLabel} />
            </div>
          </div>
        ) : null}
        {tab === "rest" ? (
          <>
            <Steps items={[t("connect.rest.s1"), t("connect.rest.s2")]} />
            <Snippet value={snippets.curl} label={copyLabel} />
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="/api/v1/openapi.json"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                {t("connect.rest.openapi")}
                <ArrowUpRight className="size-4 text-[#5566f6]" />
              </a>
              <a
                href="/developers"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                {t("connect.rest.docs")}
                <ArrowUpRight className="size-4 text-[#5566f6]" />
              </a>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
