import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_FRAME_ANCESTORS,maxBrowserHandoffUrl } from "./browser";
test("MAX browser launch has explicit trusted frame origins and no wildcard",()=>{
  assert.match(MAX_FRAME_ANCESTORS,/https:\/\/max\.ru/);
  assert.match(MAX_FRAME_ANCESTORS,/https:\/\/web\.max\.ru/);
  assert.equal(MAX_FRAME_ANCESTORS.includes("*"),false);
});
test("MAX embedded fallback uses an origin-bound URL fragment",()=>{
  const ticket="a".repeat(43);
  assert.equal(maxBrowserHandoffUrl("https://wesetup.ru/ignored",ticket),"https://wesetup.ru/max#ticket="+ticket);
  assert.throws(()=>maxBrowserHandoffUrl("http://untrusted.invalid",ticket));
  assert.throws(()=>maxBrowserHandoffUrl("https://wesetup.ru","bad&ticket"));
});
