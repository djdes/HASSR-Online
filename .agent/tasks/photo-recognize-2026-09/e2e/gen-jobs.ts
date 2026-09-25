// Builds wesetup_vision_extract job texts for the worker -TestJobFile runs against the local dev server.
import { readFileSync, writeFileSync } from "node:fs";

import { buildVisionImageUrl, signVisionImage, signedVisionImageUrl } from "@/lib/ai-vision/image-link";
import { buildVisionInstruction, buildVisionJobText } from "@/lib/ai-vision/instructions";
import { saveVisionImage, visionTempDir } from "@/lib/ai-vision/temp-store";

// Same secret as the dev server (NEXTAUTH_SECRET from the copy's .env); never printed.
for (const line of readFileSync("C:/wt/qrforms/.env", "utf8").split(/\r?\n/)) {
  const match = /^(NEXTAUTH_SECRET|VISION_IMAGE_SECRET)=(.*)$/.exec(line.trim());
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const dir = process.argv[2];
const base = "http://localhost:3042";

async function main() {
  const bytes = readFileSync("C:/wt/qrforms/.agent/tasks/photo-recognize-2026-09/evidence/ac1-invoice.png");
  const saved = await saveVisionImage(bytes);
  if (!saved) throw new Error("not an image");
  const instruction = buildVisionInstruction("raw");
  const good = signedVisionImageUrl(base, saved.id);
  const parsed = new URL(good);
  const exp = Number(parsed.searchParams.get("exp"));
  const sig = parsed.searchParams.get("sig")!;
  const tampered = buildVisionImageUrl(base, saved.id, exp, (sig[0] === "A" ? "B" : "A") + sig.slice(1));
  const pastExp = Date.now() - 1000;
  const expired = buildVisionImageUrl(base, saved.id, pastExp, signVisionImage(saved.id, pastExp));
  const jobs: Record<string, string[]> = {
    ok: [good],
    "foreign-host": [good.replace("http://localhost:3042", "http://evil.example.com:3042")],
    "foreign-port": [good.replace("localhost:3042", "localhost:3043")],
    "foreign-path": [`${base}/uploads/${saved.id}?exp=${exp}&sig=${sig}`],
    tampered: [tampered],
    expired: [expired],
  };
  for (const [name, urls] of Object.entries(jobs)) {
    writeFileSync(`${dir}/job-${name}.txt`, buildVisionJobText({ imageUrls: urls, instruction }), "utf8");
  }
  writeFileSync(
    `${dir}/worker-test-config.json`,
    JSON.stringify({ SiteBaseUrl: base, Model: "sonnet", TimeoutSec: 100 }, null, 2),
    "utf8"
  );
  console.log(JSON.stringify({ tempDir: visionTempDir(), id: saved.id, good: good.replace(/sig=.*/, "sig=…") }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
