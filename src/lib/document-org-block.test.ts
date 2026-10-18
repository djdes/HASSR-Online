import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCUMENT_ORG_ROW_ORDER,
  buildDocumentOrgBlock,
  currentLegalProfile,
  documentOrgRequisitesLine,
  documentOrgRows,
  effectiveKpp,
  journalHeaderOrgText,
  registryDefaults,
  toOrderOrgSnapshot,
  type DocumentOrgSource,
} from "@/lib/document-org-block";
import { buildOrgSnapshot } from "@/lib/orders/org-snapshot";

/** Снимок ЕГРЮЛ в форме `legalProfileJson` (лишние поля профиля опущены). */
const PROFILE = {
  inn: "7701234567",
  type: "LEGAL",
  nameShort: "ООО «Ромашка»",
  nameFull: "Общество с ограниченной ответственностью «Ромашка»",
  kpp: "770101001",
  ogrn: "1027700132195",
  address: "109012, г Москва, ул Ильинка, д 4",
  management: { name: "Петров Пётр Петрович", post: "Генеральный директор" },
};

const ORG: DocumentOrgSource = {
  name: "Кафе «Ромашка»",
  journalShortName: null,
  legalProfileJson: PROFILE,
  inn: "7701234567",
  address: "г. Москва, ул. Пищевая, д. 12",
  phone: "+7 495 000-00-00",
};

const POINT = { name: "Точка 2", address: "ул. Ленина, 5", journalName: null, kpp: "770102002", phone: "+7 900 111-22-33" };

test("блок без правок: реквизиты из снимка ЕГРЮЛ, фактический адрес — из «Реквизитов»", () => {
  const block = buildDocumentOrgBlock({ org: ORG });
  assert.equal(block.org.fullName, PROFILE.nameFull);
  assert.equal(block.org.shortName, PROFILE.nameShort);
  assert.equal(block.org.journalName, PROFILE.nameShort);
  assert.equal(block.org.inn, "7701234567");
  assert.equal(block.org.kpp, "770101001");
  assert.equal(block.org.ogrn, "1027700132195");
  assert.equal(block.org.ogrnLabel, "ОГРН");
  assert.equal(block.org.legalAddress, PROFILE.address);
  assert.equal(block.org.address, ORG.address);
  assert.equal(block.org.directorName, "Петров Пётр Петрович");
  assert.equal(block.org.directorPost, "Генеральный директор");
  assert.equal(block.org.city, "Москва");
  assert.equal(block.point, null);
  assert.deepEqual(block.brand, { logoUrl: null, color: null });
});

test("правки поверх снимка: правка побеждает, пустая — снова ЕГРЮЛ, снимок не меняется", () => {
  const snapshotBefore = JSON.stringify(PROFILE);
  const edited = buildDocumentOrgBlock({
    org: {
      ...ORG,
      legalFullName: "  Общество   с ограниченной ответственностью «Ромашка-Сити» ",
      kpp: "770201001",
      ogrn: "1157746000000",
      legalAddress: "123100, г Москва, Пресненская наб, д 12",
      directorName: "Иванова Анна Сергеевна",
      directorPost: "Управляющая",
    },
  });
  assert.equal(edited.org.fullName, "Общество с ограниченной ответственностью «Ромашка-Сити»");
  assert.equal(edited.org.kpp, "770201001");
  assert.equal(edited.org.ogrn, "1157746000000");
  assert.equal(edited.org.legalAddress, "123100, г Москва, Пресненская наб, д 12");
  assert.equal(edited.org.directorName, "Иванова Анна Сергеевна");
  assert.equal(edited.org.directorPost, "Управляющая");
  // Краткое — по-прежнему из ЕГРЮЛ (правки краткого нет: оно у журналов своё).
  assert.equal(edited.org.shortName, PROFILE.nameShort);

  const cleared = buildDocumentOrgBlock({
    org: { ...ORG, legalFullName: "", kpp: "   ", ogrn: null, legalAddress: undefined, directorName: "", directorPost: null },
  });
  assert.equal(cleared.org.fullName, PROFILE.nameFull);
  assert.equal(cleared.org.kpp, PROFILE.kpp);
  assert.equal(cleared.org.directorName, PROFILE.management.name);
  assert.equal(JSON.stringify(PROFILE), snapshotBefore, "снимок ЕГРЮЛ не тронут");

  // Должность из ЕГРЮЛ остаётся, если правили только Ф. И. О.
  const onlyName = buildDocumentOrgBlock({ org: { ...ORG, directorName: "Иванова Анна Сергеевна" } });
  assert.equal(onlyName.org.directorPost, "Генеральный директор");
});

test("снимок другого ИНН не подмешивается: КПП и ОГРН чужого юрлица не печатаются", () => {
  const org = { ...ORG, inn: "500100732259" };
  assert.equal(currentLegalProfile(org), null);
  const block = buildDocumentOrgBlock({ org });
  assert.equal(block.org.inn, "500100732259");
  assert.equal(block.org.kpp, null);
  assert.equal(block.org.ogrn, null);
  assert.equal(block.org.fullName, "Кафе «Ромашка»");
  assert.equal(block.org.legalAddress, ORG.address);
  assert.deepEqual(registryDefaults(org), {
    legalFullName: null,
    kpp: null,
    ogrn: null,
    legalAddress: null,
    directorName: null,
    directorPost: null,
  });
  // Правки при этом действуют.
  assert.equal(buildDocumentOrgBlock({ org: { ...org, kpp: "500101001" } }).org.kpp, "500101001");
});

test("без снимка и правок — название из «Реквизитов», техническое название с почтой не печатается", () => {
  const block = buildDocumentOrgBlock({ org: { name: "ИП Сидоров", inn: null, address: null, legalProfileJson: null } });
  assert.equal(block.org.fullName, "ИП Сидоров");
  assert.equal(block.org.shortName, "ИП Сидоров");
  assert.equal(block.org.kpp, null);
  assert.equal(block.org.legalAddress, null);
  const placeholder = buildDocumentOrgBlock({ org: { name: "Организация ivan@mail.ru" } });
  assert.ok(!placeholder.org.fullName.includes("@"));
});

test("ОГРНИП у ИП: 15 цифр — подпись «ОГРНИП», строки КПП нет", () => {
  const block = buildDocumentOrgBlock({
    org: { name: "ИП Сидоров С. С.", inn: "500100732259", ogrn: "321774600000012" },
  });
  assert.equal(block.org.ogrnLabel, "ОГРНИП");
  const rows = documentOrgRows(block);
  assert.deepEqual(
    rows.map((row) => row.label),
    ["Полное наименование", "ИНН", "ОГРНИП"],
  );
});

test("порядок строк блока фиксирован: организация, затем точка", () => {
  assert.deepEqual([...DOCUMENT_ORG_ROW_ORDER], [
    "fullName",
    "shortName",
    "inn",
    "kpp",
    "ogrn",
    "legalAddress",
    "address",
    "director",
    "phone",
    "pointName",
    "pointAddress",
    "pointKpp",
    "pointPhone",
  ]);
  const rows = documentOrgRows(buildDocumentOrgBlock({ org: ORG, point: POINT }));
  assert.deepEqual(
    rows.map((row) => [row.key, row.label, row.value]),
    [
      ["fullName", "Полное наименование", PROFILE.nameFull],
      ["shortName", "Сокращённое наименование", PROFILE.nameShort],
      ["inn", "ИНН", "7701234567"],
      ["kpp", "КПП", "770101001"],
      ["ogrn", "ОГРН", "1027700132195"],
      ["legalAddress", "Юридический адрес", PROFILE.address],
      ["address", "Фактический адрес", ORG.address],
      ["director", "Генеральный директор", "Петров Пётр Петрович"],
      ["phone", "Телефон", "+7 495 000-00-00"],
      ["pointName", "Торговая точка", "Точка 2, ул. Ленина, 5"],
      ["pointKpp", "КПП точки", "770102002"],
      ["pointPhone", "Телефон точки", "+7 900 111-22-33"],
    ],
  );
  // Строки точки помечены — карточка «О торговой точке».
  assert.deepEqual(rows.filter((row) => row.point).map((row) => row.key), ["pointName", "pointKpp", "pointPhone"]);
  // Адрес точки отдельной строкой — когда подпись точки его не содержит.
  const named = documentOrgRows(buildDocumentOrgBlock({ org: ORG, point: { ...POINT, journalName: "Кафе «Ромашка» на Ленина" } }));
  assert.deepEqual(
    named.filter((row) => row.point).map((row) => [row.key, row.value]),
    [
      ["pointName", "Кафе «Ромашка» на Ленина"],
      ["pointAddress", "ул. Ленина, 5"],
      ["pointKpp", "770102002"],
      ["pointPhone", "+7 900 111-22-33"],
    ],
  );
});

test("шапка журнала: название · точка · ИНН · КПП точки · адрес · телефон точки", () => {
  const withPoint = buildDocumentOrgBlock({ org: ORG, point: POINT });
  assert.equal(effectiveKpp(withPoint), "770102002");
  assert.equal(
    journalHeaderOrgText(withPoint),
    "ООО «Ромашка» · Точка 2, ул. Ленина, 5 · ИНН 7701234567 · КПП 770102002 · г. Москва, ул. Пищевая, д. 12 · тел. +7 900 111-22-33",
  );
  // Без точки — КПП организации, телефона точки нет.
  assert.equal(
    journalHeaderOrgText(buildDocumentOrgBlock({ org: ORG })),
    "ООО «Ромашка» · ИНН 7701234567 · КПП 770101001 · г. Москва, ул. Пищевая, д. 12",
  );
  // Без снимка и КПП — прежний вид «название · ИНН · адрес».
  assert.equal(
    journalHeaderOrgText(buildDocumentOrgBlock({ org: { name: "ООО «Ромашка»", inn: "7701234567", address: "г. Москва, ул. Пищевая, д. 12" } })),
    "ООО «Ромашка» · ИНН 7701234567 · г. Москва, ул. Пищевая, д. 12",
  );
  // Своё название документа в шапке.
  const own = buildDocumentOrgBlock({ org: ORG, documentConfig: { headerOrgName: "Кафе, цех 2" } });
  assert.ok(journalHeaderOrgText(own).startsWith("Кафе, цех 2 · ИНН"));
});

test("строка реквизитов документа и снимок приказа собираются из блока", () => {
  const block = buildDocumentOrgBlock({ org: { ...ORG, kpp: "770201001" } });
  assert.equal(
    documentOrgRequisitesLine(block),
    `ИНН 7701234567 · КПП 770201001 · ОГРН 1027700132195 · ${PROFILE.address}`,
  );
  assert.equal(documentOrgRequisitesLine(block, { address: "actual" }).endsWith(ORG.address!), true);
  assert.deepEqual(toOrderOrgSnapshot(block), {
    orgName: PROFILE.nameFull,
    orgShortName: PROFILE.nameShort,
    orgInn: "7701234567",
    orgKpp: "770201001",
    orgOgrn: "1027700132195",
    orgAddress: PROFILE.address,
    directorName: "Петров Пётр Петрович",
    directorPost: "Генеральный директор",
    city: "Москва",
  });
  // buildOrgSnapshot приказов — тот же блок, правки учитываются.
  assert.deepEqual(buildOrgSnapshot({ ...ORG, name: ORG.name!, inn: ORG.inn!, address: ORG.address!, legalProfileJson: PROFILE, kpp: "770201001" }), toOrderOrgSnapshot(block));
});

test("брендинг блока: логотип как есть, цвет нормализован", () => {
  const block = buildDocumentOrgBlock({ org: { ...ORG, logoUrl: "/api/org-assets/org1/logo?v=2", brandColor: "#AABBCCDD" } });
  assert.deepEqual(block.brand, { logoUrl: "/api/org-assets/org1/logo?v=2", color: "#aabbcc" });
  assert.equal(buildDocumentOrgBlock({ org: { ...ORG, brandColor: "красный" } }).brand.color, null);
});
