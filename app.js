const bank = window.LATIN_BANK || [];
const blocks = window.LATIN_BLOCKS || [];
const notes = window.LATIN_NOTES || {};
const byId = new Map(bank.map(question => [question.id, question]));

const derivativeHints = {
  custodit:'custody, custodian', epistula:'epistle', frustra:'frustrate', fugit:'fugitive',
  credit:'credit, credible', convenit:'convene, convention', invitat:'invite, invitation',
  procedit:'proceed, procedure', tradit:'tradition', imperium:'imperial, empire',
  civis:'civic, civilisation', senator:'senate', audit:'audible, audience',
  docet:'doctor, doctrine', trahit:'traction, tractor', portat:'transport, portable',
  terra:'terrain, terrestrial', pax:'pacify, pacific'
};

const wordBankEntries = bank
  .filter(question => {
    if (question.direction !== 'Latin → English') return false;
    const id = question.id || '';
    const source = question.sourceRef || '';
    return /^s(1[0-2]|[1-9])-\d+-l2e$/.test(id) || source.startsWith('Chapter 1–2');
  })
  .map(question => {
    const stageMatch = (question.id || '').match(/^s(\d+)-/);
    return {
      id: question.id,
      stage: stageMatch ? Number(stageMatch[1]) : null,
      group: stageMatch ? `Stage ${stageMatch[1]}` : (question.topic || 'Chapter 1–2 word bank'),
      latin: String(question.context || '').trim(),
      english: String(question.answerExample || (question.accepted || [])[0] || '').trim(),
      clue: String(question.explain || '').replace(/\s*Source:.*$/i, '').trim(),
      memory: derivativeHints[String(question.context || '').trim()] || '',
    };
  })
  .filter(entry => entry.latin && entry.english)
  .filter((entry, index, entries) => entries.findIndex(other => normExact(other.latin) === normExact(entry.latin) && normExact(other.english) === normExact(entry.english)) === index);

let wordBankQueue = [];
let wordBankIndex = 0;
let wordBankReviewMode = false;

const masteryTarget = 85;
const stateKey = 'latinSummerV8State';
const dailyGoalMinutes = 20;
const dailyGoalQuestions = 30;
const idleLimitMs = 90 * 1000;
let lastStudyInteraction = Date.now();
let lastActiveTick = Date.now();
let audioContext = null;
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
let sessionAnswers = [];

function emptyState() {
  return {
    version: 8.21,
    attempts: [],
    reviews: {},
    results: {},
    cycles: {},
    settings: { sound: true },
    daily: {},
    activeSession: null,
    lastSaved: null,
    lastBackup: null,
  };
}

function mergeState(saved) {
  const output = Object.assign(emptyState(), saved || {});
  output.version = 8.2;
  output.attempts = Array.isArray(output.attempts) ? output.attempts : [];
  output.reviews = output.reviews || {};
  output.results = output.results || {};
  output.cycles = output.cycles || {};
  output.settings = Object.assign({ sound: true }, output.settings || {});
  output.daily = output.daily && typeof output.daily === 'object' ? output.daily : {};
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

function localISODate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function todayISO() {
  return localISODate(new Date());
}

function addDays(number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + number);
  return localISODate(date);
}

function formatStamp(value) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not yet' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}


function dailyRecord(date = todayISO()) {
  if (!state.daily[date]) {
    state.daily[date] = {
      activeMs: 0,
      questions: 0,
      correct: 0,
      wrong: 0,
      topics: {},
      sessionKinds: {},
      wordBank: {},
      completedAt: null,
    };
  }
  const record = state.daily[date];
  record.activeMs = Number(record.activeMs) || 0;
  record.questions = Number(record.questions) || 0;
  record.correct = Number(record.correct) || 0;
  record.wrong = Number(record.wrong) || 0;
  record.topics = record.topics && typeof record.topics === 'object' ? record.topics : {};
  record.sessionKinds = record.sessionKinds && typeof record.sessionKinds === 'object' ? record.sessionKinds : {};
  record.wordBank = record.wordBank && typeof record.wordBank === 'object' ? record.wordBank : {};
  return record;
}

function dailyGoalComplete(record = dailyRecord()) {
  return record.activeMs >= dailyGoalMinutes * 60 * 1000 && record.questions >= dailyGoalQuestions;
}

function markDailyCompletion(record = dailyRecord()) {
  if (dailyGoalComplete(record) && !record.completedAt) {
    record.completedAt = new Date().toISOString();
    playTone('complete');
  }
}

function recordDailyAnswer(question, ok) {
  const record = dailyRecord();
  record.questions += 1;
  if (ok) record.correct += 1;
  else record.wrong += 1;
  const topic = question.topic || question.day || 'Other';
  if (!record.topics[topic]) record.topics[topic] = { answered: 0, correct: 0 };
  record.topics[topic].answered += 1;
  if (ok) record.topics[topic].correct += 1;
  const kind = sessionInfo.kind || 'practice';
  record.sessionKinds[kind] = (record.sessionKinds[kind] || 0) + 1;
  markDailyCompletion(record);
}

function isStudyViewActive() {
  const notesView = document.getElementById('notes');
  const quizView = document.getElementById('quiz');
  const wordBankView = document.getElementById('wordbank');
  return Boolean(
    document.visibilityState === 'visible'
    && (
      (notesView && !notesView.classList.contains('hidden'))
      || (quizView && !quizView.classList.contains('hidden'))
      || (wordBankView && !wordBankView.classList.contains('hidden'))
    )
  );
}

function noteStudyInteraction() {
  lastStudyInteraction = Date.now();
}

function tickActiveStudy() {
  const now = Date.now();
  const delta = Math.min(20000, Math.max(0, now - lastActiveTick));
  lastActiveTick = now;
  if (!isStudyViewActive() || now - lastStudyInteraction > idleLimitMs || delta <= 0) return;
  const record = dailyRecord();
  record.activeMs += delta;
  markDailyCompletion(record);
  try {
    localStorage.setItem(stateKey, JSON.stringify(state));
  } catch (error) {}
  renderDailyGoal();
}

function renderDailyGoal() {
  const record = dailyRecord();
  const minutes = Math.floor(record.activeMs / 60000);
  const accuracy = record.questions ? Math.round(record.correct / record.questions * 100) : null;
  const timePct = Math.min(100, record.activeMs / (dailyGoalMinutes * 60000) * 100);
  const questionPct = Math.min(100, record.questions / dailyGoalQuestions * 100);
  const combinedPct = Math.round(Math.min(timePct, questionPct));
  const completed = dailyGoalComplete(record);

  const minutesEl = document.getElementById('todayMinutes');
  const questionsEl = document.getElementById('todayQuestions');
  const accuracyEl = document.getElementById('todayAccuracy');
  const correctLine = document.getElementById('todayCorrectLine');
  const timeBar = document.getElementById('dailyTimeBar');
  const questionBar = document.getElementById('dailyQuestionsBar');
  const status = document.getElementById('dailyStatus');
  const remaining = document.getElementById('dailyRemaining');

  if (!minutesEl) return;
  minutesEl.textContent = minutes;
  questionsEl.textContent = record.questions;
  if (accuracyEl) accuracyEl.textContent = accuracy === null ? '—' : `${accuracy}%`;
  if (correctLine) correctLine.textContent = record.questions ? `${record.correct} correct · ${record.wrong} to review` : 'No answers yet';
  timeBar.style.width = `${timePct}%`;
  questionBar.style.width = `${questionPct}%`;

  const prettyAccuracy = document.getElementById('prettyAccuracy');
  const prettyAccuracyNote = document.getElementById('prettyAccuracyNote');
  const accuracySummary = document.getElementById('todayAccuracySummary');
  const correctSummary = document.getElementById('todayCorrectSummary');
  if (prettyAccuracy) prettyAccuracy.textContent = accuracy === null ? '—' : `${accuracy}%`;
  if (accuracySummary) accuracySummary.textContent = accuracy === null ? '—' : `${accuracy}%`;
  if (prettyAccuracyNote) {
    prettyAccuracyNote.textContent = accuracy === null ? 'Start today’s practice'
      : accuracy >= 90 ? 'Brilliant work ✨'
      : accuracy >= 85 ? 'Strong work ♡'
      : accuracy >= 70 ? 'Keep building'
      : 'Every mistake helps';
  }
  if (correctSummary) correctSummary.textContent = record.questions ? `${record.correct} correct · ${record.wrong} to review` : 'No answers yet';

  const timeEncouragement = document.getElementById('timeEncouragement');
  const questionEncouragement = document.getElementById('questionEncouragement');
  if (timeEncouragement) {
    const left = Math.max(0, dailyGoalMinutes - minutes);
    timeEncouragement.textContent = completed ? 'Focus goal complete ✨'
      : left === 0 ? 'Time goal complete — lovely focus ♡'
      : minutes >= 15 ? `Nearly there — ${left} min left ♡`
      : minutes >= 10 ? 'Halfway there — keep going!'
      : minutes > 0 ? 'A lovely start ♡'
      : 'Ready when you are ♡';
  }
  if (questionEncouragement) {
    const left = Math.max(0, dailyGoalQuestions - record.questions);
    questionEncouragement.textContent = completed ? 'Question goal complete ✨'
      : left === 0 ? '30 questions done — amazing!'
      : left <= 5 ? `Final push — ${left} to go!`
      : left <= 12 ? `Only ${left} questions to go ♡`
      : record.questions >= 15 ? 'Halfway there!'
      : record.questions > 0 ? 'One question at a time ♡'
      : 'Let’s get started ♡';
  }

  const reminder = document.getElementById('todayReminder');
  if (reminder) {
    const minsLeft = Math.max(0, dailyGoalMinutes - minutes);
    const qsLeft = Math.max(0, dailyGoalQuestions - record.questions);
    reminder.textContent = completed ? 'You did it! Today’s goal is complete ♡'
      : !minsLeft && qsLeft ? `Great focus! Just ${qsLeft} question${qsLeft === 1 ? '' : 's'} left.`
      : !qsLeft && minsLeft ? `30 questions done! Just ${minsLeft} active minute${minsLeft === 1 ? '' : 's'} left.`
      : combinedPct >= 75 ? 'Almost there — you’re so close! ♡'
      : combinedPct >= 50 ? 'You’re over halfway there ✨'
      : combinedPct > 0 ? 'Great start — keep the momentum going ♡'
      : 'You’ve got this. One question at a time ♡';
  }

  if (status) {
    status.textContent = completed ? '✓ Today complete' : `${combinedPct}% complete`;
    status.classList.toggle('done', completed);
  }
  if (remaining) {
    if (completed) {
      remaining.textContent = `Amazing work — ${record.questions} questions and ${Math.max(dailyGoalMinutes, minutes)} active minutes completed today.`;
    } else {
      const minsLeft = Math.max(0, dailyGoalMinutes - minutes);
      const qsLeft = Math.max(0, dailyGoalQuestions - record.questions);
      const pieces = [];
      if (minsLeft) pieces.push(`${minsLeft} min`);
      if (qsLeft) pieces.push(`${qsLeft} question${qsLeft === 1 ? '' : 's'}`);
      remaining.textContent = pieces.length ? `${pieces.join(' + ')} left to complete today’s goal.` : 'A little progress every day adds up.';
    }
  }

  const dailyRing = document.getElementById('dailyRing');
  const dailyRingValue = document.getElementById('dailyRingValue');
  if (dailyRing) dailyRing.setAttribute('aria-label', `Daily goal ${combinedPct}% complete`);
  if (dailyRingValue) dailyRingValue.textContent = `${combinedPct}%`;

  const reviewed = wordBankReviewedCount();
  const wbStat = document.getElementById('wordBankTodayStat');
  const wbText = document.getElementById('wordBankProgressText');
  if (wbStat) wbStat.textContent = `${reviewed}/10`;
  if (wbText) wbText.textContent = `${reviewed} / 10`;
}

function parentReportText() {
  const date = todayISO();
  const record = dailyRecord(date);
  const minutes = Math.floor(record.activeMs / 60000);
  const accuracy = record.questions ? Math.round(record.correct / record.questions * 100) : 0;
  const topicRows = Object.entries(record.topics || {})
    .map(([topic, stats]) => ({ topic, wrong: Math.max(0, stats.answered - stats.correct), answered: stats.answered }))
    .sort((a, b) => b.wrong - a.wrong || b.answered - a.answered)
    .slice(0, 3)
    .filter(item => item.wrong > 0);
  const weak = topicRows.length ? topicRows.map(item => `${item.topic}: ${item.wrong} missed`).join('; ') : 'No repeated weak topic identified today.';
  const status = dailyGoalComplete(record) ? '✅ Daily goal complete' : '⚠️ Daily goal not yet complete';
  return [
    `Latin Revision — ${date}`,
    status,
    `Active study: ${minutes} / ${dailyGoalMinutes} min`,
    `Questions: ${record.questions} / ${dailyGoalQuestions}`,
    `Correct: ${record.correct}`,
    `Incorrect: ${record.wrong}`,
    `Accuracy: ${record.questions ? `${accuracy}%` : '—'}`,
    `Due-review questions answered: ${record.sessionKinds.review || 0}`,
    `Word bank reviewed: ${wordBankReviewedCount(date)} / 10`,
    `Needs attention: ${weak}`,
  ].join('\\n');
}

async function shareParentReport() {
  const text = parentReportText();
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Latin Revision daily report', text });
      return;
    }
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      alert('Parent report copied. You can paste it into Messages, Mail or WhatsApp.');
      return;
    }
  } catch (error) {
    if (error && error.name === 'AbortError') return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
  alert('Parent report copied. You can paste it into Messages, Mail or WhatsApp.');
}

function save() {
  state.lastSaved = new Date().toISOString();
  try {
    localStorage.setItem(stateKey, JSON.stringify(state));
    const warning = document.getElementById('saveWarning');
    if (warning) warning.classList.remove('show');
  } catch (error) {
    const warning = document.getElementById('saveWarning');
    if (warning) warning.classList.add('show');
    console.error('Latin Revision progress could not be saved.', error);
  }
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

const APP_SCREENS = ['dashboard','dailyPicker','learnPage','practiceHub','progressPage','morePage','wordbank','notes','quiz','results','gamesHub','gamePlay'];
let currentScreen = 'dashboard';
let screenHistory = [];

function show(id, options = {}) {
  const target = document.getElementById(id);
  if (!target) {
    console.error(`Unknown screen: ${id}`);
    id = 'dashboard';
  }
  if (!options.noHistory && currentScreen && currentScreen !== id && APP_SCREENS.includes(currentScreen)) {
    screenHistory.push(currentScreen);
    if (screenHistory.length > 30) screenHistory.shift();
  }
  APP_SCREENS.forEach(section => {
    const el = document.getElementById(section);
    if (el) {
      el.removeAttribute('hidden');
      el.classList.add('hidden');
    }
  });
  const next = document.getElementById(id) || document.getElementById('dashboard');
  next.removeAttribute('hidden');
  next.classList.remove('hidden');
  currentScreen = next.id;
  window.scrollTo(0, 0);
}

function goBack() {
  while (screenHistory.length) {
    const id = screenHistory.pop();
    if (id && id !== currentScreen && document.getElementById(id)) {
      show(id, { noHistory: true });
      if (id === 'dashboard') setNavActive('today');
      else if (id === 'learnPage') setNavActive('learn');
      else if (id === 'practiceHub' || id === 'quiz') setNavActive('practice');
      else if (id === 'wordbank') setNavActive('words');
      else if (id === 'progressPage') setNavActive('progress');
      return;
    }
  }
  showDashboard();
}

const LEARN_MODULES = {
  grammar: {
    title: 'Grammar',
    intro: 'Cases, verbs, sentence patterns and grammar control from the teacher-covered course.',
    matches(question) {
      const t = String(question.topic || '').toLowerCase();
      return /(case|declension|genitive|vocative|adjective|pronoun|possessive|tense|person and number|finite verb|perfect cue|perfect pattern|grammar role)/.test(t);
    }
  },
  vocabulary: {
    title: 'Vocabulary',
    intro: 'Build secure vocabulary in both directions, including dictionary clues and core forms.',
    matches(question) {
      const t = String(question.topic || '').toLowerCase();
      return /(vocabulary|nouns|preposition|core verbs|miscellaneous words)/.test(t);
    }
  },
  translation: {
    title: 'Translation',
    intro: 'Practise accurate Latin and natural English using translation and sentence-control questions.',
    matches(question) {
      const t = String(question.topic || '').toLowerCase();
      return /(translation|set-text|comprehension|restore the sentence|production|whole-passage|choose the complete translation)/.test(t);
    }
  },
  roman: {
    title: 'Roman World & Culture',
    intro: 'Use the culture, place and research questions already present in the teacher-covered bank.',
    matches(question) {
      const t = String(question.topic || '').toLowerCase();
      return /(map locations|why each place matters|research questions)/.test(t);
    }
  }
};

let currentLearnKind = '';

function learnModulePool(kind) {
  const module = LEARN_MODULES[kind];
  if (!module) return [];
  return bank.filter(question => module.matches(question));
}

function startCategoryPractice(kind = currentLearnKind) {
  const module = LEARN_MODULES[kind];
  if (!module) return showLearn();
  const pool = learnModulePool(kind);
  if (!pool.length) {
    alert(`There are no ${module.title.toLowerCase()} questions in the current teacher-covered bank.`);
    return showLearn(kind);
  }
  const pending = new Set(Object.keys(state.reviews || {}));
  const available = pool.filter(question => !pending.has(question.id));
  const source = available.length ? available : pool;
  reviewMode = false;
  sessionInfo = { kind: `module-${kind}`, advanceReview: true };
  const sample = kind === 'roman' ? Math.min(10, source.length) : Math.min(15, source.length);
  startQuiz(balancedTake(source, sample), `${module.title} focused practice`, module.title);
}

function startDailyRevision() {
  showDailyPicker();
}

function showDailyPicker() {
  renderDatePicker();
  show('dailyPicker');
  setNavActive('today');
}

function renderDatePicker() {
  const list = document.getElementById('datePickerList');
  if (!list) return;
  list.innerHTML = '';
  blocks.forEach(block => {
    const focus = focusPoolFor(block);
    const cycle = cycleFor(block.day);
    const latest = latestPct(block.day);
    const completed = cycle.completedPercent;
    let status = 'Not started';
    let cls = '';
    if (Number.isFinite(completed)) {
      status = completed >= masteryTarget ? `Mastered ${completed}%` : `Cycle ${completed}%`;
      cls = completed >= masteryTarget ? 'completed' : 'started';
    } else if ((cycle.seen || []).length || latest !== null) {
      status = latest === null ? 'In progress' : `Last session ${latest}%`;
      cls = 'started';
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `date-card ${cls}`.trim();
    button.dataset.action = 'open-date';
    button.dataset.day = block.day;
    const sample = block.mode === 'due' ? 'Due review' : block.mode === 'weak' ? 'Weak-question review' : `${Math.min(block.sample || 15, focus.length || block.sample || 15)}-question focus`;
    button.innerHTML = `<strong>${esc(block.day)}</strong><span>${esc(block.label)}</span><span>${esc(block.scope)}</span><b>${esc(status)} · ${esc(sample)} →</b>`;
    list.appendChild(button);
  });
}

function openDateBlock(day) {
  const block = blocks.find(item => item.day === day);
  if (!block) return showRouteError('That revision date is not available.');
  openNotes(block.day);
}

function openMistakeReview() {
  const due = dueQuestions();
  if (due.length) return startDue();
  showPracticeHub();
  const line = document.getElementById('practiceDueText');
  if (line) line.textContent = 'No mistakes are due today — you are caught up ♡';
}

function startQuickQuiz() {
  const pending = new Set(Object.keys(state.reviews || {}));
  const attempted = attemptedContentDays();
  let pool = attempted.length
    ? bank.filter(question => attempted.includes(question.day) && !pending.has(question.id))
    : [];
  if (!pool.length) {
    const block = suggestedBlock();
    if (block) pool = focusPoolFor(block).filter(question => !pending.has(question.id));
  }
  if (!pool.length) pool = bank.filter(question => !pending.has(question.id)).slice(0, 80);
  if (!pool.length) return void alert('No quiz questions are currently available.');
  reviewMode = false;
  sessionInfo = { kind: 'quick', advanceReview: true };
  startQuiz(balancedTake(pool, Math.min(10, pool.length)), 'Quick Quiz — 10 questions', 'Quick Quiz');
}


function showDashboard() {
  try { renderDashboard(); } catch (error) { console.error('Dashboard render failed:', error); }
  show('dashboard', { noHistory: true });
  currentScreen = 'dashboard';
  screenHistory = [];
  setNavActive('today');
}

function showLearn(kind = '') {
  currentLearnKind = LEARN_MODULES[kind] ? kind : '';
  const title = document.getElementById('learnPageTitle');
  const intro = document.getElementById('learnPageIntro');
  const count = document.getElementById('learnModuleCount');
  const hint = document.getElementById('learnModuleHint');
  const start = document.getElementById('learnStartButton');

  if (currentLearnKind) {
    const module = LEARN_MODULES[currentLearnKind];
    const pool = learnModulePool(currentLearnKind);
    if (title) title.textContent = module.title;
    if (intro) intro.textContent = module.intro;
    if (count) count.textContent = `${pool.length} matching questions available`;
    if (hint) hint.textContent = 'Start focused practice, or choose a dated block below.';
    if (start) {
      start.disabled = !pool.length;
      start.textContent = `Start ${module.title} practice`;
      start.dataset.action = `start-module:${currentLearnKind}`;
      start.onclick = null;
    }
  } else {
    if (title) title.textContent = 'Your revision library';
    if (intro) intro.textContent = 'Choose Grammar, Vocabulary, Translation or Roman World, or open the dated revision plan.';
    if (count) count.textContent = 'Choose a topic to see its question pool.';
    if (hint) hint.textContent = 'Each topic uses only matching teacher-covered questions.';
    if (start) {
      start.disabled = true;
      start.textContent = 'Choose a topic first';
      delete start.dataset.action;
      start.onclick = null;
    }
  }
  show('learnPage');
  setNavActive('learn');
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
  renderDailyGoal();
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
    const dayButton = card.querySelector('button');
    dayButton.dataset.action = 'open-date';
    dayButton.dataset.day = block.day;
    list.appendChild(card);
  });
  renderV82DashboardExtras();
  renderSaveStatus();
}

function openNotes(day) {
  const block = blocks.find(item => item.day === day);
  if (!block) {
    showRouteError('That revision block is no longer available.');
    return showDailyPicker();
  }
  const note = notes[day] || {
    title: `${block.day} — ${block.label}`,
    intro: 'Review the exact locked scope before starting practice.',
    must: [],
    sections: []
  };
  const title = document.getElementById('notesTitle');
  const intro = document.getElementById('notesIntro');
  const scope = document.getElementById('notesScope');
  const must = document.getElementById('mustList');
  const sections = document.getElementById('notesSections');
  if (title) title.textContent = note.title || `${block.day} — ${block.label}`;
  if (intro) intro.textContent = note.intro || '';
  if (scope) scope.textContent = block.scope || '';
  if (must) must.innerHTML = (note.must || note.items || []).map(item => `<li>${esc(item)}</li>`).join('');
  if (sections) sections.innerHTML = (note.sections || []).map(section => `<section class="note-section"><h3>${esc(section.title)}</h3><ul>${(section.items || []).map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>`).join('');
  const start = document.getElementById('notesStartButton');
  if (start) {
    start.dataset.action = 'start-date';
    start.dataset.day = block.day;
    start.onclick = null;
  }
  show('notes');
  setNavActive('learn');
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
  if (!days.length) return startQuickQuiz();
  const pending = new Set(Object.keys(state.reviews));
  const pool = bank.filter(question => days.includes(question.day) && !pending.has(question.id));
  if (!pool.length) return startQuickQuiz();
  reviewMode = false;
  sessionInfo = { kind: 'mixed', advanceReview: true };
  startQuiz(stratifiedSample(pool, Math.min(15, pool.length)), 'Balanced mixed test — attempted blocks', 'Mixed');
}

function startDue() {
  const pool = dueQuestions();
  if (!pool.length) return openMistakeReview();
  reviewMode = true;
  sessionInfo = { kind: 'review', advanceReview: true };
  startQuiz(balancedTake(pool, Math.min(20, pool.length)), 'Due spaced-repetition review', 'Due');
}

function startQuiz(questions, title, day) {
  quizQuestions = questions;
  current = 0;
  score = 0;
  sessionAnswers = [];
  quizTitle = title;
  quizDay = day;
  state.activeSession = {
    qids: questions.map(question => question.id), title, day, current: 0, score: 0,
    reviewMode, sessionInfo: { ...sessionInfo }, sessionAnswers: [],
  };
  save();
  show('quiz');
  setNavActive('practice');
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
  sessionAnswers = Array.isArray(active.sessionAnswers) ? active.sessionAnswers : [];
  if (active.current >= questions.length) {
    current = questions.length - 1;
    return finish();
  }
  current = active.current || 0;
  show('quiz');
  setNavActive('practice');
  renderQuestion();
}

function pauseQuiz() {
  if (!confirm('Pause this practice? Your place and score will be saved, and you can continue later.')) return;
  showPracticeHub();
}

function renderQuestion() {
  const question = quizQuestions[current];
  const questionStage = document.getElementById('questionStage');
  if (questionStage) questionStage.classList.remove('answer-correct', 'answer-wrong');
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
  recordDailyAnswer(question, result.ok);
  sessionAnswers.push({
    id: question.id,
    topic: question.topic || question.direction || question.day || 'Other',
    ok: result.ok,
  });

  if (state.activeSession) {
    state.activeSession.score = score;
    state.activeSession.current = current + 1;
    state.activeSession.sessionInfo = { ...sessionInfo };
    state.activeSession.sessionAnswers = [...sessionAnswers];
  }
  save();
  playTone(result.ok ? 'correct' : 'wrong');

  const answer = question.a || question.answerExample || (question.accepted || [])[0] || '';
  let html = `<div class="feedback-title"><span class="feedback-icon">${result.ok ? '✓' : '↺'}</span>${result.ok ? positiveAnswerMessage() : gentleCorrectionMessage()}</div><div class="your-answer"><strong>Your answer:</strong> ${esc(given)}</div>`;
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
  const questionStage = document.getElementById('questionStage');
  if (questionStage) {
    questionStage.classList.remove('answer-correct', 'answer-wrong');
    void questionStage.offsetWidth;
    questionStage.classList.add(result.ok ? 'answer-correct' : 'answer-wrong');
  }
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


function sessionTopicSummary() {
  const groups = {};
  sessionAnswers.forEach(answer => {
    const topic = answer.topic || 'Other';
    if (!groups[topic]) groups[topic] = { answered: 0, correct: 0 };
    groups[topic].answered += 1;
    if (answer.ok) groups[topic].correct += 1;
  });
  return Object.entries(groups)
    .map(([topic, stats]) => ({ topic, ...stats, percent: Math.round(stats.correct / Math.max(1, stats.answered) * 100) }))
    .sort((a, b) => a.percent - b.percent || b.answered - a.answered)
    .slice(0, 4);
}

function renderSessionBreakdown() {
  const box = document.getElementById('topicBreakdown');
  if (!box) return;
  const rows = sessionTopicSummary();
  if (!rows.length) {
    box.innerHTML = '<strong>Topic breakdown</strong><div class="small muted" style="margin-top:6px">No topic data recorded for this session.</div>';
    return;
  }
  box.innerHTML = `<strong>Topic breakdown</strong>${rows.map(row => `
    <div class="topic-row">
      <span>${esc(row.topic)}</span>
      <strong>${row.correct}/${row.answered} · ${row.percent}%</strong>
    </div>`).join('')}`;
}

function celebrateMastery(percent) {
  const box = document.getElementById('masteryCelebration');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = `<div class="eyebrow">Milestone reached</div><h2>Mastered ✓</h2><div>Full focus cycle completed at <strong>${percent}%</strong>. This dated block is now mastered.</div>`;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const tones = ['var(--sage)', 'var(--lav)', 'var(--gold)', 'var(--rose)'];
  for (let i = 0; i < 18; i += 1) {
    const particle = document.createElement('span');
    particle.className = 'celebration-particle';
    particle.style.left = `${5 + Math.random() * 90}%`;
    particle.style.top = `${-8 - Math.random() * 25}px`;
    particle.style.background = tones[i % tones.length];
    particle.style.animationDelay = `${Math.random() * 0.25}s`;
    box.appendChild(particle);
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
  document.getElementById('resultScore').textContent = `${score}/${quizQuestions.length} answered correctly`;
  const resultRing = document.getElementById('resultRing');
  if (resultRing) {
    resultRing.style.setProperty('--p', percent);
    resultRing.setAttribute('aria-label', `Session accuracy ${percent}%`);
  }
  document.getElementById('resultPercent').textContent = `${percent}%`;
  document.getElementById('resultCorrect').textContent = score;
  document.getElementById('resultWrong').textContent = Math.max(0, quizQuestions.length - score);
  const today = dailyRecord();
  document.getElementById('resultDailyProgress').textContent = `${today.questions}/${dailyGoalQuestions}`;
  const celebration = document.getElementById('masteryCelebration');
  if (celebration) {
    celebration.classList.add('hidden');
    celebration.innerHTML = '';
  }
  renderSessionBreakdown();

  let resultMessage;
  if (sessionInfo.cycleCompleted) {
    resultMessage = sessionInfo.cyclePercent >= masteryTarget
      ? `Outstanding work ✨ Full focus cycle completed at ${sessionInfo.cyclePercent}% — this dated block is now Mastered.`
      : `Good work completing the full focus cycle at ${sessionInfo.cyclePercent}%. Review the tricky ones, then come back stronger ♡`;
  } else if (percent >= masteryTarget) {
    resultMessage = 'Great session — 85%+! ♡ Keep going through the full focus cycle to turn this block into Mastered.';
  } else {
    resultMessage = 'Good effort — every tricky question is now helping plan your next review. Keep going ♡';
  }
  document.getElementById('resultMessage').textContent = resultMessage;
  if (sessionInfo.cycleCompleted && sessionInfo.cyclePercent >= masteryTarget) {
    celebrateMastery(sessionInfo.cyclePercent);
  }

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


function setNavActive(name) {
  const map = { today: 'navToday', learn: 'navLearn', practice: 'navPractice', words: 'navWords', progress: 'navProgress' };
  Object.values(map).forEach(id => {
    const button = document.getElementById(id);
    if (button) button.classList.remove('active');
  });
  const active = document.getElementById(map[name]);
  if (active) active.classList.add('active');
}

function greetingForNow() { return 'Salve, Psyche!';
}

function suggestedBlock() {
  const regular = blocks.filter(block => !block.mode && block.day !== '30 Aug');
  return regular.find(block => {
    const focus = focusPoolFor(block);
    const cycle = cycleFor(block.day);
    return focus.length && !(Number.isFinite(cycle.completedPercent) && cycle.completedPercent >= masteryTarget);
  }) || regular.find(block => focusPoolFor(block).length) || blocks[0] || null;
}


function v9CurrentStreak() {
  const dates = Object.keys(state.daily || {}).sort().reverse();
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(12,0,0,0);
  for (let i = 0; i < 366; i += 1) {
    const key = localISODate(cursor);
    const rec = state.daily && state.daily[key];
    if (rec && dailyGoalComplete(rec)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (i === 0) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }
  return streak;
}

function renderV9Extras() {
  setText('v9Streak', v9CurrentStreak());
  const now = new Date();
  const dateText = now.toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  setText('v9Date', dateText);
  const due = dueQuestions().length;
  setText('v9ReviewText', due ? `${due} review${due===1?'':'s'} ready today.` : 'Turn mistakes into mastery.');
  const completed = blocks
    .filter(block => !block.mode && Number.isFinite(cycleFor(block.day).completedPercent))
    .map(block => ({block, pct: cycleFor(block.day).completedPercent, round: cycleFor(block.day).completedRound || 1}));
  if (completed.length) {
    const last = completed[completed.length - 1];
    setText('v9Achievement', `${last.block.label} complete`);
    setText('v9AchievementNote', `${last.pct}% on the completed focus cycle.`);
  } else {
    setText('v9Achievement', 'Your first milestone');
    setText('v9AchievementNote', 'Complete a full focus cycle to earn it.');
  }
}
function renderV82DashboardExtras() {
  const greeting = document.getElementById('greetingTitle');
  if (greeting) greeting.textContent = greetingForNow();

  const record = dailyRecord();
  const combinedPct = Math.round(Math.min(
    100,
    Math.min(
      record.activeMs / (dailyGoalMinutes * 60000) * 100,
      record.questions / dailyGoalQuestions * 100
    )
  ));
  const hero = document.getElementById('heroEncouragement');
  if (hero) {
    hero.textContent = dailyGoalComplete(record) ? 'Today’s goal is complete — beautiful work ✨'
      : combinedPct >= 80 ? 'Almost there — one last little push ♡'
      : combinedPct >= 50 ? 'You’re over halfway there. Keep going ✨'
      : combinedPct > 0 ? 'Great start — every question is progress ♡'
      : 'Small steps every day make brilliant progress.';
  }

  const block = suggestedBlock();
  const nextDay = document.getElementById('nextUpDay');
  const nextTitle = document.getElementById('nextUpTitle');
  const nextMeta = document.getElementById('nextUpMeta');
  const nextButton = document.getElementById('nextUpButton');
  const prettyCycle = document.getElementById('prettyCycle');
  const prettyCycleNote = document.getElementById('prettyCycleNote');
  if (block) {
    if (nextDay) nextDay.textContent = block.day;
    if (nextTitle) nextTitle.textContent = block.label;
    if (nextMeta) nextMeta.textContent = block.scope;
    if (nextButton) {
      nextButton.disabled = false;
      nextButton.dataset.action = 'open-date';
      nextButton.dataset.day = block.day;
      nextButton.onclick = null;
    }
    const focus = focusPoolFor(block);
    const cycle = cycleFor(block.day);
    const seen = cycle.seen.filter(id => focus.some(question => question.id === id)).length;
    if (prettyCycle) prettyCycle.textContent = `${seen}/${focus.length || 0}`;
    if (prettyCycleNote) prettyCycleNote.textContent = focus.length ? `${Math.max(0, focus.length - seen)} unseen in next focus` : 'Balanced review block';
  } else if (nextButton) {
    nextButton.disabled = true;
  }

  const wb = wordBankReviewedCount();
  const wbStat = document.getElementById('wordBankTodayStat');
  const wbText = document.getElementById('wordBankProgressText');
  if (wbStat) wbStat.textContent = `${wb}/10`;
  if (wbText) wbText.textContent = `${wb} / 10`;
  renderV9Extras();
}

function continueToday() {
  return startDailyRevision();
}

function showProgress() {
  try { renderProgressPage(); } catch (error) { console.error('Progress render failed:', error); }
  show('progressPage');
  setNavActive('progress');
}

function showPracticeHub() {
  const due = dueQuestions().length;
  const dueButton = document.getElementById('practiceDueButton');
  const dueText = document.getElementById('practiceDueText');
  if (dueButton) dueButton.disabled = !due;
  if (dueText) dueText.textContent = due ? `${due} review question${due === 1 ? '' : 's'} ready today.` : 'Nothing due right now.';
  const mixedButton = document.getElementById('practiceMixedButton');
  if (mixedButton) mixedButton.disabled = false;
  show('practiceHub');
  setNavActive('practice');
}

function showRevisionPlan() {
  showLearn('');
  setTimeout(() => {
    const target = document.getElementById('daylist');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 20);
}

function renderProgressPage() {
  const record = dailyRecord();
  const completedCycles = blocks
    .filter(block => !block.mode && focusPoolFor(block).length)
    .map(block => cycleFor(block.day).completedPercent)
    .filter(value => Number.isFinite(value));
  const overall = completedCycles.length
    ? Math.round(completedCycles.reduce((total, value) => total + value, 0) / completedCycles.length)
    : 0;
  const accuracy = record.questions ? Math.round(record.correct / record.questions * 100) : null;
  const due = dueQuestions().length;
  const words = wordBankReviewedCount();
  const block = suggestedBlock();

  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  setText('progressOverall', `${overall}%`);
  setText('progressTodayAccuracy', accuracy === null ? '—' : `${accuracy}%`);
  setText('progressTodayLine', record.questions ? `${record.correct}/${record.questions} correct today` : 'No answers yet');
  setText('progressDue', String(due));
  setText('progressWords', `${words}/10`);

  if (block) {
    const focus = focusPoolFor(block);
    const cycle = cycleFor(block.day);
    const valid = new Set(focus.map(q => q.id));
    const seen = cycle.seen.filter(id => valid.has(id)).length;
    const completed = Number.isFinite(cycle.completedPercent) ? ` · last completed cycle ${cycle.completedPercent}%` : '';
    setText('progressCycleLine', `${block.day} — ${seen}/${focus.length || 0} seen${completed}`);
  } else {
    setText('progressCycleLine', 'No focus cycle started yet.');
  }
}

function showMore() {
  try { renderParentReport(); renderSaveStatus(); } catch (error) { console.error('More-page render failed:', error); }
  show('morePage');
  setNavActive('more');
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dailyWordBankEntries(date = todayISO()) {
  const items = [...wordBankEntries];
  const random = seededRandom(hashText(`latin-v82-${date}`));
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  const picked = [];
  const stagesSeen = new Set();
  for (const entry of items) {
    if (picked.length >= 10) break;
    if (!stagesSeen.has(entry.stage)) {
      picked.push(entry);
      stagesSeen.add(entry.stage);
    }
  }
  for (const entry of items) {
    if (picked.length >= 10) break;
    if (!picked.some(item => item.id === entry.id)) picked.push(entry);
  }
  return picked;
}

function wordBankReviewedCount(date = todayISO()) {
  const record = dailyRecord(date);
  const todayIds = new Set(dailyWordBankEntries(date).map(entry => entry.id));
  return Object.keys(record.wordBank || {}).filter(id => todayIds.has(id)).length;
}

function openWordBank() {
  wordBankReviewMode = false;
  wordBankQueue = dailyWordBankEntries();
  const record = dailyRecord();
  const firstUnrated = wordBankQueue.findIndex(entry => !record.wordBank[entry.id]);
  wordBankIndex = firstUnrated >= 0 ? firstUnrated : wordBankQueue.length;
  show('wordbank');
  setNavActive('words');
  noteStudyInteraction();
  renderWordBankCard();
}

function renderWordBankCard() {
  const summary = document.getElementById('wordBankSummary');
  const card = document.getElementById('wordBankCard');
  const revealActions = document.getElementById('wordBankRevealActions');
  const rateActions = document.getElementById('wordBankRateActions');
  const answer = document.getElementById('wordBankAnswer');

  if (!wordBankQueue.length || wordBankIndex >= wordBankQueue.length) {
    const record = dailyRecord();
    const base = dailyWordBankEntries();
    const ratings = base.map(entry => record.wordBank[entry.id]).filter(Boolean);
    const known = ratings.filter(value => value === 'known').length;
    const again = ratings.filter(value => value === 'again').length;
    if (card) card.classList.add('hidden');
    if (revealActions) revealActions.classList.add('hidden');
    if (rateActions) rateActions.classList.add('hidden');
    if (summary) {
      summary.classList.remove('hidden');
      summary.innerHTML = `
        <div class="eyebrow">Today’s word bank complete</div>
        <h2>${again ? 'Lovely work — let’s keep the tricky ones close ♡' : 'Amazing — all ten felt secure! ✨'}</h2>
        <p class="muted">You reviewed ${ratings.length} teacher-covered words today.</p>
        <div class="wb-kpis"><div class="wb-kpi"><strong>${known}</strong><div class="small muted">Got it</div></div><div class="wb-kpi"><strong>${again}</strong><div class="small muted">Again</div></div></div>
        <div class="wb-actions">
          ${again ? '<button class="primary" onclick="reviewAgainWords()">Review Again words</button>' : ''}
          <button class="secondary" onclick="showDashboard()">Back to Today</button>
        </div>`;
    }
    const count = document.getElementById('wordBankCount');
    if (count) count.textContent = `${Math.min(ratings.length, 10)} / 10`;
    renderDailyGoal();
    save();
    return;
  }

  if (summary) summary.classList.add('hidden');
  if (card) card.classList.remove('hidden');
  if (revealActions) revealActions.classList.remove('hidden');
  if (rateActions) rateActions.classList.add('hidden');
  if (answer) answer.classList.add('hidden');

  const entry = wordBankQueue[wordBankIndex];
  const stage = document.getElementById('wordBankStage');
  const latin = document.getElementById('wordBankLatin');
  const english = document.getElementById('wordBankEnglish');
  const clue = document.getElementById('wordBankClue');
  const memory = document.getElementById('wordBankMemory');
  const count = document.getElementById('wordBankCount');

  if (stage) stage.textContent = entry.group || (entry.stage ? `Stage ${entry.stage}` : 'Word bank');
  if (latin) latin.textContent = entry.latin;
  if (english) english.textContent = entry.english;
  if (clue) clue.textContent = entry.clue || 'Say the Latin and English pair aloud once before moving on.';
  if (memory) {
    memory.textContent = entry.memory ? `Memory hook: ${entry.memory}` : '';
    memory.classList.toggle('hidden', !entry.memory);
  }
  if (count) count.textContent = `${Math.min(wordBankIndex + 1, wordBankQueue.length)} / ${wordBankQueue.length}`;
}

function revealWordBank() {
  const answer = document.getElementById('wordBankAnswer');
  const revealActions = document.getElementById('wordBankRevealActions');
  const rateActions = document.getElementById('wordBankRateActions');
  if (answer) answer.classList.remove('hidden');
  if (revealActions) revealActions.classList.add('hidden');
  if (rateActions) rateActions.classList.remove('hidden');
  noteStudyInteraction();
}

function rateWordBank(known) {
  const entry = wordBankQueue[wordBankIndex];
  if (!entry) return;
  const record = dailyRecord();
  record.wordBank[entry.id] = known ? 'known' : 'again';
  save();
  if (known) playTone('correct');
  wordBankIndex += 1;
  noteStudyInteraction();
  renderWordBankCard();
}

function reviewAgainWords() {
  const record = dailyRecord();
  const againIds = new Set(Object.entries(record.wordBank).filter(([, rating]) => rating === 'again').map(([id]) => id));
  wordBankQueue = dailyWordBankEntries().filter(entry => againIds.has(entry.id));
  wordBankIndex = 0;
  wordBankReviewMode = true;
  renderWordBankCard();
}

function positiveAnswerMessage() {
  const run = [...sessionAnswers].reverse().findIndex(answer => !answer.ok);
  const streak = run === -1 ? sessionAnswers.length : run;
  if (streak >= 5) return `Brilliant — ${streak} in a row! ✨`;
  if (streak >= 3) return `You’re on a roll — ${streak} in a row! ♡`;
  const messages = ['Great job! ✨', 'Well done! ♡', 'Beautifully done!', 'Yes — you’ve got it!', 'Optime! Great work!'];
  return messages[(score + current) % messages.length];
}

function gentleCorrectionMessage() {
  const messages = [
    'Not quite — have another look ♡',
    'Good try — here’s the key point.',
    'Nearly — let’s fix this one together.',
    'That one was tricky. You’ve got the next one.',
  ];
  return messages[(current + sessionAnswers.length) % messages.length];
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
  if (!audioContext) audioContext = new AudioContext();
  const audio = audioContext;
  if (audio.state === 'suspended') audio.resume().catch(() => {});
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
}

function exportProgress() {
  state.lastBackup = new Date().toISOString();
  save();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Latin_Revision_V8_2_progress_backup.json';
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
      if (!data || typeof data !== 'object' || !Array.isArray(data.attempts) || !data.reviews || typeof data.reviews !== 'object' || !data.cycles || typeof data.cycles !== 'object') throw new Error('Invalid backup');
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


function showRouteError(message) {
  console.error(message);
  let box = document.getElementById('routeError');
  if (!box) {
    box = document.createElement('div');
    box.id = 'routeError';
    box.className = 'route-error';
    box.setAttribute('role', 'alert');
    const main = document.querySelector('main');
    if (main) main.prepend(box); else document.body.prepend(box);
  }
  box.textContent = message;
  box.classList.remove('hidden');
  setTimeout(() => box.classList.add('hidden'), 5000);
}

function runAction(action, element) {
  if (!action) return;
  try {
        if (action === 'open-games') return openGames();
    if (action === 'game-match') return startLatinGame('match');
    if (action === 'game-gladiator') return startLatinGame('gladiator');
    if (action === 'game-sentence') return startLatinGame('sentence');
    if (action === 'game-sprint') return startLatinGame('sprint');
    if (action === 'games-back') return endLatinGame();
if (action === 'home') return showDashboard();
    if (action === 'learn') return showLearn();
    if (action === 'practice') return showPracticeHub();
    if (action === 'wordbank') return openWordBank();
    if (action === 'progress') return showProgress();
    if (action === 'more') return showMore();
    if (action === 'sound') return toggleSound();
    if (action === 'resume') return resumeSession();
    if (action === 'daily-picker') return showDailyPicker();
    if (action === 'mistake-review') return openMistakeReview();
    if (action === 'quick-quiz') return startQuickQuiz();
    if (action === 'revision-plan') return showRevisionPlan();
    if (action === 'due') return startDue();
    if (action === 'mixed') return startMixed();
    if (action === 'export') return exportProgress();
    if (action === 'import') {
      const input = document.getElementById('importfile');
      if (input) input.click();
      return;
    }
    if (action === 'share-report') return shareParentReport();
    if (action === 'reset') return resetProgress();
    if (action === 'wb-reveal') return revealWordBank();
    if (action === 'back') return goBack();
    if (action === 'wb-again') return rateWordBank(false);
    if (action === 'wb-known') return rateWordBank(true);
    if (action === 'check-answer') return checkAnswer();
    if (action === 'next-question') return nextQuestion();
    if (action === 'pause-quiz') return pauseQuiz();
    if (action.startsWith('module:')) return showLearn(action.split(':')[1]);
    if (action.startsWith('start-module:')) return startCategoryPractice(action.split(':')[1]);
    if (action === 'open-date') return openDateBlock(element.dataset.day);
    if (action === 'start-date') {
      const block = blocks.find(item => item.day === element.dataset.day);
      if (!block) return showRouteError('That revision date is not available.');
      return startBlock(block);
    }
    showRouteError(`Unknown action: ${action}`);
  } catch (error) {
    console.error(`Action failed: ${action}`, error);
    showRouteError('That button hit an app error. Your progress is safe; please try Home and open it again.');
  }
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  event.preventDefault();
  runAction(control.dataset.action, control);
});

const importInput = document.querySelector('[data-import-progress="1"]');
if (importInput) importInput.addEventListener('change', importProgress);


['pointerdown', 'keydown', 'touchstart'].forEach(eventName => {
  document.addEventListener(eventName, noteStudyInteraction, { passive: true });
});
document.addEventListener('visibilitychange', () => {
  lastActiveTick = Date.now();
  if (document.visibilityState === 'visible') noteStudyInteraction();
});
setInterval(tickActiveStudy, 15000);

try { renderDashboard(); } catch (error) { console.error('Initial dashboard render failed:', error); }
show('dashboard', { noHistory: true });
currentScreen = 'dashboard';
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));


/* ===== V9.1.4 Games runtime repair ===== */
function gameEsc(value){
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}
function gameSafeRender(fn){
  try { fn(); }
  catch(error){
    console.error('Latin Game render error:', error);
    const area=document.getElementById('gameArea');
    if(area) area.innerHTML='<div class="game-question"><h2>Game needs a refresh</h2><p>'+
      gameEsc(error && error.message ? error.message : error)+'</p>'+
      '<button type="button" class="secondaryButton" onclick="openGames()">Back to Games</button></div>';
  }
}

/* ===== V9.1 Latin Games engine ===== */
let latinGame = {type:null,score:0,combo:0,round:0,timer:null,seconds:0,answer:'',selected:[],pairs:[]};

const LATIN_GAME_ART = {
  bronze:"data:image/webp;base64,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",
  silver:"data:image/webp;base64,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",
  gold:"data:image/webp;base64,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",
  victory:"data:image/webp;base64,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",
  correct:"data:image/webp;base64,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"
};

function gameBank(){ return window.LATIN_BANK || []; }

function gameShuffle(items){
  const x=[...items];
  for(let i=x.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [x[i],x[j]]=[x[j],x[i]];
  }
  return x;
}

function stopLatinGameTimer(){
  if(latinGame.timer){
    clearInterval(latinGame.timer);
    latinGame.timer=null;
  }
}

function openGames(){
  stopLatinGameTimer();
  show('gamesHub');
  setNavActive('practice');
}

function endLatinGame(){
  stopLatinGameTimer();
  show('gamesHub',{noHistory:true});
  setNavActive('practice');
}

function updateLatinGameStats(){
  const s=document.getElementById('gameScore');
  const c=document.getElementById('gameCombo');
  const t=document.getElementById('gameTimer');
  if(s) s.textContent='Score '+latinGame.score;
  if(c) c.textContent='Combo '+latinGame.combo;
  if(t) t.textContent=latinGame.type==='sprint' ? latinGame.seconds+'s' : '';
}

function latinVocabPairs(){
  const out=[];
  const seen=new Set();

  for(const q of gameBank()){
    if(q.type!=='exact_any') continue;
    if(String(q.direction||'')!=='Latin → English') continue;

    const latin=String(q.context||'').trim();
    const english=String((Array.isArray(q.accepted)&&q.accepted[0]) || q.answerExample || '').trim();
    if(!latin || !english || latin.length>40 || english.length>60) continue;

    const key=(latin+'|'+english).toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    out.push({latin,english});
  }
  return out;
}

function latinMCBank(){
  return gameBank().filter(q =>
    q.type==='mc' &&
    Array.isArray(q.opts) &&
    q.opts.length>=2 &&
    q.q &&
    q.a
  );
}

function latinSprintBank(){
  const bank=latinMCBank();
  const vocab=bank.filter(q => {
    const topic=String(q.topic||'').toLowerCase();
    const label=String(q.label||'').toLowerCase();
    return topic.includes('vocabulary') ||
           topic.includes('nouns') ||
           topic.includes('preposition') ||
           topic.includes('core verbs') ||
           topic.includes('miscellaneous') ||
           label.includes('vocabulary');
  });
  return vocab.length ? vocab : bank;
}

function latinSentenceBank(){
  return gameBank().filter(q => {
    if(q.type!=='lat_auto') return false;
    const answer=String(q.answerExample || (Array.isArray(q.accepted)&&q.accepted[0]) || '').trim();
    const count=answer ? answer.split(/\s+/).length : 0;
    return count>=3 && count<=12;
  });
}

function startLatinGame(type){
  stopLatinGameTimer();
  latinGame={
    type,
    score:0,
    combo:0,
    round:0,
    timer:null,
    seconds:type==='sprint'?60:0,
    answer:'',
    selected:[],
    pairs:[]
  };

  const titles={
    match:'Verbum Match',
    gladiator:'Gladiator Challenge',
    sentence:'Build the Sentence',
    sprint:'Roman Sprint'
  };
  const title=document.getElementById('gameTitle');
  if(title) title.textContent=titles[type] || 'Latin Game';

  show('gamePlay');
  setNavActive('practice');
  updateLatinGameStats();

  if(type==='match'){
    gameSafeRender(renderLatinMatch);
  }else if(type==='sentence'){
    gameSafeRender(renderLatinSentence);
  }else{
    if(type==='sprint'){
      latinGame.timer=setInterval(()=>{
        latinGame.seconds--;
        updateLatinGameStats();
        if(latinGame.seconds<=0) finishLatinGame();
      },1000);
    }
    gameSafeRender(renderLatinChallenge);
  }
}

function renderLatinMatch(){
  const pairs=gameShuffle(latinVocabPairs()).slice(0,6);
  latinGame.pairs=pairs;
  latinGame.round=0;

  if(pairs.length<3){
    latinGameMessage('Not enough matching vocabulary was found in the source bank.');
    return;
  }

  const tiles=gameShuffle(
    pairs.flatMap((p,index)=>[
      {pair:index,side:'latin',text:p.latin},
      {pair:index,side:'english',text:p.english}
    ])
  );

  const area=document.getElementById('gameArea');
  area.innerHTML=
    '<p>Match each Latin word with its English meaning.</p>'+
    '<div class="match-grid">'+
    tiles.map(x =>
      '<button class="match-tile" type="button" data-pair="'+x.pair+'" data-side="'+x.side+'">'+
      gameEsc(x.text)+
      '</button>'
    ).join('')+
    '</div>';

  area.querySelectorAll('.match-tile').forEach(button=>{
    button.addEventListener('click',()=>pickLatinMatch(button));
  });
}

function pickLatinMatch(button){
  if(button.classList.contains('matched')) return;

  const selected=document.querySelector('.match-tile.selected');
  if(!selected){
    button.classList.add('selected');
    return;
  }
  if(selected===button) return;

  selected.classList.remove('selected');

  const correct=
    selected.dataset.pair===button.dataset.pair &&
    selected.dataset.side!==button.dataset.side;

  if(correct){
    selected.classList.add('matched');
    button.classList.add('matched');
    latinGame.score += 10 + latinGame.combo*2;
    latinGame.combo++;
    latinGame.round++;
    updateLatinGameStats();

    if(latinGame.round>=latinGame.pairs.length){
      setTimeout(finishLatinGame,350);
    }
  }else{
    latinGame.combo=0;
    updateLatinGameStats();
  }
}

function renderLatinChallenge(){
  if(latinGame.type==='gladiator' && latinGame.round>=10){
    finishLatinGame();
    return;
  }

  const pool=latinGame.type==='sprint' ? latinSprintBank() : latinMCBank();
  if(!pool.length){
    latinGameMessage('No suitable source-bank multiple-choice questions were found.');
    return;
  }

  const q=pool[Math.floor(Math.random()*pool.length)];
  latinGame.answer=String(q.a);

  const area=document.getElementById('gameArea');
  const promptParts=[];
  if(q.context) promptParts.push('<p>'+gameEsc(String(q.context))+'</p>');
  promptParts.push('<h2>'+gameEsc(String(q.q))+'</h2>');

  area.innerHTML=
    '<div class="game-question">'+
    '<p>'+gameEsc(String(q.topic||q.label||''))+'</p>'+
    promptParts.join('')+
    '<div class="game-options">'+
    gameShuffle(q.opts).map(option =>
      '<button type="button" data-game-answer="'+gameEsc(String(option))+'">'+
      gameEsc(String(option))+
      '</button>'
    ).join('')+
    '</div></div>';

  area.querySelectorAll('[data-game-answer]').forEach(button=>{
    button.addEventListener('click',()=>answerLatinChallenge(button.dataset.gameAnswer));
  });
}

function answerLatinChallenge(answer){
  const correct=
    String(answer).trim().toLowerCase()===
    String(latinGame.answer).trim().toLowerCase();

  if(correct){
    latinGame.score += 10 + latinGame.combo*2;
    latinGame.combo++;
  }else{
    latinGame.combo=0;
  }

  latinGame.round++;
  updateLatinGameStats();

  const area=document.getElementById('gameArea');
  area.querySelectorAll('[data-game-answer]').forEach(b=>b.disabled=true);

  const feedback=document.createElement('p');
  feedback.className='game-feedback';
  feedback.textContent=correct ? 'Correct ♡' : 'Answer: '+latinGame.answer;
  area.prepend(feedback);

  setTimeout(()=>{
    if(latinGame.type==='sprint' && latinGame.seconds<=0) return;
    gameSafeRender(renderLatinChallenge);
  },450);
}

function renderLatinSentence(){
  if(latinGame.round>=5){
    finishLatinGame();
    return;
  }

  const pool=latinSentenceBank();
  if(!pool.length){
    latinGameMessage('No suitable Latin sentence-production items were found in the source bank.');
    return;
  }

  const q=pool[Math.floor(Math.random()*pool.length)];
  latinGame.answer=String(q.answerExample || q.accepted[0]).trim();
  latinGame.selected=[];

  const words=gameShuffle(latinGame.answer.split(/\s+/));
  const area=document.getElementById('gameArea');

  area.innerHTML=
    '<div class="game-question">'+
    '<p>'+gameEsc(String(q.context||''))+'</p>'+
    '<h2>'+gameEsc(String(q.q||'Build the Latin sentence.'))+'</h2>'+
    '<div class="sentence-build" id="sentenceBuild">Tap the words in order…</div>'+
    '<div class="game-options">'+
    words.map((word,index)=>
      '<button class="word-chip" type="button" data-game-word="'+index+'">'+
      gameEsc(word)+
      '</button>'
    ).join('')+
    '</div>'+
    '<p><button class="primaryButton" type="button" id="sentenceGameCheck">Check sentence</button> '+
    '<button class="secondaryButton" type="button" id="sentenceGameClear">Clear</button></p>'+
    '</div>';

  area.querySelectorAll('[data-game-word]').forEach(button=>{
    button.addEventListener('click',()=>{
      if(button.classList.contains('used')) return;
      button.classList.add('used');
      latinGame.selected.push(button.textContent);
      document.getElementById('sentenceBuild').textContent=latinGame.selected.join(' ');
    });
  });

  document.getElementById('sentenceGameClear').addEventListener('click',renderLatinSentence);
  document.getElementById('sentenceGameCheck').addEventListener('click',checkLatinSentence);
}

function checkLatinSentence(){
  const made=latinGame.selected.join(' ').replace(/\s+/g,' ').trim().toLowerCase();
  const correctAnswer=latinGame.answer.replace(/\s+/g,' ').trim().toLowerCase();
  const correct=made===correctAnswer;

  if(correct){
    latinGame.score += 20 + latinGame.combo*3;
    latinGame.combo++;
  }else{
    latinGame.combo=0;
  }

  latinGame.round++;
  updateLatinGameStats();

  const area=document.getElementById('gameArea');
  const feedback=document.createElement('p');
  feedback.className='game-feedback';
  feedback.textContent=correct ? 'Correct ♡' : 'Answer: '+latinGame.answer;
  area.prepend(feedback);

  setTimeout(()=>gameSafeRender(renderLatinSentence),700);
}

function finishLatinGame(){
  stopLatinGameTimer();

  const score=latinGame.score;
  const medal=score>=120 ? 'gold' : score>=60 ? 'silver' : 'bronze';
  let best=score;

  try{
    const key='latinGameBest_'+latinGame.type;
    best=Math.max(score,Number(localStorage.getItem(key)||0));
    localStorage.setItem(key,String(best));
  }catch(e){}

  const area=document.getElementById('gameArea');
  area.innerHTML=
    '<div class="game-result">'+
    '<img src="'+LATIN_GAME_ART[medal]+'" alt="">'+
    '<h2>'+medal.charAt(0).toUpperCase()+medal.slice(1)+'!</h2>'+
    '<p>You scored <strong>'+score+'</strong>.</p>'+
    '<p class="game-best">Best score: '+best+'</p>'+
    '<button class="primaryButton" type="button" id="latinGameAgain">Play again</button> '+
    '<button class="secondaryButton" type="button" id="latinGameDone">Games</button>'+
    '</div>';

  document.getElementById('latinGameAgain').addEventListener('click',()=>startLatinGame(latinGame.type));
  document.getElementById('latinGameDone').addEventListener('click',openGames);
}

function latinGameMessage(text){
  const area=document.getElementById('gameArea');
  area.innerHTML=
    '<div class="game-question"><p>'+gameEsc(text)+'</p>'+
    '<button class="secondaryButton" type="button" id="latinGameMessageBack">Back to games</button></div>';
  document.getElementById('latinGameMessageBack').addEventListener('click',openGames);
}





/* ===== V9.1.3 lightweight games fallback ===== */
document.addEventListener('click', function(event){
  const trigger=event.target.closest('[data-action="open-games"]');
  if(!trigger) return;
  event.preventDefault();
  try{ openGames(); }catch(error){ console.error('Games open failed',error); }
}, true);
