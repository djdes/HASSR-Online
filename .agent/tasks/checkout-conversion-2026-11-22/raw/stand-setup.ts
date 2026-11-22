import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { writePlatformRequisites } from "@/lib/closing-documents/requisites";
import { EMPTY_REQUISITES } from "@/lib/closing-documents/types";

async function main() {
  await writePlatformRequisites({
    ...EMPTY_REQUISITES,
    nameFull: "ООО «Тест Сетап»",
    nameShort: "ООО «Тест Сетап»",
    inn: "7707083893",
    kpp: "770701001",
    ogrn: "1027700132195",
    address: "г. Москва, ул. Тестовая, д. 1",
    bank: { name: "ПАО Сбербанк", bik: "044525225", account: "40702810938000000001", corrAccount: "30101810400000000225" },
    head: { post: "Генеральный директор", name: "Иванов Иван Иванович" },
  } as never);
  const passwordHash = await bcrypt.hash("Test12345!", 10);
  const org = await db.organization.upsert({
    where: { id: "stand-org-noinn" },
    update: { inn: null, legalProfileJson: undefined },
    create: { id: "stand-org-noinn", name: "Кафе «Тест»", type: "restaurant" },
  });
  await db.user.upsert({
    where: { email: "manager@stand.test" },
    update: { organizationId: org.id, role: "owner", isActive: true, passwordHash },
    create: { email: "manager@stand.test", name: "Мария Тестова", phone: "+79991234567", passwordHash, role: "owner", organizationId: org.id, isActive: true },
  });
  console.log("ok", org.id);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
