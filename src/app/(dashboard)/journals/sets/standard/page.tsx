import { forbidden } from "next/navigation";
import { JournalSetPage } from "@/components/journals/journal-set-page";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const dynamic = "force-dynamic";

/**
 * «Журналы → Наборы журналов → Стандартный набор» (11 журналов эскиза, скан 82).
 * Состав — только `JOURNAL_SETS.standard` (`src/lib/journal-sets.ts`).
 * Наборы настраивает руководство — guard как у `/api/settings/journals/sets`.
 */
export default async function StandardJournalSetPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  return <JournalSetPage setId="standard" session={session} />;
}
