import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import { listEmailSenders } from "@/lib/email-sender-access.server";
import { loadCrmContact } from "@/lib/crm/queries.server";
import { canAccessPlatformPath } from "@/lib/platform-access";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { displayName } from "../../crm-format";
import { ContactCardClient } from "./contact-card-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await loadCrmContact(id);
  return { title: card ? `${displayName(card.contact)} — CRM` : "CRM" };
}

export default async function CrmContactPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const viewer = await platformViewerForSession(session);
  const own = viewer.scope === "own";
  const card = await loadCrmContact(id, { userId: session.user.id, own });
  if (!card) notFound();
  const can = (href: string) => canAccessPlatformPath(viewer, href);
  return (
    <div className="space-y-4" data-crm-contact={card.contact.id}>
      <Link href="/root/crm/contacts" className="inline-flex items-center gap-1.5 text-[13px] text-[#3848c7] hover:underline">
        <ArrowLeft className="size-4" />
        Все контакты
      </Link>
      <ContactCardClient
        emailSenders={await listEmailSenders(session.user.id)}
        card={card}
        viewerId={session.user.id}
        ownScope={own}
        links={{
          feedback: can("/root/feedback"),
          proposals: can("/root/proposals"),
          invoices: can("/root/invoices"),
          // Менеджеру («свои») — карточка только своего клиента, чужая ответит 404.
          organization: card.organization
            ? can(`/root/organizations/${card.organization.id}`) && (!own || card.organization.accountManagerId === session.user.id)
            : false,
          mailSettings: can("/root/me"),
        }}
        nowIso={new Date().toISOString()}
      />
    </div>
  );
}
