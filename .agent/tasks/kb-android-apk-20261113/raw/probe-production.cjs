const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const expectedSha = process.argv[2];
  assert.match(expectedSha ?? '', /^[0-9a-f]{40}$/);
  const origin = 'https://wesetup.ru';
  const buildResponse = await fetch(origin + '/api/build-info', { cache: 'no-store' });
  assert.equal(buildResponse.status, 200);
  const build = await buildResponse.json();
  assert.equal(build.fullBuildId, expectedSha);
  const slug = '/baza-znaniy/prilozhenie-android';
  const articleResponse = await fetch(origin + slug);
  assert.equal(articleResponse.status, 200);
  const article = await articleResponse.text();
  assert.match(article, /<a[^>]*href="https:\/\/wesetup\.ru\/download\/android"[^>]*>/);
  assert.ok(article.includes('Как установить'));
  const navigation = await fetch(origin + '/baza-znaniy');
  assert.equal(navigation.status, 200);
  assert.ok((await navigation.text()).includes('href="' + slug + '"'));
  const oldArticle = await fetch(origin + '/baza-znaniy/telegram-i-obshchiy-qr');
  assert.equal(oldArticle.status, 200);
  assert.ok((await oldArticle.text()).includes('href="' + slug + '"'));
  const apk = await fetch(origin + '/download/android', { method: 'HEAD', redirect: 'manual' });
  assert.equal(apk.status, 302);
  const apkUrl = apk.headers.get('location');
  assert.equal(apkUrl, 'https://github.com/djdes/HASSR-Online/releases/download/wesetup-app-latest/wesetup.apk');
  const asset = await fetch(apkUrl, { method: 'HEAD', redirect: 'follow' });
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'application/vnd.android.package-archive');
  const result = { status: 'PASS', checkedAt: new Date().toISOString(), expectedSha, build,
    article: { url: origin + slug, status: articleResponse.status, nativeApkAnchor: true, installationSteps: true },
    navigation: { status: navigation.status, articleLinked: true }, previousArticle: { status: oldArticle.status, articleLinked: true },
    apk: { url: origin + '/download/android', status: apk.status, location: apkUrl, assetStatus: asset.status, contentType: asset.headers.get('content-type') } };
  fs.writeFileSync(__dirname + '/production-probe.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
