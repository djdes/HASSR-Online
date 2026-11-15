const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const expected = process.argv[2];
  const result = {checkedAt:new Date().toISOString(),expected,routes:{}};
  const build = await fetch('https://wesetup.ru/api/build-info', {signal:AbortSignal.timeout(30000),cache:'no-store'});
  if (!build.ok) throw new Error('Build endpoint HTTP '+build.status);
  result.build = await build.json();
  for (const route of ['/','/login','/register','/landing/screens/staff-neutral-desktop.webp','/landing/screens/staff-neutral-mobile.webp']) {
    const response = await fetch('https://wesetup.ru'+route,{signal:AbortSignal.timeout(30000),cache:'no-store'});
    result.routes[route] = response.status;
    if (!response.ok) throw new Error(route+' HTTP '+response.status);
    if(route==='/login') {
      const html = await response.text();
      result.loginCopy = {neutralHeading:html.includes('Электронные журналы для вашей организации'),medical:html.includes('Медцентры')};
      if(!Object.values(result.loginCopy).every(Boolean)) throw new Error('Live login copy mismatch');
    } else await response.body?.cancel();
  }
  fs.writeFileSync(path.join(__dirname,'production-probe.json'),JSON.stringify(result,null,2)+'\n');
  if (!expected.startsWith(result.build.buildId) || result.build.buildId==='dev') throw new Error('Unexpected serving build '+result.build.buildId);
  console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});
