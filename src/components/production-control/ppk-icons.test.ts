import test from "node:test";
import assert from "node:assert/strict";
import { PPK_BLOCKS } from "@/lib/ppk/registry";
import { PPK_ICONS } from "./ppk-icons";

test("у каждого блока ППК есть иконка в карте", () => {
  for (const block of PPK_BLOCKS) {
    assert.ok(PPK_ICONS[block.icon], `нет иконки ${block.icon} для блока ${block.key}`);
  }
});
