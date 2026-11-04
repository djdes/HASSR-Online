import { cardVcard } from "@/lib/promo/card-offer";

export const runtime = "nodejs";

/** «Сохранить контакт» со страницы акции по визитке — vCard сетап. */
export function GET() {
  return new Response(cardVcard(), {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'attachment; filename="wesetup.vcf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
