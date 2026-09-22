import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toMiniUrl } from "@/lib/notifications";

describe("toMiniUrl", () => {
  it("ссылки дашборда переводятся в кабинет", () => {
    // Уведомления заводятся с адресами дашборда, а push открывается в
    // установленном приложении — там этих страниц нет.
    assert.equal(toMiniUrl("/journals/hygiene"), "/mini/journals/hygiene");
  });

  it("адреса кабинета остаются как есть", () => {
    assert.equal(toMiniUrl("/mini/today"), "/mini/today");
  });

  it("незнакомый раздел ведёт на главную, а не в пустоту", () => {
    assert.equal(toMiniUrl("/capa"), "/mini");
  });

  it("запросы PIN сотрудников открывают раздел сотрудников", () => {
    assert.equal(toMiniUrl("/settings/users?pinRequests=1#pin-requests"), "/mini/staff");
  });

  it("пустое и отсутствующее — на главную", () => {
    assert.equal(toMiniUrl(null), "/mini");
    assert.equal(toMiniUrl(undefined), "/mini");
    assert.equal(toMiniUrl(""), "/mini");
  });

  it("внешний адрес наружу не уводит", () => {
    // Нажатие на уведомление не должно открывать чужой сайт.
    assert.equal(toMiniUrl("https://example.com/phish"), "/mini");
    assert.equal(toMiniUrl("//example.com"), "/mini");
    assert.equal(toMiniUrl("javascript:alert(1)"), "/mini");
  });
});
