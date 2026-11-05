import { isPlatformAdministrator } from "@/lib/platform-access";

export type GglSpendApprover = {
  isRoot: boolean;
  platformSections: readonly string[];
};

export type GglSpendApprovalOptions = {
  allowSeoApproveWithinPlan: boolean;
  withinApprovedPlan: boolean;
};

/**
 * Financial guard for GoGetLinks link purchases and budget adjustments.
 *
 * By default, spending and limit changes are restricted to the platform
 * superadmin (owner `isRoot`) or full platform administrators (`isPlatformAdministrator`).
 *
 * If `allowSeoApproveWithinPlan` is explicitly enabled on the GoGetLinks account
 * connection and the purchase slot fits within an approved schedule plan,
 * a user with the `seo` section may approve the purchase directly.
 */
export function canApproveGglSpend(user: GglSpendApprover, opts: GglSpendApprovalOptions): boolean {
  if (isPlatformAdministrator(user)) {
    return true;
  }
  return Boolean(
    opts.allowSeoApproveWithinPlan &&
      opts.withinApprovedPlan &&
      user.platformSections.includes("seo"),
  );
}
