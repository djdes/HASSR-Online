/**
 * Шаблоны Word (`document-docx.ts`, 6 журналов) — как их скачивают с сайта:
 * подвал с копирайтом и QR на /qb с самой длинной помещающейся почтой.
 * DOCX → PDF через LibreOffice (отдельный профиль), число страниц и место QR
 * в подвале (растр) — до и после (страниц не больше, QR читается).
 *
 *   node --import tsx .agent/tasks/qr-bw-minimal-2026-09/docx-templates.ts <метка>
 * PDF/DOCX — в D:/wt-build/tmp-bwqr/docx-<метка>/; сводка — raw/docx-<метка>.json.
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { BLANK_QR_LINES, blankQrUrl } from "@/lib/blank-qr-token";
import { DOCX_SAMPLE_CODES, renderJournalDocumentDocx } from "@/lib/document-docx";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { journalQrMatrix } from "@/lib/pdf-journal-qr";

import { BLANK_EMAIL } from "../journal-qr-header-2026-09/pages";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "qr-bw-minimal-2026-09");
const TMP = process.env.BWQR_TMP ?? "D:/wt-build/tmp-bwqr";
const SOFFICE = process.env.SOFFICE ?? "C:/Program Files/LibreOffice/program/soffice.exe";
export const ORIGIN = "https://wesetup.ru";

export function docxQrUrl(code: string): string {
  return blankQrUrl(ORIGIN, { target: { kind: "code", code }, email: BLANK_EMAIL }).url;
}

async function main() {
  const label = process.argv[2];
  if (!label) throw new Error("метка: master | after");
  const dir = path.join(TMP, `docx-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const code of DOCX_SAMPLE_CODES) {
    const { buffer } = await renderJournalDocumentDocx(buildJournalSampleInput(code), code, {
      footer: { qrUrl: docxQrUrl(code), lines: BLANK_QR_LINES },
    });
    const file = path.join(dir, `${code}.docx`);
    fs.writeFileSync(file, buffer);
    files.push(file);
  }
  const profile = `file:///${path.join(TMP, "lo-profile").replace(/\\/g, "/")}`;
  const run = spawnSync(SOFFICE, [`-env:UserInstallation=${profile}`, "--headless", "--convert-to", "pdf", "--outdir", dir, ...files], {
    encoding: "utf8",
    timeout: 300_000,
  });
  if (run.status !== 0) throw new Error(`LibreOffice: ${run.stderr || run.stdout}`);
  const out = DOCX_SAMPLE_CODES.map((code) => {
    const pdf = fs.readFileSync(path.join(dir, `${code}.pdf`));
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    const url = docxQrUrl(code);
    return { code, url, modulesH: journalQrMatrix(url).modules.size, pages, pdfBytes: pdf.length };
  });
  for (const row of out) console.log(`${row.code.padEnd(24)} ${row.pages} стр. QR H ${row.modulesH} мод. ${row.url}`);
  fs.mkdirSync(path.join(TASK_DIR, "raw"), { recursive: true });
  fs.writeFileSync(path.join(TASK_DIR, "raw", `docx-${label}.json`), JSON.stringify(out, null, 1));
}

if (process.argv[1] && /docx-templates\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
