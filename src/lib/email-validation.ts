/**
 * Проверка адреса почты на стороне клиента: структура плюс подсказка
 * опечатки в домене.
 *
 * Зачем это здесь, а не одной регуляркой: с мгновенной регистрацией
 * пароль уходит письмом и адрес больше нигде не подтверждается. Опечатка
 * вроде `gmail.ru` означает мёртвый аккаунт — человек не сможет войти со
 * второго устройства и не поймёт почему. Дешевле поймать это в поле
 * ввода.
 *
 * Существование домена здесь НЕ проверяется — для этого есть
 * `/api/public/email-domain-check`, который смотрит MX-записи. Тут
 * только то, что можно решить без сети.
 */

/** Домены, ради которых и городится подсказка: массовая почта. */
const POPULAR_DOMAINS = [
  "gmail.com",
  "mail.ru",
  "yandex.ru",
  "ya.ru",
  "bk.ru",
  "inbox.ru",
  "list.ru",
  "internet.ru",
  "rambler.ru",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
  "vk.com",
];

/**
 * Домены, которых не существует, но которые постоянно набирают по
 * привычке. Для них подсказка жёсткая: отправку блокируем, потому что
 * письмо гарантированно никуда не уйдёт.
 */
const KNOWN_WRONG: Record<string, string> = {
  "gmail.ru": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cim": "gmail.com",
  "gmail.co": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.comm": "gmail.com",
  "mail.com.ru": "mail.ru",
  "yandex.com.ru": "yandex.ru",
  "yandex.ri": "yandex.ru",
  "mail.ri": "mail.ru",
  "mail.ru.com": "mail.ru",
  "yanex.ru": "yandex.ru",
  "yandx.ru": "yandex.ru",
  "iclod.com": "icloud.com",
  "outlok.com": "outlook.com",
  "hotmial.com": "hotmail.com",
};

export type EmailCheck =
  | { status: "empty"; message: string }
  | { status: "invalid"; message: string }
  /// Домен почти наверняка набран с ошибкой — отправку блокируем.
  | { status: "typo"; message: string; suggestion: string; certain?: boolean }
  | { status: "ok" };

/** Расстояние Левенштейна — для поиска «почти таких же» доменов. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;

  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/**
 * Подменяет домен в адресе, сохраняя всё до собаки.
 * `ivan@gmail.ru` + `gmail.com` → `ivan@gmail.com`.
 */
export function replaceDomain(email: string, domain: string): string {
  const at = email.lastIndexOf("@");
  const local = at === -1 ? email : email.slice(0, at);
  return `${local}@${domain}`;
}

export function checkEmail(rawValue: string): EmailCheck {
  const value = rawValue.trim().toLowerCase();

  if (!value) {
    return { status: "empty", message: "Введите адрес электронной почты" };
  }
  if (value.length > 200) {
    return { status: "invalid", message: "Адрес слишком длинный" };
  }
  if (/\s/.test(value)) {
    return { status: "invalid", message: "В адресе не должно быть пробелов" };
  }

  const at = value.indexOf("@");
  if (at === -1) {
    return { status: "invalid", message: "В адресе не хватает символа @" };
  }
  if (value.indexOf("@", at + 1) !== -1) {
    return { status: "invalid", message: "В адресе больше одной собаки" };
  }

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  if (!local) {
    return {
      status: "invalid",
      message: "Перед @ должно быть имя ящика",
    };
  }
  if (!domain) {
    return { status: "invalid", message: "После @ должен быть домен" };
  }
  if (!domain.includes(".")) {
    return {
      status: "invalid",
      message: "В домене не хватает точки — например, mail.ru",
    };
  }
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return { status: "invalid", message: "Домен набран с ошибкой" };
  }
  if (!/^[a-z0-9.-]+$/.test(domain)) {
    return { status: "invalid", message: "В домене недопустимые символы" };
  }

  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (tld.length < 2 || /\d/.test(tld)) {
    return { status: "invalid", message: "Домен набран с ошибкой" };
  }

  // Явно неверные, но привычные написания.
  const known = KNOWN_WRONG[domain];
  if (known) {
    return {
      status: "typo",
      suggestion: known,
      message: `Домена ${domain} не существует. Возможно, вы имели в виду ${known}`,
      // Такого домена нет наверняка — в отличие от «похож на популярный».
      certain: true,
    };
  }

  // Опечатка в популярном домене: одна-две буквы мимо.
  if (!POPULAR_DOMAINS.includes(domain)) {
    for (const candidate of POPULAR_DOMAINS) {
      if (distance(domain, candidate) <= 2) {
        return {
          status: "typo",
          suggestion: candidate,
          message: `Возможно, вы имели в виду ${candidate}`,
        };
      }
    }
  }

  return { status: "ok" };
}
