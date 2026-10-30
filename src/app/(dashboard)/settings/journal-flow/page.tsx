import { forbidden, redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { JournalFlowClient } from "./journal-flow-client";

export const dynamic = "force-dynamic";

export default async function JournalFlowPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!hasCapability(session.user, "admin.full")) forbidden();

  const organizationId = getActiveOrgId(session);
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { taskFlowMode: true },
  });
  return <JournalFlowClient initialMode={(org?.taskFlowMode as "race" | "shared" | "manual") ?? "race"} />;
}
