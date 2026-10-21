import { requireRoot } from "@/lib/auth-helpers";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { moscowDate } from "@/lib/yandex-direct-report";
import { DirectStatsClient } from "./direct-stats-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RootDirectPage() {
  await requireRoot();
  return (
    <DomainMessagesBoundary namespaces={["rootDirect"]}>
      <DirectStatsClient today={moscowDate()} />
    </DomainMessagesBoundary>
  );
}