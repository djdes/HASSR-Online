(async()=>{
const targets=await(await fetch('http://127.0.0.1:9229/json')).json();
if(!targets[0].title.includes('typescript'))throw Error('Unexpected target');
const ws=new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map();let pauseResolve;
const paused=new Promise(r=>pauseResolve=r);
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Debugger.paused')pauseResolve(m.params)});
const send=(method,params={})=>new Promise(r=>{const id=++seq;pending.set(id,r);ws.send(JSON.stringify({id,method,params}))});
await send('Debugger.enable');await send('Debugger.pause');const p=await paused;
const findings=[];
try {for(const frame of p.callFrames.slice(-60)){
 const result=await send('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'typeof node!=="undefined" && node ? (()=>{let p=node;while(p.parent)p=p.parent;return {file:p.fileName,code:p.text?.slice(node.pos,node.end).slice(0,300)}})() : typeof sourceFile!=="undefined" ? sourceFile?.fileName : undefined',returnByValue:true,silent:true});
 findings.push({fn:frame.functionName,file:result.result?.result?.value});
}} finally {await send('Debugger.resume')}
require('fs').writeFileSync('.agent/tasks/catalog-search-20261116/raw/typecheck-location.json',JSON.stringify(findings,null,2));console.log(findings);
await send('Runtime.evaluate',{expression:'setTimeout(()=>process.getBuiltinModule("inspector").close(),100)'});ws.close();
})().catch(e=>{console.error(e);process.exitCode=1});
