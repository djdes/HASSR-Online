import assert from "node:assert/strict";
import { test } from "node:test";
import { safeMaxReturnPath, maxToken, hashMaxToken, maxId } from "./security";
import { maxMenuPolicy, canConfirmMaxRequest } from "./policy";

test("MAX ids reject unsafe numbers and preserve string int64", () => {
  assert.equal(maxId("9007199254740993"), "9007199254740993");
  assert.equal(maxId(9007199254740993), null);
  assert.equal(maxId(-123, true), "-123");
  assert.equal(maxId("0"), null);
});
test("MAX return paths allow site screens and reject redirects and API actions", () => {
  for (const path of ["//evil.test", "/\\evil.test", "/%2f%2fevil.test", "/api/auth/logout", "/max", "/max/connect", "/max/journals", "/max/open/hygiene", "/login", "/x\r\nLocation:evil", "https://evil.test", "/journals/../api/foo"]) assert.equal(safeMaxReturnPath(path), "/journals", path);
  assert.equal(safeMaxReturnPath("/journal-fill/org/hygiene?token=qr"), "/journal-fill/org/hygiene?token=qr");
});
test("MAX linking tokens are high entropy and hashes do not store bearer credentials", () => {
  const a=maxToken(); const b=maxToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(a,b);
  assert.equal(hashMaxToken(a).length,64); assert.notEqual(hashMaxToken(a),a);
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
