import { NicheLanding, getNicheMetadata } from "@/components/landing/niche-landing";

export const metadata = getNicheMetadata("dlya-salona-krasoty");

export default function DlyaSalonaKrasotyPage() {
  return <NicheLanding slug="dlya-salona-krasoty" />;
}
