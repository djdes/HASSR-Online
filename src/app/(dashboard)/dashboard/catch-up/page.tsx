import { forbidden, notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { automationOn } from "@/lib/journal-controls";
import { getJournalControls } from "@/lib/journal-controls.server";
import { CatchUpClient } from "./catch-up-client";

export const dynamic = "force-dynamic";

export default async function CatchUpPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  // Без галочки спецрежима страницы как будто нет (2026-11-05).
  if (!automationOn(await getJournalControls(getActiveOrgId(session)), "catchUp")) notFound();
  return <CatchUpClient />;
}
