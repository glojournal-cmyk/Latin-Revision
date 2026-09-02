const bank = window.LATIN_BANK || [];
const blocks = window.LATIN_BLOCKS || [];
const notes = window.LATIN_NOTES || {};
const byId = new Map(bank.map(question => [question.id, question]));

const masteryTarget = 85;
const stateKey = 'latinSummerV8State';
const olderStateKeys = ['latinSummerV7State', 'latinSummerV6State', 'latinV3State'];

let state;
let migrationMessage = '';
let quizQuestions = [];
let current = 0;
let score = 0;
let quizTitle = '';
let quizDay = '';
let reviewMode = false;
let sessionInfo = {};

function emptyState() {
  return {
    version: 8,
    attempts: [],
    reviews: {},
    results: {},
    cycles: {},
    settings: { sound: true },
    activeSession: null,
    lastSaved: null,
    lastBackup: null,
  };
}

function mergeState(saved) {
  const output = Object.assign(emptyState(), saved || {});
  output.version = 8;
  output.attempts = Array.isArray(output.attempts) ? output.attempts : [];
  output.reviews = output.reviews || {};
  output.results = output.results || {};
  output.cycles = output.cycles || {};
  output.settings = Object.assign({ sound: true }, output.settings || {});
  output.activeSession = output.activeSession || null;
  Object.values(output.cycles).forEach(cycle => {
    cycle.seen = Array.isArray(cycle.seen) ? cycle.seen : [];
    cycle.reviewSeen = Array.isArray(cycle.reviewSeen) ? cycle.reviewSeen : [];
    cycle.lastSession = Array.isArray(cycle.lastSession) ? cycle.lastSession : [];
    cycle.round = Number(cycle.round) || 1;
    cycle.answered = Number(cycle.answered) || 0;
    cycle.correct = Number(cycle.correct) || 0;
  });
  return output;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(stateKey) || 'null');
    if (saved) return mergeState(saved);
  } catch (error) {}

  for (const key of olderStateKeys) {
    try {
      const older = JSON.parse(localStorage.getItem(key) || 'null');
      if (older) {
        migrationMessage = 'Your earlier scores, saved mistakes and review dates were carried into V8. Reliable mastery cycles start from the questions you complete in this version.';
        const migrated = mergeState(older);
        migrated.cycles = {};
        migrated.activeSession = null;
        return migrated;
      }
    } catch (error) {}
  }
  return emptyState();
}

state = loadState();

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function stripMarks(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function norm(value) {
  return stripMarks(value)
    .toLowerCase()
    .replace(/[“”‘’.,!?;:'"()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripAnswerNotes(value) {
  return String(value || '').replace(/\s*\([^)]*\)/g, ' ');
}

function normExact(value) {
  return norm(stripAnswerNotes(value)).replace(/^(the|a|an)\s+/, '');
}

function tokens(value) {
  return new Set(norm(value).split(' ').filter(Boolean));
}

function phrase(answer, option) {
  return (` ${norm(answer)} `).includes(` ${norm(option)} `);
}

function shuffle(values) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [output[index], output[randomIndex]] = [output[randomIndex], output[index]];
  }
  return output;
}

function todayISO() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + number);
  return date.toISOString().slice(0, 10);
}

function formatStamp(value) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not yet' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function save() {
  state.lastSaved = new Date().toISOString();
  localStorage.setItem(stateKey, JSON.stringify(state));
  renderSaveStatus();
}

function renderSaveStatus() {
  const saved = document.getElementById('lastSaved');
  const backup = document.getElementById('lastBackup');
  if (saved) saved.textContent = formatStamp(state.lastSaved);
  if (backup) backup.textContent = state.lastBackup ? formatStamp(state.lastBackup) : 'No backup exported yet';
  const sound = state.settings.sound !== false;
  document.getElementById('soundButton').setAttribute('aria-pressed', String(sound));
  document.getElementById('soundLabel').textContent = sound ? 'Sound on' : 'Sound off';
}

function show(id) {
  ['dashboard', 'notes', 'quiz', 'results'].forEach(section => document.getElementById(section).classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showDashboard() {
  renderDashboard();
  show('dashboard');
}

function cycleFor(day) {
  if (!state.cycles[day]) {
    state.cycles[day] = {
      seen: [], reviewSeen: [], lastSession: [], round: 1,
      answered: 0, correct: 0, completedPercent: null, completedRound: null,
    };
  }
  return state.cycles[day];
}

function focusPoolFor(block) {
  return bank.filter(question => question.day === block.day);
}

function historyPoolFor(block) {
  const sourceDays = block.sourceDays || [];
  return bank.filter(question => sourceDays.includes(question.day) && question.day !== block.day);
}

function dueQuestions() {
  return Object.entries(state.reviews)
    .filter(([, review]) => review.due <= todayISO())
    .map(([id]) => byId.get(id))
    .filter(Boolean);
}

function latestPct(day) {
  const attempts = state.attempts.filter(attempt => attempt.day === day);
  return attempts.length ? attempts[attempts.length - 1].percent : null;
}

function phaseFor(day) {
  if (['18 Jul', '19 Jul'].includes(day)) return 'Week 1 — diagnostic and foundations';
  if (['24 Jul', '25 Jul', '26 Jul', '27 Jul', '28 Jul', '29 Jul', '31 Jul'].includes(day)) return 'Week 2 — core content build';
  if (['9 Aug', '11 Aug', '12 Aug'].includes(day)) return 'Week 4 — retrieval and grammar';
  if (['15 Aug', '16 Aug', '18 Aug', '19 Aug'].includes(day)) return 'Week 5 — stronger language';
  if (['22 Aug', '23 Aug', '24 Aug', '25 Aug', '28 Aug'].includes(day)) return 'Week 6 — higher skills and set texts';
  return 'Week 7 — assess and consolidate';
}

function topicSummary() {
  const counts = new Map();
  Object.keys(state.reviews).forEach(id => {
    const question = byId.get(id);
    if (!question) return;
    const topic = question.topic || question.day || 'Other';
    counts.set(topic, (counts.get(topic) || 0) + 1);
  });
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return items.length ? items.map(([topic, count]) => `${topic}: ${count}`).join(' · ') : 'Held out of normal practice';
}

function renderDashboard() {
  const reviewEntries = Object.entries(state.reviews);
  const due = reviewEntries.filter(([, review]) => review.due <= todayISO()).length;
  document.getElementById('totalcount').textContent = bank.length;
  document.getElementById('duecount').textContent = due;
  document.getElementById('weakcount').textContent = reviewEntries.length;
  document.getElementById('weakSummary').textContent = topicSummary();
  document.getElementById('duebtn').disabled = !due;
  document.getElementById('resultDueButton').disabled = !due;

  const completedCycles = blocks
    .filter(block => !block.mode && focusPoolFor(block).length)
    .map(block => cycleFor(block.day).completedPercent)
    .filter(value => Number.isFinite(value));
  const overall = completedCycles.length
    ? Math.round(completedCycles.reduce((total, value) => total + value, 0) / completedCycles.length)
    : 0;
  document.getElementById('overall').textContent = `${overall}%`;
  document.getElementById('overallbar').style.width = `${overall}%`;

  const migration = document.getElementById('migration');
  if (migrationMessage) {
    migration.textContent = migrationMessage;
    migration.classList.remove('hidden');
  } else {
    migration.classList.add('hidden');
  }

  const resumePanel = document.getElementById('resumePanel');
  if (state.activeSession) {
    const remaining = Math.max(0, state.activeSession.qids.length - state.activeSession.current);
    document.getElementById('resumeText').textContent = `${state.activeSession.title} · ${remaining} question${remaining === 1 ? '' : 's'} remaining.`;
    resumePanel.classList.remove('hidden');
  } else {
    resumePanel.classList.add('hidden');
  }

  const list = document.getElementById('daylist');
  list.innerHTML = '';
  let phase = '';
  blocks.forEach(block => {
    const nextPhase = phaseFor(block.day);
    if (nextPhase !== phase) {
      phase = nextPhase;
      const heading = document.createElement('div');
      heading.className = 'phase';
      heading.textContent = phase;
      list.appendChild(heading);
    }

    const focus = focusPoolFor(block);
    const history = historyPoolFor(block);
    const cycle = cycleFor(block.day);
    const validFocus = new Set(focus.map(question => question.id));
    cycle.seen = cycle.seen.filter(id => validFocus.has(id));
    const seen = cycle.seen.length;
    const remaining = Math.max(0, focus.length - seen);
    const latest = latestPct(block.day);
    const completed = cycle.completedPercent;
    let status = 'Not started';
    let statusClass = 'new';
    if (Number.isFinite(completed)) {
      status = completed >= masteryTarget ? `Mastered ${completed}%` : `Cycle ${completed}%`;
      statusClass = completed >= masteryTarget ? 'mastered' : 'started';
    } else if (seen || latest !== null) {
      status = latest === null ? 'In progress' : `Session ${latest}%`;
      statusClass = 'started';
    }

    let action = `Start ${Math.min(block.sample, focus.length || history.length)} questions`;
    if (block.mode === 'weak') action = 'Extra practice — schedule unchanged';
    if (block.mode === 'due') action = 'Do due review';
    if (block.day === '30 Aug') action = 'Start balanced assessment';
    const poolAvailable = block.mode === 'due' ? due : block.mode ? reviewEntries.length : (focus.length + history.length);
    const countLine = focus.length
      ? `<span>${focus.length} focus questions</span><span class="cycle-badge">Cycle ${cycle.round}: ${seen}/${focus.length} seen</span>${history.length ? `<span>${history.length} cumulative-review questions</span>` : '<span>No immediate repeats</span>'}`
      : `<span>${history.length} balanced review questions</span>`;

    const card = document.createElement('article');
    card.className = 'day-card';
    card.innerHTML = `<div class="day-main"><div><div class="day-title"><h2>${esc(block.day)}</h2><strong>${esc(block.label)}</strong><span class="status ${statusClass}">${esc(status)}</span></div><div class="cycle-line">${countLine}</div></div><button class="primary" ${poolAvailable ? '' : 'disabled'}>${esc(action)}</button></div><div class="scope"><strong>Locked scope:</strong> ${esc(block.scope)}</div>`;
    card.querySelector('button').onclick = () => openNotes(block.day);
    list.appendChild(card);
  });
  renderSaveStatus();
}

function openNotes(day) {
  const block = blocks.find(item => item.day === day);
  const note = notes[day] || { title: day, intro: 'Review the exact scope before practice.', must: [], sections: [] };
  document.getElementById('notesTitle').textContent = note.title;
  document.getElementById('notesIntro').textContent = note.intro || '';
  document.getElementById('notesScope').textContent = block.scope;
  document.getElementById('mustList').innerHTML = (note.must || note.items || []).map(item => `<li>${esc(item)}</li>`).join('');
  document.getElementById('notesSections').innerHTML = (note.sections || []).map(section => `<section class="note-section"><h3>${esc(section.title)}</h3><ul>${(section.items || []).map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>`).join('');
  document.getElementById('notesStartButton').onclick = () => startBlock(block);
  show('notes');
}

function balancedTake(pool, count) {
  if (!count || !pool.length) return [];
  const written = shuffle(pool.filter(question => question.type !== 'mc'));
  const multipleChoice = shuffle(pool.filter(question => question.type === 'mc'));
  const writtenTarget = Math.min(written.length, Math.ceil(count * 0.4));
  const selected = written.slice(0, writtenTarget);
  selected.push(...multipleChoice.slice(0, Math.max(0, count - selected.length)));
  if (selected.length < count) {
    const selectedIds = new Set(selected.map(question => question.id));
    selected.push(...shuffle(pool.filter(question => !selectedIds.has(question.id))).slice(0, count - selected.length));
  }
  return shuffle(selected.slice(0, count));
}

function stratifiedSample(pool, count) {
  const groups = new Map();
  shuffle(pool).forEach(question => {
    if (!groups.has(question.day)) groups.set(question.day, []);
    groups.get(question.day).push(question);
  });
  const days = shuffle([...groups.keys()]);
  const selected = [];
  while (selected.length < count && days.some(day => groups.get(day).length)) {
    for (const day of days) {
      if (selected.length >= count) break;
      const group = groups.get(day);
      if (group.length) selected.push(group.shift());
    }
  }
  return balancedTake(selected, Math.min(count, selected.length));
}

function resetCycleRound(cycle) {
  cycle.round += 1;
  cycle.seen = [];
  cycle.reviewSeen = [];
  cycle.answered = 0;
  cycle.correct = 0;
}

function selectFresh(block) {
  const pending = new Set(Object.keys(state.reviews));
  const focusAll = focusPoolFor(block);
  const historyAll = historyPoolFor(block);
  const cycle = cycleFor(block.day);
  const focusIds = new Set(focusAll.map(question => question.id));
  cycle.seen = cycle.seen.filter(id => focusIds.has(id));

  if (focusAll.length && cycle.seen.length >= focusAll.length) resetCycleRound(cycle);

  let focusRemaining = focusAll.filter(question => !cycle.seen.includes(question.id) && !pending.has(question.id) && !(cycle.seen.length === 0 && cycle.round > 1 && cycle.lastSession.includes(question.id)));
  if (!focusRemaining.length && focusAll.some(question => !cycle.seen.includes(question.id) && !pending.has(question.id))) {
    focusRemaining = focusAll.filter(question => !cycle.seen.includes(question.id) && !pending.has(question.id));
  }
  let historyRemaining = historyAll.filter(question => !pending.has(question.id) && !cycle.reviewSeen.includes(question.id) && !cycle.lastSession.includes(question.id));
  if (!historyRemaining.length && historyAll.length) {
    cycle.reviewSeen = [];
    historyRemaining = historyAll.filter(question => !pending.has(question.id) && !cycle.lastSession.includes(question.id));
  }

  let questions = [];
  if (focusAll.length) {
    const focusTarget = historyAll.length ? Math.min(focusRemaining.length, Math.ceil(block.sample * 0.8)) : Math.min(focusRemaining.length, block.sample);
    const focusQuestions = balancedTake(focusRemaining, focusTarget);
    const historyQuestions = balancedTake(historyRemaining, Math.min(historyRemaining.length, block.sample - focusQuestions.length));
    questions = shuffle([...focusQuestions, ...historyQuestions]);
    if (questions.length < block.sample) {
      const used = new Set(questions.map(question => question.id));
      const refill = balancedTake([...focusRemaining, ...historyRemaining].filter(question => !used.has(question.id)), block.sample - questions.length);
      questions.push(...refill);
    }
  } else {
    questions = stratifiedSample(historyRemaining, Math.min(block.sample, historyRemaining.length));
  }

  if (!questions.length) return { questions: [], round: cycle.round, remaining: 0, total: focusAll.length };
  cycle.lastSession = questions.map(question => question.id);
  questions.filter(question => question.day !== block.day).forEach(question => {
    if (!cycle.reviewSeen.includes(question.id)) cycle.reviewSeen.push(question.id);
  });
  save();
  return {
    questions,
    round: cycle.round,
    remaining: Math.max(0, focusAll.length - cycle.seen.length),
    total: focusAll.length,
  };
}

function startBlock(block) {
  if (block.mode === 'weak') {
    const pool = Object.keys(state.reviews).map(id => byId.get(id)).filter(Boolean);
    if (!pool.length) return void alert('There are no saved weak questions.');
    reviewMode = true;
    sessionInfo = { kind: 'extra-review', advanceReview: false };
    startQuiz(balancedTake(pool, Math.min(block.sample, pool.length)), `${block.day} — extra weak-question practice`, block.day);
    return;
  }
  if (block.mode === 'due') {
    const pool = dueQuestions();
    if (!pool.length) return void alert('No reviews are due today.');
    reviewMode = true;
    sessionInfo = { kind: 'review', advanceReview: true };
    startQuiz(balancedTake(pool, Math.min(block.sample, pool.length)), `${block.day} — due review`, block.day);
    return;
  }
  if (block.day === '30 Aug') {
    const pending = new Set(Object.keys(state.reviews));
    const pool = historyPoolFor(block).filter(question => !pending.has(question.id));
    reviewMode = false;
    sessionInfo = { kind: 'assessment', advanceReview: true };
    startQuiz(stratifiedSample(pool, Math.min(block.sample, pool.length)), '30 Aug — balanced full assessment', block.day);
    return;
  }

  const selected = selectFresh(block);
  if (!selected.questions.length) {
    alert('Every unseen focus question is currently held for scheduled review. Complete Due today when those questions become available.');
    showDashboard();
    return;
  }
  reviewMode = false;
  sessionInfo = { kind: 'fresh', round: selected.round, remaining: selected.remaining, total: selected.total, focusDay: block.day, advanceReview: true };
  startQuiz(selected.questions, `${block.day} — ${block.label}`, block.day);
}

function attemptedContentDays() {
  return blocks
    .filter(block => !block.mode && block.day !== '30 Aug' && latestPct(block.day) !== null)
    .map(block => block.day);
}

function startMixed() {
  const days = attemptedContentDays();
  if (!days.length) return void alert('Complete at least one dated block first.');
  const pending = new Set(Object.keys(state.reviews));
  const pool = bank.filter(question => days.includes(question.day) && !pending.has(question.id));
  if (!pool.length) return void alert('No mixed questions are currently available.');
  reviewMode = false;
  sessionInfo = { kind: 'mixed', advanceReview: true };
  startQuiz(stratifiedSample(pool, Math.min(15, pool.length)), 'Balanced mixed test — attempted blocks', 'Mixed');
}

function startDue() {
  const pool = dueQuestions();
  if (!pool.length) return void alert('No reviews are due today.');
  reviewMode = true;
  sessionInfo = { kind: 'review', advanceReview: true };
  startQuiz(balancedTake(pool, Math.min(20, pool.length)), 'Due spaced-repetition review', 'Due');
}

function startQuiz(questions, title, day) {
  quizQuestions = questions;
  current = 0;
  score = 0;
  quizTitle = title;
  quizDay = day;
  state.activeSession = {
    qids: questions.map(question => question.id), title, day, current: 0, score: 0,
    reviewMode, sessionInfo: { ...sessionInfo },
  };
  save();
  show('quiz');
  renderQuestion();
}

function resumeSession() {
  const active = state.activeSession;
  if (!active) return;
  const questions = active.qids.map(id => byId.get(id)).filter(Boolean);
  if (!questions.length) {
    state.activeSession = null;
    save();
    return showDashboard();
  }
  quizQuestions = questions;
  quizTitle = active.title;
  quizDay = active.day;
  score = active.score || 0;
  reviewMode = Boolean(active.reviewMode);
  sessionInfo = active.sessionInfo || {};
  if (active.current >= questions.length) {
    current = questions.length - 1;
    return finish();
  }
  current = active.current || 0;
  show('quiz');
  renderQuestion();
}

function pauseQuiz() {
  if (!confirm('Pause this practice? Your place and score will be saved, and you can continue from the home screen.')) return;
  showDashboard();
}

function renderQuestion() {
  const question = quizQuestions[current];
  document.getElementById('quizTitle').textContent = quizTitle;
  document.getElementById('questionCounter').textContent = `Question ${current + 1} of ${quizQuestions.length}`;
  document.getElementById('quizBar').style.width = `${current / quizQuestions.length * 100}%`;
  const badge = sessionInfo.kind === 'review' ? 'Due review'
    : sessionInfo.kind === 'extra-review' ? 'Extra practice · schedule unchanged'
      : sessionInfo.kind === 'assessment' ? 'Balanced assessment'
        : sessionInfo.kind === 'mixed' ? 'Balanced mixed test'
          : `Cycle ${sessionInfo.round || 1} · focus first`;
  document.getElementById('freshBadge').textContent = badge;

  const context = document.getElementById('questionContext');
  context.textContent = question.context || '';
  context.classList.toggle('hidden', !question.context);
  document.getElementById('direction').textContent = question.direction || question.topic;
  document.getElementById('questionText').textContent = question.q;
  const area = document.getElementById('inputArea');
  area.innerHTML = '';
  if (question.type === 'mc') {
    const box = document.createElement('div');
    box.className = 'answers';
    shuffle(question.opts).forEach(option => {
      const button = document.createElement('button');
      button.className = 'answer-button';
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.textContent = option;
      button.onclick = () => {
        box.querySelectorAll('button').forEach(item => {
          item.classList.remove('selected');
          item.dataset.selected = '';
          item.setAttribute('aria-pressed', 'false');
        });
        button.classList.add('selected');
        button.dataset.selected = '1';
        button.setAttribute('aria-pressed', 'true');
      };
      box.appendChild(button);
    });
    area.appendChild(box);
  } else {
    const placeholder = question.type === 'unordered_set'
      ? 'Write all required forms in any order.'
      : 'Write the full answer here.';
    area.innerHTML = `<textarea id="textAnswer" autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="${placeholder}"></textarea>`;
  }
  document.getElementById('feedback').className = 'feedback hidden';
  document.getElementById('checkButton').classList.remove('hidden');
  document.getElementById('nextButton').classList.add('hidden');
}

function parseUnorderedAnswer(answer, expectedItems) {
  const expected = expectedItems.map(item => normExact(item));
  const allSingleWords = expected.every(item => !item.includes(' '));
  let parts;
  if (allSingleWords) {
    parts = norm(answer.replace(/\band\b/gi, ' ').replace(/[;,/|]/g, ' ')).split(' ').filter(Boolean);
  } else {
    parts = answer.split(/\s*(?:,|;|\/|\||\band\b)\s*/i).map(normExact).filter(Boolean);
  }
  return [...new Set(parts)];
}

function mark(question, answer) {
  if (question.type === 'exact_any') {
    const ok = (question.accepted || []).some(accepted => normExact(accepted) === normExact(answer));
    return { ok, missing: [], extra: [] };
  }
  if (question.type === 'unordered_set') {
    const expected = (question.setItems || []).map(normExact);
    const given = parseUnorderedAnswer(answer, question.setItems || []);
    const missing = expected.filter(item => !given.includes(item));
    const extra = given.filter(item => !expected.includes(item));
    return { ok: missing.length === 0 && extra.length === 0, missing, extra };
  }
  if (question.type === 'eng_auto') {
    if ((question.accepted || []).some(accepted => norm(accepted) === norm(answer))) return { ok: true, missing: [], extra: [] };
    const missing = [];
    (question.groups || []).forEach(group => {
      if (!group.some(option => phrase(answer, option))) missing.push(group[0]);
    });
    return { ok: missing.length === 0, missing, extra: [] };
  }
  if (question.type === 'lat_auto') {
    if ((question.accepted || []).some(accepted => norm(accepted) === norm(answer))) return { ok: true, missing: [], extra: [] };
    const answerTokens = tokens(answer);
    const missing = [];
    (question.latinGroups || []).forEach(group => {
      if (!group.every(item => answerTokens.has(norm(item)))) missing.push(group.join(' + '));
    });
    const allowed = new Set();
    (question.latinGroups || []).flat().forEach(item => allowed.add(norm(item)));
    (question.accepted || []).forEach(accepted => tokens(accepted).forEach(item => allowed.add(item)));
    const extra = [...answerTokens].filter(item => !allowed.has(item));
    return { ok: missing.length === 0 && extra.length === 0, missing, extra };
  }
  return { ok: false, missing: [], extra: [] };
}

function updateReview(question, ok) {
  state.results[question.id] = { ok, date: new Date().toISOString() };
  if (sessionInfo.kind === 'extra-review' && !sessionInfo.advanceReview) return;
  if (!ok) {
    state.reviews[question.id] = { stage: 1, due: addDays(2), lastWrong: new Date().toISOString() };
    return;
  }
  const review = state.reviews[question.id];
  if (reviewMode && sessionInfo.advanceReview && review) {
    if (review.stage === 1) state.reviews[question.id] = { stage: 2, due: addDays(7), lastWrong: review.lastWrong };
    else delete state.reviews[question.id];
  }
}

function recordFocusResult(question, ok) {
  if (sessionInfo.kind !== 'fresh' || question.day !== sessionInfo.focusDay) return;
  const cycle = cycleFor(sessionInfo.focusDay);
  if (!cycle.seen.includes(question.id)) {
    cycle.seen.push(question.id);
    cycle.answered += 1;
    if (ok) cycle.correct += 1;
  }
  const focusTotal = focusPoolFor(blocks.find(block => block.day === sessionInfo.focusDay)).length;
  sessionInfo.remaining = Math.max(0, focusTotal - cycle.seen.length);
  if (focusTotal && cycle.seen.length >= focusTotal) {
    cycle.completedPercent = Math.round(cycle.correct / Math.max(1, cycle.answered) * 100);
    cycle.completedRound = cycle.round;
    sessionInfo.cycleCompleted = true;
    sessionInfo.cyclePercent = cycle.completedPercent;
  }
}

function checkAnswer() {
  const question = quizQuestions[current];
  const feedback = document.getElementById('feedback');
  let result = { ok: false, missing: [], extra: [] };
  let given = '';
  if (question.type === 'mc') {
    const selected = document.querySelector('.answer-button[data-selected="1"]');
    if (!selected) return void alert('Choose an answer first.');
    given = selected.textContent;
    result.ok = norm(given) === norm(question.a);
  } else {
    const input = document.getElementById('textAnswer');
    given = input.value.trim();
    if (!given) return void alert('Write an answer first.');
    result = mark(question, given);
  }

  if (result.ok) score += 1;
  updateReview(question, result.ok);
  recordFocusResult(question, result.ok);

  if (state.activeSession) {
    state.activeSession.score = score;
    state.activeSession.current = current + 1;
    state.activeSession.sessionInfo = { ...sessionInfo };
  }
  save();
  playTone(result.ok ? 'correct' : 'wrong');

  const answer = question.a || question.answerExample || (question.accepted || [])[0] || '';
  let html = `<div class="feedback-title">${result.ok ? '✓ Correct' : 'Not quite — let’s fix it'}</div><div class="your-answer"><strong>Your answer:</strong> ${esc(given)}</div>`;
  if (!result.ok && result.missing.length) {
    html += `<div><strong>Missing:</strong><ul class="feedback-list">${result.missing.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>`;
  }
  if (!result.ok && result.extra.length) {
    html += `<div><strong>Incorrect extra answer${result.extra.length === 1 ? '' : 's'}:</strong><ul class="feedback-list">${result.extra.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>`;
  }
  if (answer) html += `<div class="answer-example"><strong>Accepted answer:</strong><br>${esc(answer)}</div>`;
  html += `<div class="explanation-box"><strong>How to work it out</strong><ol class="feedback-list">${(question.steps || [question.explain || 'Compare with the accepted answer.']).map(step => `<li>${esc(step)}</li>`).join('')}</ol>${question.explain ? `<div class="small muted" style="margin-top:8px">${esc(question.explain)}</div>` : ''}</div>`;
  html += `<div class="memory-box"><strong>Must remember:</strong> ${esc(question.mustRemember || question.explain || 'Review the exact form before moving on.')}</div>`;
  if (!result.ok && sessionInfo.kind === 'extra-review') {
    html += '<div class="review-schedule"><strong>Extra practice only:</strong> the original due date has not been moved.</div>';
  } else if (!result.ok) {
    html += '<div class="review-schedule"><strong>Saved for later:</strong> this question leaves ordinary Practice and returns in 2 days. After a correct due review, it returns once more in 7 days.</div>';
  }
  feedback.innerHTML = html;
  feedback.className = `feedback ${result.ok ? 'good' : 'bad'}`;
  document.getElementById('checkButton').classList.add('hidden');
  document.getElementById('nextButton').classList.remove('hidden');
}

function nextQuestion() {
  if (current < quizQuestions.length - 1) {
    current += 1;
    if (state.activeSession) state.activeSession.current = current;
    save();
    renderQuestion();
  } else {
    finish();
  }
}

function finish() {
  const percent = Math.round(score / Math.max(1, quizQuestions.length) * 100);
  state.attempts.push({
    date: new Date().toISOString(), day: quizDay, percent, score,
    total: quizQuestions.length, title: quizTitle,
  });
  state.activeSession = null;
  save();
  playTone('complete');
  document.getElementById('resultScore').textContent = `${score}/${quizQuestions.length} — ${percent}%`;

  let resultMessage;
  if (sessionInfo.cycleCompleted) {
    resultMessage = sessionInfo.cyclePercent >= masteryTarget
      ? `Full focus cycle completed at ${sessionInfo.cyclePercent}% — this dated block is now Mastered.`
      : `Full focus cycle completed at ${sessionInfo.cyclePercent}%. Start the next cycle after completing due reviews.`;
  } else if (percent >= masteryTarget) {
    resultMessage = 'Strong session (85%+). The block becomes Mastered only after the full focus-question cycle is completed at 85% or above.';
  } else {
    resultMessage = 'Below 85% for this session. Missed questions are held out of ordinary Practice and scheduled for review.';
  }
  document.getElementById('resultMessage').textContent = resultMessage;

  let cycleText = '<strong>Session complete.</strong>';
  if (sessionInfo.kind === 'fresh') {
    cycleText = `<strong>Focus cycle:</strong> ${sessionInfo.remaining} unseen focus question${sessionInfo.remaining === 1 ? '' : 's'} remain in cycle ${sessionInfo.round}.`;
  } else if (sessionInfo.kind === 'review') {
    cycleText = '<strong>Due review complete:</strong> correct 2-day items move to a 7-day check; correct 7-day items leave the queue.';
  } else if (sessionInfo.kind === 'extra-review') {
    cycleText = '<strong>Extra practice complete:</strong> original spaced-repetition dates were not changed.';
  }
  document.getElementById('cycleResult').innerHTML = cycleText;
  show('results');
}

function toggleSound() {
  state.settings.sound = state.settings.sound === false;
  save();
  if (state.settings.sound) playTone('correct');
}

function playTone(kind) {
  if (state.settings.sound === false) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const audio = new AudioContext();
  const patterns = { correct: [392, 523], wrong: [294, 247], complete: [392, 523, 659] };
  const toneList = patterns[kind] || patterns.correct;
  toneList.forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + index * 0.11;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(kind === 'wrong' ? 0.035 : 0.05, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.18);
  });
  setTimeout(() => audio.close().catch(() => {}), toneList.length * 110 + 300);
}

function exportProgress() {
  state.lastBackup = new Date().toISOString();
  save();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Latin_Revision_V8_progress_backup.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function importProgress(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.attempts) || !data.reviews) throw new Error('Invalid backup');
      state = mergeState(data);
      save();
      migrationMessage = 'Progress backup restored successfully.';
      showDashboard();
    } catch (error) {
      alert('This does not look like a valid Latin Revision progress backup.');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function resetProgress() {
  const message = 'Reset all scores, mastery cycles, paused practice and review dates on this device? Export a backup first if you may need these records.';
  if (!confirm(message)) return;
  state = emptyState();
  save();
  migrationMessage = '';
  showDashboard();
}

renderDashboard();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
