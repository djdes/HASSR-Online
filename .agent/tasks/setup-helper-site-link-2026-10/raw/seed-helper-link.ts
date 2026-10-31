import { db } from "@/lib/db";

// Local fixtures for the helper ↔ site link: products with shelf life and a dish list
// in the active brakerage document, so /api/setup-helper/catalog has real content.
async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { name: "Тестовая организация HACCP Demo" } });
  const products = [
    { name: "Молоко 3,2%", shelfLifeDays: 5, storageTemp: "+2…+6 °C", supplier: "ООО «Молочный двор»" },
    { name: "Сметана 20%", shelfLifeDays: 7, storageTemp: "+2…+6 °C", supplier: "ООО «Молочный двор»" },
    { name: "Филе куриное охлаждённое", shelfLifeDays: 3, storageTemp: "0…+4 °C", supplier: "ИП Петров" },
    { name: "Котлеты куриные (п/ф)", shelfLifeDays: 1, storageTemp: "+2…+6 °C", supplier: null },
    { name: "Фарш говяжий", shelfLifeDays: 90, storageTemp: "−18 °C и ниже", supplier: "ИП Петров" },
  ];
  await db.product.deleteMany({ where: { organizationId: org.id, name: { in: products.map((p) => p.name) } } });
  for (const p of products) await db.product.create({ data: { ...p, organizationId: org.id, unit: "kg" } });
  const doc = await db.journalDocument.findFirst({
    where: { organizationId: org.id, template: { code: "finished_product" }, status: "active", dateFrom: { lte: new Date() }, dateTo: { gte: new Date() } },
    select: { id: true, config: true },
  });
  if (doc) {
    const config = (doc.config ?? {}) as Record<string, unknown>;
    await db.journalDocument.update({
      where: { id: doc.id },
      data: {
        config: {
          ...config,
          itemsCatalog: ["Каша молочная овсяная с маслом", "Суп гороховый с гренками", "Котлета куриная, пюре картофельное"],
          productLists: [{ id: "list-1", name: "Изделия", items: ["Компот из сухофруктов", "Какао с молоком"] }],
        } as never,
      },
    });
  }
  console.log(JSON.stringify({ org: org.id, products: products.length, brakerageDoc: doc?.id ?? null }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
