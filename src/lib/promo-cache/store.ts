import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Atomic JSON snapshot storage on disk for public promotional pages.
 *
 * Design principles (informed by Yesbeat production lessons):
 * - Named domain datasets (`tariffs`, `blog-articles`, …), never `md5(sql)`
 *   keys that leave orphan files or need a DB tracking table.
 * - Zero long-lived heap cache and zero background daemons/Redis/root: OS page
 *   cache serves 1–50 KB JSON files in sub-millisecond time without consuming
 *   Node V8 memory or drifting across PM2 processes.
 * - No visitor-facing TTL expiration: cached files are served as-is with 0 DB
 *   queries and refreshed explicitly on admin mutations, deploys, and cron.
 * - Atomic `tmp + rename` writes in the target directory prevent torn reads.
 */

export type PromoSnapshotEnvelope<T> = {
  version: 1;
  dataset: string;
  generatedAt: string;
  data: T;
};

export type PromoSnapshotStatus = {
  dataset: string;
  filePath: string;
  exists: boolean;
  sizeBytes: number | null;
  generatedAt: string | null;
};

const DATASET_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const PROD_DATA_ROOT = "/var/www/wesetupru/data";
const PROD_PROMO_CACHE_DIR = `${PROD_DATA_ROOT}/promo-cache`;

/** Transient cold-start deduplication only; cleared in `.finally()` so zero steady-state RAM. */
const inflightBuilds = new Map<string, Promise<unknown>>();

export function assertValidDatasetName(dataset: string): void {
  if (!DATASET_PATTERN.test(dataset)) {
    throw new Error(`Invalid promo cache dataset name: "${dataset}"`);
  }
}

export function resolvePromoCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  existsSync: (targetPath: string) => boolean = fs.existsSync,
): string {
  const configured = env.PROMO_CACHE_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  if (existsSync(PROD_DATA_ROOT)) {
    return PROD_PROMO_CACHE_DIR;
  }
  return path.resolve(process.cwd(), ".cache", "promo-cache");
}

function snapshotFilePath(dataset: string, dir?: string): string {
  assertValidDatasetName(dataset);
  const baseDir = dir ? path.resolve(dir) : resolvePromoCacheDir();
  return path.join(baseDir, `${dataset}.json`);
}

async function renameWithWindowsRetry(tmpPath: string, targetPath: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fsp.rename(tmpPath, targetPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if ((code === "EPERM" || code === "EACCES") && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

export async function writePromoSnapshotFile<T>(
  dataset: string,
  data: T,
  options?: { dir?: string; now?: Date },
): Promise<PromoSnapshotEnvelope<T>> {
  const targetPath = snapshotFilePath(dataset, options?.dir);
  const targetDir = path.dirname(targetPath);
  await fsp.mkdir(targetDir, { recursive: true });

  const envelope: PromoSnapshotEnvelope<T> = {
    version: 1,
    dataset,
    generatedAt: (options?.now ?? new Date()).toISOString(),
    data,
  };

  const nonce = randomBytes(6).toString("hex");
  const tmpPath = path.join(targetDir, `.${dataset}.${process.pid}.${nonce}.tmp`);
  const serialized = `${JSON.stringify(envelope, null, 2)}\n`;

  try {
    await fsp.writeFile(tmpPath, serialized, "utf8");
    await renameWithWindowsRetry(tmpPath, targetPath);
  } catch (error) {
    await fsp.unlink(tmpPath).catch(() => undefined);
    throw error;
  }

  return envelope;
}

export async function readPromoSnapshotFile<T>(
  dataset: string,
  options?: { dir?: string },
): Promise<PromoSnapshotEnvelope<T> | null> {
  const targetPath = snapshotFilePath(dataset, options?.dir);
  let raw: string;
  try {
    raw = await fsp.readFile(targetPath, "utf8");
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PromoSnapshotEnvelope<T>>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== 1 ||
      parsed.dataset !== dataset ||
      typeof parsed.generatedAt !== "string" ||
      !("data" in parsed)
    ) {
      return null;
    }
    return parsed as PromoSnapshotEnvelope<T>;
  } catch {
    return null;
  }
}

export async function readOrBuildPromoSnapshot<T>(params: {
  dataset: string;
  build: () => Promise<T>;
  fallback: () => T;
  dir?: string;
}): Promise<T> {
  const existing = await readPromoSnapshotFile<T>(params.dataset, { dir: params.dir });
  if (existing !== null) {
    return existing.data;
  }

  const targetDir = params.dir ? path.resolve(params.dir) : resolvePromoCacheDir();
  const lockKey = `${targetDir}::${params.dataset}`;
  const active = inflightBuilds.get(lockKey) as Promise<T> | undefined;
  if (active) {
    return active;
  }

  const task = (async (): Promise<T> => {
    try {
      const fresh = await params.build();
      await writePromoSnapshotFile(params.dataset, fresh, { dir: targetDir }).catch((writeErr) => {
        console.error(`[promo-cache] failed to persist ${params.dataset}.json`, writeErr);
      });
      return fresh;
    } catch (error) {
      console.error(`[promo-cache] cold build failed for ${params.dataset}, using fallback`, error);
      return params.fallback();
    }
  })().finally(() => {
    inflightBuilds.delete(lockKey);
  });

  inflightBuilds.set(lockKey, task);
  return task;
}

export async function inspectPromoSnapshots(
  datasets: readonly string[],
  options?: { dir?: string },
): Promise<PromoSnapshotStatus[]> {
  const results: PromoSnapshotStatus[] = [];
  for (const dataset of datasets) {
    const filePath = snapshotFilePath(dataset, options?.dir);
    try {
      const stat = await fsp.stat(filePath);
      const parsed = await readPromoSnapshotFile<unknown>(dataset, options);
      results.push({
        dataset,
        filePath,
        exists: parsed !== null,
        sizeBytes: stat.size,
        generatedAt: parsed?.generatedAt ?? null,
      });
    } catch {
      results.push({
        dataset,
        filePath,
        exists: false,
        sizeBytes: null,
        generatedAt: null,
      });
    }
  }
  return results;
}
