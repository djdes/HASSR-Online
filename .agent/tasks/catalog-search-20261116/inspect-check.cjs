(async()=>{
 const targets=await (await fetch('http://127.0.0.1:9229/json')).json();
 if(!targets[0].title.includes('typescript')) throw Error('Unexpected inspector target');
 const ws=new WebSocket(targets[0].webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 const result=new Promise(r=>ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1)r(m.result.result.value)}));
 ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'({pid:process.pid,heap:process.getBuiltinModule("v8").getHeapStatistics()})',returnByValue:true}}));
 const value=await result;
 require('fs').writeFileSync('.agent/tasks/catalog-search-20261116/raw/typecheck-heap.json',JSON.stringify(value,null,2));
 console.log(value);
 ws.send(JSON.stringify({id:2,method:'Runtime.evaluate',params:{expression:'setTimeout(()=>process.getBuiltinModule("inspector").close(),100)'}}));
 ws.close();
})().catch(e=>{console.error(e);process.exitCode=1});
