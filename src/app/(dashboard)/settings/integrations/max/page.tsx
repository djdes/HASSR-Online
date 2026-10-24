import { requireAuth,getActiveOrgId } from "@/lib/auth-helpers";
import { requireMaxOrganizationManager } from "@/lib/max/service";
import { MaxConnectClient } from "@/components/max/max-connect-client";
import { PageHeader } from "@/components/ui/page-header";
import { redirect } from "next/navigation";

export const dynamic="force-dynamic";
export default async function MaxSettingsPage() {
  const session=await requireAuth();
  try{await requireMaxOrganizationManager(session.user.id,getActiveOrgId(session));}catch{redirect("/max/connect");}
  return <div className="space-y-6"><PageHeader title="MAX" description="Личный кабинет в мессенджере и подключение организации"/><MaxConnectClient name={session.user.name??"ваш аккаунт"} organizationName={session.user.organizationName} next="/settings" organizationOnly/></div>;
}
