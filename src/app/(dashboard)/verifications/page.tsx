import { forbidden, redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { hasCapability } from "@/lib/permission-presets";
import { VerificationsClient } from "./verifications-client";

export const dynamic = "force-dynamic";

export default async function VerificationsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!hasCapability(session.user, "tasks.verify")) forbidden();
  return <VerificationsClient />;
}
