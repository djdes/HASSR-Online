// Сравнение инструкций чтения показаний на живом исполнителе (очередь ИИ-диспетчера).
// node --import tsx zz-eval.ts <runs> <variants,comma> <photos,comma|all>
import fs from "node:fs";

import { buildVisionInstruction, buildVisionJobText } from "@/lib/ai-vision/instructions";
import { parseReadingReply, parseReadingSeen } from "@/lib/ai-vision/parse";

const DIR = "C:/wt/_orch/thermo/";
const runs = Number(process.argv[2] ?? "1");
const variantNames = (process.argv[3] ?? "base,new").split(",");
const photoFilter = process.argv[4] ?? "all";

const urls: Record<string, string> = Object.fromEntries(
  fs.readFileSync(DIR + "urls.txt", "utf8").trim().split(/\r?\n/).map((line) => line.split(" ") as [string, string]),
);
const ZOOM_NOTE = "Второе фото — увеличенный фрагмент того же прибора около верха столбика (или конца стрелки): черты и верх столбика читай по нему, подписи сверяй с первым фото.";
const instructions: Record<string, string> = {
  base: fs.readFileSync(DIR + "instr-baseline.txt", "utf8"),
  new: fs.readFileSync(DIR + "instr-new.txt", "utf8"),
};
instructions.zoom = instructions.new.replace("\n\nПравила:", "\n" + ZOOM_NOTE + "\n\nПравила:");
const expected: Record<string, number> = { single: 32, three: 22, led84: 8.4, dial18: -18, led30: 3, led263: -26.3 };
const tolerance: Record<string, number> = { single: 1, three: 2, led84: 0, dial18: 1, led30: 0, led263: 0 };

function findToken(o: unknown): string | null {
  if (!o || typeof o !== "object") return null;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (k === "PROJECTSFLOW_AGENT_TOKEN" && typeof v === "string") return v;
    const inner = findToken(v);
    if (inner) return inner;
  }
  return null;
}
const token = findToken(JSON.parse(fs.readFileSync("C:/www/ralph/mcp-projectsflow.json", "utf8").replace(/^\uFEFF/, "")));
if (!token) throw new Error("no PF token");
const api = "https://projectsflow.ru/api";
const projectId = "5c2c38fa-f022-44b8-b125-f67a8caa0bf4";

type Job = { status?: string; improvedText?: string | null; error?: string | null };

async function runOne(photo: string, variant: string): Promise<string> {
  const auto = urls[photo + "-auto"];
  const imageUrls = variant === "zoom" ? [urls[photo], urls[photo + "-zoom"]] : variant === "final" && auto ? [urls[photo], auto] : [urls[photo]];
  const instruction = variant === "final" ? buildVisionInstruction("reading", { metric: "temperature", zoom: Boolean(auto) }) : instructions[variant];
  const text = buildVisionJobText({ imageUrls, instruction });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const started = Date.now();
    const enq = await fetch(`${api}/agent/ai-prompt-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, projectId, mode: "assistant" }),
    });
    const body = (await enq.json().catch(() => null)) as { jobId?: string; id?: string } | null;
    const jobId = body?.jobId ?? body?.id;
    if (!jobId) return `enqueue ${enq.status}`;
    let final: Job | null = null;
    while (Date.now() - started < 600_000) {
      const r = await fetch(`${api}/agent/ai-prompt-jobs/${jobId}?wait=25`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 504) continue;
      const got = (await r.json().catch(() => null)) as ({ job?: Job } & Job) | null;
      const job = got?.job ?? got;
      if (job?.status === "succeeded" || job?.status === "failed" || job?.status === "cancelled") {
        final = job;
        break;
      }
    }
    const secs = Math.round((Date.now() - started) / 1000);
    if (final?.status === "succeeded") {
      const raw = final.improvedText ?? "";
      const parsed = parseReadingReply(raw);
      const seen = (parseReadingSeen(raw) ?? "").replace(/\s+/g, " ");
      const v = parsed?.value;
      const ok = v !== null && v !== undefined && Math.abs(v - expected[photo]) <= tolerance[photo] + 1e-9;
      return `${ok ? "OK  " : "MISS"} value=${v ?? "null"} device=${parsed?.device ?? "-"} conf=${parsed?.confidence ?? "-"} ${secs}s | ${seen}`;
    }
    if (!final?.error?.startsWith("wrong_worker")) return `${final?.status ?? "timeout"} ${final?.error ?? ""} ${secs}s`;
  }
  return "wrong_worker x5";
}

async function main() {
  const photos = Object.keys(expected).filter((p) => photoFilter === "all" || photoFilter.split(",").includes(p));
  const tasks: Array<Promise<void>> = [];
  const lines: string[] = [];
  for (const photo of photos) {
    for (const variant of variantNames) {
      for (let run = 1; run <= runs; run += 1) {
        tasks.push(runOne(photo, variant).then((result) => {
          const line = `${photo.padEnd(7)} exp=${String(expected[photo]).padEnd(6)} ${variant.padEnd(4)} #${run}: ${result}`;
          lines.push(line);
          console.log(line);
        }));
      }
    }
  }
  await Promise.all(tasks);
  fs.writeFileSync(DIR + `eval-${Date.now()}.txt`, lines.sort().join("\n"), "utf8");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
