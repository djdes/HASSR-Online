import { db } from "@/lib/db";
import { buildColdEquipmentConfigFromEquipment } from "@/lib/cold-equipment-document";
import { mintEquipmentQrToken } from "@/lib/equipment-qr-token";
import { journalShortSig } from "@/lib/qr-fill-token";
import { setEmployeeQrPin } from "@/lib/qr-fill-actor";
import { writeFileSync } from "node:fs";
async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { name: { contains: "Гавань" } }, select: { id: true } });
  const equipment = await db.equipment.findMany({ where: { area: { organizationId: org.id } }, select: { id: true, name: true, type: true, tempMin: true, tempMax: true } });
  const fridges = equipment.filter((e) => e.type === "refrigerator" || e.type === "freezer" || e.tempMin != null || e.tempMax != null);
  const fridge = fridges.find((e) => e.tempMin != null && e.tempMax != null && e.tempMin >= 0) ?? fridges[0];
  if (fridge.tempMin == null || fridge.tempMax == null) await db.equipment.update({ where: { id: fridge.id }, data: { tempMin: 2, tempMax: 6 } });
  const doc = await db.journalDocument.findFirstOrThrow({ where: { organizationId: org.id, template: { code: "cold_equipment_control" } }, select: { id: true } });
  const config = buildColdEquipmentConfigFromEquipment(fridges);
  await db.journalDocument.update({ where: { id: doc.id }, data: { config } });
  const cook = await db.user.findFirstOrThrow({ where: { organizationId: org.id, role: { notIn: ["owner", "manager", "head_chef", "technologist"] }, isActive: true }, select: { id: true, name: true } });
  const err = await setEmployeeQrPin(cook.id, "2580");
  const admin = await db.user.findFirstOrThrow({ where: { email: "admin@haccp.local" }, select: { id: true } });
  const out = {
    orgId: org.id,
    fridge: { id: fridge.id, name: fridge.name, min: fridge.tempMin ?? 2, max: fridge.tempMax ?? 6 },
    fridgeUrl: `/equipment-fill/${fridge.id}?token=${encodeURIComponent(mintEquipmentQrToken(fridge.id))}`,
    coldDocId: doc.id,
    hygieneUrl: `/qj/${org.id}/hygiene/${journalShortSig(org.id, "hygiene")}`,
    finishedUrl: `/qj/${org.id}/finished_product/${journalShortSig(org.id, "finished_product")}`,
    cook: { ...cook, pinError: err },
    adminId: admin.id,
    fridgeCount: fridges.length,
  };
  writeFileSync(".e2e-tmp/setup.json", JSON.stringify(out, null, 2));
  console.log(out);
}
main().then(() => process.exit(0));
