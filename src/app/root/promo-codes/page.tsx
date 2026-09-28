import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { promoPaidUses } from "@/lib/promo/service";

import { PromoCodesClient, type PromoRow } from "./promo-codes-client";

export const dynamic = "force-dynamic";

export default async function RootPromoCodesPage() {
  await requireRoot();
  const rows = await db.promoCode.findMany({ orderBy: { createdAt: "desc" } });
  const uses = await promoPaidUses(rows.map((r) => r.code));
  const initial: PromoRow[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    kind: r.kind === "fixed" ? "fixed" : "percent",
    value: r.value,
    active: r.active,
    startsAt: r.startsAt?.toISOString() ?? null,
    endsAt: r.endsAt?.toISOString() ?? null,
    maxUses: r.maxUses,
    newClientsOnly: r.newClientsOnly,
    note: r.note,
    paidUses: uses[r.code] ?? 0,
  }));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Промокоды</h1>
        <p className="mt-1 max-w-[720px] text-[14px] leading-relaxed text-[#6f7282]">
          Скидка на подписку при оформлении: процент или рубли, срок, лимит использований,
          «только новым». Считается по оплаченным заказам — брошенный заказ лимит не тратит.
          Если идёт акция (ROOT → «Акции»), промокод считается от цены по акции. К оборудованию
          скидка не применяется. Стартовый набор кодов — <code>scripts/seed-promo-codes.ts</code>
          (создаёт выключенными).
        </p>
      </div>
      <PromoCodesClient initial={initial} />
    </div>
  );
}
