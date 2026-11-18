# Кеш публичных страниц в nginx (спека seo-speed-pack-2026-11, п. 5)

Публичные страницы (лендинг, каталог журналов, блог, страницы журналов) рендерятся
на каждый запрос: ответ сервера 0,65–0,85 с (замер 2026-11-17). Приложение уже
помечает **анонимные** ответы этих страниц как кешируемые —
`Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`
(`src/proxy.ts`, `isPublicCacheablePage`). Кабинет, вход и всё с кукой сессии
получают `no-store` и в кеш не попадают.

nginx сейчас этот заголовок не использует. Включить микрокеш на 60 секунд —
ответ из кеша < 50 мс, приложение рендерит страницу раз в минуту.

## Конфиг

В блок `http { … }`:

```nginx
proxy_cache_path /var/cache/nginx/wesetup levels=1:2 keys_zone=wesetup_pages:50m max_size=1g inactive=10m use_temp_path=off;

# Имена кук с точками и дефисами в $cookie_… не читаются — берём из заголовка.
map $http_cookie $wesetup_session {
  default 0;
  "~*haccp-online\.session-token" 1;
}
map $http_cookie $wesetup_locale {
  default "";
  "~*wesetup\.site-locale=(?<loc>[a-z]+)" $loc;
}
```

В `server { … }` сайта, в `location /` перед `proxy_pass`:

```nginx
proxy_cache wesetup_pages;
proxy_cache_key "$scheme$host$request_uri|$wesetup_locale";
# Только то, что приложение само разрешило кешировать (s-maxage / no-store).
proxy_cache_valid 404 1m;
proxy_cache_use_stale updating error timeout http_500 http_502 http_503;
proxy_cache_background_update on;
proxy_cache_lock on;
# Не кешировать и не отдавать из кеша вошедшим пользователям.
proxy_cache_bypass $wesetup_session $http_authorization;
proxy_no_cache     $wesetup_session $http_authorization;
add_header X-Cache-Status $upstream_cache_status always;
```

Имена кук сессии — `src/lib/auth-cookies.ts` (`haccp-online.session-token`,
`__Secure-haccp-online.session-token` и легаси-имена с тем же корнем): регулярка
в `map` ловит их все.

## Проверка

```bash
curl -sI https://wesetup.ru/journals-info/cleaning | grep -i x-cache-status   # MISS, затем HIT
curl -s -o /dev/null -w "%{time_starttransfer}\n" https://wesetup.ru/journals-info/cleaning
```

Вошедший пользователь всегда должен видеть `X-Cache-Status: BYPASS`.
