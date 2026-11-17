import { GET as previewGet } from "@/app/api/journal-samples/[code]/preview/route";

export const runtime = "nodejs";

/**
 * GET /journal-preview/<код>.webp — та же картинка бланка, что
 * `/api/journal-samples/<код>/preview`, но по адресу вне `/api/`: `/api/`
 * закрыт в robots.txt, а картинку должен видеть поиск по картинкам
 * («бланк журнала …»; спека seo-speed-pack-2026-11, п. 10).
 */
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const code = /^([a-z0-9_]+)\.webp$/.exec(file)?.[1];
  if (!code) return new Response("Not found", { status: 404 });
  return previewGet(request, { params: Promise.resolve({ code }) });
}
