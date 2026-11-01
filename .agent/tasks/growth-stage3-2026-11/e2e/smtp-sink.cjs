/**
 * Приёмник SMTP для локальной проверки (127.0.0.1:2525): принимает любое письмо
 * и пишет в stdout «кому — тема». Нужен, чтобы отправка писем считалась
 * доставленной (в dev без SMTP письмо только пишется в журнал и «не доставлено»).
 * Запуск: node .agent/tasks/growth-stage3-2026-11/e2e/smtp-sink.cjs
 */
const net = require("node:net");

const server = net.createServer((socket) => {
  let data = false;
  let buffer = "";
  let message = "";
  let rcpt = [];
  socket.write("220 sink ESMTP\r\n");
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while (true) {
      if (data) {
        index = buffer.indexOf("\r\n.\r\n");
        if (index < 0) return;
        message += buffer.slice(0, index);
        buffer = buffer.slice(index + 5);
        data = false;
        const subject = (message.match(/^Subject: (.*)$/im) || [])[1] || "";
        console.log(`${new Date().toISOString()} ${rcpt.join(",")} — ${subject.trim()}`);
        message = "";
        rcpt = [];
        socket.write("250 OK queued\r\n");
        continue;
      }
      index = buffer.indexOf("\r\n");
      if (index < 0) return;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const command = line.slice(0, 4).toUpperCase();
      if (command === "EHLO" || command === "HELO") socket.write("250-sink\r\n250 OK\r\n");
      else if (command === "RCPT") { rcpt.push(line.replace(/^RCPT TO:\s*/i, "")); socket.write("250 OK\r\n"); }
      else if (command === "DATA") { data = true; socket.write("354 End data with <CR><LF>.<CR><LF>\r\n"); }
      else if (command === "QUIT") { socket.end("221 Bye\r\n"); return; }
      else socket.write("250 OK\r\n");
    }
  });
  socket.on("error", () => {});
});
server.listen(2525, "127.0.0.1", () => console.log("smtp sink on 127.0.0.1:2525"));
