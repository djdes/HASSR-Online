import { EmailInvites } from "@/components/partner/email-invites";
import { InviteLinkCard } from "@/components/partner/invite-link-card";
import { Card } from "@/components/partner/ui";
import { PageGuide } from "@/components/ui/page-guide";
import { buildInviteTexts } from "@/lib/partners/invite-texts";
import { listClientInvites } from "@/lib/partners/invites-list";
import { requirePartnerPage } from "@/lib/partners/page-context";

export const dynamic = "force-dynamic";

export default async function PartnerInvitesPage() {
  const { membership } = await requirePartnerPage();
  const { partner } = membership;
  const [texts, invites] = await Promise.all([
    Promise.resolve(buildInviteTexts(partner.brandName, partner.slug, partner.code, partner.hideFromClients)),
    listClientInvites(partner.id),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Приглашения</h1>
        <p className="mt-1 text-[14px] text-[#6f7282]">
          Три способа подключить клиента: ссылка, код или письмо. Все они привязывают организацию к {partner.brandName}.
        </p>
      </div>

      <PageGuide
        title="Как клиент подключается"
        storageKey="partner-invites"
        bullets={[
          "Новый клиент: открывает вашу ссылку, регистрируется — привязка создаётся автоматически, ваш брендинг включается сразу.",
          "Клиент с аккаунтом: в «Настройки → Консультант» вводит ваш код или открывает ссылку и подтверждает подключение.",
          "При подключении клиент выбирает уровень доступа: «только просмотр» или «просмотр и редактирование». Изменить его может только клиент.",
          "Одна организация может быть привязана только к одному партнёру. Ваша собственная организация клиентом стать не может.",
        ]}
      />

      <Card title="Ссылка, код и готовые тексты" eyebrow="Скопируйте и отправьте">
        <InviteLinkCard texts={texts} />
      </Card>

      <Card title="Приглашения по почте" eyebrow="От имени WeSetup">
        <EmailInvites invites={invites} />
      </Card>
    </div>
  );
}
