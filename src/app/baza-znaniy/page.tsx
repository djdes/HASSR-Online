import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, ClipboardCheck, CreditCard, MonitorSmartphone, MousePointerClick, NotebookTabs, Rocket, ShieldCheck, Smartphone } from "lucide-react";

import { KbShell } from "@/components/kb/kb-shell";
import { LiveGuideStartButton } from "@/components/live-guide/live-guide-host";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { KB_ARTICLES, KB_GROUPS } from "@/content/kb/articles";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";

const TITLE = "База знаний WeSetup";
const DESCRIPTION = "Как начать работу и пользоваться WeSetup: кабинет руководителя, журналы СанПиН и ХАССП, телефон сотрудника, чек-листы, ППК и проверка — со снимками экранов.";
const URL = "https://wesetup.ru/baza-znaniy";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: { type: "website", locale: "ru_RU", siteName: "WeSetup", url: URL, title: TITLE, description: DESCRIPTION, images: ogImages({ title: TITLE, subtitle: DESCRIPTION }) },
  twitter: { card: DEFAULT_TWITTER_CARD, title: TITLE, description: DESCRIPTION, images: twitterImages({ title: TITLE }) },
};

const GROUP_ICONS: Record<string, typeof BookOpen> = {
  start: Rocket,
  cabinet: MonitorSmartphone,
  journals: NotebookTabs,
  phone: Smartphone,
  control: ClipboardCheck,
  inspection: ShieldCheck,
  billing: CreditCard,
};

export default function KnowledgeBaseIndexPage() {
  const first = KB_ARTICLES[0];
  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader activeSection="knowledge-base" />
      <KbShell>
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#5566f6]">Документация</div>
        <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-[40px]">{TITLE}</h1>
        <p className="mt-3 max-w-[680px] text-[16px] leading-[1.7] text-[#3c4053]">
          Как начать работу и пользоваться сервисом: кабинет руководителя, журналы, телефон сотрудника, чек-листы и подготовка к проверке. Снимки — настоящие экраны, на них цифрами отмечено главное.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/baza-znaniy/${first.slug}`} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]">
            С чего начать <ArrowRight className="size-4" />
          </Link>
          <Link href="/register" className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
            Попробовать бесплатно
          </Link>
          <LiveGuideStartButton className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
            <MousePointerClick className="size-4 text-[#5566f6]" />
            Регистрация с подсказками
          </LiveGuideStartButton>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {KB_GROUPS.map((group) => {
            const Icon = GROUP_ICONS[group.id] ?? BookOpen;
            return (
              <section key={group.id} className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                    <Icon className="size-5" />
                  </span>
                  <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{group.title}</h2>
                </div>
                <ul className="mt-4 space-y-1">
                  {group.articles.map((article) => (
                    <li key={article.slug}>
                      <Link href={`/baza-znaniy/${article.slug}`} className="group flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-[14.5px] text-[#3c4053] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]">
                        {article.title}
                        <ArrowRight className="size-4 shrink-0 text-[#5566f6] opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </KbShell>
      <PublicFooter />
    </div>
  );
}
