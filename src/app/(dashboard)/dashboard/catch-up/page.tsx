import { forbidden, redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { CatchUpClient } from "./catch-up-client";

export const dynamic = "force-dynamic";

export default async function CatchUpPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  return <CatchUpClient />;
}
