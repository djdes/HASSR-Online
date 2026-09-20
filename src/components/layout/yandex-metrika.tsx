import Script from "next/script";

/**
 * Yandex.Metrika counter. Mounts in the root layout only when the env
 * variable `NEXT_PUBLIC_YANDEX_METRIKA_ID` is set (numeric counter id
 * from metrika.yandex.ru). Until then, renders nothing, so CI builds
 * and preview deploys don't ship a zero-id tracker.
 *
 * Uses next/script with `strategy="afterInteractive"` so the counter
 * doesn't block first paint. Settings match the stock snippet from
 * the Metrika dashboard: webvisor, clickmap, accurate bounce,
 * ecommerce dataLayer, manual referrer + url for SPA navigations.
 */
export function YandexMetrika() {
  const id = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
  if (!id || !/^\d{5,12}$/.test(id)) return null;

  const counterId = JSON.stringify(Number(id));

  return (
    <>
      <Script
        id="yandex-metrika"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            /* Публичные QR-формы (заполнение с телефона в цехе): без счётчика —
               лишние 300 КБ на медленной сети, а аналитика там не нужна. */
            /* Условие блоком, а не return: у встроенного скрипта нет функции-обёртки,
               и return на верхнем уровне — синтаксическая ошибка, с которой счётчик
               не запускался ни на одной странице. */
            if (!/^\\/(journal-fill|equipment-fill|room-fill|task-fill)(\\/|$)/.test(location.pathname)) {
            (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
            m[i].l=1*new Date();
            for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
            k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
            (window, document, "script", "https://mc.yandex.ru/metrika/tag.js?id=${Number(id)}", "ym");

            ym(${counterId}, "init", {
                ssr: true,
                webvisor: true,
                clickmap: true,
                ecommerce: "dataLayer",
                referrer: document.referrer,
                url: location.href,
                accurateTrackBounce: true,
                trackLinks: true
            });
            }
          `,
        }}
      />
      <noscript
        dangerouslySetInnerHTML={{
          __html: `<div><img src="https://mc.yandex.ru/watch/${Number(id)}" style="position:absolute; left:-9999px;" alt="" /></div>`,
        }}
      />
    </>
  );
}
