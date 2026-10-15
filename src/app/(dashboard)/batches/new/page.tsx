import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/auth-helpers";
import { BatchForm } from "@/components/batches/batch-form";

export default async function NewBatchPage() {
  await requireAuth();
  const t = await getTranslations("productionBatches");
  return (
    <div className="space-y-5">
      <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold">{t("newBatch")}</h1>
      <BatchForm />
    </div>
  );
}
