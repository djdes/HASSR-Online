/*
 * Local stand for brand-everywhere-2026-11-21 (NOT for production).
 * Owner «Анна» of «Доброе кафе» (no logo, no colours yet — the browser test uploads the logo),
 * a fridge in an area with a signed QR sticker token. Prints JSON.
 * Run: npx tsx .agent/tasks/brand-everywhere-2026-11-21/raw/seed-stand.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { attachAccountForNewOrganization, createOrganization } from "@/lib/create-organization";
import { mintEquipmentQrToken } from "@/lib/equipment-qr-token";
import { LEGAL_VERSION } from "@/lib/legal-consent";

async function main() {
  const { organizationId } = await createOrganization({ name: "Доброе кафе", sphere: "restaurant", accountId: null, ownerUserId: null });
  await db.organization.update({ where: { id: organizationId }, data: { inn: "7701234567", journalShortName: "ООО «Доброе кафе»" } });
  const owner = await db.user.create({
    data: {
      email: "brand-owner@local.test",
      name: "Анна Владелец",
      phone: "+79990000001",
      role: "owner",
      isActive: true,
      passwordHash: await bcrypt.hash("OwnerPass123!", 10),
      organizationId,
      legalVersion: LEGAL_VERSION,
      showWhatsNew: false,
    },
    select: { id: true },
  });
  await db.$transaction((tx) => attachAccountForNewOrganization(tx, { ownerUserId: owner.id, organizationId, subscriptionPlan: "standard", subscriptionEnd: new Date(Date.now() + 90 * 86_400_000) }));
  const area = await db.area.create({ data: { organizationId, name: "Горячий цех" }, select: { id: true } });
  const fridge = await db.equipment.create({
    data: { areaId: area.id, name: "Холодильник №1", type: "fridge", tempMin: 2, tempMax: 6 },
    select: { id: true },
  });
  console.log(JSON.stringify({ email: "brand-owner@local.test", password: "OwnerPass123!", organizationId, ownerId: owner.id, equipmentId: fridge.id, token: mintEquipmentQrToken(fridge.id) }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
