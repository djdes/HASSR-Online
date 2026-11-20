/**
 * CLI maintenance & deploy refresh utility for WeSetup promo JSON cache.
 *
 * Usage:
 *   npx tsx scripts/refresh-promo-cache.ts             # rebuilds all 8 JSON snapshots
 *   npx tsx scripts/refresh-promo-cache.ts --status    # prints disk status (0 DB connections)
 *   npx tsx scripts/refresh-promo-cache.ts --only=tariffs,blog-articles
 */
import "dotenv/config";

import {
  PROMO_DATASETS,
  getPromoCacheStatus,
  refreshAllPromoDatasets,
  resolvePromoCacheDir,
  type PromoDatasetName,
} from "../src/lib/promo-cache";

async function printStatus(): Promise<void> {
  const dir = resolvePromoCacheDir();
  const statuses = await getPromoCacheStatus({ dir });
  console.log(`[promo-cache] dir=${dir}`);
  for (const item of statuses) {
    const size = item.sizeBytes !== null ? `${(item.sizeBytes / 1024).toFixed(1)} KB` : "—";
    console.log(
      `  ${item.exists ? "OK  " : "MISS"} ${item.dataset.padEnd(22)} ${size.padStart(9)}  ${item.generatedAt ?? "not generated"}`,
    );
  }
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--status")) {
    await printStatus();
    return;
  }

  const onlyArg = args.find((a) => a.startsWith("--only="));
  const datasets: PromoDatasetName[] = onlyArg
    ? (onlyArg
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is PromoDatasetName =>
          (PROMO_DATASETS as readonly string[]).includes(s),
        ))
    : [...PROMO_DATASETS];

  if (datasets.length === 0) {
    console.error(`[promo-cache] no valid datasets specified. Valid: ${PROMO_DATASETS.join(", ")}`);
    process.exit(1);
  }

  const dir = resolvePromoCacheDir();
  const startedAt = Date.now();
  console.log(`[promo-cache] refreshing ${datasets.length} dataset(s) into ${dir}…`);
  const summaries = await refreshAllPromoDatasets({ dir, datasets });
  for (const s of summaries) {
    console.log(`  [ok] ${s.dataset.padEnd(22)} items=${String(s.itemCount).padEnd(5)} at=${s.generatedAt}`);
  }
  console.log(`[promo-cache] done in ${Date.now() - startedAt} ms`);

  const { db } = await import("../src/lib/db");
  await db.$disconnect().catch(() => undefined);
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("[promo-cache] refresh failed:", error);
    process.exit(1);
  });
