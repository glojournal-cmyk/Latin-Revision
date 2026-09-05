const CACHE='latin-revision-v9-1-4-games-runtime-repair-20260905';
const APP_PREFIX='latin-revision-';
const CORE=['./','./index.html','./app.js','./question-bank.js','./manifest.webmanifest','./assets/games/victory.png','./assets/games/hero.png','./assets/games/match.png','./assets/games/gladiator.png','./assets/games/sentence.png','./assets/games/sprint.png','./assets/games/bronze.png','./assets/games/silver.png','./assets/games/gold.png','./assets/games/laurel.png','./assets/games/correct.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
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
