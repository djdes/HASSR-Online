import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { verifyMaxInitData, safeMaxReturnPath, maxToken, hashMaxToken, maxId } from "./security";
import { maxMenuPolicy, visibleMaxJournals, canConfirmMaxRequest } from "./policy";

const now = 1_790_000_000;
function signed(extra: Record<string, string> = {}, token = "test-bot-secret") {
  const p = new URLSearchParams({ auth_date: String(now), user: JSON.stringify({ id: 42, first_name: "Анна" }), ...extra });
  const data = [...p.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${k}=${v}`).join("\n");
  p.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update(token).digest()).update(data).digest("hex"));
  return p.toString();
}
test("MAX accepts signed launch data and preserves Unicode", () => {
  assert.deepEqual(verifyMaxInitData(signed(), "test-bot-secret", now), { ok: true, userId: "42" });
});
test("MAX rejects tampered, duplicated, stale and future launch parameters", () => {
  for (const input of [signed().replace("42", "43"), signed()+"&auth_date="+now, signed({auth_date:String(now-301)}), signed({auth_date:String(now+31)}), signed({auth_date:"NaN"}), signed({user:'{"id":-1}'}), signed({user:'{"id":9007199254740993}'})]) {
    assert.equal(verifyMaxInitData(input, "test-bot-secret", now).ok, false);
  }
  assert.equal(verifyMaxInitData(signed(), "wrong", now).ok, false);
  assert.equal(verifyMaxInitData(signed(), "", now).ok, false);
});
test("MAX ids reject unsafe numbers and preserve string int64", () => {
  assert.equal(maxId("9007199254740993"), "9007199254740993");
  assert.equal(maxId(9007199254740993), null);
  assert.equal(maxId(-123, true), "-123");
  assert.equal(maxId("0"), null);
});
test("MAX return paths allow site screens and reject redirects and API actions", () => {
  for (const path of ["//evil.test", "/\\evil.test", "/%2f%2fevil.test", "/api/auth/logout", "/max", "/max/connect", "/login", "/x\r\nLocation:evil", "https://evil.test", "/journals/../api/foo"]) assert.equal(safeMaxReturnPath(path), "/journals", path);
  assert.equal(safeMaxReturnPath("/journal-fill/org/hygiene?token=qr"), "/journal-fill/org/hygiene?token=qr");
});
test("MAX linking tokens are high entropy and hashes do not store bearer credentials", () => {
  const a=maxToken(); const b=maxToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(a,b);
  assert.equal(hashMaxToken(a).length,64); assert.notEqual(hashMaxToken(a),a);
});
test("MAX employees see ACL journals; disabled and inactive journals stay hidden", () => {
  const journals=[{code:"hygiene",name:"Гигиена"},{code:"cleaning",name:"Уборка"}];
  assert.deepEqual(visibleMaxJournals(journals,["hygiene"],new Set()),[journals[0]]);
  assert.deepEqual(visibleMaxJournals(journals,null,new Set(["cleaning"])),[journals[0]]);
  assert.deepEqual(visibleMaxJournals(journals,[],new Set()),[]);
});
test("MAX policy never grants ROOT through management role and respects settings flag", () => {
  assert.equal(maxMenuPolicy({role:"cook",isRoot:false,canManageSettings:false,permissionPreset:"cook"}).settings,false);
  assert.equal(maxMenuPolicy({role:"manager",isRoot:false,canManageSettings:false}).root,false);
  assert.equal(maxMenuPolicy({role:"cook",isRoot:false,canManageSettings:true}).settings,true);
  assert.equal(maxMenuPolicy({role:"cook",isRoot:true}).root,true);
});
test("MAX menu honors organization capability overrides",()=>{
  assert.equal(maxMenuPolicy({role:"head_chef",orgPresetOverrides:{head_chef:[]}}).verify,false);
});
test("MAX confirmation rejects expiry, another owner and already consumed requests", () => {
  const req={userId:"u1",expiresAt:new Date(2000),usedAt:null,claimedMaxUserId:"42"};
  assert.equal(canConfirmMaxRequest(req,"u1",new Date(1000)),true);
  assert.equal(canConfirmMaxRequest(req,"u2",new Date(1000)),false);
  assert.equal(canConfirmMaxRequest(req,"u1",new Date(2000)),false);
  assert.equal(canConfirmMaxRequest({...req,usedAt:new Date(500)},"u1",new Date(1000)),false);
  assert.equal(canConfirmMaxRequest({...req,claimedMaxUserId:null},"u1",new Date(1000)),false);
});
