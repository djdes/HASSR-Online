// Writes the exact production instructions (buildVisionInstruction) to UTF-8 files for -TestPromptFile.
// Run: node --import tsx .agent/tasks/photo-recognize-2026-09/e2e/gen-instructions.ts <out-dir>
import { writeFileSync } from "node:fs";
import { buildVisionInstruction } from "@/lib/ai-vision/instructions";

const dir = process.argv[2];
for (const kind of ["menu", "raw", "generic", "label", "reading"] as const) {
  writeFileSync(`${dir}/instr-${kind}.txt`, buildVisionInstruction(kind), "utf8");
}
writeFileSync(`${dir}/instr-photo_check.txt`, buildVisionInstruction("photo_check", { expected: "food" }), "utf8");
console.log("written to", dir);
