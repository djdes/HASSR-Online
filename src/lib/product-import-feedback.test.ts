import assert from "node:assert/strict";
import test from "node:test";
import { getProductImportFeedback } from "./product-import-feedback";

test("actionable diagnostics retain their semantic reason and only approved values", () => {
  assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_UNAUTHORIZED", error: "private" }), { key: "errors.unauthorized" });
  assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_MANAGEMENT_REQUIRED" }), { key: "errors.managementRequired" });
  assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_FILE_REQUIRED" }), { key: "errors.fileRequired" });
  assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_EMPTY" }), { key: "errors.empty" });
  assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_NAME_COLUMN_REQUIRED" }), { key: "errors.nameColumnRequired" });
  assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_NO_PRODUCTS" }), { key: "errors.noProducts" });
  assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_FAILED" }), { key: "errors.failed" });
  assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_TOO_LARGE", params: { limitMB: 10, private: "discard" } }), { key: "errors.tooLarge", values: { limitMB: 10 } });
  assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_TOO_MANY_ROWS", params: { count: 20001, limit: 20000 } }), { key: "errors.tooManyRows", values: { count: 20001, limit: 20000 } });
});

test("arbitrary text, prototype keys and malformed codes cannot become messages", () => {
  for (const body of [null, undefined, false, [], "private error", {error:"Не авторизован"}, Object.create({errorCode:"PRODUCT_IMPORT_FAILED"}), ...["__proto__", "constructor", "toString", "unknown", {}, 5, null].map(errorCode => ({errorCode, error:"private"}))]) {
    assert.deepEqual(getProductImportFeedback(body), { key: "errors.generic" });
  }
});

test("numeric guidance requires own finite safe number fields without coercion", () => {
  for (const bad of [undefined, null, "10", NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, {}, true]) {
    assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_TOO_LARGE", params: {limitMB:bad} }), { key: "errors.generic" });
    assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_TOO_MANY_ROWS", params: {count:bad,limit:20000} }), { key: "errors.generic" });
    assert.deepEqual(getProductImportFeedback({ errorCode: "PRODUCT_IMPORT_TOO_MANY_ROWS", params: {count:20001,limit:bad} }), { key: "errors.generic" });
  }
  for (const params of [undefined, null, [], {}, Object.create({limitMB:10,count:20001,limit:20000})]) {
    for (const errorCode of ["PRODUCT_IMPORT_TOO_LARGE", "PRODUCT_IMPORT_TOO_MANY_ROWS"]) assert.deepEqual(getProductImportFeedback({errorCode,params}), {key:"errors.generic"});
  }
  assert.deepEqual(getProductImportFeedback({errorCode:"PRODUCT_IMPORT_TOO_LARGE",params:{limitMB:0}}),{key:"errors.generic"});
  assert.deepEqual(getProductImportFeedback({errorCode:"PRODUCT_IMPORT_TOO_MANY_ROWS",params:{count:1,limit:0}}),{key:"errors.generic"});
  assert.deepEqual(getProductImportFeedback({errorCode:"PRODUCT_IMPORT_TOO_MANY_ROWS",params:{count:0,limit:Number.MAX_SAFE_INTEGER}}),{key:"errors.tooManyRows",values:{count:0,limit:Number.MAX_SAFE_INTEGER}});
});
