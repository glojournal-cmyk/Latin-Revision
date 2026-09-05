const CACHE='latin-revision-study-journal-v8-2-2-20260905';
const APP_PREFIX='latin-revision-';
const ASSETS=["./","./index.html","./app.js","./question-bank.js","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png","./assets/colosseum.png","./assets/hourglass.svg","./assets/notebook.svg","./assets/books.svg","./assets/scroll.svg","./assets/statue.svg","./assets/laurel.svg"];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key.startsWith(APP_PREFIX)&&key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  event.respondWith((async()=>{
    try{
      const response=await fetch(event.request);
      if(response && response.ok){
        const cache=await caches.open(CACHE);
        cache.put(event.request,response.clone()).catch(()=>{});
      }
      return response;
    }catch(error){
      const cached=await caches.match(event.request);
      if(cached) return cached;
      if(event.request.mode==='navigate'){
        const shell=await caches.match('./index.html');
        if(shell) return shell;
      }
      throw error;
    }
  })());
});
