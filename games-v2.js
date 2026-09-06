(() => {
  'use strict';

  const VERSION = '10.1.0';
  const PLAN_YEAR = 2026;
  const GAME_ORDER = ['forma', 'mosaic', 'verbum', 'manuscript'];

  const CONFIG = {
    forma: {
      title: 'Forma Forge',
      subtitle: 'Repair the form. Strengthen your Latin.',
      levels: [
        'Recognise components',
        'Stem + ending',
        'Similar endings',
        'Reduced labels',
        'Repair in context',
        'Mixed forge'
      ]
    },
    mosaic: {
      title: 'Sentence Mosaic',
      subtitle: 'Build · Practise · Understand',
      levels: [
        'Role-supported build',
        'Form-aware build',
        'Reduced labels',
        'Free sentence strip',
        'Morphology + syntax',
        'Context build'
      ]
    },
    verbum: {
      title: 'Verbum Match 2.0',
      subtitle: 'Forms · Meanings · Connections',
      levels: [
        'Recognise',
        'Reverse',
        'Form families',
        'Sort',
        'Grammar connections',
        'Mixed challenge'
      ]
    },
    manuscript: {
      title: 'Manuscript Mystery',
      subtitle: 'Investigate · Restore · Understand',
      levels: [
        'Case File I',
        'Case File II',
        'Case File III',
        'Case File IV',
        'Case File V',
        'Case File VI'
      ]
    }
  };

  const MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const PREP_WORDS = new Set(['a','ab','ad','ante','apud','circum','contra','cum','de','e','ex','in','inter','per','post','pro','sine','sub','trans']);
  const CLASS_LABELS = {noun:'Noun',verb:'Verb',preposition:'Preposition',adverb:'Adverb',adjective:'Adjective'};

  let session = null;
  let activeModule = null;
  let currentLevelSelectionGame = null;
  let dragState = null;

  const formaState = {};
  const mosaicState = {};
  const verbumState = {};
  const manuscriptState = {};

  function h(value){
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[ch]));
  }

  function norm(value){
    return String(value ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase()
      .replace(/[.,;:!?()[\]{}“”"'’]/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function nowISO(){
    return new Date().toISOString();
  }

  function planDate(day){
    const match=String(day||'').trim().match(/^(\d{1,2})\s+([A-Za-z]{3})$/);
    if(!match || !(match[2] in MONTHS)) return null;
    return new Date(PLAN_YEAR, MONTHS[match[2]], Number(match[1]), 12, 0, 0, 0);
  }

  function questionUnlocked(q){
    if(!q || !q.day) return false;

    const scheduled=planDate(q.day);
    const today=new Date();
    today.setHours(23,59,59,999);
    if(scheduled && scheduled<=today) return true;

    const cycle=state.cycles && state.cycles[q.day];
    if(cycle && (
      Number.isFinite(cycle.completedPercent) ||
      (Array.isArray(cycle.seen) && cycle.seen.length) ||
      (Array.isArray(cycle.reviewSeen) && cycle.reviewSeen.length)
    )) return true;

    const attempts=Array.isArray(state.attempts)?state.attempts:[];
    if(attempts.some(a=>a && (a.id===q.id || a.qid===q.id || a.questionId===q.id))) return true;

    return false;
  }

  function unlockedBank(){
    return bank.filter(questionUnlocked);
  }

  function sourceTrace(q){
    return {
      id:q.id,
      day:q.day,
      topic:q.topic || '',
      sourceRef:q.sourceRef || q.label || ''
    };
  }

  function skillForQuestion(q){
    const topic=String(q.topic||'').trim();
    const low=topic.toLowerCase();

    if(/^stage \d+ vocabulary$/.test(low)) return {
      id:'vocab:'+low.replace(/\s+/g,'-'),
      label:topic
    };
    if(low==='present person and number') return {id:'morph:present-person-number',label:'Present-tense endings'};
    if(low==='perfect cues') return {id:'morph:perfect-cues',label:'Perfect forms'};
    if(low==='prepositions') return {id:'grammar:preposition-case',label:'Prepositions + case'};
    if(low==='case functions') return {id:'grammar:case-functions',label:'Case functions'};
    if(low==='accusative forms') return {id:'morph:accusative-forms',label:'Accusative forms'};
    if(low.includes('set-text') || low.includes('restore the set text')){
      return {id:'settext:'+norm(q.sourceRef||q.label||topic)+':'+low.replace(/\s+/g,'-'),label:topic};
    }
    if(q.type==='lat_auto'){
      const tense=String(q.explain||'').match(/Tense:\s*([A-Za-z]+)/i);
      return {
        id:'sentence:'+(tense?tense[1].toLowerCase():'production'),
        label:tense?`${tense[1]} sentence building`:'Sentence building'
      };
    }
    return {id:'topic:'+low.replace(/\s+/g,'-'),label:topic || 'Latin recall'};
  }

  function clueFromQuestion(q, fallback='Look again at the form and the source-taught pattern.'){
    if(Array.isArray(q.steps)){
      const candidate=q.steps.find(step=>{
        const t=String(step||'');
        return t && !/correct choice|accepted form|complete answer|required answer|required source meaning/i.test(t);
      });
      if(candidate) return candidate;
    }
    if(q.mustRemember && !String(q.mustRemember).includes('→')) return q.mustRemember;
    if(q.explain && !/means\s+[“"]/i.test(String(q.explain))) return q.explain;
    return fallback;
  }

  function mustRememberFromQuestion(q){
    return q.mustRemember || q.explain || 'Check the exact source-taught form before moving on.';
  }

  function answerFromQuestion(q){
    if(q.a!==undefined && q.a!==null) return String(q.a);
    if(Array.isArray(q.accepted) && q.accepted.length) return String(q.accepted[0]);
    return String(q.answerExample||'');
  }

  function hashString(input){
    let hsh=2166136261>>>0;
    const text=String(input);
    for(let i=0;i<text.length;i++){
      hsh^=text.charCodeAt(i);
      hsh=Math.imul(hsh,16777619);
    }
    return hsh>>>0;
  }

  function mulberry32(seed){
    let a=seed>>>0;
    return function(){
      a|=0;
      a=a+0x6D2B79F5|0;
      let t=Math.imul(a^a>>>15,1|a);
      t=t+Math.imul(t^t>>>7,61|t)^t;
      return ((t^t>>>14)>>>0)/4294967296;
    };
  }

  function seededShuffle(array, salt=''){
    const copy=array.slice();
    const seed=(session?session.seed:hashString(todayKey())) ^ hashString(salt);
    const random=mulberry32(seed>>>0);
    for(let i=copy.length-1;i>0;i--){
      const j=Math.floor(random()*(i+1));
      [copy[i],copy[j]]=[copy[j],copy[i]];
    }
    return copy;
  }

  function todayKey(){
    const d=new Date();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const day=String(d.getDate()).padStart(2,'0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function ensureStore(){
    if(!state.gamesV2 || typeof state.gamesV2!=='object'){
      state.gamesV2={version:2,games:{},weakness:{},sessions:[],activeSession:null};
    }
    const store=state.gamesV2;
    store.version=2;
    store.games=store.games&&typeof store.games==='object'?store.games:{};
    store.weakness=store.weakness&&typeof store.weakness==='object'?store.weakness:{};
    store.sessions=Array.isArray(store.sessions)?store.sessions:[];

    GAME_ORDER.forEach(gameId=>{
      if(!store.games[gameId] || typeof store.games[gameId]!=='object'){
        store.games[gameId]={
          unlocked:1,
          bestStars:{},
          bestPoints:{},
          totalPoints:0,
          consecutive85:0,
          adaptiveTier:1,
          lastPlayed:null
        };
      }
      const p=store.games[gameId];
      p.unlocked=Math.max(1,Math.min(6,Number(p.unlocked)||1));
      p.bestStars=p.bestStars&&typeof p.bestStars==='object'?p.bestStars:{};
      p.bestPoints=p.bestPoints&&typeof p.bestPoints==='object'?p.bestPoints:{};
      p.totalPoints=Number(p.totalPoints)||0;
      p.consecutive85=Number(p.consecutive85)||0;
      p.adaptiveTier=Math.max(1,Math.min(6,Number(p.adaptiveTier)||1));
    });
    return store;
  }

  function gameProgress(gameId){
    return ensureStore().games[gameId];
  }

  function persist(){
    try{ save(); }catch(error){ console.error('Game progress save failed',error); }
  }

  function rememberWeakness(item, kind){
    if(!item || !item.skillId) return;
    const store=ensureStore();
    const entry=store.weakness[item.skillId] || {
      label:item.skillLabel || item.skillId,
      seen:0,
      wrong:0,
      repaired:0,
      recentWrong:false,
      lastSeen:null,
      day:item.day||null,
      sourceRef:item.sourceRef||''
    };

    if(kind==='seen') entry.seen++;
    if(kind==='wrong'){
      entry.wrong++;
      entry.recentWrong=true;
    }
    if(kind==='repaired') entry.repaired++;
    if(kind==='echo-correct') entry.recentWrong=false;

    entry.label=item.skillLabel || entry.label;
    entry.day=item.day || entry.day;
    entry.sourceRef=item.sourceRef || entry.sourceRef;
    entry.lastSeen=nowISO();
    store.weakness[item.skillId]=entry;
  }

  function ensureSkillStat(item){
    const key=item.skillId||'general';
    if(!session.skillStats[key]){
      session.skillStats[key]={
        label:item.skillLabel||key,
        seen:0,
        firstCorrect:0,
        repaired:0,
        wrong:0,
        day:item.day||null
      };
    }
    return session.skillStats[key];
  }

  function createSession(gameId, level){
    const progress=gameProgress(gameId);
    const sessionIndex=ensureStore().sessions.filter(s=>s.gameId===gameId).length;
    const seed=hashString(`${todayKey()}|${gameId}|${level}|${sessionIndex}`);
    session={
      id:`${gameId}-${Date.now()}`,
      gameId,
      level,
      seed,
      startedAt:nowISO(),
      points:0,
      combo:0,
      maxCombo:0,
      shields:3,
      clues:0,
      firstCorrect:0,
      repaired:0,
      normalResolved:0,
      target:0,
      echoResolved:0,
      inEcho:false,
      echoQueue:[],
      echoIndex:0,
      itemAttempts:{},
      itemClueUsed:{},
      skillStats:{},
      echoSkills:new Set(),
      retestQueue:[],
      usedSourceIds:new Set(),
      pickCounter:0,
      adaptiveTier:progress.adaptiveTier,
      stageLabel:'',
      lastOutcome:null
    };
    ensureStore().activeSession={
      gameId,level,seed,startedAt:session.startedAt,version:VERSION
    };
    persist();
    updateHUD();
    return session;
  }

  function setTarget(count){
    session.target=Math.max(1,Number(count)||1);
    updateHUD();
  }

  function markUsed(item){
    if(!item) return;
    const ids=item.sourceIds || (item.sourceId?[item.sourceId]:[]);
    ids.forEach(id=>session.usedSourceIds.add(String(id)));
  }

  function preferredSkill(){
    const due=session.retestQueue.find(entry=>!entry.used && entry.dueAt<=session.normalResolved);
    return due?due.skillId:null;
  }

  function pickItem(pool, salt='pick'){
    if(!Array.isArray(pool) || !pool.length) return null;
    session.pickCounter++;

    const preferred=preferredSkill();
    let candidates=pool.filter(item=>{
      const ids=item.sourceIds || (item.sourceId?[item.sourceId]:[]);
      return !ids.some(id=>session.usedSourceIds.has(String(id)));
    });
    if(!candidates.length) candidates=pool.slice();

    if(preferred){
      const same=candidates.filter(item=>item.skillId===preferred);
      if(same.length) candidates=same;
    }else{
      const weakness=ensureStore().weakness;
      const weighted=candidates.filter(item=>weakness[item.skillId] && weakness[item.skillId].recentWrong);
      if(weighted.length && session.pickCounter%3===0) candidates=weighted;
    }

    const shuffled=seededShuffle(candidates,`${salt}-${session.pickCounter}`);
    const item=shuffled[0]||null;
    if(item){
      markUsed(item);
      if(preferred){
        const queued=session.retestQueue.find(entry=>!entry.used && entry.skillId===preferred && entry.dueAt<=session.normalResolved);
        if(queued) queued.used=true;
      }
    }
    return item;
  }

  function scheduleRetest(item){
    if(!item || !item.skillId) return;
    const offset=3+(hashString(item.id)%3);
    session.retestQueue.push({
      skillId:item.skillId,
      dueAt:session.normalResolved+offset,
      sourceId:item.sourceId||item.id,
      used:false
    });
  }

  function submit(item, correct, {echo=false}={}){
    markUsed(item);
    const key=String(item.id);
    const attempts=Number(session.itemAttempts[key]||0);
    const stat=ensureSkillStat(item);

    if(correct){
      const firstTry=attempts===0;
      const repaired=attempts===1;
      let added=0;

      if(echo){
        added=firstTry?40:25;
      }else if(firstTry){
        const cluePenalty=session.itemClueUsed[key]?20:0;
        const comboBonus=Math.min(20,session.combo*5);
        added=Math.max(60,100-cluePenalty+comboBonus);
        session.firstCorrect++;
        session.combo++;
        session.maxCombo=Math.max(session.maxCombo,session.combo);
      }else if(repaired){
        added=60;
        session.repaired++;
      }else{
        added=20;
      }

      session.points+=added;
      stat.seen++;
      if(firstTry) stat.firstCorrect++;
      if(repaired) stat.repaired++;
      rememberWeakness(item,'seen');
      if(repaired) rememberWeakness(item,'repaired');
      if(echo && firstTry) rememberWeakness(item,'echo-correct');

      if(echo) session.echoResolved++;
      else session.normalResolved++;

      session.lastOutcome=repaired?'repaired':'correct';
      persistActiveSummary();
      updateHUD(repaired?'Good repair.':'Correct.');

      return {state:repaired?'repaired':'correct',points:added};
    }

    const nextAttempts=attempts+1;
    session.itemAttempts[key]=nextAttempts;
    session.combo=0;
    stat.wrong++;
    rememberWeakness(item,'wrong');

    if(nextAttempts===1){
      if(!session.itemClueUsed[key]){
        session.itemClueUsed[key]=true;
        session.clues++;
      }
      scheduleRetest(item);
      session.echoSkills.add(item.skillId);
      session.lastOutcome='repair';
      persistActiveSummary();
      updateHUD('Repair attempt — use the clue, then try again.');
      return {
        state:'repair',
        clue:item.clue || 'Check the source-taught form and try the same skill again.'
      };
    }

    session.shields=Math.max(0,session.shields-1);
    stat.seen++;
    rememberWeakness(item,'seen');
    session.echoSkills.add(item.skillId);
    if(echo) session.echoResolved++;
    else session.normalResolved++;

    session.lastOutcome='reveal';
    persistActiveSummary();
    updateHUD('Look again at the source-taught pattern.');

    return {
      state:'reveal',
      answer:item.answerDisplay || '',
      mustRemember:item.mustRemember || 'Check the exact source form.'
    };
  }

  function requestClue(item){
    const key=String(item.id);
    if(!session.itemClueUsed[key]){
      session.itemClueUsed[key]=true;
      session.clues++;
      persistActiveSummary();
    }
    updateHUD('Clue requested.');
    return item.clue || 'Look again at the source-taught pattern.';
  }

  function persistActiveSummary(){
    const store=ensureStore();
    store.activeSession={
      gameId:session.gameId,
      level:session.level,
      seed:session.seed,
      startedAt:session.startedAt,
      points:session.points,
      normalResolved:session.normalResolved,
      target:session.target,
      clues:session.clues,
      version:VERSION
    };
    persist();
  }

  function accuracy(){
    if(!session || !session.target) return 0;
    // A successful repair demonstrates partial recovery, so it contributes 60%.
    // This mirrors the repaired Game Points rule while keeping first-try success more valuable.
    const recovered=session.firstCorrect + session.repaired*0.6;
    return Math.max(0,Math.min(100,Math.round(recovered/session.target*100)));
  }

  function starsFor(acc){
    if(acc<70) return 0;
    if(acc>=90 && session.clues<=1) return 3;
    if(acc>=85) return 2;
    return 1;
  }

  function updateProgressOnFinish(){
    const store=ensureStore();
    const p=gameProgress(session.gameId);
    const acc=accuracy();
    const stars=starsFor(acc);
    const completed=acc>=70;
    const unlockThreshold=session.gameId==='manuscript'?85:80;
    const unlockedNext=acc>=unlockThreshold && session.level<6;

    p.bestStars[session.level]=Math.max(Number(p.bestStars[session.level])||0,stars);
    p.bestPoints[session.level]=Math.max(Number(p.bestPoints[session.level])||0,session.points);
    p.totalPoints+=session.points;
    p.lastPlayed=nowISO();

    if(unlockedNext){
      p.unlocked=Math.max(p.unlocked,session.level+1);
    }

    if(acc>=85){
      p.consecutive85++;
      if(p.consecutive85>=2){
        p.adaptiveTier=Math.min(6,p.adaptiveTier+1);
        p.consecutive85=0;
      }
    }else{
      p.consecutive85=0;
    }

    const summary={
      gameId:session.gameId,
      level:session.level,
      accuracy:acc,
      points:session.points,
      stars,
      clues:session.clues,
      completed,
      strongest:strongestSkill(),
      needs:weakestSkills(2),
      date:nowISO()
    };
    store.sessions.push(summary);
    if(store.sessions.length>60) store.sessions=store.sessions.slice(-60);
    store.activeSession=null;
    persist();
    return summary;
  }

  function strongestSkill(){
    const values=Object.values(session.skillStats);
    if(!values.length) return {label:'No completed skill yet',day:null};
    values.sort((a,b)=>{
      const ar=a.seen?(a.firstCorrect+a.repaired*.6)/a.seen:0;
      const br=b.seen?(b.firstCorrect+b.repaired*.6)/b.seen:0;
      return br-ar || b.seen-a.seen;
    });
    return {label:values[0].label,day:values[0].day};
  }

  function weakestSkills(limit=2){
    const values=Object.values(session.skillStats)
      .filter(stat=>stat.wrong>0)
      .sort((a,b)=>b.wrong-a.wrong || a.firstCorrect-b.firstCorrect)
      .slice(0,limit)
      .map(stat=>({label:stat.label,day:stat.day,wrong:stat.wrong}));
    return values;
  }

  function buildEchoQueue(){
    const skills=Array.from(session.echoSkills);
    if(!skills.length) return [];
    const due=session.retestQueue
      .filter(item=>item.skillId)
      .sort((a,b)=>a.dueAt-b.dueAt)
      .map(item=>item.skillId);
    const merged=[];
    [...due,...skills].forEach(skill=>{
      if(skill && !merged.includes(skill)) merged.push(skill);
    });
    if(merged.length===1) return [merged[0],merged[0]];
    return merged.slice(0,Math.min(4,merged.length));
  }

  function continueAfterResolved(module){
    if(session.inEcho){
      session.echoIndex++;
      if(session.echoIndex>=session.echoQueue.length){
        return showResult();
      }
      return module.renderEcho(session.echoQueue[session.echoIndex]);
    }

    if(session.normalResolved>=session.target){
      const echo=buildEchoQueue();
      if(echo.length){
        session.inEcho=true;
        session.echoQueue=echo;
        session.echoIndex=0;
        updateHUD('Echo Round — one last look at today’s tricky patterns.');
        return module.renderEcho(echo[0]);
      }
      return showResult();
    }
    return module.next();
  }

  function showResult(){
    const summary=updateProgressOnFinish();
    const config=CONFIG[session.gameId];
    const needs=summary.needs;
    const reviewDay=(needs.find(item=>item.day)||summary.strongest||{}).day;
    const stars='★'.repeat(summary.stars)+'☆'.repeat(3-summary.stars);
    const tryNext=gameProgress(session.gameId).unlocked>session.level && session.level<6;

    area().innerHTML=`
      <section class="g2-result parchment-card">
        <div class="eyebrow">SESSION COMPLETE</div>
        <h2>${h(summary.completed?'Level complete':'Good practice — build it once more')}</h2>
        <div class="g2-result-grid">
          <div><span>Accuracy</span><strong>${summary.accuracy}%</strong></div>
          <div><span>Game Points</span><strong>${summary.points.toLocaleString()}</strong></div>
          <div><span>Stars</span><strong class="g2-stars">${stars}</strong></div>
        </div>
        <div class="g2-result-skills">
          <div><span>Strongest skill</span><strong>${h(summary.strongest.label)}</strong></div>
          <div><span>Needs another look</span>${
            needs.length
              ? `<ol>${needs.map(x=>`<li>${h(x.label)}</li>`).join('')}</ol>`
              : '<strong>No repeated weakness in this session.</strong>'
          }</div>
        </div>
        <p class="g2-result-note">Game mistakes stayed inside the game layer and did not change formal Mastery or scheduled review.</p>
        <div class="g2-result-actions">
          <button class="secondaryButton" type="button" data-g2-result="again">Play again</button>
          ${tryNext?'<button class="primaryButton" type="button" data-g2-result="next">Try next level →</button>':''}
          ${reviewDay?'<button class="secondaryButton" type="button" data-g2-result="note">Review note</button>':''}
          <button class="secondaryButton" type="button" data-g2-result="games">Games</button>
        </div>
      </section>`;

    area().querySelector('[data-g2-result="again"]')?.addEventListener('click',()=>startLevel(session.gameId,session.level));
    area().querySelector('[data-g2-result="next"]')?.addEventListener('click',()=>startLevel(session.gameId,session.level+1));
    area().querySelector('[data-g2-result="games"]')?.addEventListener('click',openHub);
    area().querySelector('[data-g2-result="note"]')?.addEventListener('click',()=>{
      if(reviewDay && typeof openNotes==='function') openNotes(reviewDay);
    });

    playTone('complete');
    renderHubProgress();
  }

  function area(){
    return document.getElementById('gameArea');
  }

  function updateHUD(message){
    const gameId=session?session.gameId:currentLevelSelectionGame;
    const level=session?session.level:1;
    const progress=gameId?gameProgress(gameId):null;

    const levelEl=document.getElementById('gameLevel');
    const pointsEl=document.getElementById('gamePoints');
    const streakEl=document.getElementById('gameStreak');
    const shieldsEl=document.getElementById('gameShields');
    const dotsEl=document.getElementById('gameLevelDots');
    const bar=document.getElementById('gameProgressFill');
    const mood=document.getElementById('gameMood');
    const sound=document.getElementById('gameSoundButton');

    if(levelEl) levelEl.textContent=`Level ${level} / 6`;
    if(pointsEl) pointsEl.textContent=String(session?session.points:0);
    if(streakEl) streakEl.textContent=String(session?session.combo:0);

    const shields=session?session.shields:3;
    if(shieldsEl){
      shieldsEl.textContent='◆ '.repeat(shields)+'◇ '.repeat(Math.max(0,3-shields));
      shieldsEl.setAttribute('aria-label',`${shields} focus shield${shields===1?'':'s'} remaining`);
    }

    if(dotsEl){
      const unlocked=progress?progress.unlocked:1;
      dotsEl.innerHTML=Array.from({length:6},(_,i)=>{
        const num=i+1;
        const cls=num<level?'done':num===level?'current':num<=unlocked?'open':'locked';
        return `<i class="${cls}"></i>`;
      }).join('');
    }

    if(bar){
      const pct=session && session.target
        ? Math.min(100,(session.normalResolved/session.target)*100)
        : 0;
      bar.style.width=`${pct}%`;
    }

    if(mood && message) mood.textContent=message;
    if(sound) sound.textContent=state.settings && state.settings.sound===false?'♩ Sound off':'♪ Soft sound';
  }

  function setHeader(gameId, level){
    const cfg=CONFIG[gameId];
    const title=document.getElementById('gameTitle');
    const subtitle=document.getElementById('gameSubtitle');
    if(title) title.textContent=cfg.title;
    if(subtitle) subtitle.textContent=level?`${cfg.levels[level-1]} · ${cfg.subtitle}`:cfg.subtitle;
  }

  function openHub(){
    currentLevelSelectionGame=null;
    session=null;
    activeModule=null;
    show('gamesHub');
    setNavActive('practice');
    renderHubProgress();
  }

  function exit(){
    ensureStore().activeSession=null;
    persist();
    openHub();
  }

  function start(gameId){
    if(!CONFIG[gameId]) return showGameError(`Unknown game: ${gameId}`);
    currentLevelSelectionGame=gameId;
    show('gamePlay');
    setNavActive('practice');
    setHeader(gameId,null);
    renderLevelSelect(gameId);
  }

  function renderHubProgress(){
    ensureStore();
    document.querySelectorAll('[data-game-summary]').forEach(el=>{
      const gameId=el.dataset.gameSummary;
      const p=gameProgress(gameId);
      const stars=Object.values(p.bestStars).reduce((sum,n)=>sum+(Number(n)||0),0);
      el.textContent=`Level ${p.unlocked} / 6 unlocked · ${stars} star${stars===1?'':'s'} earned`;
    });
  }

  function contentAvailable(gameId, level){
    try{
      const module=MODULES[gameId];
      return module && module.available(level);
    }catch(error){
      console.error('Game availability check failed',gameId,level,error);
      return false;
    }
  }

  function renderLevelSelect(gameId){
    const cfg=CONFIG[gameId];
    const p=gameProgress(gameId);
    setHeader(gameId,null);
    session=null;
    updateHUD('Choose a level. Teacher-covered content is checked before play.');

    area().innerHTML=`
      <section class="g2-level-select parchment-card">
        <div class="eyebrow">LEVEL SELECT</div>
        <h2>${h(cfg.title)}</h2>
        <p>Levels unlock from real game results. Content that has not reached its teacher-covered date remains unavailable.</p>
        <div class="g2-level-grid">
          ${cfg.levels.map((name,index)=>{
            const level=index+1;
            const progressLocked=level>p.unlocked;
            const contentLocked=!contentAvailable(gameId,level);
            const locked=progressLocked||contentLocked;
            const stars=Number(p.bestStars[level])||0;
            const best=Number(p.bestPoints[level])||0;
            return `<button class="g2-level-card ${locked?'locked':''}" type="button" data-g2-level="${level}" ${locked?'disabled':''}>
              <div class="g2-level-card-top"><span>Level ${level}</span><strong>${'★'.repeat(stars)}${'☆'.repeat(3-stars)}</strong></div>
              <h3>${h(name)}</h3>
              <p>${contentLocked?'Teacher content not yet unlocked.':progressLocked?'Clear earlier learning to unlock this level.':'Ready to play.'}</p>
              <small>${best?`Best Game Points: ${best}`:'No completed score yet'}</small>
            </button>`;
          }).join('')}
        </div>
      </section>`;

    area().querySelectorAll('[data-g2-level]').forEach(button=>{
      button.addEventListener('click',()=>startLevel(gameId,Number(button.dataset.g2Level)));
    });
  }

  function startLevel(gameId, level){
    const p=gameProgress(gameId);
    if(level<1 || level>6 || level>p.unlocked) return renderLevelSelect(gameId);
    if(!contentAvailable(gameId,level)){
      return showGameError('This level needs teacher-covered content that is not unlocked yet.');
    }

    ensureAudio();
    playTone('paper');
    createSession(gameId,level);
    setHeader(gameId,level);
    activeModule=MODULES[gameId];

    try{
      activeModule.start(level);
    }catch(error){
      console.error('Game start failed',gameId,level,error);
      showGameError(error.message||String(error));
    }
  }

  function showGameError(message){
    const box=area();
    if(!box) return;
    box.innerHTML=`<section class="g2-error parchment-card"><h2>Game needs a refresh</h2><p>${h(message)}</p><button class="secondaryButton" type="button" data-g2-error-back>Back to Games</button></section>`;
    box.querySelector('[data-g2-error-back]')?.addEventListener('click',openHub);
  }

  function feedbackSlot(){
    return document.querySelector('#gameArea .g2-feedback-slot');
  }

  function clueSlot(){
    return document.querySelector('#gameArea .g2-clue-slot');
  }

  function renderOutcome(outcome, item, onContinue, revealFn){
    const slot=feedbackSlot();
    if(!slot) return;

    if(outcome.state==='repair'){
      slot.innerHTML=`<div class="g2-repair-feedback repair"><strong>Repair attempt</strong><p>${h(outcome.clue)}</p><small>The answer stays hidden. Try the same item once more.</small></div>`;
      slot.setAttribute('aria-live','polite');
      return;
    }

    if(outcome.state==='reveal'){
      if(typeof revealFn==='function') revealFn();
      const activeSlot=feedbackSlot();
      if(!activeSlot) return;
      activeSlot.innerHTML=`<div class="g2-repair-feedback reveal"><strong>Look again.</strong><p><b>Correct answer:</b> ${h(outcome.answer)}</p><p><b>Must remember:</b> ${h(outcome.mustRemember)}</p><button class="primaryButton" type="button" data-g2-continue>Continue →</button></div>`;
      activeSlot.querySelector('[data-g2-continue]')?.addEventListener('click',onContinue);
      return;
    }

    const label=outcome.state==='repaired'?'Good repair.':'Correct.';
    slot.innerHTML=`<div class="g2-repair-feedback success"><strong>${label}</strong><p>+${outcome.points} Game Points</p><button class="primaryButton" type="button" data-g2-continue>Continue →</button></div>`;
    slot.querySelector('[data-g2-continue]')?.addEventListener('click',onContinue);
    playTone(outcome.state==='repaired'?'match':'correct');
  }

  function wireClue(item, applyClue){
    const button=document.querySelector('#gameArea [data-g2-clue]');
    if(!button) return;
    button.addEventListener('click',()=>{
      const clue=requestClue(item);
      const slot=clueSlot();
      if(slot) slot.innerHTML=`<div class="g2-clue-card"><strong>Clue</strong><p>${h(clue)}</p></div>`;
      if(typeof applyClue==='function') applyClue();
      playTone('paper');
    });
  }

  function sourcePill(item){
    const trace=(item.sourceTraces||[])[0];
    if(!trace) return '';
    return `<span class="g2-source-pill">${h(trace.day||'')} · ${h(trace.topic||trace.sourceRef||'Teacher source')}</span>`;
  }

  function stageRail(steps,currentIndex){
    return `<ol class="g2-stage-rail">${steps.map((step,index)=>{
      const cls=index<currentIndex?'done':index===currentIndex?'active':'';
      return `<li class="${cls}"><span>${index+1}</span><div><strong>${h(step.title)}</strong><small>${h(step.note||'')}</small></div></li>`;
    }).join('')}</ol>`;
  }

  function parchmentShell({rail,main,aside='',tray='',className=''}){
    return `<div class="g2-workspace ${className}">
      <aside class="g2-left-rail">${rail}</aside>
      <main class="g2-main-board parchment-card">${main}</main>
      ${aside?`<aside class="g2-right-aside">${aside}</aside>`:''}
      ${tray?`<section class="g2-evidence-tray">${tray}</section>`:''}
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Shared drag + tap layer
  // ---------------------------------------------------------------------------
  function wireDrag(container, onDrop){
    if(!container) return;
    let selectedTileId=null;

    function setSelected(tile){
      container.querySelectorAll('[data-g2-tile].selected').forEach(el=>el.classList.remove('selected'));
      if(!tile){selectedTileId=null;return;}
      selectedTileId=tile.dataset.g2Tile;
      tile.classList.add('selected');
      playTone('tile');
    }

    container.querySelectorAll('[data-g2-tile]').forEach(tile=>{
      tile.setAttribute('draggable','true');

      tile.addEventListener('click',event=>{
        if(tile.disabled) return;
        event.preventDefault();
        setSelected(tile.classList.contains('selected')?null:tile);
      });

      tile.addEventListener('dragstart',event=>{
        if(tile.disabled) return;
        event.dataTransfer.setData('text/plain',tile.dataset.g2Tile);
        event.dataTransfer.effectAllowed='move';
        tile.classList.add('dragging');
      });

      tile.addEventListener('dragend',()=>tile.classList.remove('dragging'));

      tile.addEventListener('pointerdown',event=>{
        if(tile.disabled || event.pointerType==='mouse') return;
        dragState={
          pointerId:event.pointerId,
          tileId:tile.dataset.g2Tile,
          startX:event.clientX,
          startY:event.clientY,
          active:false,
          ghost:null
        };
        tile.setPointerCapture?.(event.pointerId);
      });

      tile.addEventListener('pointermove',event=>{
        if(!dragState || dragState.pointerId!==event.pointerId) return;
        const dx=event.clientX-dragState.startX;
        const dy=event.clientY-dragState.startY;
        if(!dragState.active && Math.hypot(dx,dy)>10){
          dragState.active=true;
          const ghost=tile.cloneNode(true);
          ghost.classList.add('g2-drag-ghost');
          ghost.removeAttribute('id');
          document.body.appendChild(ghost);
          dragState.ghost=ghost;
        }
        if(dragState.active){
          event.preventDefault();
          dragState.ghost.style.left=`${event.clientX}px`;
          dragState.ghost.style.top=`${event.clientY}px`;
        }
      });

      function finishPointer(event){
        if(!dragState || dragState.pointerId!==event.pointerId) return;
        if(dragState.active){
          event.preventDefault();
          const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-g2-drop]');
          if(target && container.contains(target)){
            onDrop(dragState.tileId,target.dataset.g2Drop,target);
          }
        }
        dragState.ghost?.remove();
        dragState=null;
      }

      tile.addEventListener('pointerup',finishPointer);
      tile.addEventListener('pointercancel',event=>{
        if(dragState && dragState.pointerId===event.pointerId){
          dragState.ghost?.remove();
          dragState=null;
        }
      });
    });

    container.querySelectorAll('[data-g2-drop]').forEach(zone=>{
      zone.addEventListener('dragover',event=>{
        event.preventDefault();
        zone.classList.add('drag-over');
      });
      zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
      zone.addEventListener('drop',event=>{
        event.preventDefault();
        zone.classList.remove('drag-over');
        const id=event.dataTransfer.getData('text/plain');
        if(id) onDrop(id,zone.dataset.g2Drop,zone);
      });
      zone.addEventListener('click',event=>{
        const selected=container.querySelector('[data-g2-tile].selected');
        const activeId=selected?.dataset.g2Tile || selectedTileId;
        if(!activeId) return;
        event.preventDefault();
        onDrop(activeId,zone.dataset.g2Drop,zone);
        setSelected(null);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Content transformation helpers — all output derives from source-locked bank.
  // ---------------------------------------------------------------------------
  function longestCommonPrefix(words){
    if(!words.length) return '';
    let prefix=words[0];
    for(let i=1;i<words.length;i++){
      while(prefix && !words[i].startsWith(prefix)) prefix=prefix.slice(0,-1);
      if(!prefix) break;
    }
    return prefix;
  }

  function presentFormItems(){
    const qs=unlockedBank().filter(q=>q.topic==='Present person and number' && q.type==='mc');
    const groups=new Map();

    qs.forEach(q=>{
      const context=String(q.context||'');
      const form=context.split('—')[0].trim();
      const model=context.match(/model:\s*([A-Za-zāēīōūȳ]+)\s*\(([^)]+)\)/i);
      if(!form || !model) return;
      const key=model[1].toLowerCase();
      if(!groups.has(key)) groups.set(key,{lemma:model[1],meaning:model[2],rows:[]});
      groups.get(key).rows.push({q,form});
    });

    const out=[];
    groups.forEach(group=>{
      const stem=longestCommonPrefix(group.rows.map(r=>r.form));
      if(stem.length<2) return;
      const endings=group.rows.map(r=>r.form.slice(stem.length)).filter(Boolean);
      group.rows.forEach(row=>{
        const ending=row.form.slice(stem.length);
        if(!ending) return;
        const meaningMatch=String(row.q.explain||'').match(/means\s+[“"]([^”"]+)[”"]/i);
        const skill=skillForQuestion(row.q);
        out.push({
          id:`forma:${row.q.id}`,
          sourceId:row.q.id,
          sourceIds:[row.q.id],
          sourceTraces:[sourceTrace(row.q)],
          day:row.q.day,
          sourceRef:row.q.sourceRef,
          skillId:skill.id,
          skillLabel:skill.label,
          kind:'verb',
          q:row.q,
          stem,
          ending,
          target:row.form,
          model:group.lemma,
          modelMeaning:group.meaning,
          personNumber:String(row.q.a||''),
          meaning:meaningMatch?meaningMatch[1]:'',
          siblingEndings:Array.from(new Set(endings)),
          clue:`Check the ending for ${String(row.q.a||'this person and number')}.`,
          mustRemember:mustRememberFromQuestion(row.q),
          answerDisplay:row.form
        });
      });
    });
    return out;
  }

  function accusativeForgeItems(){
    return unlockedBank()
      .filter(q=>q.topic==='Accusative forms' && q.type==='mc' && q.a)
      .map(q=>{
        const skill=skillForQuestion(q);
        return {
          id:`forma:${q.id}`,
          sourceId:q.id,
          sourceIds:[q.id],
          sourceTraces:[sourceTrace(q)],
          day:q.day,
          sourceRef:q.sourceRef,
          skillId:skill.id,
          skillLabel:skill.label,
          kind:'noun',
          q,
          target:String(q.a),
          choices:(q.opts||[]).map(String),
          clue:clueFromQuestion(q,'Think about the case needed for the direct object.'),
          mustRemember:mustRememberFromQuestion(q),
          answerDisplay:String(q.a)
        };
      });
  }

  function sentenceItems(){
    return unlockedBank()
      .filter(q=>q.type==='lat_auto' && Array.isArray(q.latinGroups) && q.latinGroups.length>=2)
      .map(q=>{
        const skill=skillForQuestion(q);
        return {
          id:`mosaic:${q.id}`,
          sourceId:q.id,
          sourceIds:[q.id],
          sourceTraces:[sourceTrace(q)],
          day:q.day,
          sourceRef:q.sourceRef,
          skillId:skill.id,
          skillLabel:skill.label,
          q,
          clue:clueFromQuestion(q,'Check every required form and the role it is doing.'),
          mustRemember:mustRememberFromQuestion(q),
          answerDisplay:q.answerExample || answerFromQuestion(q)
        };
      });
  }

  function vocabPairItems(maxStage=12){
    const out=[];
    const seen=new Set();
    unlockedBank().forEach(q=>{
      if(q.type!=='exact_any' || q.direction!=='Latin → English') return;
      const match=String(q.topic||'').match(/^Stage\s+(\d+)\s+vocabulary$/i);
      if(!match || Number(match[1])>maxStage) return;
      const latin=String(q.context||'').trim();
      const english=String((q.accepted&&q.accepted[0])||q.answerExample||'').trim();
      if(!latin || !english) return;
      const key=norm(latin)+'|'+norm(english);
      if(seen.has(key)) return;
      seen.add(key);
      const skill=skillForQuestion(q);
      out.push({
        id:`verbum:vocab:${q.id}`,
        sourceId:q.id,
        sourceIds:[q.id],
        sourceTraces:[sourceTrace(q)],
        day:q.day,
        sourceRef:q.sourceRef,
        skillId:skill.id,
        skillLabel:skill.label,
        latin,
        english,
        clue:clueFromQuestion(q,'Use the grammar clue attached to this learned word.'),
        mustRemember:mustRememberFromQuestion(q),
        answerDisplay:`${latin} → ${english}`,
        q
      });
    });
    return out;
  }

  function perfectPairItems(){
    return unlockedBank()
      .filter(q=>q.topic==='Perfect cues' && q.direction==='Present cue → perfect cue')
      .map(q=>{
        const present=String(q.context||'').split(/\s/)[0].trim();
        const perfect=answerFromQuestion(q);
        if(!present || !perfect) return null;
        const skill=skillForQuestion(q);
        return {
          id:`verbum:perfect:${q.id}`,
          sourceId:q.id,
          sourceIds:[q.id],
          sourceTraces:[sourceTrace(q)],
          day:q.day,
          sourceRef:q.sourceRef,
          skillId:skill.id,
          skillLabel:skill.label,
          left:present,
          right:perfect,
          clue:clueFromQuestion(q,'Use the learned perfect cue; do not invent a pattern.'),
          mustRemember:mustRememberFromQuestion(q),
          answerDisplay:`${present} → ${perfect}`,
          q
        };
      })
      .filter(Boolean);
  }

  function wordClassItems(){
    const out=[];
    const seen=new Set();
    unlockedBank().forEach(q=>{
      if(q.type!=='exact_any' || q.direction!=='Latin → English') return;
      const form=String(q.context||'').split(',')[0].trim();
      if(!form || form.includes(' ')) return;

      const explanation=String(q.explain||'').toLowerCase();
      let wordClass='';
      if(/\bnoun\b/.test(explanation)) wordClass='noun';
      else if(/\bpreposition\b/.test(explanation)) wordClass='preposition';
      else if(/\b(?:irregular\s+)?verb\b/.test(explanation)) wordClass='verb';
      else if(/\badverb\b/.test(explanation)) wordClass='adverb';
      else if(/\badjective\b/.test(explanation)) wordClass='adjective';
      if(!wordClass) return;

      const key=norm(form)+'|'+wordClass;
      if(seen.has(key)) return;
      seen.add(key);
      const skill=skillForQuestion(q);
      out.push({
        id:`verbum:class:${q.id}`,
        sourceId:q.id,
        sourceIds:[q.id],
        sourceTraces:[sourceTrace(q)],
        day:q.day,
        sourceRef:q.sourceRef,
        skillId:'word-class:'+wordClass,
        skillLabel:`${CLASS_LABELS[wordClass]} recognition`,
        form,
        wordClass,
        clue:'Think about how this entry was labelled in the teacher vocabulary table.',
        mustRemember:mustRememberFromQuestion(q),
        answerDisplay:`${form} — ${CLASS_LABELS[wordClass]}`,
        q
      });
    });
    return out;
  }

  function prepCaseItems(){
    return unlockedBank()
      .filter(q=>q.topic==='Prepositions' && q.type==='mc' && /Which case is required/i.test(String(q.q||'')))
      .map(q=>{
        const prep=String(q.context||'').split('=')[0].trim();
        const skill=skillForQuestion(q);
        return {
          id:`verbum:prep:${q.id}`,
          sourceId:q.id,
          sourceIds:[q.id],
          sourceTraces:[sourceTrace(q)],
          day:q.day,
          sourceRef:q.sourceRef,
          skillId:skill.id,
          skillLabel:skill.label,
          prep,
          caseName:String(q.a||''),
          clue:clueFromQuestion(q,'Check the case that was learned with this preposition.'),
          mustRemember:mustRememberFromQuestion(q),
          answerDisplay:`${prep} + ${String(q.a||'')}`,
          q
        };
      })
      .filter(item=>item.prep && item.caseName);
  }

  function setTextBundles(){
    const allowed=new Set(['ad urbem','ad villam paragraphs 1–3','ad villam paragraphs 4–6']);
    const source=unlockedBank().filter(q=>allowed.has(q.sourceRef));
    const refs={};
    source.forEach(q=>{
      if(!refs[q.sourceRef]) refs[q.sourceRef]={sourceRef:q.sourceRef,all:[],translations:[],restores:[],grammar:[],comprehension:[]};
      const bucket=refs[q.sourceRef];
      bucket.all.push(q);
      if(q.topic==='Set-text translation') bucket.translations.push(q);
      if(q.topic==='Restore the set text') bucket.restores.push(q);
      if(q.topic==='Set-text grammar' || q.topic==='Set-text verb tense') bucket.grammar.push(q);
      if(q.topic==='Set-text comprehension') bucket.comprehension.push(q);
    });
    return refs;
  }

  function normalizedSentence(text){
    return norm(String(text||'').split(/\nFocus(?: verb)?:/i)[0]);
  }

  function buildCaseFile(level){
    const refByLevel=[
      'ad urbem','ad urbem',
      'ad villam paragraphs 1–3','ad villam paragraphs 1–3',
      'ad villam paragraphs 4–6','ad villam paragraphs 4–6'
    ];
    const ref=refByLevel[level-1];
    const bundles=setTextBundles();
    const bundle=bundles[ref];
    if(!bundle) return null;

    const offset=level%2===0?3:0;
    const translations=bundle.translations.slice(offset,offset+4).length>=3
      ? bundle.translations.slice(offset,offset+4)
      : bundle.translations.slice(0,4);

    const translationSet=new Set(translations.map(q=>normalizedSentence(q.context)));

    let restore=bundle.restores.find(q=>{
      const full=String(q.context||'').replace(/_{3,}/g,String(q.a||''));
      return translationSet.has(normalizedSentence(full));
    }) || bundle.restores[offset%Math.max(1,bundle.restores.length)] || bundle.restores[0];

    const grammarIn=bundle.grammar.filter(q=>translationSet.has(normalizedSentence(q.context)));
    const grammar=grammarIn.length>=2?grammarIn.slice(0,3):bundle.grammar.slice(offset,offset+3);

    return {
      level,
      sourceRef:ref,
      translations,
      restore,
      grammar,
      comprehension:bundle.comprehension.slice(offset,offset+2)
    };
  }

  // ---------------------------------------------------------------------------
  // FORMA FORGE
  // ---------------------------------------------------------------------------
  const FORMA_STEPS=[
    {title:'Build the Correct Form',note:'Place the source-taught pieces.'},
    {title:'Check Your Form',note:'Submit when the form is complete.'},
    {title:'Learn from Feedback',note:'Repair before the answer is revealed.'},
    {title:'Keep Going',note:'Complete the level to build fluency.'},
    {title:'Use a Hint if Needed',note:'A clue reduces perfect-star eligibility.'}
  ];

  const Forma={
    available(level){
      const verbs=presentFormItems();
      if(level<6) return verbs.length>=6;
      return verbs.length>=4 && accusativeForgeItems().length>=2;
    },

    start(level){
      formaState.level=level;
      formaState.verbPool=presentFormItems();
      formaState.nounPool=accusativeForgeItems();
      formaState.current=null;
      formaState.placed=[];
      formaState.tray=[];
      setTarget(6);
      this.next();
    },

    next(){
      const level=formaState.level;
      let pool=formaState.verbPool;
      if(level===6 && session.normalResolved%3===2 && formaState.nounPool.length){
        pool=formaState.nounPool;
      }
      const item=pickItem(pool,'forma');
      if(!item) return showGameError('No unlocked source-taught form is available for this level.');
      formaState.current=item;
      formaState.isEcho=false;
      this.setupItem(item);
      this.render();
    },

    setupItem(item){
      const level=formaState.level;
      if(item.kind==='noun'){
        const choices=seededShuffle(item.choices.filter(Boolean),`noun-${item.id}`).slice(0,6);
        if(!choices.includes(item.target)) choices[0]=item.target;
        formaState.expected=[item.target];
        formaState.placed=[''];
        formaState.tray=seededShuffle(Array.from(new Set(choices)),`noun-tray-${item.id}`);
        formaState.locked=[false];
        formaState.labels=['Accusative form'];
        formaState.mode='noun';
        return;
      }

      const distractors=item.siblingEndings.filter(end=>end!==item.ending);
      const extraCount=level<=2?2:4;
      const endings=seededShuffle(distractors,`endings-${item.id}`).slice(0,extraCount);
      endings.push(item.ending);

      formaState.expected=[item.stem,item.ending];
      formaState.labels=level>=4?['','']:['Stem','Ending'];
      formaState.mode=(level===5 || (level===6 && session.normalResolved%2===1))?'repair':'build';

      if(level===1){
        formaState.placed=[item.stem,''];
        formaState.locked=[true,false];
        formaState.tray=seededShuffle(Array.from(new Set(endings)),`tray-${item.id}`);
      }else if(formaState.mode==='repair'){
        const wrong=seededShuffle(distractors,`wrong-${item.id}`)[0] || endings.find(x=>x!==item.ending) || '';
        formaState.placed=[item.stem,wrong];
        formaState.locked=[true,false];
        formaState.tray=seededShuffle(Array.from(new Set([item.ending,...endings])),`repair-${item.id}`);
      }else{
        formaState.placed=['',''];
        formaState.locked=[false,false];
        formaState.tray=seededShuffle(Array.from(new Set([item.stem,...endings])),`build-${item.id}`);
      }
    },

    render(){
      const item=formaState.current;
      const level=formaState.level;
      const prompt=item.kind==='noun'
        ? `<div class="g2-prompt-context">${h(item.q.context||'')}</div><h2>${h(item.q.q||'Build the correct form.')}</h2>`
        : `<div class="g2-prompt-context">${item.meaning?h(item.meaning):h(item.modelMeaning)}</div><h2>${formaState.mode==='repair'?'Repair':'Build'} the present form for <em>${h(item.personNumber)}</em>.</h2><p>Model: <strong>${h(item.model)}</strong>${item.modelMeaning?` — ${h(item.modelMeaning)}`:''}</p>`;

      const main=`
        <div class="g2-board-kicker">${sourcePill(item)}</div>
        <div class="g2-forge-prompt">${prompt}</div>
        <div class="g2-forge-slots">
          ${formaState.expected.map((expected,index)=>{
            const value=formaState.placed[index];
            const locked=formaState.locked[index];
            return `<div class="g2-slot-wrap">
              ${formaState.labels[index]?`<span>${h(formaState.labels[index])}</span>`:''}
              <button class="g2-dropzone g2-forge-slot ${locked?'locked':''}" type="button" data-g2-drop="${index}" ${locked?'disabled':''}>
                ${value?`<strong>${h(value)}</strong>`:'<span>Drop here</span>'}
              </button>
            </div>`;
          }).join('')}
        </div>
        <div class="g2-clue-slot"></div>
        <div class="g2-feedback-slot"></div>`;

      const aside=`<div class="g2-hint-panel"><button class="secondaryButton" type="button" data-g2-clue>Request a Clue</button><p>${level<=2?'Strong scaffolding stays visible at this level.':'Use a clue only if you need it.'}</p></div>`;

      const tray=`
        <div class="g2-tray-head"><div><strong>Word Parts</strong><small>${formaState.mode==='repair'?'Replace the incorrect component.':'Drag a piece or tap it, then tap a slot.'}</small></div><span>${h(item.skillLabel)}</span></div>
        <div class="g2-tile-tray">
          ${formaState.tray.map((text,index)=>`<button class="g2-tile" type="button" data-g2-tile="${index}">${h(text)}</button>`).join('')}
        </div>
        <div class="g2-actions">
          <button class="secondaryButton" type="button" data-forma-clear>Clear</button>
          <button class="primaryButton" type="button" data-forma-check>Repair Form</button>
        </div>`;

      area().innerHTML=parchmentShell({
        rail:stageRail(FORMA_STEPS,session.lastOutcome==='repair'?2:0),
        main,aside,tray,className:'g2-forma'
      });

      wireDrag(area(),(tileId,dropId)=>this.place(Number(tileId),Number(dropId)));
      area().querySelectorAll('.g2-forge-slot:not(.locked)').forEach(slot=>{
        slot.addEventListener('dblclick',()=>this.remove(Number(slot.dataset.g2Drop)));
      });
      area().querySelector('[data-forma-clear]')?.addEventListener('click',()=>this.clear());
      area().querySelector('[data-forma-check]')?.addEventListener('click',()=>this.check());
      wireClue(item,()=>{
        const correctIndex=formaState.tray.findIndex(x=>x===formaState.expected.find((x,i)=>formaState.placed[i]!==x));
        if(correctIndex>=0) area().querySelector(`[data-g2-tile="${correctIndex}"]`)?.classList.add('clue');
      });
    },

    place(tileIndex,slotIndex){
      if(formaState.locked[slotIndex]) return;
      const text=formaState.tray[tileIndex];
      if(text===undefined) return;
      formaState.placed[slotIndex]=text;
      playTone('tile');
      this.render();
    },

    remove(slotIndex){
      if(formaState.locked[slotIndex]) return;
      formaState.placed[slotIndex]='';
      this.render();
    },

    clear(){
      formaState.placed=formaState.placed.map((value,index)=>formaState.locked[index]?value:'');
      playTone('paper');
      this.render();
    },

    check(){
      const item=formaState.current;
      const correct=formaState.expected.every((expected,index)=>norm(formaState.placed[index])===norm(expected));
      const outcome=submit(item,correct,{echo:formaState.isEcho});

      if(outcome.state==='repair'){
        renderOutcome(outcome,item,()=>{},null);
        return;
      }

      renderOutcome(outcome,item,()=>continueAfterResolved(this),()=>{
        formaState.placed=formaState.expected.slice();
        this.render();
      });
    },

    renderEcho(skillId){
      const pool=[...formaState.verbPool,...formaState.nounPool].filter(item=>item.skillId===skillId);
      let item=pickItem(pool,'forma-echo');
      if(!item) item=pickItem([...formaState.verbPool,...formaState.nounPool],'forma-echo-any');
      if(!item) return showResult();

      formaState.current={...item,id:`echo:${item.id}:${session.echoIndex}`};
      formaState.isEcho=true;
      this.setupItem(formaState.current);
      updateHUD('Echo Round — rebuild one related form.');
      this.render();
    }
  };

  // ---------------------------------------------------------------------------
  // SENTENCE MOSAIC
  // ---------------------------------------------------------------------------
  const MOSAIC_STEPS=[
    {title:'Build the Latin Sentence',note:'Use the source-taught forms.'},
    {title:'Check Your Answer',note:'Latin word order may vary.'},
    {title:'Explore and Learn',note:'Repair a form before reveal.'},
    {title:'Keep Going',note:'Complete the level to build confidence.'}
  ];

  function canonicalTokens(q){
    return String(q.answerExample || (q.accepted&&q.accepted[0]) || '').trim().split(/\s+/).filter(Boolean);
  }

  function tokenClassMap(){
    const map=new Map();
    unlockedBank().forEach(q=>{
      if(q.type!=='exact_any') return;
      const form=String(q.context||'').split(',')[0].trim();
      if(!form || form.includes(' ')) return;
      const explanation=String(q.explain||'').toLowerCase();
      let cls='';
      if(/\bnoun\b/.test(explanation)) cls='noun';
      else if(/\bpreposition\b/.test(explanation)) cls='preposition';
      else if(/\b(?:irregular\s+)?verb\b/.test(explanation)) cls='verb';
      else if(/\badverb\b/.test(explanation)) cls='adverb';
      else if(/\badjective\b/.test(explanation)) cls='adjective';
      if(cls) map.set(norm(form),cls);
    });
    return map;
  }

  function mosaicDistractors(item,count){
    if(count<=0) return [];
    const required=new Set(canonicalTokens(item.q).map(norm));
    const classMap=tokenClassMap();
    const wantedClasses=canonicalTokens(item.q).map(t=>classMap.get(norm(t))).filter(Boolean);
    const candidates=[];

    sentenceItems().forEach(other=>{
      if(other.sourceId===item.sourceId) return;
      canonicalTokens(other.q).forEach(token=>{
        if(required.has(norm(token))) return;
        const cls=classMap.get(norm(token));
        if(!wantedClasses.length || !cls || wantedClasses.includes(cls)) candidates.push(token);
      });
    });

    return seededShuffle(Array.from(new Set(candidates)),`mosaic-distractors-${item.id}`).slice(0,count);
  }

  function validateMosaic(item,selected){
    const q=item.q;
    const groups=q.latinGroups||[];
    const remaining=selected.map(token=>norm(token));
    if(remaining.length!==groups.length) return {ok:false,reason:'form-count'};

    const used=new Array(remaining.length).fill(false);
    for(const group of groups){
      const options=(group||[]).map(norm);
      const index=remaining.findIndex((token,i)=>!used[i] && options.includes(token));
      if(index<0) return {ok:false,reason:'missing-form'};
      used[index]=true;
    }

    const canonical=canonicalTokens(q);
    const selectedNorm=selected.map(norm);
    for(let i=0;i<canonical.length-1;i++){
      const token=norm(canonical[i]);
      const next=norm(canonical[i+1]);
      if(PREP_WORDS.has(token) || token==='non'){
        const pos=selectedNorm.indexOf(token);
        if(pos<0 || selectedNorm[pos+1]!==next){
          return {ok:false,reason:'phrase-link',token:canonical[i]};
        }
      }
    }

    return {ok:true};
  }

  const Mosaic={
    available(){
      return sentenceItems().length>=5;
    },

    start(level){
      mosaicState.level=level;
      mosaicState.pool=sentenceItems();
      mosaicState.current=null;
      mosaicState.selected=[];
      mosaicState.tray=[];
      mosaicState.isEcho=false;
      setTarget(5);
      this.next();
    },

    next(){
      const item=pickItem(mosaicState.pool,'mosaic');
      if(!item) return showGameError('No unlocked teacher-covered sentence is available.');
      mosaicState.current=item;
      mosaicState.isEcho=false;
      this.setup(item);
      this.render();
    },

    setup(item){
      const required=canonicalTokens(item.q);
      const distractorCount=mosaicState.level>=5?2:mosaicState.level>=3?1:0;
      mosaicState.selected=[];
      mosaicState.tray=seededShuffle([...required,...mosaicDistractors(item,distractorCount)],`mosaic-tray-${item.id}`);
    },

    render(){
      const item=mosaicState.current;
      const level=mosaicState.level;
      const roleGuide=level<=2
        ? `<div class="g2-role-guide"><strong>Role guide</strong><span>Subject</span><span>Verb</span><span>Object / Recipient</span><span>Extra</span><small>Guide only — the final Latin order is flexible.</small></div>`
        : level===3
          ? `<div class="g2-role-guide compact"><strong>Think:</strong><span>Who?</span><span>What action?</span><span>What receives it?</span></div>`
          : '';

      const main=`
        <div class="g2-board-kicker">${sourcePill(item)}</div>
        <div class="g2-mosaic-prompt"><span>Build the Latin sentence</span><h2>${h(item.q.context)}</h2></div>
        ${roleGuide}
        <div class="g2-mosaic-strip" data-g2-drop="strip">
          ${mosaicState.selected.length
            ? mosaicState.selected.map((entry,index)=>`<button class="g2-built-tile" type="button" data-mosaic-remove="${index}" title="Tap to remove">${h(entry.text)}</button>`).join('')
            : '<span class="g2-placeholder">Drag words here, or tap a word then tap this strip.</span>'
          }
        </div>
        <div class="g2-clue-slot"></div>
        <div class="g2-feedback-slot"></div>`;

      const aside=`<div class="g2-hint-panel"><button class="secondaryButton" type="button" data-g2-clue>Request a Clue</button><p>${level<=2?'Use the role guide, but do not force English word order.':'Look at endings, roles and prepositions before requesting help.'}</p></div>`;

      const selectedIndexes=new Set(mosaicState.selected.map(x=>x.index));
      const tray=`
        <div class="g2-tray-head"><div><strong>Word Tiles</strong><small>Every production item comes from the teacher-covered sentence bank.</small></div><span>${h(item.skillLabel)}</span></div>
        <div class="g2-tile-tray">
          ${mosaicState.tray.map((text,index)=>`<button class="g2-tile ${selectedIndexes.has(index)?'used':''}" type="button" data-g2-tile="${index}" ${selectedIndexes.has(index)?'disabled':''}>${h(text)}</button>`).join('')}
        </div>
        <div class="g2-actions">
          <button class="secondaryButton" type="button" data-mosaic-clear>Clear</button>
          <button class="primaryButton" type="button" data-mosaic-check>Check Sentence</button>
        </div>`;

      area().innerHTML=parchmentShell({
        rail:stageRail(MOSAIC_STEPS,session.lastOutcome==='repair'?2:0),
        main,aside,tray,className:'g2-mosaic'
      });

      wireDrag(area(),(tileId,dropId)=>{
        if(dropId!=='strip') return;
        this.add(Number(tileId));
      });
      area().querySelectorAll('[data-mosaic-remove]').forEach(button=>{
        button.addEventListener('click',()=>this.remove(Number(button.dataset.mosaicRemove)));
      });
      area().querySelector('[data-mosaic-clear]')?.addEventListener('click',()=>{mosaicState.selected=[];playTone('paper');this.render();});
      area().querySelector('[data-mosaic-check]')?.addEventListener('click',()=>this.check());
      wireClue(item,()=>{
        const required=canonicalTokens(item.q).map(norm);
        const selected=mosaicState.selected.map(x=>norm(x.text));
        const needed=required.find(token=>!selected.includes(token));
        if(needed){
          const idx=mosaicState.tray.findIndex(text=>norm(text)===needed);
          if(idx>=0) area().querySelector(`[data-g2-tile="${idx}"]`)?.classList.add('clue');
        }
      });
    },

    add(index){
      if(mosaicState.selected.some(x=>x.index===index)) return;
      mosaicState.selected.push({index,text:mosaicState.tray[index]});
      playTone('tile');
      this.render();
    },

    remove(position){
      mosaicState.selected.splice(position,1);
      playTone('tile');
      this.render();
    },

    check(){
      const item=mosaicState.current;
      const selected=mosaicState.selected.map(x=>x.text);
      const validation=validateMosaic(item,selected);
      if(!validation.ok){
        if(validation.reason==='phrase-link' && validation.token){
          item.clue=`Keep ${validation.token} with the source-taught word that follows it in this phrase.`;
        }else{
          item.clue='Check that every required Latin form is present. Word order may vary, but the forms must be exact.';
        }
      }

      const outcome=submit(item,validation.ok,{echo:mosaicState.isEcho});
      if(outcome.state==='repair'){
        renderOutcome(outcome,item,()=>{},null);
        return;
      }

      renderOutcome(outcome,item,()=>continueAfterResolved(this),()=>{
        mosaicState.selected=canonicalTokens(item.q).map((text,index)=>({index:-100-index,text}));
        this.render();
      });
    },

    renderEcho(skillId){
      let pool=mosaicState.pool.filter(item=>item.skillId===skillId);
      let item=pickItem(pool,'mosaic-echo') || pickItem(mosaicState.pool,'mosaic-echo-any');
      if(!item) return showResult();
      mosaicState.current={...item,id:`echo:${item.id}:${session.echoIndex}`};
      mosaicState.isEcho=true;
      this.setup(mosaicState.current);
      updateHUD('Echo Round — build a different sentence using the same kind of skill.');
      this.render();
    }
  };

  // ---------------------------------------------------------------------------
  // VERBUM MATCH 2.0
  // ---------------------------------------------------------------------------
  const VERBUM_STEPS=[
    {title:'Make the Connection',note:'Drag or tap a source tile.'},
    {title:'Explore the Pattern',note:'Use teacher-source clues only.'},
    {title:'Check the Match',note:'A first error becomes a repair.'},
    {title:'Keep Going',note:'Level demand changes, not just board size.'}
  ];

  const Verbum={
    available(level){
      if(level===1) return vocabPairItems(3).length>=5;
      if(level===2) return vocabPairItems(6).length>=5;
      if(level===3) return perfectPairItems().length>=5;
      if(level===4){
        const classes=new Set(wordClassItems().map(x=>x.wordClass));
        return wordClassItems().length>=8 && classes.size>=3;
      }
      if(level===5) return prepCaseItems().length>=5;
      return vocabPairItems(12).length>=4 && perfectPairItems().length>=3 && prepCaseItems().length>=3;
    },

    start(level){
      verbumState.level=level;
      verbumState.isEcho=false;
      if(level===1) return this.startPairBoard('vocab',vocabPairItems(3),false,6);
      if(level===2) return this.startPairBoard('vocab',vocabPairItems(6),true,6);
      if(level===3) return this.startPairBoard('perfect',perfectPairItems(),false,6);
      if(level===4) return this.startSortBoard();
      if(level===5) return this.startPairBoard('prep',prepCaseItems(),false,6);
      return this.startMixed();
    },

    startPairBoard(mode,pool,reverse,count){
      verbumState.mode=mode;
      verbumState.reverse=reverse;
      const selected=seededShuffle(pool,`verbum-board-${mode}-${session.level}`).slice(0,count);
      verbumState.items=selected.map(item=>({...item}));
      verbumState.resolved=new Set();
      verbumState.hintedTarget=null;
      setTarget(selected.length);
      this.renderPairBoard();
    },

    pairTexts(item){
      if(verbumState.mode==='vocab'){
        return verbumState.reverse
          ? {left:item.english,right:item.latin}
          : {left:item.latin,right:item.english};
      }
      if(verbumState.mode==='perfect') return {left:item.left,right:item.right};
      if(verbumState.mode==='prep') return {left:item.prep,right:item.caseName};
      return {left:'',right:''};
    },

    renderPairBoard(){
      const unresolved=verbumState.items.filter(item=>!verbumState.resolved.has(item.id));
      const leftItems=unresolved.map(item=>({id:item.id,text:this.pairTexts(item).left}));
      const rightItems=seededShuffle(unresolved.map(item=>({id:item.id,text:this.pairTexts(item).right})),`targets-${session.normalResolved}-${verbumState.mode}`);

      const labels=verbumState.mode==='perfect'
        ? ['Present / learned cue','Perfect cue']
        : verbumState.mode==='prep'
          ? ['Preposition','Required case']
          : verbumState.reverse?['English','Latin']:['Latin','English'];

      const main=`
        <div class="g2-board-kicker"><span class="g2-source-pill">${h(CONFIG.verbum.levels[session.level-1])}</span></div>
        <div class="g2-match-instruction"><h2>${verbumState.mode==='prep'?'Connect each preposition to its source-taught case.':verbumState.mode==='perfect'?'Connect the learned present cue to its learned perfect cue.':'Match each source tile to its learned partner.'}</h2></div>
        <div class="g2-match-board">
          <section><h3>${h(labels[0])}</h3>${leftItems.map(item=>`<button class="g2-tile g2-match-source" type="button" data-g2-tile="${h(item.id)}">${h(item.text)}</button>`).join('')}</section>
          <section><h3>${h(labels[1])}</h3>${rightItems.map(item=>`<button class="g2-dropzone g2-match-target ${verbumState.hintedTarget===item.id?'clue':''}" type="button" data-g2-drop="${h(item.id)}">${h(item.text)}</button>`).join('')}</section>
        </div>
        <div class="g2-clue-slot"></div>
        <div class="g2-feedback-slot"></div>`;

      const aside=`<div class="g2-hint-panel"><button class="secondaryButton" type="button" data-g2-clue>Request a Clue</button><p>A clue removes one impossible relationship or highlights a source pattern. It does not reveal the whole board.</p></div>`;

      area().innerHTML=parchmentShell({
        rail:stageRail(VERBUM_STEPS,session.lastOutcome==='repair'?2:0),
        main,aside,className:'g2-verbum'
      });

      wireDrag(area(),(sourceId,targetId)=>this.checkPair(sourceId,targetId));
      const first=unresolved[0];
      if(first) wireClue(first,()=>{
        const wrong=rightItems.find(target=>target.id!==first.id);
        if(wrong) area().querySelector(`[data-g2-drop="${CSS.escape(wrong.id)}"]`)?.classList.add('eliminated');
      });
    },

    checkPair(sourceId,targetId){
      const item=verbumState.items.find(x=>x.id===sourceId);
      if(!item || verbumState.resolved.has(item.id)) return;
      const correct=sourceId===targetId;
      const outcome=submit(item,correct,{echo:verbumState.isEcho});

      if(outcome.state==='repair'){
        const slot=feedbackSlot();
        if(slot) slot.innerHTML=`<div class="g2-repair-feedback repair"><strong>Repair attempt</strong><p>${h(outcome.clue)}</p><small>Try a different connection.</small></div>`;
        return;
      }

      if(outcome.state==='reveal'){
        verbumState.resolved.add(item.id);
        renderOutcome(outcome,item,()=>this.afterPair(),()=>{
          verbumState.hintedTarget=item.id;
          this.renderPairBoard();
        });
        return;
      }

      verbumState.resolved.add(item.id);
      renderOutcome(outcome,item,()=>this.afterPair(),null);
    },

    afterPair(){
      if(verbumState.isEcho){
        return continueAfterResolved(this);
      }
      if(session.normalResolved>=session.target) return continueAfterResolved(this);
      this.renderPairBoard();
    },

    startSortBoard(){
      verbumState.mode='sort';
      const pool=wordClassItems();
      const counts={};
      pool.forEach(item=>counts[item.wordClass]=(counts[item.wordClass]||0)+1);
      const categories=Object.entries(counts).filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name])=>name);
      const items=seededShuffle(pool.filter(item=>categories.includes(item.wordClass)),'verbum-sort').slice(0,8);
      verbumState.items=items;
      verbumState.categories=categories;
      verbumState.resolved=new Set();
      setTarget(items.length);
      this.renderSortBoard();
    },

    renderSortBoard(){
      const unresolved=verbumState.items.filter(item=>!verbumState.resolved.has(item.id));
      const main=`
        <div class="g2-board-kicker"><span class="g2-source-pill">Teacher vocabulary labels</span></div>
        <div class="g2-match-instruction"><h2>Sort each learned entry by its source-taught word class.</h2></div>
        <div class="g2-sort-zones">
          ${verbumState.categories.map(category=>`<button class="g2-dropzone g2-sort-zone" type="button" data-g2-drop="${h(category)}"><strong>${h(CLASS_LABELS[category])}</strong></button>`).join('')}
        </div>
        <div class="g2-clue-slot"></div>
        <div class="g2-feedback-slot"></div>`;

      const tray=`<div class="g2-tray-head"><div><strong>Word Tiles</strong><small>Drag a word, or tap it then tap a category.</small></div></div>
        <div class="g2-tile-tray">${unresolved.map(item=>`<button class="g2-tile" type="button" data-g2-tile="${h(item.id)}">${h(item.form)}</button>`).join('')}</div>`;

      area().innerHTML=parchmentShell({
        rail:stageRail(VERBUM_STEPS,session.lastOutcome==='repair'?2:0),
        main,
        aside:`<div class="g2-hint-panel"><button class="secondaryButton" type="button" data-g2-clue>Request a Clue</button><p>Think about how the entry was labelled in the teacher table.</p></div>`,
        tray,
        className:'g2-verbum'
      });

      wireDrag(area(),(sourceId,target)=>this.checkSort(sourceId,target));
      const first=unresolved[0];
      if(first) wireClue(first,()=>{
        const wrong=verbumState.categories.find(category=>category!==first.wordClass);
        area().querySelector(`[data-g2-drop="${wrong}"]`)?.classList.add('eliminated');
      });
    },

    checkSort(sourceId,target){
      const item=verbumState.items.find(x=>x.id===sourceId);
      if(!item) return;
      const outcome=submit(item,item.wordClass===target,{echo:verbumState.isEcho});

      if(outcome.state==='repair'){
        renderOutcome(outcome,item,()=>{},null);
        return;
      }

      verbumState.resolved.add(item.id);
      renderOutcome(outcome,item,()=>this.afterSort(),null);
    },

    afterSort(){
      if(session.normalResolved>=session.target || verbumState.isEcho) return continueAfterResolved(this);
      this.renderSortBoard();
    },

    startMixed(){
      verbumState.mode='mixed';
      verbumState.mixedIndex=0;
      verbumState.mixedPools=[
        {kind:'reverse',pool:vocabPairItems(12)},
        {kind:'perfect',pool:perfectPairItems()},
        {kind:'sort',pool:wordClassItems()},
        {kind:'prep',pool:prepCaseItems()}
      ];
      setTarget(8);
      this.nextMixed();
    },

    nextMixed(){
      if(session.normalResolved>=session.target) return continueAfterResolved(this);
      const spec=verbumState.mixedPools[verbumState.mixedIndex%verbumState.mixedPools.length];
      verbumState.mixedIndex++;
      let item=pickItem(spec.pool,`verbum-mixed-${spec.kind}`);
      if(!item) return this.nextMixed();

      verbumState.singleItem=item;
      verbumState.singleKind=spec.kind;
      this.renderMixedSingle();
    },

    renderMixedSingle(){
      const item=verbumState.singleItem;
      let sourceText='',correct='',targets=[];

      if(verbumState.singleKind==='reverse'){
        sourceText=item.english;
        correct=item.latin;
        targets=seededShuffle(vocabPairItems(12).filter(x=>x.id!==item.id).map(x=>x.latin),`mixed-vocab-${item.id}`).slice(0,2);
      }else if(verbumState.singleKind==='perfect'){
        sourceText=item.left;
        correct=item.right;
        targets=seededShuffle(perfectPairItems().filter(x=>x.id!==item.id).map(x=>x.right),`mixed-perfect-${item.id}`).slice(0,2);
      }else if(verbumState.singleKind==='prep'){
        sourceText=item.prep;
        correct=item.caseName;
        targets=seededShuffle(Array.from(new Set(prepCaseItems().filter(x=>x.id!==item.id).map(x=>x.caseName))),`mixed-prep-${item.id}`).slice(0,2);
      }else{
        sourceText=item.form;
        correct=item.wordClass;
        targets=verbumState.categories || ['noun','verb','preposition'];
      }

      targets=Array.from(new Set([correct,...targets])).slice(0,3);
      const targetLabels=verbumState.singleKind==='sort'
        ? targets.map(value=>({value,label:CLASS_LABELS[value]||value}))
        : targets.map(value=>({value,label:value}));

      const main=`
        <div class="g2-board-kicker"><span class="g2-source-pill">Mixed challenge</span></div>
        <h2>Make the correct connection.</h2>
        <div class="g2-single-source"><button class="g2-tile" type="button" data-g2-tile="source">${h(sourceText)}</button></div>
        <div class="g2-single-targets">${seededShuffle(targetLabels,`mixed-targets-${item.id}`).map(target=>`<button class="g2-dropzone" type="button" data-g2-drop="${h(target.value)}">${h(target.label)}</button>`).join('')}</div>
        <div class="g2-clue-slot"></div><div class="g2-feedback-slot"></div>`;

      area().innerHTML=parchmentShell({
        rail:stageRail(VERBUM_STEPS,session.lastOutcome==='repair'?2:0),
        main,
        aside:`<div class="g2-hint-panel"><button class="secondaryButton" type="button" data-g2-clue>Request a Clue</button><p>Use a clue only if the source-taught connection is not coming back.</p></div>`,
        className:'g2-verbum'
      });

      wireDrag(area(),(_,target)=>this.checkMixed(target,correct));
      wireClue(item,()=>{
        const wrong=targetLabels.find(x=>x.value!==correct);
        if(wrong) area().querySelector(`[data-g2-drop="${CSS.escape(wrong.value)}"]`)?.classList.add('eliminated');
      });
    },

    checkMixed(target,correct){
      const item=verbumState.singleItem;
      const outcome=submit(item,norm(target)===norm(correct),{echo:false});
      if(outcome.state==='repair') return renderOutcome(outcome,item,()=>{},null);
      renderOutcome(outcome,item,()=>this.nextMixed(),null);
    },

    next(){
      if(verbumState.level===6) return this.nextMixed();
      if(verbumState.mode==='sort') return this.renderSortBoard();
      return this.renderPairBoard();
    },

    renderEcho(skillId){
      const candidates=[
        ...vocabPairItems(12),
        ...perfectPairItems(),
        ...wordClassItems(),
        ...prepCaseItems()
      ].filter(item=>item.skillId===skillId);
      const item=pickItem(candidates,'verbum-echo') || pickItem(candidates.length?candidates:vocabPairItems(12),'verbum-echo-any');
      if(!item) return showResult();

      verbumState.isEcho=true;
      verbumState.singleItem={...item,id:`echo:${item.id}:${session.echoIndex}`};

      if(item.latin!==undefined){
        verbumState.singleKind='reverse';
      }else if(item.left!==undefined){
        verbumState.singleKind='perfect';
      }else if(item.wordClass!==undefined){
        verbumState.singleKind='sort';
      }else{
        verbumState.singleKind='prep';
      }
      updateHUD('Echo Round — reconnect a related pattern.');
      this.renderEchoSingle();
    },

    renderEchoSingle(){
      const item=verbumState.singleItem;
      let sourceText='',correct='',targets=[];
      if(verbumState.singleKind==='reverse'){
        sourceText=item.english; correct=item.latin;
        targets=seededShuffle(vocabPairItems(12).filter(x=>x.sourceId!==item.sourceId).map(x=>x.latin),`echo-vocab-${item.id}`).slice(0,2);
      }else if(verbumState.singleKind==='perfect'){
        sourceText=item.left; correct=item.right;
        targets=seededShuffle(perfectPairItems().filter(x=>x.sourceId!==item.sourceId).map(x=>x.right),`echo-perfect-${item.id}`).slice(0,2);
      }else if(verbumState.singleKind==='sort'){
        sourceText=item.form; correct=item.wordClass; targets=['noun','verb','preposition','adverb'].filter(Boolean);
      }else{
        sourceText=item.prep; correct=item.caseName;
        targets=Array.from(new Set(prepCaseItems().map(x=>x.caseName))).slice(0,4);
      }
      const values=Array.from(new Set([correct,...targets])).slice(0,4);

      area().innerHTML=parchmentShell({
        rail:`<div class="g2-echo-label"><strong>Echo Round</strong><small>One last look at today’s tricky patterns.</small></div>`,
        main:`<h2>Reconnect the pattern.</h2><div class="g2-single-source"><button class="g2-tile" type="button" data-g2-tile="source">${h(sourceText)}</button></div>
          <div class="g2-single-targets">${seededShuffle(values,`echo-targets-${item.id}`).map(value=>`<button class="g2-dropzone" type="button" data-g2-drop="${h(value)}">${h(verbumState.singleKind==='sort'?(CLASS_LABELS[value]||value):value)}</button>`).join('')}</div>
          <div class="g2-clue-slot"></div><div class="g2-feedback-slot"></div>`,
        aside:`<div class="g2-hint-panel"><button class="secondaryButton" type="button" data-g2-clue>Request a Clue</button></div>`,
        className:'g2-verbum'
      });

      wireDrag(area(),(_,target)=>{
        const outcome=submit(item,norm(target)===norm(correct),{echo:true});
        if(outcome.state==='repair') return renderOutcome(outcome,item,()=>{},null);
        renderOutcome(outcome,item,()=>continueAfterResolved(this),null);
      });
      wireClue(item,null);
    }
  };

  // ---------------------------------------------------------------------------
  // MANUSCRIPT MYSTERY
  // ---------------------------------------------------------------------------
  const MANUSCRIPT_STAGES=[
    {title:'Restore',note:'Replace a missing source word.'},
    {title:'Inspect',note:'Highlight the requested feature.'},
    {title:'Connect',note:'Link forms to source-taught labels.'},
    {title:'Sequence',note:'Order events from the passage.'},
    {title:'Interpret',note:'Build the final translation.'}
  ];

  function focusFromGrammar(q){
    const context=String(q.context||'');
    const parts=context.split(/\nFocus(?: verb)?:\s*/i);
    return {sentence:parts[0].trim(),focus:(parts[1]||'').trim()};
  }

  const Manuscript={
    available(level){
      const caseFile=buildCaseFile(level);
      return !!(caseFile && caseFile.translations.length>=3 && caseFile.restore && caseFile.grammar.length>=2);
    },

    start(level){
      manuscriptState.level=level;
      manuscriptState.caseFile=buildCaseFile(level);
      manuscriptState.stage=0;
      manuscriptState.isEcho=false;
      manuscriptState.current=null;
      manuscriptState.restorePlaced='';
      manuscriptState.connectPlaced={};
      manuscriptState.sequencePlaced=[];
      manuscriptState.interpretPlaced=[];
      setTarget(5);
      this.renderStage();
    },

    casePassage(){
      return manuscriptState.caseFile.translations.map(q=>q.context).join(' ');
    },

    next(){
      manuscriptState.stage++;
      if(manuscriptState.stage>=5) return continueAfterResolved(this);
      this.renderStage();
    },

    renderStage(){
      const stage=manuscriptState.stage;
      if(stage===0) return this.renderRestore();
      if(stage===1) return this.renderInspect();
      if(stage===2) return this.renderConnect();
      if(stage===3) return this.renderSequence();
      return this.renderInterpret();
    },

    renderRestore(){
      const q=manuscriptState.caseFile.restore;
      const skill=skillForQuestion(q);
      const item={
        id:`manuscript:restore:${q.id}`,
        sourceId:q.id,sourceIds:[q.id],sourceTraces:[sourceTrace(q)],
        day:q.day,sourceRef:q.sourceRef,skillId:skill.id,skillLabel:'Restore the set text',
        q,clue:clueFromQuestion(q,'Use the surrounding clause to identify the missing source word.'),
        mustRemember:mustRememberFromQuestion(q),answerDisplay:String(q.a||'')
      };
      manuscriptState.current=item;

      const trayValues=seededShuffle(Array.from(new Set([String(q.a||''),...(q.opts||[]).map(String)])),`restore-${q.id}`).slice(0,6);
      manuscriptState.restoreTray=trayValues;

      const main=`
        <div class="g2-board-kicker">${sourcePill(item)}</div>
        <div class="g2-casefile-title"><span>Case File</span><p>${h(manuscriptState.caseFile.sourceRef)}</p></div>
        <div class="g2-manuscript-text">
          <p>${h(q.context).replace(/_{3,}/g,`<button class="g2-dropzone g2-inline-blank" type="button" data-g2-drop="restore">${manuscriptState.restorePlaced?h(manuscriptState.restorePlaced):'________'}</button>`)}</p>
        </div>
        <div class="g2-clue-slot"></div><div class="g2-feedback-slot"></div>`;

      const tray=`<div class="g2-tray-head"><div><strong>Evidence Tray</strong><small>Restore the damaged source sentence.</small></div></div>
        <div class="g2-tile-tray">${trayValues.map((value,index)=>`<button class="g2-tile" type="button" data-g2-tile="${index}">${h(value)}</button>`).join('')}</div>
        <div class="g2-actions"><button class="primaryButton" type="button" data-manuscript-check>Check Evidence</button></div>`;

      area().innerHTML=parchmentShell({
        rail:stageRail(MANUSCRIPT_STAGES,0),
        main,
        aside:`<div class="g2-hint-panel"><button class="secondaryButton" type="button" data-g2-clue>Request a Clue</button><p>The whole passage answer is never revealed by a single clue.</p></div>`,
        tray,
        className:'g2-manuscript'
      });

      wireDrag(area(),(tileId,dropId)=>{
        if(dropId!=='restore') return;
        manuscriptState.restorePlaced=trayValues[Number(tileId)];
        playTone('paper');
        this.renderRestore();
      });
      area().querySelector('[data-manuscript-check]')?.addEventListener('click',()=>{
        const outcome=submit(item,norm(manuscriptState.restorePlaced)===norm(q.a),{echo:false});
        if(outcome.state==='repair') return renderOutcome(outcome,item,()=>{},null);
        renderOutcome(outcome,item,()=>this.next(),()=>{manuscriptState.restorePlaced=String(q.a||'');this.renderRestore();});
      });
      wireClue(item,()=>{
        const wrongIndex=trayValues.findIndex(value=>norm(value)!==norm(q.a));
        if(wrongIndex>=0) area().querySelector(`[data-g2-tile="${wrongIndex}"]`)?.classList.add('eliminated');
      });
    },

    renderInspect(){
      const q=manuscriptState.caseFile.grammar[0];
      const focus=focusFromGrammar(q);
      const skill=skillForQuestion(q);
      const item={
        id:`manuscript:inspect:${q.id}`,
        sourceId:q.id,sourceIds:[q.id],sourceTraces:[sourceTrace(q)],
        day:q.day,sourceRef:q.sourceRef,skillId:skill.id,skillLabel:'Finite verb inspection',
        q,clue:'Look at the verb form named in the teacher source and identify it in the sentence.',
        mustRemember:mustRememberFromQuestion(q),answerDisplay:focus.focus
      };
      manuscriptState.current=item;

      const tokens=focus.sentence.split(/(\s+|[,.!?;:])/).filter(token=>token && !/^\s+$/.test(token));
      const main=`
        <div class="g2-board-kicker">${sourcePill(item)}</div>
        <h2>Inspect the manuscript</h2>
        <p>Highlight the focus verb directly in the source sentence.</p>
        <div class="g2-highlight-passage">${tokens.map((token,index)=>{
          const clean=token.replace(/[,.!?;:]/g,'');
          return /[A-Za-zāēīōūȳ]/.test(clean)
            ? `<button class="g2-highlight-word" type="button" data-inspect-index="${index}">${h(token)}</button>`
            : h(token);
        }).join(' ')}</div>
        <div class="g2-clue-slot"></div><div class="g2-feedback-slot"></div>`;

      area().innerHTML=parchmentShell({
        rail:stageRail(MANUSCRIPT_STAGES,1),
        main,
        aside:`<div class="g2-hint-panel"><button class="secondaryButton" type="button" data-g2-clue>Request a Clue</button><p>Highlighting is checked against the teacher-covered focus form.</p></div>`,
        tray:`<div class="g2-tray-head"><div><strong>Inspection Tool</strong><small>Tap the word you want to highlight.</small></div></div>`,
        className:'g2-manuscript'
      });

      area().querySelectorAll('[data-inspect-index]').forEach(button=>{
        button.addEventListener('click',()=>{
          const correct=norm(button.textContent)===norm(focus.focus);
          const outcome=submit(item,correct,{echo:false});
          if(outcome.state==='repair'){
            button.classList.add('wrong-mark');
            return renderOutcome(outcome,item,()=>{},null);
          }
          if(outcome.state==='reveal'){
            area().querySelectorAll('[data-inspect-index]').forEach(el=>{
              if(norm(el.textContent)===norm(focus.focus)) el.classList.add('correct-mark');
            });
          }else{
            button.classList.add('correct-mark');
          }
          renderOutcome(outcome,item,()=>this.next(),null);
        });
      });
      wireClue(item,()=>{
        const candidates=Array.from(area().querySelectorAll('[data-inspect-index]')).filter(el=>norm(el.textContent)!==norm(focus.focus));
        candidates[0]?.classList.add('eliminated');
      });
    },

    renderConnect(){
      const qs=manuscriptState.caseFile.grammar.slice(0,3);
      const rows=qs.map(q=>{
        const focus=focusFromGrammar(q);
        return {q,focus:focus.focus,label:String(q.a||''),sentence:focus.sentence};
      }).filter(row=>row.focus && row.label).slice(0,3);

      const sourceIds=rows.map(row=>row.q.id);
      const skill=skillForQuestion(rows[0].q);
      const item={
        id:`manuscript:connect:${sourceIds.join('-')}`,
        sourceId:sourceIds[0],sourceIds,sourceTraces:rows.map(row=>sourceTrace(row.q)),
        day:rows[0].q.day,sourceRef:rows[0].q.sourceRef,
        skillId:skill.id,skillLabel:'Set-text verb labels',
        clue:clueFromQuestion(rows[0].q,'Use the exact tense label learned with the focus verb.'),
        mustRemember:rows.map(row=>mustRememberFromQuestion(row.q)).join(' '),
        answerDisplay:rows.map(row=>`${row.focus} → ${row.label}`).join('; ')
      };
      manuscriptState.current=item;
      manuscriptState.connectRows=rows;
      manuscriptState.connectPlaced={};

      this.renderConnectBoard();
    },

    renderConnectBoard(){
      const item=manuscriptState.current;
      const rows=manuscriptState.connectRows;
      const labels=seededShuffle(Array.from(new Set(rows.map(row=>row.label))),`connect-labels-${item.id}`);

      const main=`
        <div class="g2-board-kicker">${sourcePill(item)}</div>
        <h2>Connect each focus verb to its source-taught label.</h2>
        <div class="g2-connect-board">
          ${rows.map((row,index)=>`<div class="g2-connect-row"><span><strong>${h(row.focus)}</strong><small>${h(row.sentence)}</small></span><button class="g2-dropzone" type="button" data-g2-drop="${index}">${manuscriptState.connectPlaced[index]?h(manuscriptState.connectPlaced[index]):'Drop label'}</button></div>`).join('')}
        </div>
        <div class="g2-clue-slot"></div><div class="g2-feedback-slot"></div>`;

      const tray=`<div class="g2-tray-head"><div><strong>Evidence Tray</strong><small>Grammar labels for this case file.</small></div></div>
        <div class="g2-tile-tray">${labels.map((label,index)=>`<button class="g2-tile" type="button" data-g2-tile="${index}">${h(label)}</button>`).join('')}</div>
        <div class="g2-actions"><button class="primaryButton" type="button" data-connect-check>Check Connections</button></div>`;

      area().innerHTML=parchmentShell({
        rail:stageRail(MANUSCRIPT_STAGES,2),
        main,
        aside:`<div class="g2-hint-panel"><button class="secondaryButton" type="button" data-g2-clue>Request a Clue</button><p>Use the form and context together.</p></div>`,
        tray,
        className:'g2-manuscript'
      });

      wireDrag(area(),(tileId,dropId)=>{
        manuscriptState.connectPlaced[Number(dropId)]=labels[Number(tileId)];
        playTone('tile');
        this.renderConnectBoard();
      });

      area().querySelector('[data-connect-check]')?.addEventListener('click',()=>{
        const correct=rows.every((row,index)=>norm(manuscriptState.connectPlaced[index])===norm(row.label));
        const outcome=submit(item,correct,{echo:false});
        if(outcome.state==='repair') return renderOutcome(outcome,item,()=>{},null);
        renderOutcome(outcome,item,()=>this.next(),()=>{
          rows.forEach((row,index)=>manuscriptState.connectPlaced[index]=row.label);
          this.renderConnectBoard();
        });
      });

      wireClue(item,()=>{
        const empty=rows.findIndex((row,index)=>!manuscriptState.connectPlaced[index]);
        if(empty>=0){
          const correct=rows[empty].label;
          const wrongIndex=labels.findIndex(label=>label!==correct);
          if(wrongIndex>=0) area().querySelector(`[data-g2-tile="${wrongIndex}"]`)?.classList.add('eliminated');
        }
      });
    },

    renderSequence(){
      const translations=manuscriptState.caseFile.translations.slice(0,3);
      const item={
        id:`manuscript:sequence:${translations.map(q=>q.id).join('-')}`,
        sourceId:translations[0].id,sourceIds:translations.map(q=>q.id),sourceTraces:translations.map(sourceTrace),
        day:translations[0].day,sourceRef:translations[0].sourceRef,
        skillId:`settext:${norm(translations[0].sourceRef)}:sequence`,
        skillLabel:'Passage event sequence',
        clue:'Use the order of the source passage, not general world knowledge.',
        mustRemember:'Sequence the events from the passage itself.',
        answerDisplay:translations.map(q=>q.answerExample||answerFromQuestion(q)).join(' → ')
      };
      manuscriptState.current=item;
      manuscriptState.sequenceItems=translations.map((q,index)=>({
        id:String(index),
        text:q.answerExample||answerFromQuestion(q),
        q
      }));
      manuscriptState.sequencePlaced=['','',''];
      this.renderSequenceBoard();
    },

    renderSequenceBoard(){
      const item=manuscriptState.current;
      const placedIds=new Set(manuscriptState.sequencePlaced.filter(Boolean));
      const tray=seededShuffle(manuscriptState.sequenceItems,`sequence-${item.id}`);

      const main=`
        <div class="g2-board-kicker">${sourcePill(item)}</div>
        <h2>Put the passage events in order.</h2>
        <p>Use the order in the teacher-covered passage.</p>
        <div class="g2-sequence-slots">${manuscriptState.sequencePlaced.map((id,index)=>{
          const event=manuscriptState.sequenceItems.find(x=>x.id===id);
          return `<button class="g2-dropzone g2-sequence-slot" type="button" data-g2-drop="${index}"><span>${index+1}</span>${event?h(event.text):'Drop event'}</button>`;
        }).join('')}</div>
        <div class="g2-clue-slot"></div><div class="g2-feedback-slot"></div>`;

      const trayHtml=`<div class="g2-tray-head"><div><strong>Event Cards</strong><small>Drag, or tap a card then tap a numbered slot.</small></div></div>
        <div class="g2-tile-tray">${tray.map(event=>`<button class="g2-tile ${placedIds.has(event.id)?'used':''}" type="button" data-g2-tile="${event.id}" ${placedIds.has(event.id)?'disabled':''}>${h(event.text)}</button>`).join('')}</div>
        <div class="g2-actions"><button class="primaryButton" type="button" data-sequence-check>Check Order</button></div>`;

      area().innerHTML=parchmentShell({
        rail:stageRail(MANUSCRIPT_STAGES,3),
        main,
        aside:`<div class="g2-hint-panel"><button class="secondaryButton" type="button" data-g2-clue>Request a Clue</button><p>The clue will only narrow one event position.</p></div>`,
        tray:trayHtml,
        className:'g2-manuscript'
      });

      wireDrag(area(),(tileId,dropId)=>{
        const existing=manuscriptState.sequencePlaced.indexOf(tileId);
        if(existing>=0) manuscriptState.sequencePlaced[existing]='';
        manuscriptState.sequencePlaced[Number(dropId)]=tileId;
        playTone('paper');
        this.renderSequenceBoard();
      });

      area().querySelector('[data-sequence-check]')?.addEventListener('click',()=>{
        const expected=['0','1','2'];
        const correct=expected.every((id,index)=>manuscriptState.sequencePlaced[index]===id);
        const outcome=submit(item,correct,{echo:false});
        if(outcome.state==='repair') return renderOutcome(outcome,item,()=>{},null);
        renderOutcome(outcome,item,()=>this.next(),()=>{
          manuscriptState.sequencePlaced=expected;
          this.renderSequenceBoard();
        });
      });

      wireClue(item,()=>{
        const firstEmpty=manuscriptState.sequencePlaced.findIndex(x=>!x);
        if(firstEmpty>=0) area().querySelector(`[data-g2-drop="${firstEmpty}"]`)?.classList.add('clue');
      });
    },

    renderInterpret(){
      const q=manuscriptState.caseFile.translations[manuscriptState.caseFile.translations.length-1];
      const skill=skillForQuestion(q);
      const item={
        id:`manuscript:interpret:${q.id}`,
        sourceId:q.id,sourceIds:[q.id],sourceTraces:[sourceTrace(q)],
        day:q.day,sourceRef:q.sourceRef,skillId:skill.id,skillLabel:'Set-text interpretation',
        q,clue:clueFromQuestion(q,'Find the finite verb first, then keep every key idea.'),
        mustRemember:mustRememberFromQuestion(q),answerDisplay:q.answerExample||answerFromQuestion(q)
      };
      manuscriptState.current=item;
      manuscriptState.interpretPlaced=[];
      manuscriptState.interpretGroups=(q.groups||[]).map((group,index)=>({
        id:String(index),
        choices:Array.isArray(group)?group.map(String):[]
      }));
      this.renderInterpretBoard();
    },

    renderInterpretBoard(){
      const item=manuscriptState.current;
      const q=item.q;
      const allChoices=[];
      manuscriptState.interpretGroups.forEach(group=>{
        const choice=group.choices[0];
        if(choice) allChoices.push({groupId:group.id,text:choice});
      });
      const shuffled=seededShuffle(allChoices,`interpret-${item.id}`);
      const used=new Set(manuscriptState.interpretPlaced.map(x=>x.groupId));

      const main=`
        <div class="g2-board-kicker">${sourcePill(item)}</div>
        <h2>Interpret the final line.</h2>
        <div class="g2-manuscript-text"><p>${h(q.context)}</p></div>
        <div class="g2-translation-strip" data-g2-drop="interpret">
          ${manuscriptState.interpretPlaced.length
            ? manuscriptState.interpretPlaced.map((x,index)=>`<button class="g2-built-tile" type="button" data-interpret-remove="${index}">${h(x.text)}</button>`).join('')
            : '<span class="g2-placeholder">Build the English translation from its required key ideas.</span>'}
        </div>
        <div class="g2-clue-slot"></div><div class="g2-feedback-slot"></div>`;

      const tray=`<div class="g2-tray-head"><div><strong>Translation Fragments</strong><small>These fragments come directly from the source checker groups.</small></div></div>
        <div class="g2-tile-tray">${shuffled.map(choice=>`<button class="g2-tile ${used.has(choice.groupId)?'used':''}" type="button" data-g2-tile="${choice.groupId}" ${used.has(choice.groupId)?'disabled':''}>${h(choice.text)}</button>`).join('')}</div>
        <div class="g2-actions"><button class="primaryButton" type="button" data-interpret-check>Interpret</button></div>`;

      area().innerHTML=parchmentShell({
        rail:stageRail(MANUSCRIPT_STAGES,4),
        main,
        aside:`<div class="g2-hint-panel"><button class="secondaryButton" type="button" data-g2-clue>Request a Clue</button><p>No timer. Keep the meaning natural and complete.</p></div>`,
        tray,
        className:'g2-manuscript'
      });

      wireDrag(area(),(tileId,dropId)=>{
        if(dropId!=='interpret') return;
        const group=manuscriptState.interpretGroups.find(x=>x.id===tileId);
        if(!group || manuscriptState.interpretPlaced.some(x=>x.groupId===tileId)) return;
        manuscriptState.interpretPlaced.push({groupId:tileId,text:group.choices[0]});
        playTone('paper');
        this.renderInterpretBoard();
      });

      area().querySelectorAll('[data-interpret-remove]').forEach(button=>{
        button.addEventListener('click',()=>{
          manuscriptState.interpretPlaced.splice(Number(button.dataset.interpretRemove),1);
          this.renderInterpretBoard();
        });
      });

      area().querySelector('[data-interpret-check]')?.addEventListener('click',()=>{
        const selected=manuscriptState.interpretPlaced.map(x=>x.groupId);
        const expected=manuscriptState.interpretGroups.map(x=>x.id);
        const correct=selected.length===expected.length && expected.every((id,index)=>selected[index]===id);
        const outcome=submit(item,correct,{echo:false});
        if(outcome.state==='repair') return renderOutcome(outcome,item,()=>{},null);
        renderOutcome(outcome,item,()=>continueAfterResolved(this),()=>{
          manuscriptState.interpretPlaced=manuscriptState.interpretGroups.map(group=>({groupId:group.id,text:group.choices[0]}));
          this.renderInterpretBoard();
        });
      });

      wireClue(item,()=>{
        const expectedNext=String(manuscriptState.interpretPlaced.length);
        const button=area().querySelector(`[data-g2-tile="${expectedNext}"]`);
        button?.classList.add('clue');
      });
    },

    renderEcho(skillId){
      if(String(skillId).endsWith(':sequence')){
        const translations=unlockedBank()
          .filter(q=>q.sourceRef===manuscriptState.caseFile.sourceRef && q.topic==='Set-text translation' && !session.usedSourceIds.has(q.id))
          .slice(0,3);
        if(translations.length>=3){
          const item={
            id:`echo:manuscript:sequence:${translations.map(q=>q.id).join('-')}:${session.echoIndex}`,
            sourceId:translations[0].id,
            sourceIds:translations.map(q=>q.id),
            sourceTraces:translations.map(sourceTrace),
            day:translations[0].day,
            sourceRef:translations[0].sourceRef,
            skillId,
            skillLabel:'Passage event sequence',
            clue:'Use the order of the source passage itself.',
            mustRemember:'Sequence the events from the passage, not from guesswork.',
            answerDisplay:translations.map(q=>q.answerExample||answerFromQuestion(q)).join(' → ')
          };
          const events=translations.map((q,index)=>({id:String(index),text:q.answerExample||answerFromQuestion(q)}));
          let placed=['','',''];

          const render=()=>{
            const used=new Set(placed.filter(Boolean));
            const tray=seededShuffle(events,`echo-seq-${item.id}`);
            area().innerHTML=parchmentShell({
              rail:`<div class="g2-echo-label"><strong>Echo Round</strong><small>One last look at today’s tricky patterns.</small></div>`,
              main:`<h2>Sequence a different part of the same passage.</h2>
                <div class="g2-sequence-slots">${placed.map((id,index)=>{
                  const event=events.find(x=>x.id===id);
                  return `<button class="g2-dropzone g2-sequence-slot" type="button" data-g2-drop="${index}"><span>${index+1}</span>${event?h(event.text):'Drop event'}</button>`;
                }).join('')}</div>
                <div class="g2-feedback-slot"></div>`,
              tray:`<div class="g2-tile-tray">${tray.map(event=>`<button class="g2-tile ${used.has(event.id)?'used':''}" type="button" data-g2-tile="${event.id}" ${used.has(event.id)?'disabled':''}>${h(event.text)}</button>`).join('')}</div>
                <div class="g2-actions"><button class="primaryButton" type="button" data-echo-seq-check>Check Order</button></div>`,
              className:'g2-manuscript'
            });
            wireDrag(area(),(tileId,dropId)=>{
              const old=placed.indexOf(tileId);
              if(old>=0) placed[old]='';
              placed[Number(dropId)]=tileId;
              render();
            });
            area().querySelector('[data-echo-seq-check]')?.addEventListener('click',()=>{
              const correct=['0','1','2'].every((id,index)=>placed[index]===id);
              const outcome=submit(item,correct,{echo:true});
              if(outcome.state==='repair') return renderOutcome(outcome,item,()=>{},null);
              renderOutcome(outcome,item,()=>continueAfterResolved(this),null);
            });
          };
          render();
          return;
        }
      }

      const related=unlockedBank().filter(q=>{
        const skill=skillForQuestion(q);
        return skill.id===skillId && q.sourceRef===manuscriptState.caseFile.sourceRef;
      });

      const translation=related.find(q=>q.topic==='Set-text translation' && !session.usedSourceIds.has(q.id));
      const restore=related.find(q=>q.topic==='Restore the set text' && !session.usedSourceIds.has(q.id));

      if(restore){
        const skill=skillForQuestion(restore);
        const item={
          id:`echo:manuscript:${restore.id}:${session.echoIndex}`,
          sourceId:restore.id,sourceIds:[restore.id],sourceTraces:[sourceTrace(restore)],
          day:restore.day,sourceRef:restore.sourceRef,skillId:skill.id,skillLabel:'Restore the set text',
          q:restore,clue:clueFromQuestion(restore),mustRemember:mustRememberFromQuestion(restore),answerDisplay:String(restore.a||'')
        };
        const choices=seededShuffle(Array.from(new Set([String(restore.a||''),...(restore.opts||[]).map(String)])),`echo-restore-${restore.id}`).slice(0,4);
        area().innerHTML=parchmentShell({
          rail:`<div class="g2-echo-label"><strong>Echo Round</strong><small>One last look at today’s tricky patterns.</small></div>`,
          main:`<h2>Restore one related line.</h2><div class="g2-manuscript-text"><p>${h(restore.context)}</p></div><div class="g2-single-targets">${choices.map(value=>`<button class="g2-dropzone" type="button" data-echo-choice="${h(value)}">${h(value)}</button>`).join('')}</div><div class="g2-feedback-slot"></div>`,
          className:'g2-manuscript'
        });
        area().querySelectorAll('[data-echo-choice]').forEach(button=>{
          button.addEventListener('click',()=>{
            const outcome=submit(item,norm(button.dataset.echoChoice)===norm(restore.a),{echo:true});
            if(outcome.state==='repair') return renderOutcome(outcome,item,()=>{},null);
            renderOutcome(outcome,item,()=>continueAfterResolved(this),null);
          });
        });
        return;
      }

      if(translation){
        const skill=skillForQuestion(translation);
        const item={
          id:`echo:manuscript:${translation.id}:${session.echoIndex}`,
          sourceId:translation.id,sourceIds:[translation.id],sourceTraces:[sourceTrace(translation)],
          day:translation.day,sourceRef:translation.sourceRef,skillId:skill.id,skillLabel:'Set-text interpretation',
          q:translation,clue:clueFromQuestion(translation),mustRemember:mustRememberFromQuestion(translation),answerDisplay:translation.answerExample||answerFromQuestion(translation)
        };
        const groups=translation.groups||[];
        const fragments=groups.map((group,index)=>({id:String(index),text:String((group||[])[0]||'')})).filter(x=>x.text);
        let placed=[];
        const render=()=>{
          area().innerHTML=parchmentShell({
            rail:`<div class="g2-echo-label"><strong>Echo Round</strong><small>One last look at today’s tricky patterns.</small></div>`,
            main:`<h2>Rebuild one related translation.</h2><div class="g2-manuscript-text"><p>${h(translation.context)}</p></div><div class="g2-translation-strip" data-g2-drop="echo">${placed.map((x,index)=>`<button class="g2-built-tile" type="button" data-echo-remove="${index}">${h(x.text)}</button>`).join('')||'<span class="g2-placeholder">Build the translation.</span>'}</div><div class="g2-feedback-slot"></div>`,
            tray:`<div class="g2-tile-tray">${seededShuffle(fragments,`echo-frags-${translation.id}`).map(x=>`<button class="g2-tile ${placed.some(y=>y.id===x.id)?'used':''}" type="button" data-g2-tile="${x.id}" ${placed.some(y=>y.id===x.id)?'disabled':''}>${h(x.text)}</button>`).join('')}</div><div class="g2-actions"><button class="primaryButton" type="button" data-echo-check>Check</button></div>`,
            className:'g2-manuscript'
          });
          wireDrag(area(),(tileId,dropId)=>{
            if(dropId!=='echo') return;
            const fragment=fragments.find(x=>x.id===tileId);
            if(fragment&&!placed.some(x=>x.id===tileId)){placed.push(fragment);render();}
          });
          area().querySelectorAll('[data-echo-remove]').forEach(button=>button.addEventListener('click',()=>{placed.splice(Number(button.dataset.echoRemove),1);render();}));
          area().querySelector('[data-echo-check]')?.addEventListener('click',()=>{
            const correct=placed.length===fragments.length && fragments.every((x,index)=>placed[index]?.id===x.id);
            const outcome=submit(item,correct,{echo:true});
            if(outcome.state==='repair') return renderOutcome(outcome,item,()=>{},null);
            renderOutcome(outcome,item,()=>continueAfterResolved(this),null);
          });
        };
        render();
        return;
      }

      showResult();
    }
  };

  // ---------------------------------------------------------------------------
  // Echo support for Forma/Mosaic delegates back into their normal renderers.
  // ---------------------------------------------------------------------------
  Forma.renderEcho = Forma.renderEcho.bind(Forma);
  Mosaic.renderEcho = Mosaic.renderEcho.bind(Mosaic);

  const MODULES={forma:Forma,mosaic:Mosaic,verbum:Verbum,manuscript:Manuscript};

  // Ensure only game-specific persistence is written.
  function debugPools(){
    const bundles=setTextBundles();
    return {
      unlockedQuestions:unlockedBank().length,
      presentForms:presentFormItems().length,
      accusativeForms:accusativeForgeItems().length,
      sentenceItems:sentenceItems().length,
      vocabL1:vocabPairItems(3).length,
      vocabL2:vocabPairItems(6).length,
      perfectPairs:perfectPairItems().length,
      wordClasses:wordClassItems().length,
      prepCases:prepCaseItems().length,
      manuscript:Object.fromEntries(Object.entries(bundles).map(([key,b])=>[key,{
        translations:b.translations.length,
        restores:b.restores.length,
        grammar:b.grammar.length,
        comprehension:b.comprehension.length
      }]))
    };
  }

  window.GameV2={
    version:VERSION,
    openHub,
    start,
    startLevel,
    exit,
    renderHubProgress,
    debugPools,
    contentAvailable,
    questionUnlocked
  };

  ensureStore();
  renderHubProgress();
})();