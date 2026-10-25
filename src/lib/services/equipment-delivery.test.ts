import assert from "node:assert/strict";
import test from "node:test";

import { HARDWARE_BUNDLES, bundleTotal, normalizeHardwareConfig } from "@/lib/hardware-pricing";
import {
  EQUIPMENT_DELIVERY_SERVICE_KEY,
  equipmentDeliveryComment,
  equipmentDeliveryService,
} from "./equipment-delivery";

test("delivery request is priced by the hardware price list, never by the client", () => {
  const kitchen = HARDWARE_BUNDLES.find((bundle) => bundle.id === "standard")!;
  const service = equipmentDeliveryService(kitchen.composition);
  assert.equal(service.key, EQUIPMENT_DELIVERY_SERVICE_KEY);
  assert.equal(service.priceRub, bundleTotal(kitchen));
  // «от»: доставку и монтаж согласует менеджер — баллами сразу не списывается.
  assert.equal(service.priceFrom, true);
  // Чужие позиции и отрицательные количества сервер выбрасывает.
  assert.deepEqual(normalizeHardwareConfig({ temp: 2, bogus: 5, nfc: -1 }), { temp: 2 });
});

test("delivery comment lists the address, the set and the total for the admin", () => {
  const comment = equipmentDeliveryComment({
    config: { temp: 2, tablet: 1 },
    address: "Москва, ул. Тестовая, 1",
    comment: "Позвонить заранее",
  });
  assert.match(comment, /^Адрес доставки: Москва, ул\. Тестовая, 1/);
  assert.match(comment, /Датчик температуры × 2/);
  assert.match(comment, /Планшет для кухни × 1/);
  assert.match(comment, /Итого по прайсу: 19\s880 ₽/);
  assert.match(comment, /Комментарий: Позвонить заранее$/);
  assert.doesNotMatch(equipmentDeliveryComment({ config: { temp: 1 }, address: null, comment: null }), /Адрес|Комментарий/);
});
