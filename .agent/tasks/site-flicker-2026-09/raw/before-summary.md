## Замер «before-results»

Окно разбора: 1500 мс после начала перехода. Прогонов: 302.

| Сценарий | Чужая тема (макс) | Где | «Что нового» | Пусто без скелетона, макс | CLS макс | Скелетоны |
|---|---|---|---|---|---|---|
| load:dashboard | 1554 мс (44 кадр.), по кадрам 1258 мс | phone/own-light/db-dark, phone/own-dark/db-light, phone/sys-dark/db-light, phone/sys-light/db-dark | — | 0 мс | 0.178 | дашборд |
| load:journals | 3018 мс (20 кадр.), по кадрам 1351 мс | phone/own-light/db-dark, phone/own-dark/db-light, phone/sys-dark/db-light, phone/sys-light/db-dark | — | 0 мс | 0.152 | журналы |
| load:journal | 1407 мс (42 кадр.), по кадрам 1328 мс | phone/own-light/db-dark, phone/own-dark/db-light, phone/sys-dark/db-light, phone/sys-light/db-dark | — | 0 мс | 0.018 | журналы › документы журнала |
| load:document | 1704 мс (15 кадр.), по кадрам 1199 мс | phone/own-light/db-dark, phone/own-dark/db-light, phone/sys-dark/db-light, phone/sys-light/db-dark | — | 0 мс | 0.001 | журналы › документ › документы журнала |
| load:settings | 2130 мс (76 кадр.), по кадрам 1374 мс | phone/own-light/db-dark, phone/own-dark/db-light, phone/sys-dark/db-light, phone/sys-light/db-dark | — | 0 мс | 0 | настройки |
| load:balance | 1749 мс (27 кадр.), по кадрам 585 мс | phone/own-light/db-dark, phone/own-dark/db-light, phone/sys-dark/db-light, phone/sys-light/db-dark | — | 0 мс | 0 | настройки |
| nav:dashboard>journals | 0 | — | — | 0 мс | 0.016 | журналы |
| nav:journals>journal | 0 | — | — | 0 мс | 0.018 | документы журнала › журналы |
| nav:journal>document | 0 | — | — | 0 мс | 0.008 | документ › документы журнала |
| nav:document>settings | 0 | — | — | 0 мс | 0.037 | настройки |
| nav:settings>balance | 0 | — | — | 0 мс | 0.004 | настройки |
| back:>settings | 0 | — | — | 0 мс | 0.004 | настройки |
| back:>document | 0 | — | — | 0 мс | 0.037 | — |
| back:>journal | 0 | — | — | 0 мс | 0.011 | — |
| back:>journals | 0 | — | — | 0 мс | 0.909 | — |
| back:>dashboard | 0 | — | — | 0 мс | 0.016 | — |
| refresh:dashboard | 167 мс (1 кадр.), по кадрам 45 мс | desk/own-light | — | 0 мс | 0 | — |
| login | 0 мс (0 кадр.), по кадрам 107 мс | — | — | 0 мс | 0.001 | дашборд |
| logout | 0 | — | — | 0 мс | 0 | light+708 / dark+541 → light+100 / light+517 / dark+426 → light+100 |
| mini · load:/dashboard | 0 | — | — | 0 мс | 0.001 | дашборд |
| mini · nav:/dashboard>/journals | 0 | — | — | 0 мс | 0 | журналы |
| mini · nav:/journals>/mini/sections | 135 мс (4 кадр.), по кадрам 123 мс | phone/mini:sys-dark/db-light, phone/mini:sys-light/db-dark | — | 314 мс | 0 | — |
| mini · nav:/mini/sections>/mini/me | 0 | — | — | 317 мс | 0.009 | — |
| mini · back:1 | 0 | — | — | 0 мс | 0 | — |
| mini · back:2 | 690 мс (2 кадр.), по кадрам 111 мс | phone/mini:sys-dark/db-light, phone/mini:sys-light/db-dark | — | 0 мс | 0 | — |
| wn · load:dashboard | 0 | — | видно с 1187–1754 мс, события: show@1187; show@1754 | 0 мс | 0.178 | дашборд |
| wn · nav:dashboard>journals | 0 | — | видно с 9–13 мс | 0 мс | 0.016 | журналы |
| wn · nav:journals>journal | 0 | — | видно с 11–13 мс | 0 мс | 0.018 | документы журнала |
| wn · nav:journal>document | 0 | — | видно с 4–11 мс | 0 мс | 0.006 | документ |
| wn · nav:document>settings | 0 | — | видно с 5–11 мс | 0 мс | 0.037 | настройки |
| wn · nav:settings>balance | 0 | — | видно с 15–105 мс | 0 мс | 0.004 | настройки |
| wn · back:>settings | 0 | — | видно с 9–133 мс | 0 мс | 0.004 | — |
| wn · nav:settings>whats-new(public) | 0 | — | видно с 71–106 мс | 0 мс | 0 | — |
| wn · back:>settings(remount) | 0 | — | видно с 134–149 мс | 0 мс | 0.018 | — |
| wn · after-close:nav>dashboard | 0 | — | — | 0 мс | 0.037 | дашборд |
| wn · after-close:reload | 0 | — | — | 0 мс | 0 | дашборд |
| wn-legacy · load1:dashboard | 0 | — | видно с 1155–2543 мс, события: show@1155; show@2543 | 0 мс | 0.178 | дашборд |
| wn-legacy · load2:dashboard | 0 | — | видно с 373–3769 мс, события: show@373; show@3769 | 0 мс | 0.178 | дашборд |
| wn-legacy · after-close:reload | 0 | — | — | 0 мс | 0 | дашборд |

