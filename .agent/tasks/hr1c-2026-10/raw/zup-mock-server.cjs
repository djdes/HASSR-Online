// Локальная заглушка 1С:ЗУП 3 (OData, :4588): сотрудники, текущие кадровые данные, должности. Basic odata:secret.
const http = require('http');
const fs = require('fs');
const path = require('path');
const log = [];
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const employees = [
  { Ref_Key: 'e-belova', Description: 'Белова Елена Андреевна', DeletionMark: false, ВАрхиве: false },
  { Ref_Key: 'e-grachev', Description: 'Грачев Виктор Ильич', DeletionMark: false, ВАрхиве: false },
  { Ref_Key: 'e-novikova', Description: 'Новикова Анна Сергеевна', DeletionMark: false, ВАрхиве: false },
  { Ref_Key: 'e-pekarev', Description: 'Пекарев Иван Ильич', DeletionMark: false, ВАрхиве: false },
  { Ref_Key: 'e-old', Description: 'Старый Работник', DeletionMark: false, ВАрхиве: true },
  { Ref_Key: 'e-deleted', Description: 'Помечен на удаление', DeletionMark: true, ВАрхиве: false },
];
const hr = [
  { Сотрудник_Key: 'e-belova', ДатаПриема: '2024-02-01T00:00:00', ДатаУвольнения: '0001-01-01T00:00:00', ТекущаяДолжность_Key: 'p-cook' },
  { Сотрудник_Key: 'e-grachev', ДатаПриема: '2023-05-10T00:00:00', ДатаУвольнения: `${yesterday}T00:00:00`, ТекущаяДолжность_Key: 'p-cook' },
  { Сотрудник_Key: 'e-novikova', ДатаПриема: '2026-10-28T00:00:00', ДатаУвольнения: '0001-01-01T00:00:00', ТекущаяДолжность_Key: 'p-cook' },
  { Сотрудник_Key: 'e-pekarev', ДатаПриема: '2026-10-29T00:00:00', ДатаУвольнения: '0001-01-01T00:00:00', ТекущаяДолжность_Key: 'p-baker' },
];
const positions = [{ Ref_Key: 'p-cook', Description: 'Повар' }, { Ref_Key: 'p-baker', Description: 'Пекарь' }];
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const entity = decodeURIComponent(url.pathname.replace('/zup/odata/standard.odata/', ''));
  const okAuth = req.headers.authorization === 'Basic ' + Buffer.from('odata:secret').toString('base64');
  log.push(`${req.method} ${entity} $top=${url.searchParams.get('$top')} $skip=${url.searchParams.get('$skip')} auth=${okAuth ? 'ok' : 'bad'}`);
  if (!okAuth) { res.writeHead(401); return res.end(); }
  const send = (value) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ 'odata.metadata': 'x', value })); };
  if (entity === 'Catalog_Сотрудники') return send(employees);
  if (entity === 'InformationRegister_ТекущиеКадровыеДанныеСотрудников') return send(hr);
  if (entity === 'Catalog_Должности') return send(positions);
  res.writeHead(404); res.end();
}).listen(4588, '127.0.0.1');
setInterval(() => fs.writeFileSync(path.join(__dirname, 'mock-log.txt'), log.join('\n') + '\n'), 1000);
console.log('zup mock up');
