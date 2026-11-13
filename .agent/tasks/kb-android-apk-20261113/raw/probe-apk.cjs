const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
(async () => {
  const release = spawnSync('C:/Users/Yaroslav/.local/gh/bin/gh.exe', ['api', 'repos/djdes/HASSR-Online/releases/tags/wesetup-app-latest'], { encoding: 'utf8', windowsHide: true });
  assert.equal(release.status, 0, release.stderr);
  const data = JSON.parse(release.stdout);
  const asset = data.assets.find(item => item.name === 'wesetup.apk');
  assert.ok(asset);
  const url = 'https://wesetup.ru/download/android';
  const response = await fetch(url, { method: 'HEAD', redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), asset.browser_download_url);
  const download = await fetch(asset.browser_download_url, { method: 'HEAD', redirect: 'follow' });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/vnd.android.package-archive');
  const result = { status: 'PASS', checkedAt: new Date().toISOString(), url, redirectStatus: response.status,
    location: response.headers.get('location'), releaseName: data.name, publishedAt: data.published_at,
    assetStatus: download.status, contentType: download.headers.get('content-type'), bytes: Number(download.headers.get('content-length')) };
  fs.writeFileSync(__dirname + '/apk-probe.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
