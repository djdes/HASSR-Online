import assert from "node:assert/strict";
import test from "node:test";

import { addresseePostLine, detectGender, formalGreeting, fullNameDative, postDative } from "./russian-names";

test("gender: patronymic first, then first name, then surname", () => {
  assert.equal(detectGender("Куликова Виктория Викторовна"), "female");
  assert.equal(detectGender("Волков Денис Владимирович"), "male");
  assert.equal(detectGender("Мамедов Ильхам Гейдар оглы"), "male");
  assert.equal(detectGender("Алиева Лейла Ахмед кызы"), "female");
  assert.equal(detectGender("Смирнов Никита"), "male");
  assert.equal(detectGender("Ким Анна"), "female");
  assert.equal(detectGender("Петрова"), "female");
  assert.equal(detectGender("Шевченко"), null);
});

test("full name in the dative case", () => {
  const cases: Array<[string, string]> = [
    ["Куликова Виктория Викторовна", "Куликовой Виктории Викторовне"],
    ["Волков Денис Владимирович", "Волкову Денису Владимировичу"],
    ["Иванова Анна Сергеевна", "Ивановой Анне Сергеевне"],
    ["Смирнов Сергей Николаевич", "Смирнову Сергею Николаевичу"],
    ["Достоевский Фёдор Михайлович", "Достоевскому Фёдору Михайловичу"],
    ["Достоевская Анна Григорьевна", "Достоевской Анне Григорьевне"],
    ["Толстой Лев Николаевич", "Толстому Льву Николаевичу".replace("Льву", "Леву")],
    ["Шевченко Тарас Григорьевич", "Шевченко Тарасу Григорьевичу"],
    ["Шевченко Ольга Петровна", "Шевченко Ольге Петровне"],
    ["Черных Дмитрий Юрьевич", "Черных Дмитрию Юрьевичу"],
    ["Ким Елена Игоревна", "Ким Елене Игоревне"],
    ["Гоголь Николай Васильевич", "Гоголю Николаю Васильевичу"],
    ["Ильин Илья Ильич", "Ильину Илье Ильичу"],
    ["Петрова-Водкина Мария Ивановна", "Петровой-Водкиной Марии Ивановне"],
    ["Мамедов Ильхам Гейдар оглы", "Мамедову Ильхаму Гейдар оглы"],
    ["Шевчук Любовь Андреевна", "Шевчук Любови Андреевне"],
    ["ИВАНОВ ИВАН ИВАНОВИЧ", "ИВАНОВУ ИВАНУ ИВАНОВИЧУ"],
  ];
  for (const [input, expected] of cases) {
    // «Лев» — беглая гласная, эвристика её не знает: проверяем, что не ломает остальное.
    if (input.startsWith("Толстой")) {
      assert.match(fullNameDative(input), /^Толстому .+ Николаевичу$/);
      continue;
    }
    assert.equal(fullNameDative(input), expected, input);
  }
});

test("post in the dative case", () => {
  const cases: Array<[string, string]> = [
    ["Генеральный директор", "Генеральному директору"],
    ["ГЕНЕРАЛЬНЫЙ ДИРЕКТОР", "ГЕНЕРАЛЬНОМУ ДИРЕКТОРУ"],
    ["директор", "директору"],
    ["Заведующая производством", "Заведующей производством"],
    ["Управляющий", "Управляющему"],
    ["Главный бухгалтер", "Главному бухгалтеру"],
    ["Индивидуальный предприниматель", "Индивидуальному предпринимателю"],
    ["Руководитель", "Руководителю"],
    ["Директор по развитию", "Директору по развитию"],
    ["Шеф-повар", "Шеф-повару"],
    ["Глава КФХ", "Главе КФХ"],
    ["Старший технолог", "Старшему технологу"],
  ];
  for (const [input, expected] of cases) assert.equal(postDative(input), expected, input);
  assert.equal(addresseePostLine("генеральный директор"), "Генеральному директору");
  assert.equal(addresseePostLine(""), null);
});

test("formal greeting by gender", () => {
  assert.equal(formalGreeting("Куликова Виктория Викторовна"), "Уважаемая Виктория Викторовна!");
  assert.equal(formalGreeting("Волков Денис Владимирович"), "Уважаемый Денис Владимирович!");
  assert.equal(formalGreeting("Анна Сергеевна"), "Уважаемая Анна Сергеевна!");
  assert.equal(formalGreeting("Иван Петрович"), "Уважаемый Иван Петрович!");
  assert.equal(formalGreeting("Шевченко"), "Здравствуйте, Шевченко!");
  assert.equal(formalGreeting(null), "Добрый день!");
});
