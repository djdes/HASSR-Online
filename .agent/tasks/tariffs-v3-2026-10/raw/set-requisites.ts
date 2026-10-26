// Локальная проверка счёта: реквизиты исполнителя (как в тестовом фикстуре) и ИНН «Кафе Стандарт».
import { writePlatformRequisites } from "@/lib/closing-documents/requisites";
import { EMPTY_REQUISITES } from "@/lib/closing-documents/types";
import { db } from "@/lib/db";

async function main() {
  const { updatedAt: _u, ...base } = EMPTY_REQUISITES as typeof EMPTY_REQUISITES & { updatedAt?: string };
  void _u;
  await writePlatformRequisites({
    ...base,
    nameFull: "Общество с ограниченной ответственностью «БФС»",
    inn: "5018215599",
    ogrn: "1235000105306",
    address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6",
    bank: { name: "АО «Банк»", bik: "044525225", account: "40702810000000000001", corrAccount: "30101810400000000225" },
    head: { post: "Генеральный директор", name: "Иванов И. И." },
  });
  const updated = await db.organization.updateMany({ where: { name: "Кафе Стандарт" }, data: { inn: "7712345678" } });
  console.log("requisites written; org inn rows:", updated.count);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
