import { NicheLanding, getNicheMetadata } from "@/components/landing/niche-landing";

export const metadata = getNicheMetadata("dlya-fitnes-centra");

export default function DlyaFitnesCentraPage() {
  return <NicheLanding slug="dlya-fitnes-centra" />;
}
