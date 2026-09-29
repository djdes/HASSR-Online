import { requireRoot } from "@/lib/auth-helpers";
import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { fallbackSender } from "@/lib/proposal/content";
import { readDefaultProposalSender } from "@/lib/proposal/context.server";
import { listProposalPromoOptions } from "@/lib/proposal/root.server";
import { PROPOSAL_SPHERES } from "@/lib/proposal/spheres";

import { ProposalsClient } from "./proposals-client";

export const dynamic = "force-dynamic";

/**
 * ROOT → «Коммерческие предложения»: генератор КП по сфере — PDF на А4,
 * письмо и веб-версия по подписанной ссылке. Цены — из тарифа и акций на
 * момент отрисовки, промокод — из «Промокодов» или вручную.
 */
export default async function RootProposalsPage() {
  const session = await requireRoot();
  const [savedSender, promoOptions, requisites] = await Promise.all([
    readDefaultProposalSender(),
    listProposalPromoOptions(),
    readPlatformRequisites().catch(() => null),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Коммерческие предложения</h1>
        <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
          КП на одном листе А4 под сферу клиента: как работают журналы по QR, что получит заведение, какие журналы
          нужны, и предложение — бесплатно для одного сотрудника, подписка для команды со скидкой по промокоду. Цена
          и акция берутся из «Тарифов» и «Акций» в момент открытия, реквизиты — из «Реквизитов».
        </p>
      </div>
      <ProposalsClient
        spheres={PROPOSAL_SPHERES}
        promoOptions={promoOptions}
        savedSender={savedSender}
        fallbackSender={fallbackSender(requisites)}
        rootEmail={session.user.email ?? null}
      />
    </div>
  );
}
