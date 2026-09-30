import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock3, Handshake, PauseCircle, XCircle } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getPartnerBrandById, logoUrlFor } from "@/lib/partners/branding";
import { getPartnerMembership } from "@/lib/partners/service";
import { AuthSessionProvider } from "@/components/layout/session-provider";
import { PartnerShell } from "@/components/partner/partner-shell";
import { SiteThemeBootstrap, SiteThemeProvider } from "@/components/theme/site-theme";
import { Toaster } from "@/components/ui/sonner";
import { readInitialTheme } from "@/lib/site-theme.server";
import "@/app/app-theme.css";

export const dynamic = "force-dynamic";

// Партнёрский кабинет — приватная зона, индексировать нечего.
export const metadata = {
  robots: { index: false, follow: false },
};

/**
 * `/partner/*` — кабинет партнёра. Middleware сюда не заходит: доступ
 * решается тут, по членству в PartnerUser. Не партнёр → на форму
 * заявки; партнёр не в статусе «active» → страница-объяснение
 * (заявка на рассмотрении / отклонена / приостановлена) без навигации
 * кабинета.
 */
export default async function PartnerAreaLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  const membership = await getPartnerMembership(session.user.id);
  if (!membership) redirect("/settings/partner");

  const [profile, brand, ownOrg, partnerRow] = await Promise.all([
    db.user.findUnique({ where: { id: session.user.id }, select: { themePreference: true } }),
    getPartnerBrandById(membership.partnerId),
    session.user.organizationId
      ? db.organization.findUnique({ where: { id: session.user.organizationId }, select: { name: true } })
      : null,
    db.partner.findUnique({ where: { id: membership.partnerId }, select: { reviewComment: true } }),
  ]);
  const initialTheme = await readInitialTheme(profile?.themePreference);
  const brandName = brand?.brandName ?? membership.partner.brandName;
  const logoUrl = brand?.hasLogoLight ? logoUrlFor(brand, "light") : null;

  const body =
    membership.partner.status === "active" ? (
      <PartnerShell
        brandName={brandName}
        logoUrl={logoUrl}
        userName={session.user.name || session.user.email || ""}
        userEmail={session.user.email || ""}
        hasOwnOrganization={Boolean(session.user.organizationId)}
        ownOrganizationName={ownOrg?.name ?? null}
      >
        {children}
      </PartnerShell>
    ) : (
      <PartnerStatusNotice
        status={membership.partner.status}
        companyName={membership.partner.companyName}
        reviewComment={partnerRow?.reviewComment ?? null}
        hasOwnOrganization={Boolean(session.user.organizationId)}
      />
    );

  return (
    <AuthSessionProvider session={session}>
      <SiteThemeProvider initialTheme={initialTheme}>
        <div className="app-shell min-h-screen bg-[#f4f5fb]" data-app-theme={initialTheme} suppressHydrationWarning>
          {/* Первым ребёнком — красит оболочку до первого кадра. */}
          <SiteThemeBootstrap />
          {body}
        </div>
        <Toaster />
      </SiteThemeProvider>
    </AuthSessionProvider>
  );
}

const STATUS_NOTICE = {
  pending: {
    icon: Clock3,
    tone: "bg-[#eef1ff] text-[#3848c7]",
    title: "Заявка на рассмотрении",
    text: "Мы проверяем заявку вручную — обычно это занимает один-два рабочих дня. Как только партнёрство подтвердят, придёт письмо и сообщение в Telegram, а этот кабинет откроется.",
  },
  rejected: {
    icon: XCircle,
    tone: "bg-[#fff4f2] text-[#a13a32]",
    title: "Заявка отклонена",
    text: "К сожалению, мы не смогли подтвердить партнёрство. Если считаете, что это ошибка или хотите дополнить заявку — напишите нам на partners@wesetup.ru.",
  },
  suspended: {
    icon: PauseCircle,
    tone: "bg-[#fff7ed] text-[#9a4a06]",
    title: "Партнёрство приостановлено",
    text: "Кабинет временно недоступен: брендинг у клиентов снят, доступ к их кабинетам закрыт, начисления не идут. История вознаграждений сохранена. Чтобы возобновить — напишите на partners@wesetup.ru.",
  },
} as const;

function PartnerStatusNotice({
  status,
  companyName,
  reviewComment,
  hasOwnOrganization,
}: {
  status: "pending" | "rejected" | "suspended";
  companyName: string;
  reviewComment: string | null;
  hasOwnOrganization: boolean;
}) {
  const notice = STATUS_NOTICE[status];
  const Icon = notice.icon;
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[520px] rounded-3xl border border-[#ececf4] bg-white p-7 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-9">
        <div className="flex items-center gap-3">
          <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${notice.tone}`}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              <Handshake className="mr-1 inline size-3.5 align-[-2px]" />
              Партнёрская программа
            </div>
            <h1 className="mt-0.5 text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">{notice.title}</h1>
          </div>
        </div>
        <p className="mt-4 text-[14px] leading-[1.6] text-[#3c4053]">
          Компания: <span className="font-medium text-[#0b1024]">{companyName}</span>
        </p>
        <p className="mt-2 text-[14px] leading-[1.6] text-[#3c4053]">{notice.text}</p>
        {reviewComment ? (
          <div className="mt-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 text-[13px] leading-[1.55] text-[#3c4053]">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
              Комментарий модератора
            </div>
            {reviewComment}
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          {hasOwnOrganization ? (
            <Link
              href="/dashboard"
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
            >
              В мою организацию
            </Link>
          ) : null}
          <Link
            href="/settings/partner"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Статус заявки
          </Link>
          <a
            href="mailto:partners@wesetup.ru"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Написать нам
          </a>
        </div>
      </div>
    </div>
  );
}
