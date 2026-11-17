// Ежедневная задача с «перемоткой времени» для организации из сценария B.
import { db } from "@/lib/db";
import { loadBillingUnit, readTrialSettings, runBillingTransitionJob, stateForUnit } from "@/lib/billing.server";
import { runTrialFeedbackJob } from "@/lib/trial-feedback.server";
import { runLifecycleJob } from "@/lib/lifecycle/job.server";

const DAY = 24 * 60 * 60 * 1000;
async function main() {
  const user = await db.user.findUnique({ where: { email: process.argv[2] }, select: { organizationId: true } });
  if (!user) throw new Error("no user");
  const unit = await loadBillingUnit(user.organizationId);
  const state = stateForUnit(unit!, await readTrialSettings(), new Date());
  const ends = state.trialEndsAt!;
  console.log("trialEndsAt", ends.toISOString());
  const mine = (r: Awaited<ReturnType<typeof runBillingTransitionJob>>) =>
    r.results.filter((row) => row.organizationId === user.organizationId).map((row) => row.outcome);
  // Сброс прошлых прогонов этой организации.
  await db.auditLog.deleteMany({ where: { organizationId: user.organizationId, action: { in: ["billing.trial.reminder", "trial.feedback_request"] } } });
  await db.crmReminderLog.deleteMany({ where: { dedupeKey: { startsWith: `lc:${unit!.key}:` } } });
  // Каждый «день» до конца пробного: биллинг, затем автоворонка — как в кроне.
  for (let day = 7; day >= 1; day -= 1) {
    const now = new Date(ends.getTime() - day * DAY + 0.5 * DAY);
    const report = await runBillingTransitionJob({ now });
    const lc = await runLifecycleJob({ now });
    const lcMine = lc.results.filter((row) => row.unit === unit!.key).map((row) => `${row.stage}: ${row.outcome}`);
    console.log(`день −${day} (${now.toISOString().slice(0, 10)}, ${["вс","пн","вт","ср","чт","пт","сб"][now.getUTCDay()]})`, JSON.stringify(mine(report)), "автоворонка:", JSON.stringify(lcMine));
  }
  const fb1 = await runTrialFeedbackJob({ now: new Date(ends.getTime() + DAY) });
  const fb2 = await runTrialFeedbackJob({ now: new Date(ends.getTime() + 1.2 * DAY) });
  console.log("feedback", JSON.stringify(fb1), "повтор", JSON.stringify(fb2));
  process.exit(0);
}
void main();
