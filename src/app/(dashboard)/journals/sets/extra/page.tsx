import { forbidden } from "next/navigation";
import { JournalSetPage } from "@/components/journals/journal-set-page";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const dynamic = "force-dynamic";

/**
 * «Журналы → Наборы журналов → Дополнительные»: остальной каталог, включается по одному.
 * Состав — только `JOURNAL_SETS.extra` (`src/lib/journal-sets.ts`).
 * Наборы настраивает руководство — guard как у `/api/settings/journals/sets`.
 */
export default async function ExtraJournalSetPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  return <JournalSetPage setId="extra" session={session} />;
}
