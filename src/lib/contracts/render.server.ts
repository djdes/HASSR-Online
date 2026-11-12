import { readLegalImage, readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { db } from "@/lib/db";

import { renderContractDocx } from "./docx";
import { contractFileName } from "./numbering";
import { renderContractPdf, type ContractImages } from "./pdf";
import { ContractError, snapshotFromRow } from "./service.server";
import { buildContractDocument } from "./template";
import type { ContractSnapshot } from "./types";

/**
 * Стабильная точка входа для PDF/DOCX договора клиента. Её зовут маршруты
 * ROOT, письмо (`send.server.ts`) и — позже — отправка по ЭДО (Saby).
 * Договор всегда перерисовывается из снимка выпуска; факсимиле и печать
 * берутся текущие (это изображения подписи БФС, а не данные договора).
 */

export type RenderedContractFile = { fileName: string; asciiFileName: string; bytes: Buffer };

async function images(snapshot: ContractSnapshot, plain = false): Promise<ContractImages> {
  if (plain || !snapshot.params.useFacsimile) return { facsimile: null, stamp: null };
  const requisites = await readPlatformRequisites();
  const [facsimile, stamp] = await Promise.all([readLegalImage("facsimile", requisites), readLegalImage("stamp", requisites)]);
  return { facsimile, stamp };
}

async function loadSnapshot(contractId: string) {
  const row = await db.clientContract.findUnique({ where: { id: contractId } });
  if (!row) throw new ContractError("contract_not_found", 404, "Договор не найден");
  return { row, snapshot: snapshotFromRow(row) };
}

/** `plain` — без факсимиле и печати, даже если договор выпущен с ними (печать на подпись от руки). */
type SnapshotRenderOptions = { voided?: boolean; blank?: boolean; plain?: boolean };

/** PDF по снимку (черновик, «рыба» или выпущенный договор). */
export async function renderContractSnapshotPdf(snapshot: ContractSnapshot, options: SnapshotRenderOptions = {}): Promise<{ bytes: Buffer; pages: number }> {
  const document = buildContractDocument(snapshot, { blank: options.blank });
  return renderContractPdf({ ...document, voided: options.voided ?? false }, snapshot.seller, await images(snapshot, options.plain));
}

/** DOCX по снимку (черновик или «рыба») — для правок в Word. */
export async function renderContractSnapshotDocx(snapshot: ContractSnapshot, options: SnapshotRenderOptions = {}): Promise<Buffer> {
  const document = buildContractDocument(snapshot, { blank: options.blank });
  return renderContractDocx({ ...document, voided: options.voided ?? false }, snapshot.seller);
}

export const CONTRACT_MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/** `?format=docx` → docx, иначе pdf. */
export function contractFormat(request: Request): "pdf" | "docx" {
  return new URL(request.url).searchParams.get("format") === "docx" ? "docx" : "pdf";
}

export async function renderClientContractPdf(contractId: string, options: { plain?: boolean } = {}): Promise<RenderedContractFile> {
  const { row, snapshot } = await loadSnapshot(contractId);
  const { bytes } = await renderContractSnapshotPdf(snapshot, { voided: row.status === "voided", plain: options.plain });
  const name = contractFileName(row.number, "pdf");
  if (options.plain) {
    return { fileName: name.utf8.replace(/\.pdf$/, " без печати.pdf"), asciiFileName: name.ascii.replace(/\.pdf$/, "-bez-pechati.pdf"), bytes };
  }
  return { fileName: name.utf8, asciiFileName: name.ascii, bytes };
}

export async function renderClientContractDocx(contractId: string): Promise<RenderedContractFile> {
  const { row, snapshot } = await loadSnapshot(contractId);
  const document = buildContractDocument(snapshot);
  const bytes = await renderContractDocx({ ...document, voided: row.status === "voided" }, snapshot.seller);
  const name = contractFileName(row.number, "docx");
  return { fileName: name.utf8, asciiFileName: name.ascii, bytes };
}

/** Content-Disposition с кириллическим именем и ASCII-запасным. */
export function attachmentHeader(file: Pick<RenderedContractFile, "fileName" | "asciiFileName">, inline = false): string {
  return `${inline ? "inline" : "attachment"}; filename="${file.asciiFileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`;
}
