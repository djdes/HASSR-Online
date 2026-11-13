import { requireRoot } from "@/lib/auth-helpers";
import { listEmailSenders } from "@/lib/email-sender-access.server";
import { workspaceMailHistory } from "@/lib/mail-workspace.server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { MailWorkspace } from "@/components/root/mail-workspace";

export const dynamic = "force-dynamic";
export default async function CorrespondencePage() {
  const session = await requireRoot();
  const [senders, history] = await Promise.all([listEmailSenders(session.user.id), workspaceMailHistory(session)]);
  return <DomainMessagesBoundary namespaces={["rootOrganizationManagement"]}>
    <MailWorkspace senders={senders} initialHistory={history} />
  </DomainMessagesBoundary>;
}
