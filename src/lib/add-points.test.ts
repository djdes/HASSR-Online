import assert from "node:assert/strict";
import test from "node:test";

import { ADD_POINTS_HREF, addPointsTarget, isAddPointsRequest, withoutAddPointsParam } from "./add-points";
import { MAX_POINTS } from "./tariff-plans";

test("«Добавить точку» ведёт на тариф с меткой addPoints=1", () => {
  assert.equal(ADD_POINTS_HREF, "/settings/subscription?addPoints=1");
  assert.equal(isAddPointsRequest("1"), true);
  assert.equal(isAddPointsRequest(["1", "0"]), true);
  assert.equal(isAddPointsRequest("0"), false);
  assert.equal(isAddPointsRequest(undefined), false);
  assert.equal(isAddPointsRequest(null), false);
});

test("выбор открывается с точкой больше оплаченного, не меньше точек в работе", () => {
  assert.equal(addPointsTarget({ requested: true, paidPoints: 2, pointsInUse: 2 }), 3);
  assert.equal(addPointsTarget({ requested: true, paidPoints: 1, pointsInUse: 1 }), 2);
  // В работе уже больше оплаченного — счётчик меньше точек в работе не даёт.
  assert.equal(addPointsTarget({ requested: true, paidPoints: 2, pointsInUse: 5 }), 5);
  assert.equal(addPointsTarget({ requested: true, paidPoints: MAX_POINTS, pointsInUse: 1 }), MAX_POINTS);
  // Нет метки, тариф не оплачен или без лимита точек — страница как обычно.
  assert.equal(addPointsTarget({ requested: false, paidPoints: 2, pointsInUse: 2 }), null);
  assert.equal(addPointsTarget({ requested: true, paidPoints: null, pointsInUse: 2 }), null);
});

test("метка убирается из адреса, остальное остаётся", () => {
  assert.equal(withoutAddPointsParam("/settings/subscription?addPoints=1"), "/settings/subscription");
  assert.equal(withoutAddPointsParam("/settings/subscription?promo=ABC&addPoints=1#tariffs"), "/settings/subscription?promo=ABC#tariffs");
  assert.equal(withoutAddPointsParam("/settings/subscription"), "/settings/subscription");
});
