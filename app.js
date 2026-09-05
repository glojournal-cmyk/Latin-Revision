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
  bronze:"./assets/games/bronze.png",
  silver:"./assets/games/silver.png",
  gold:"./assets/games/gold.png",
  victory:"./assets/games/victory.png",
  correct:"./assets/games/correct.png"
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
