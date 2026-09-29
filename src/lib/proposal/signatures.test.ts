import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OrgSphere } from "@/lib/org-profile";

import { PROPOSAL_SPHERES } from "./spheres";

/**
 * Интерфейс модуля КП заморожен спекой proposal-kp: им пользуется рассылка.
 * Проверка — типами (`npm run typecheck`): если сигнатура в `index.ts`
 * разойдётся со спекой, присваивания ниже перестанут компилироваться.
 * Импорт только типов — модуль с базой в тест не грузится.
 */
type Module = typeof import("./index");
type SpecVars = {
  sphere: OrgSphere;
  companyName?: string | null;
  recipientName?: string | null;
  promo?: { code: string; kind: "percent" | "fixed"; value: number; lifetime: boolean; endsAt: Date | null } | null;
  ctaUrl?: string | null;
  sender?: { name: string; phone?: string | null; email?: string | null; telegram?: string | null } | null;
};
type SpecEmailOptions = { webUrl?: string | null; unsubscribeUrl?: string | null; trackUrl?: (url: string) => string };

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(value: T) => value;

assertType<Equal<import("./types").ProposalVars, SpecVars>>(true);
assertType<Equal<Module["renderProposalPdf"], (vars: SpecVars) => Promise<Buffer>>>(true);
assertType<
  Equal<
    Module["renderProposalEmail"],
    (vars: SpecVars, opts?: SpecEmailOptions) => Promise<{ subject: string; preheader: string; html: string; text: string }>
  >
>(true);
assertType<Equal<Module["proposalWebUrl"], (vars: SpecVars, baseUrl?: string) => string>>(true);
assertType<Equal<Module["PROPOSAL_SPHERES"], Array<{ sphere: OrgSphere; label: string }>>>(true);

describe("интерфейс модуля КП", () => {
  it("PROPOSAL_SPHERES — сфера и подпись", () => {
    assert.ok(PROPOSAL_SPHERES.length > 0);
    for (const item of PROPOSAL_SPHERES) {
      assert.equal(typeof item.sphere, "string");
      assert.ok(item.label.length > 0);
    }
  });
});
