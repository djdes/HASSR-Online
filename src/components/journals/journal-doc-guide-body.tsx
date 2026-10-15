"use client";
import { useTranslations } from "next-intl";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Lightbulb,
  ListChecks,
  Package,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import type { JournalDocGuide } from "@/lib/journal-doc-guides";

/**
 * Секции «правил заполнения» журнала (intro, кто/когда, что подготовить,
 * пошагово, примеры, ошибки, красные флаги, норматив). Вынесены из
 * sheet'а круглой кнопки, чтобы тот же контент показывать во вкладке
 * «Правила» окна «Как заполнить?». Вёрстка не менялась.
 */
export function JournalDocGuideBody({ guide }: { guide: JournalDocGuide }) {
  const t = useTranslations("journalControls.guideSections");
  return (
    <div className="space-y-5">
      {/* Intro */}
      <p className="text-[14px] leading-[1.7] text-[#3c4053]">{guide.intro}</p>

      {/* Meta block: who + when */}
      <div className="grid gap-3 sm:grid-cols-2">
        <MetaCard
          icon={<Users className="size-4" />}
          label={t("who")}
          value={guide.whoFills}
        />
        <MetaCard
          icon={<Clock className="size-4" />}
          label={t("when")}
          value={guide.whenToFill}
        />
      </div>

      {/* Prepare */}
      {guide.prepare && guide.prepare.length > 0 ? (
        <Section
          title={t("prepare")}
          icon={<Package className="size-4" />}
          tone="info"
        >
          <ul className="space-y-1.5">
            {guide.prepare.map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-[13px] leading-[1.55] text-[#3c4053]"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* Steps */}
      <Section
        title={t("steps")}
        icon={<ListChecks className="size-4" />}
        tone="primary"
      >
        <ol className="space-y-3">
          {guide.steps.map((step, i) => (
            <li
              key={i}
              className="flex gap-3 rounded-2xl border border-[#ececf4] bg-white p-3.5"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5566f6] to-[#7a5cff] text-[12px] font-semibold text-white">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold leading-tight text-[#0b1024]">
                  {step.title}
                </div>
                <p className="mt-1 text-[13px] leading-[1.6] text-[#3c4053]">
                  {step.body}
                </p>
                {step.tip ? (
                  <div className="mt-2 flex items-start gap-2 rounded-xl bg-[#fff8eb] px-3 py-2">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-[#a13a32]" />
                    <span className="text-[12px] leading-[1.55] text-[#7a4a00]">
                      {step.tip}
                    </span>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* Examples */}
      {guide.examples && guide.examples.length > 0 ? (
        <Section
          title={t("examples")}
          icon={<Sparkles className="size-4" />}
          tone="success"
        >
          <div className="space-y-2">
            {guide.examples.map((ex, i) => (
              <div
                key={i}
                className="rounded-xl border border-[#c8f0d5] bg-[#ecfdf5]/50 px-3 py-2.5"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#136b2a]">
                  {ex.label}
                </div>
                <div className="mt-1 text-[13px] leading-[1.55] text-[#0b1024]">
                  {ex.value}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Common mistakes */}
      {guide.mistakes && guide.mistakes.length > 0 ? (
        <Section
          title={t("mistakes")}
          icon={<XCircle className="size-4" />}
          tone="warn"
        >
          <ul className="space-y-1.5">
            {guide.mistakes.map((m, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-[13px] leading-[1.55] text-[#3c4053]"
              >
                <span className="mt-0.5 inline-flex size-1.5 shrink-0 rounded-full bg-[#a13a32]" />
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* Red flags */}
      {guide.redFlags && guide.redFlags.length > 0 ? (
        <Section
          title={t("redFlags")}
          icon={<AlertTriangle className="size-4" />}
          tone="warn"
        >
          <div className="space-y-2">
            {guide.redFlags.map((rf, i) => (
              <div
                key={i}
                className="rounded-xl border border-[#ffd2cd] bg-[#fff4f2] p-3"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#a13a32]" />
                  <div className="text-[13px] font-semibold text-[#a13a32]">
                    {rf.trigger}
                  </div>
                </div>
                <div className="mt-1.5 flex items-start gap-2 pl-5">
                  <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-[#3c4053]" />
                  <div className="text-[13px] leading-[1.55] text-[#3c4053]">
                    {rf.action}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Legal ref */}
      {guide.legalRef ? (
        <div className="flex items-start gap-2 rounded-xl border border-[#ececf4] bg-[#fafbff] px-3 py-2.5">
          <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-[#6f7282]" />
          <div className="text-[12px] leading-[1.55] text-[#6f7282]">
            <span className="font-semibold text-[#3c4053]">{t("regulationLabel")}</span>{" "}
            {guide.legalRef}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetaCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[#6f7282]">
        <span className="text-[#5566f6]">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 text-[13px] leading-[1.55] text-[#0b1024]">
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "info" | "primary" | "success" | "warn";
  children: React.ReactNode;
}) {
  const accent =
    tone === "primary"
      ? "text-[#5566f6]"
      : tone === "success"
        ? "text-[#136b2a]"
        : tone === "warn"
          ? "text-[#a13a32]"
          : "text-[#3848c7]";
  return (
    <section>
      <div
        className={`mb-2.5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${accent}`}
      >
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </section>
  );
}
