import { getTranslations } from "next-intl/server";
import { AtSign } from "lucide-react";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { readMailSender } from "@/lib/platform-mail.server";
import { visibleEmail } from "@/lib/platform-team.server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { MailSenderForm } from "./mail-sender-form";

export const dynamic = "force-dynamic";

/** «Моя почта» — the mailbox this panel user's letters to clients go from. */
export default async function RootMyMailPage() {
  const session = await requireRoot();
  const [t, sender, user] = await Promise.all([
    getTranslations("rootPanel"),
    readMailSender(session.user.id),
    db.user.findUnique({ where: { id: session.user.id }, select: { name: true, email: true, contactEmail: true, phone: true, positionTitle: true } }),
  ]);
  const defaults = {
    fromName: user?.name ?? "",
    fromEmail: user ? visibleEmail(user) ?? "" : "",
    phone: user?.phone ?? "",
    position: user?.positionTitle ?? "",
  };
  return (
    <DomainMessagesBoundary namespaces={["rootPanel"]}>
      <div className="mx-auto max-w-[860px] space-y-6">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <AtSign className="size-5" />
          </span>
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("me.title")}</h1>
            <p className="mt-1 text-[14px] leading-relaxed text-[#6f7282]">{t("me.description")}</p>
          </div>
        </div>
        <MailSenderForm initial={sender} defaults={defaults} />
      </div>
    </DomainMessagesBoundary>
  );
}
