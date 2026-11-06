/**
 * Контакты WeSetup — как на визитке (владелец, 2026-11-06): основной номер
 * 495, мобильный и почта admin@. Один источник для подвала сайта, реквизитов,
 * окна «Свяжитесь с нами», главной кабинета, визитки и писем.
 *
 * Чистый модуль без БД и React: его читают и серверные, и клиентские файлы.
 */

export type CompanyPhone = { display: string; tel: string };

/** Почта для клиентов, поддержки и документов. */
export const COMPANY_EMAIL = "admin@wesetup.ru";

/** Основной (городской) номер. */
export const COMPANY_PHONE: CompanyPhone = { display: "+7 (495) 109-65-43", tel: "+74951096543" };

/** Мобильный номер. */
export const COMPANY_MOBILE: CompanyPhone = { display: "+7 (925) 305-80-77", tel: "+79253058077" };

/** Оба номера в порядке показа: основной, затем мобильный. */
export const COMPANY_PHONES: readonly CompanyPhone[] = [COMPANY_PHONE, COMPANY_MOBILE];
