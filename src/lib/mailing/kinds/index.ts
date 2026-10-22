import { registerMailingTemplate } from "@/lib/mailing/templates";

import { kpTemplate } from "./kp";
import { messageTemplate } from "./message";
import { promoTemplate } from "./promo";

/**
 * Регистрация типов рассылки — по строке на тип. Импортируют сервер
 * (очередь, API ROOT) и тесты; клиенту типы приходят списком
 * `mailingKindOptions()`, а поля формы он находит сам:
 * `src/components/mailing/fields/<kind>.tsx`.
 */
registerMailingTemplate(messageTemplate);
registerMailingTemplate(kpTemplate);
registerMailingTemplate(promoTemplate);

export {
  getMailingTemplate,
  mailingKindOptions,
  mailingKindOptionsWithData,
  mailingTemplates,
} from "@/lib/mailing/templates";
