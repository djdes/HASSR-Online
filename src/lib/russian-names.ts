/**
 * Склонение ФИО и должностей в дательный падеж и приветствие — для шапки
 * документов «Генеральному директору … Куликовой Виктории Викторовне» и
 * «Уважаемая Виктория Викторовна!».
 *
 * Это эвристика по окончаниям, а не словарь: она верна для типичных
 * русских фамилий, имён и отчеств, а редкое оставляет как есть (лучше
 * несклонённое, чем исковерканное). Поэтому в формах строки только
 * предзаполняются — человек может их поправить.
 *
 * Порядок слов ФИО — как в ЕГРЮЛ: «Фамилия Имя Отчество».
 */

export type Gender = "male" | "female" | null;

/** Мужские имена на -а/-я: склоняются как женские, но род мужской. */
const MALE_NAMES_ON_A = new Set([
  "никита",
  "илья",
  "кузьма",
  "фома",
  "лука",
  "савва",
  "данила",
  "гаврила",
  "фока",
  "ваня",
  "саша",
  "миша",
  "дима",
  "женя",
  "паша",
  "коля",
  "вова",
  "лёва",
  "лева",
  "юра",
  "серёжа",
  "сережа",
]);

/** Женские имена на согласный/мягкий знак (не склоняются или склоняются на -и). */
const FEMALE_NAMES_CONSONANT = new Set(["любовь", "нинель", "эсфирь", "юдифь", "агарь", "руфь", "рахиль", "суламифь", "адель", "ассоль"]);

const lower = (value: string) => value.toLocaleLowerCase("ru-RU");

/** Сохраняет регистр исходного слова (капслок, первая заглавная). */
function keepCase(source: string, result: string): string {
  if (source === source.toLocaleUpperCase("ru-RU") && source !== lower(source)) return result.toLocaleUpperCase("ru-RU");
  if (source.charAt(0) === source.charAt(0).toLocaleUpperCase("ru-RU")) return result.charAt(0).toLocaleUpperCase("ru-RU") + result.slice(1);
  return result;
}

/** Применяет склонение к каждой части через дефис: «Петров-Водкин» → «Петрову-Водкину». */
function hyphenated(word: string, decline: (part: string) => string): string {
  return word
    .split("-")
    .map((part) => (part ? keepCase(part, decline(lower(part))) : part))
    .join("-");
}

export function splitFullName(fullName: string): { surname: string | null; name: string | null; patronymic: string | null } {
  const parts = fullName.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length === 0) return { surname: null, name: null, patronymic: null };
  if (parts.length === 1) return { surname: parts[0], name: null, patronymic: null };
  if (parts.length === 2) return { surname: parts[0], name: parts[1], patronymic: null };
  // «Мамедов Ильхам Гейдар оглы» — отчество из двух слов.
  return { surname: parts[0], name: parts[1], patronymic: parts.slice(2).join(" ") };
}

/** Пол по отчеству, затем по имени, затем по фамилии; не ясно — null. */
export function detectGender(fullName: string): Gender {
  const { surname, name, patronymic } = splitFullName(fullName);
  if (patronymic) {
    const p = lower(patronymic);
    if (/(вна|чна|шна|кызы|гызы)$/.test(p)) return "female";
    if (/(ич|оглы|улы|уулу)$/.test(p)) return "male";
  }
  if (name) {
    const n = lower(name);
    if (MALE_NAMES_ON_A.has(n)) return "male";
    if (FEMALE_NAMES_CONSONANT.has(n)) return "female";
    if (/[ая]$/.test(n)) return "female";
    if (/[бвгджзйклмнпрстфхцчшщ]$/.test(n) || /(ий|ей|ай|ой)$/.test(n)) return "male";
  }
  if (surname) {
    const s = lower(surname);
    if (/(ова|ева|ёва|ина|ына|ская|цкая|ая)$/.test(s)) return "female";
    if (/(ов|ев|ёв|ин|ын|ский|цкий|ой|ый)$/.test(s)) return "male";
  }
  return null;
}

function surnameDative(s: string, gender: Gender): string {
  if (gender === "female") {
    if (/(ова|ева|ёва|ина|ына)$/.test(s)) return `${s.slice(0, -1)}ой`;
    if (/(ская|цкая)$/.test(s)) return `${s.slice(0, -2)}ой`;
    if (/ая$/.test(s)) return `${s.slice(0, -2)}ой`;
    if (/яя$/.test(s)) return `${s.slice(0, -2)}ей`;
    if (/ия$/.test(s)) return `${s.slice(0, -1)}и`;
    if (/[^аеёиоуыэюя]а$/.test(s)) return `${s.slice(0, -1)}е`;
    if (/[^аеёиоуыэюя]я$/.test(s)) return `${s.slice(0, -1)}е`;
    return s; // Штерн, Ким, Шевченко — женские на согласный и на гласный не склоняются
  }
  if (/(ых|их)$/.test(s)) return s; // Черных, Долгих
  if (/[еёиоуыэю]$/.test(s)) return s; // Шевченко, Дурново, Гюго
  if (/(ский|цкий|ской|цкой)$/.test(s)) return `${s.slice(0, -2)}ому`;
  if (/ый$/.test(s) || /ой$/.test(s)) return `${s.slice(0, -2)}ому`;
  if (/ий$/.test(s)) return `${s.slice(0, -2)}ему`;
  if (/ия$/.test(s)) return `${s.slice(0, -1)}и`;
  if (/[^аеёиоуыэюя]а$/.test(s)) return `${s.slice(0, -1)}е`; // Сковорода
  if (/[^аеёиоуыэюя]я$/.test(s)) return `${s.slice(0, -1)}е`;
  if (/[ьй]$/.test(s)) return `${s.slice(0, -1)}ю`; // Гоголь, Гайдай
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(s)) return `${s}у`;
  return s;
}

function nameDative(n: string, gender: Gender): string {
  if (/ия$/.test(n)) return `${n.slice(0, -1)}и`; // Мария, Виктория
  if (/[аяё]$/.test(n) && /[^аеёиоуыэюя][ая]$/.test(n)) return `${n.slice(0, -1)}е`; // Анна, Никита, Илья
  if (gender === "female") {
    if (/ь$/.test(n)) return `${n.slice(0, -1)}и`; // Любовь
    return n; // женские на согласный не склоняются
  }
  if (/ий$/.test(n)) return `${n.slice(0, -1)}ю`; // Дмитрий, Юрий
  if (/[ьй]$/.test(n)) return `${n.slice(0, -1)}ю`; // Игорь, Сергей, Николай
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(n)) return `${n}у`;
  return n;
}

function patronymicDative(p: string): string {
  if (/ич$/.test(p)) return `${p}у`;
  if (/на$/.test(p)) return `${p.slice(0, -1)}е`;
  return p; // «оглы», «кызы»
}

/** «Куликова Виктория Викторовна» → «Куликовой Виктории Викторовне». */
export function fullNameDative(fullName: string, gender: Gender = detectGender(fullName)): string {
  const { surname, name, patronymic } = splitFullName(fullName);
  if (!surname) return "";
  const parts = [hyphenated(surname, (part) => surnameDative(part, gender))];
  if (name) parts.push(hyphenated(name, (part) => nameDative(part, gender)));
  if (patronymic) {
    const words = patronymic.split(" ");
    parts.push([hyphenated(words[0], patronymicDative), ...words.slice(1)].join(" "));
  }
  return parts.join(" ");
}

const ADJECTIVE = /(ый|ий|ой|ая|яя|ое|ее)$/;

function adjectiveDative(word: string): string {
  if (/[жшчщ]ая$/.test(word)) return `${word.slice(0, -2)}ей`; // заведующая, старшая
  if (/(ая)$/.test(word)) return `${word.slice(0, -2)}ой`;
  if (/(яя)$/.test(word)) return `${word.slice(0, -2)}ей`;
  if (/[гкхжшчщ]ий$/.test(word)) return /[гкх]ий$/.test(word) ? `${word.slice(0, -2)}ому` : `${word.slice(0, -2)}ему`;
  if (/ий$/.test(word)) return `${word.slice(0, -2)}ему`;
  if (/(ый|ой)$/.test(word)) return `${word.slice(0, -2)}ому`;
  return word;
}

/** Существительные-должности женского рода на согласный не склоняются, мужские — да. */
function nounDative(word: string): string {
  if (/ия$/.test(word)) return `${word.slice(0, -1)}и`;
  if (/[^аеёиоуыэюя][ая]$/.test(word)) return `${word.slice(0, -1)}е`; // глава, судья
  if (/ь$/.test(word)) return `${word.slice(0, -1)}ю`; // руководитель, управитель
  if (/й$/.test(word)) return `${word.slice(0, -1)}ю`;
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(word)) return `${word}у`; // директор, президент
  return word;
}

/**
 * «Генеральный директор» → «генеральному директору»; «Заведующая
 * производством» → «заведующей производством». Склоняются прилагательные
 * перед первым существительным и само существительное (или
 * субстантивированное прилагательное: «управляющий», «заведующая»);
 * зависимые слова после него («по развитию», «ООО «Ромашка»») — как есть.
 */
export function postDative(post: string): string {
  const words = post.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out = [...words];
  for (let index = 0; index < words.length; index += 1) {
    const l = lower(words[index]);
    if (!/^[а-яё-]+$/.test(l)) break;
    // «заведующая», «управляющий», «исполняющий» — причастия в роли существительного.
    const substantive = /(ущ|ющ|ащ|ящ)(ий|ая)$/.test(l);
    const next = words[index + 1] ? lower(words[index + 1]) : null;
    if (ADJECTIVE.test(l) && !substantive && next && /^[а-яё-]+$/.test(next)) {
      out[index] = keepCase(words[index], adjectiveDative(l));
      continue;
    }
    out[index] = keepCase(words[index], ADJECTIVE.test(l) ? adjectiveDative(l) : nounDative(l));
    break;
  }
  return out.join(" ");
}

/** «Уважаемая Виктория Викторовна!»; без отчества — по имени; пол не ясен — «Здравствуйте, …!». */
export function formalGreeting(fullName: string | null | undefined): string {
  const text = (fullName ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Добрый день!";
  const { surname, name, patronymic } = splitFullName(text);
  // «Анна Сергеевна» без фамилии — так пишут имя адресата в рассылке.
  const namePatronymic = !patronymic && Boolean(name) && /(вна|чна|ич)$/i.test(name ?? "");
  const address = namePatronymic ? `${surname} ${name}` : name ? [name, patronymic].filter(Boolean).join(" ") : surname;
  const gender = namePatronymic ? detectGender(`_ ${surname} ${name}`) : detectGender(text);
  if (gender === "female") return `Уважаемая ${address}!`;
  if (gender === "male") return `Уважаемый ${address}!`;
  return `Здравствуйте, ${address}!`;
}

/** Строка обращения в шапке: должность в дательном с заглавной. */
export function addresseePostLine(post: string | null | undefined): string | null {
  const text = (post ?? "").trim();
  if (!text) return null;
  const declined = postDative(text);
  return declined.charAt(0).toLocaleUpperCase("ru-RU") + declined.slice(1);
}
