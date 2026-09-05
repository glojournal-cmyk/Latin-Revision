const CACHE='latin-revision-v10-0-4-2-allgames-runtime-sound-20260905';
const CORE=["./", "./index.html", "./styles.css", "./app.js", "./question-bank.js", "./manifest.webmanifest", "./art_home.webp", "./art_lessons.webp", "./art_study.webp", "./lesson_bust.webp", "./lesson_books.webp", "./lesson_column.webp", "./lesson_laurel.webp", "./lesson_syntax.webp", "./roman_city.webp", "./vocab_family.webp", "./vocab_school.webp", "./vocab_daily.webp", "./vocab_travel.webp", "./vocab_roman.webp", "./game_match.webp", "./game_gladiator.webp", "./game_sentence.webp", "./game_sprint.webp", "./translation_scene.webp", "./tip_lamp.webp", "./pattern_book.webp", "./badge_first.webp", "./badge_quick.webp", "./badge_word.webp", "./badge_sentence.webp", "./badge_streak.webp", "./badge_trophy.webp", "./correct_sprig.webp", "./daisies.webp", "./wreath.webp", "./ivy_long.webp", "./laurel.webp", "./olive.webp", "./decor_column.webp", "./decor_pen.webp", "./decor_books.webp", "./decor_bust.webp", "./decor_lamp.webp", "./roman_skyline.webp"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET') return;
 event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});return response;})
 .catch(()=>caches.match(event.request).then(hit=>hit||caches.match('./index.html'))));
});
