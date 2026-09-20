// Эмулятор клиента Telegram для страницы: подменяет мост TelegramWebviewProxy,
// которым настоящий telegram-web-app.js разговаривает с приложением Telegram.
// Сам скрипт Telegram остаётся настоящим — подменён только собеседник.
(function () {
  if (window.__tgHost) return;
  var cfg = window.__tgHostConfig || {};
  var host = (window.__tgHost = {
    events: [],
    backVisible: false,
    mainButton: null,
    closingConfirmation: false,
    verticalSwipes: true,
    headerColor: null,
    bgColor: null,
    popups: [],
    popupAnswer: cfg.popupAnswer || null,
    closed: false,
  });
  function receive(type, data) {
    try {
      window.Telegram.WebView.receiveEvent(type, data);
    } catch (e) {
      host.events.push({ type: "__receive_failed", d: String(e) });
    }
  }
  host.receive = receive;
  host.pressBack = function () { receive("back_button_pressed", {}); };
  host.pressMain = function () { receive("main_button_pressed", {}); };
  window.TelegramWebviewProxy = {
    postEvent: function (type, raw) {
      var d = null;
      try { d = raw ? JSON.parse(raw) : null; } catch (e) { d = raw; }
      host.events.push({ type: type, d: d, path: location.pathname, t: Date.now() });
      if (type === "web_app_setup_back_button") host.backVisible = !!(d && d.is_visible);
      if (type === "web_app_setup_main_button") host.mainButton = d;
      if (type === "web_app_setup_closing_behavior") host.closingConfirmation = !!(d && d.need_confirmation);
      if (type === "web_app_setup_swipe_behavior") host.verticalSwipes = !!(d && d.allow_vertical_swipe);
      if (type === "web_app_set_header_color") host.headerColor = d;
      if (type === "web_app_set_background_color") host.bgColor = d;
      if (type === "web_app_close") host.closed = true;
      if (type === "web_app_request_viewport")
        setTimeout(function () { receive("viewport_changed", { height: window.innerHeight, width: window.innerWidth, is_expanded: true, is_state_stable: true }); }, 0);
      if (type === "web_app_request_safe_area")
        setTimeout(function () { receive("safe_area_changed", cfg.safeArea || { top: 0, bottom: 34, left: 0, right: 0 }); }, 0);
      if (type === "web_app_request_content_safe_area")
        setTimeout(function () { receive("content_safe_area_changed", cfg.contentSafeArea || { top: 0, bottom: 0, left: 0, right: 0 }); }, 0);
      if (type === "web_app_request_theme")
        setTimeout(function () { receive("theme_changed", { theme_params: cfg.themeParams || {} }); }, 0);
      if (type === "web_app_open_popup") {
        host.popups.push(d);
        if (host.popupAnswer !== null)
          setTimeout(function () { receive("popup_closed", { button_id: host.popupAnswer }); }, 50);
      }
      if (type === "web_app_open_scan_qr_popup") host.popups.push({ qr: d });
    },
  };
})();
