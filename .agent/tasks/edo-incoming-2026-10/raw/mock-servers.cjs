// Локальные заглушки Диадока (:4566) и СБИС (:4555) для проверки ЭДО без живых ключей.
const http = require('http');
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const log = [];
const record = (who, req, extra = '') => log.push(`${who} ${req.method} ${req.url}${extra}`);

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    record('diadoc', req, req.headers.authorization ? ` auth=${req.headers.authorization.replace(/ddauth_token=[^,]+/, 'ddauth_token=***')}` : '');
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/V3/Authenticate') {
      const b = JSON.parse(body || '{}');
      if (b.password !== 'secret') { res.writeHead(401); return res.end('Unauthorized'); }
      res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('local-token-1');
    }
    if (!String(req.headers.authorization || '').includes('ddauth_token=local-token-1')) { res.writeHead(401); return res.end(); }
    if (url.pathname === '/GetMyOrganizations') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ Organizations: [
        { FullName: 'МБОУ СОШ № 8', Inn: '5001234567', Boxes: [{ BoxId: 'box-school@diadoc.ru', Title: 'Школа № 8' }] },
        { FullName: 'Детский сад № 68', Inn: '5007654321', Boxes: [{ BoxId: 'box-kg@diadoc.ru', Title: 'Детсад № 68' }] },
      ] }));
    }
    if (url.pathname === '/V3/GetDocuments') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ HasMoreResults: false, Documents: [
        { MessageId: 'msg-1', EntityId: 'ent-1', TypeNamedId: 'UniversalTransferDocument', DocumentNumber: 'МД-1031', DocumentDate: '31.10.2026', FileName: 'ON_NSCHFDOPPR_1.xml', IndexKey: 'k1' },
        { MessageId: 'msg-2', EntityId: 'ent-2', TypeNamedId: 'Nonformalized', FileName: 'Договор.pdf', IndexKey: 'k2' },
      ] }));
    }
    if (url.pathname === '/V4/GetEntityContent') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(fs.readFileSync(path.join(dir, 'upd-501-cp1251.xml')));
    }
    res.writeHead(404); res.end();
  });
}).listen(4566, '127.0.0.1');

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    record('saby', req, req.headers['x-sbisaccesstoken'] ? ' token=***' : '');
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/oauth/service/') {
      const b = JSON.parse(body || '{}');
      if (b.app_secret !== 'secret-1') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Неверный защищённый ключ' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ access_token: 'saby-access-1', token: 'saby-token-1', sid: 's' }));
    }
    if (url.pathname === '/service/') {
      const rpc = JSON.parse(body || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (rpc.method === 'СБИС.СписокДокументов') {
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { Документ: [
          { Идентификатор: 'saby-doc-17', Номер: '17', Дата: '30.10.2026', Вложение: [
            { Тип: 'УпдДоп', Служебный: 'Нет', Файл: { Имя: 'ON_NSCHFDOPPR_17.xml', Ссылка: 'http://127.0.0.1:4555/file/upd17' } },
          ] },
        ], Навигация: { ЕстьЕще: 'Нет' } } }));
      }
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: 0, error: { code: -1, message: 'unknown method ' + rpc.method } }));
    }
    if (url.pathname === '/file/upd17') {
      if (req.headers['x-sbisaccesstoken'] !== 'saby-access-1') { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(fs.readFileSync(path.join(dir, 'upd-503-utf8.xml')));
    }
    res.writeHead(404); res.end();
  });
}).listen(4555, '127.0.0.1');

process.on('SIGTERM', () => { fs.writeFileSync(path.join(dir, 'mock-log.txt'), log.join('\n') + '\n'); process.exit(0); });
setInterval(() => fs.writeFileSync(path.join(dir, 'mock-log.txt'), log.join('\n') + '\n'), 1000);
console.log('mocks up');
