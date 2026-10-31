// Локальная заглушка iikoServer (:4577): вход с sha1-паролем, справочники, накладные, списания, выход.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const log = [];
const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
const today = new Date().toISOString().slice(0, 10);
const invoices = `<?xml version="1.0" encoding="UTF-8"?>
<incomingInvoiceDtoes>
  <document><id>iiko-inv-1</id><incomingDocumentNumber>ПН-2045</incomingDocumentNumber><documentNumber>0045</documentNumber>
    <incomingDate>${today}T00:00:00</incomingDate><status>PROCESSED</status><supplier>sup-1</supplier>
    <items>
      <item><num>1</num><product>p-chicken</product><amount>12.4</amount><amountUnit>u-kg</amountUnit><price>420</price><sum>5208</sum></item>
      <item><num>2</num><product>p-cream</product><amount>6</amount><amountUnit>u-l</amountUnit><price>390</price><sum>2340</sum></item>
    </items></document>
  <document><id>iiko-inv-2</id><documentNumber>0046</documentNumber><dateIncoming>${today}T08:00:00</dateIncoming><status>DELETED</status><supplier>sup-1</supplier>
    <items><item><num>1</num><product>p-chicken</product><amount>1</amount></item></items></document>
</incomingInvoiceDtoes>`;
const products = [
  { id: 'p-chicken', name: 'Филе куриное охлаждённое', type: 'GOODS', mainUnit: 'u-kg', deleted: false },
  { id: 'p-cream', name: 'Сливки 33%', type: 'GOODS', mainUnit: 'u-l', deleted: false },
  { id: 'p-dough', name: 'Тесто слоёное (заготовка)', type: 'PREPARED', mainUnit: 'u-kg', deleted: false },
  { id: 'p-pasta', name: 'Паста карбонара', type: 'DISH', mainUnit: 'u-pcs', deleted: false },
];
const units = [{ id: 'u-kg', name: 'кг' }, { id: 'u-l', name: 'л' }, { id: 'u-pcs', name: 'шт' }];
const suppliers = `<employees><employee><id>sup-1</id><name>ООО «Фермер-Опт»</name><taxpayerIdNumber>5009876543</taxpayerIdNumber><supplier>true</supplier></employee></employees>`;
const writeoffs = { result: 'SUCCESS', response: [
  { id: 'iiko-wo-1', documentNumber: '31', dateIncoming: `${today}T22:00`, status: 'PROCESSED', comment: 'Истёк срок годности', items: [
    { productId: 'p-cream', amount: 1.5, measureUnitId: 'u-l', cost: 585 },
    { productId: 'p-chicken', amount: 0.8, measureUnitId: 'u-kg', cost: 336 },
  ] },
] };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = url.searchParams.get('key');
  log.push(`${req.method} ${url.pathname}${url.pathname === '/resto/api/auth' ? ` login=${url.searchParams.get('login')} pass=${url.searchParams.get('pass') === sha1('secret') ? 'sha1(ok)' : 'wrong'}` : ` key=${key ? 'yes' : 'no'}`}`);
  const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  if (url.pathname === '/resto/api/auth') {
    if (url.searchParams.get('pass') !== sha1('secret')) return send(401, 'Wrong login or password', 'text/plain');
    return send(200, 'iiko-session-key', 'text/plain');
  }
  if (key !== 'iiko-session-key') return send(401, 'no session', 'text/plain');
  switch (url.pathname) {
    case '/resto/api/logout': return send(200, '', 'text/plain');
    case '/resto/api/v2/entities/products/list': return send(200, products);
    case '/resto/api/v2/entities/list': return send(200, units);
    case '/resto/api/suppliers': return send(200, suppliers, 'application/xml');
    case '/resto/api/documents/export/incomingInvoice': return send(200, invoices, 'application/xml');
    case '/resto/api/v2/documents/writeoff': return send(200, writeoffs);
    default: return send(404, 'not found', 'text/plain');
  }
}).listen(4577, '127.0.0.1');
setInterval(() => fs.writeFileSync(path.join(__dirname, 'mock-log.txt'), log.join('\n') + '\n'), 1000);
console.log('iiko mock up');
