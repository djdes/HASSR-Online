"use client";

import { FileSignature, PlugZap, UserSearch } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { EdoBaseUrlOption, EdoCabinetView } from "@/lib/edo/cabinet.server";
import type { EdoDocumentView } from "@/lib/edo/send-core";
import { cn } from "@/lib/utils";

import { EdoCabinetCard } from "./edo-cabinet-card";
import { EdoHistory } from "./edo-history";
import { EdoSendForm } from "./edo-send-form";

export function EdoClient({
  initialCabinet,
  baseUrls,
  initialDocuments,
}: {
  initialCabinet: EdoCabinetView | null;
  baseUrls: EdoBaseUrlOption[];
  initialDocuments: EdoDocumentView[];
}) {
  const t = useTranslations("rootEdo");
  const [cabinet, setCabinet] = useState(initialCabinet);
  const [documents, setDocuments] = useState(initialDocuments);

  const steps = [
    { icon: PlugZap, title: t("steps.connect.title"), text: t("steps.connect.text"), done: !!cabinet?.ready },
    { icon: UserSearch, title: t("steps.pick.title"), text: t("steps.pick.text"), done: documents.length > 0 },
    { icon: FileSignature, title: t("steps.sign.title"), text: t("steps.sign.text"), done: false },
  ];

  return (
    <div className="space-y-5">
      <ol className="grid gap-3 md:grid-cols-3" aria-label={t("steps.label")}>
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-2xl text-[15px] font-semibold",
                step.done ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#eef1ff] text-[#5566f6]",
              )}
            >
              <step.icon className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-[#0b1024]">
                {index + 1}. {step.title}
              </div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-[#6f7282]">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-5">
          <EdoSendForm cabinet={cabinet} onSent={(doc) => setDocuments((list) => [doc, ...list.filter((d) => d.id !== doc.id)])} />
          <EdoHistory documents={documents} canRefresh={!!cabinet} onDocuments={setDocuments} />
        </div>
        <aside className={cn("min-w-0 space-y-5 lg:sticky lg:top-6 lg:self-start", !cabinet?.ready && "order-first lg:order-none")}>
          <EdoCabinetCard cabinet={cabinet} baseUrls={baseUrls} onCabinet={setCabinet} />
        </aside>
      </div>
    </div>
  );
}
