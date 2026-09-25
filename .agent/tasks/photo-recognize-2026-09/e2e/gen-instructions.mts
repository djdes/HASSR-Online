// Writes the exact production instructions (buildVisionInstruction) to UTF-8 files for -TestPromptFile.
import { writeFileSync } from "node:fs";
import { buildVisionInstruction } from "@/lib/ai-vision/instructions";

const dir = process.argv[2];
for (const kind of ["menu", "raw", "generic"] as const) {
  writeFileSync(`${dir}/instr-${kind}.txt`, buildVisionInstruction(kind), "utf8");
}
console.log(buildVisionInstruction("menu"));
