import { Info } from "lucide-react";

/**
 * Тонкая плашка сотруднику без прав на тариф, пока руководитель решает
 * после конца бесплатного периода. Работа не блокируется — только
 * объяснение, почему руководитель может спросить про состав смены.
 */
export function BillingStaffNotice({ variant = "site" }: { variant?: "site" | "mini" }) {
  return (
    <div
      role="status"
      data-testid="billing-staff-notice"
      className={`flex items-center gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-2 text-[13px] leading-[1.45] text-[#6f7282] ${
        variant === "site" ? "mb-4" : "mb-3"
      }`}
    >
      <Info className="size-4 shrink-0 text-[#5566f6]" />
      <span>Руководитель выбирает тариф — работа продолжается как обычно.</span>
    </div>
  );
}
