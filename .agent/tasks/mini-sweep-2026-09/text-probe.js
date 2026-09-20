(function () {
  var de = document.documentElement, vw = de.clientWidth;
  var root = document.querySelector("main") || document.body;
  function label(el) { return el.tagName.toLowerCase() + "." + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).replace(/\s+/g, ".").slice(0, 70); }
  function txt(el) { return (el.innerText || el.value || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " "); }
  function inXScroller(el) { var p = el.parentElement; while (p && p !== document.body) { var o = getComputedStyle(p).overflowX; if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth + 2) return true; p = p.parentElement; } return false; }
  var all = Array.from(root.querySelectorAll("*")).filter(function (e) { return e.offsetParent !== null; });
  var cut = [], ellipsis = [], offscreen = [], squeezed = [];
  all.forEach(function (el) {
    var s = getComputedStyle(el), t = txt(el); if (!t) return;
    var leaf = el.children.length === 0 || /^(button|a|label|p|span|h1|h2|h3|h4|td|th|li|summary|option)$/i.test(el.tagName);
    if (!leaf) return;
    // 1. Текст обрезан по вертикали (видна часть строк / половина строки).
    if ((s.overflowY === "hidden" || s.overflowY === "clip") && el.scrollHeight > el.clientHeight + 3 && el.clientHeight > 6 && !/line-clamp|truncate/.test(String(el.className)) && s.webkitLineClamp === "none") {
      if (cut.length < 10) cut.push(label(el) + " «" + t.slice(0, 50) + "» " + el.clientHeight + "<" + el.scrollHeight);
    }
    // 2. Текст сокращён многоточием или line-clamp: человек не видит его целиком.
    var clamped = s.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 3;
    var ell = s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 2;
    if ((clamped || ell) && t.length > 3 && !inXScroller(el)) { if (ellipsis.length < 14) ellipsis.push(label(el).slice(0, 50) + " «" + t.slice(0, 60) + "»"); }
    // 3. Поля ввода и выбора: значение/подсказка не помещается.
    if (/^(input|select)$/i.test(el.tagName) && el.scrollWidth > el.clientWidth + 4 && squeezed.length < 8) squeezed.push(label(el).slice(0, 40) + " «" + t.slice(0, 40) + "» " + el.clientWidth + "<" + el.scrollWidth);
    // 4. За правым краем экрана и не в прокручиваемом блоке.
    var r = el.getBoundingClientRect(); if (r.width > 2 && r.right > vw + 2 && !inXScroller(el) && offscreen.length < 8) offscreen.push(label(el).slice(0, 50) + " «" + t.slice(0, 40) + "» →" + Math.round(r.right));
  });
  Array.from(root.querySelectorAll("input, select, textarea")).forEach(function (el) { if (el.offsetParent === null) return; var ph = el.getAttribute("placeholder") || ""; if (el.tagName === "INPUT" && ph && !el.value) { var c = document.createElement("canvas").getContext("2d"); var s = getComputedStyle(el); c.font = s.fontSize + " " + s.fontFamily; var w = c.measureText(ph).width; var inner = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); if (w > inner + 4 && squeezed.length < 8) squeezed.push("placeholder «" + ph.slice(0, 50) + "» " + Math.round(inner) + "<" + Math.round(w)); } if (el.tagName === "SELECT") { var o = el.options[el.selectedIndex]; if (o) { var c2 = document.createElement("canvas").getContext("2d"); var s2 = getComputedStyle(el); c2.font = s2.fontSize + " " + s2.fontFamily; var w2 = c2.measureText(o.text).width; var inner2 = el.clientWidth - parseFloat(s2.paddingLeft) - parseFloat(s2.paddingRight) - 18; if (w2 > inner2 + 4 && squeezed.length < 8) squeezed.push("select «" + o.text.slice(0, 50) + "» " + Math.round(inner2) + "<" + Math.round(w2)); } } });
  return { pageOverflow: de.scrollWidth > vw + 2 ? de.scrollWidth : 0, cut: cut, ellipsis: ellipsis, squeezed: squeezed, offscreen: offscreen, height: de.scrollHeight };
})()
