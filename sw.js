const CACHE='latin-revision-v9-20260905';
const APP_PREFIX='latin-revision-';
const ASSETS=['./','./index.html','./app.js','./question-bank.js','./manifest.webmanifest','./assets/hero-colosseum.png','./assets/daily-revision.png','./assets/word-bank.png','./assets/mistake-review.png','./assets/quick-quiz.png','./assets/grammar.png','./assets/vocabulary.png','./assets/translation.png','./assets/roman-world.png','./assets/laurel.png','./assets/trophy.png','./assets/next-colosseum.png','./icons/icon-192.png','./icons/icon-512.png'];

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
