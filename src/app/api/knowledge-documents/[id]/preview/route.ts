import { NextResponse } from "next/server";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { requireKnowledgeAccess } from "@/lib/knowledge-documents.server";
import { officeZipWithinLimits } from "@/lib/knowledge-documents";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireKnowledgeAccess();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const file = await db.knowledgeDocument.findFirst({ where: { id, organizationId: auth.organizationId, kind: null, folder: null }, select: { fileName: true, content: true } });
  if (!file) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  const extension = file.fileName.split(".").pop()?.toLowerCase();
  const bytes = new Uint8Array(file.content);
  try {
    if (["docx", "xlsx"].includes(extension ?? "") && !officeZipWithinLimits(bytes)) throw new Error("Превью слишком велико");
    if (extension === "docx") {
      const zip = await JSZip.loadAsync(bytes);
      const xml = await zip.file("word/document.xml")?.async("string");
      if (!xml) throw new Error("Нет текста");
      const text = xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').slice(0, 100000);
      return NextResponse.json({ kind: "text", text }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (extension === "xlsx" || extension === "xls") {
      const book = XLSX.read(bytes, { type: "array", sheetRows: 40, cellFormula: false, cellHTML: false, bookVBA: false });
      const sheets = book.SheetNames.slice(0, 3).map((name) => ({ name, rows: XLSX.utils.sheet_to_json<string[]>(book.Sheets[name], { header: 1, defval: "", raw: false }).slice(0, 40).map((row) => row.slice(0, 20).map((cell) => String(cell).slice(0, 2000))) }));
      return NextResponse.json({ kind: "spreadsheet", sheets }, { headers: { "Cache-Control": "private, no-store" } });
    }
  } catch { return NextResponse.json({ kind: "file", message: "Предпросмотр недоступен. Скачайте документ, чтобы открыть его." }); }
  return NextResponse.json({ kind: "file", message: "Файл сохранён. Для просмотра содержимого скачайте его." });
}
