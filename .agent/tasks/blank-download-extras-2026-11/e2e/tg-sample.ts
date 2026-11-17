import { buildBlankDownloadAdminText } from "@/lib/blank-download";
import { normalizeBlankExtras } from "@/lib/blank-download-extras";
import { clientLocationLine, lookupIpGeo } from "@/lib/ip-geo";
async function main() {
const geo = await lookupIpGeo(process.argv[2] ?? "95.31.18.119");
console.log("geo:", JSON.stringify(geo));
console.log(buildBlankDownloadAdminText({
  title: "Гигиенический журнал (сотрудники)", format: "docx", email: "client@example.com", phone: "+79990000000",
  location: clientLocationLine({ geo, timeZone: "Europe/Moscow" }),
  extras: normalizeBlankExtras({ responsible: { name: "Иванова" }, employees: [{ name: "А" }, { name: "Б" }, { name: "В" }] }, "hygiene"),
  accountCreated: true, escape: (v) => v,
}));
}
void main();
