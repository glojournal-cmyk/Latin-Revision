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

function show(id) {
  ['dashboard', 'practiceHub', 'progressPage', 'morePage', 'wordbank', 'notes', 'quiz', 'results'].forEach(section => { const el = document.getElementById(section); if (el) el.classList.add('hidden'); });
  document.getElementById(id).classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showDashboard() {
  renderDashboard();
  show('dashboard');
  setNavActive('today');
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
    card.querySelector('button').onclick = () => openNotes(block.day);
    list.appendChild(card);
  });
  renderV82DashboardExtras();
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
  renderQuestion();
}

function pauseQuiz() {
  if (!confirm('Pause this practice? Your place and score will be saved, and you can continue from the home screen.')) return;
  showDashboard();
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
  const map = { today: 'navToday', practice: 'navPractice', words: 'navWords', progress: 'navProgress', more: 'navMore' };
  Object.values(map).forEach(id => {
    const button = document.getElementById(id);
    if (button) button.classList.remove('active');
  });
  const active = document.getElementById(map[name]);
  if (active) active.classList.add('active');
}

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning ♡';
  if (hour < 18) return 'Good afternoon ♡';
  return 'Good evening ♡';
}

function suggestedBlock() {
  const regular = blocks.filter(block => !block.mode && block.day !== '30 Aug');
  return regular.find(block => {
    const focus = focusPoolFor(block);
    const cycle = cycleFor(block.day);
    return focus.length && !(Number.isFinite(cycle.completedPercent) && cycle.completedPercent >= masteryTarget);
  }) || regular.find(block => focusPoolFor(block).length) || blocks[0] || null;
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
      nextButton.onclick = () => openNotes(block.day);
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
}

function continueToday() {
  if (state.activeSession) return resumeSession();
  const due = dueQuestions();
  if (due.length) return startDue();
  const block = suggestedBlock();
  if (block) return openNotes(block.day);
  startMixed();
}

function showProgress() {
  renderDashboard();
  renderProgressPage();
  show('progressPage');
  setNavActive('progress');
}

function showPracticeHub() {
  renderDashboard();
  const due = dueQuestions().length;
  const dueButton = document.getElementById('practiceDueButton');
  const dueText = document.getElementById('practiceDueText');
  if (dueButton) dueButton.disabled = !due;
  if (dueText) dueText.textContent = due ? `${due} review question${due === 1 ? '' : 's'} ready today.` : 'Nothing due right now.';
  const mixedButton = document.getElementById('practiceMixedButton');
  if (mixedButton) mixedButton.disabled = !attemptedContentDays().length;
  show('practiceHub');
  setNavActive('practice');
}

function showRevisionPlan() {
  showDashboard();
  setNavActive('practice');
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
  renderDashboard();
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

['pointerdown', 'keydown', 'touchstart'].forEach(eventName => {
  document.addEventListener(eventName, noteStudyInteraction, { passive: true });
});
document.addEventListener('visibilitychange', () => {
  lastActiveTick = Date.now();
  if (document.visibilityState === 'visible') noteStudyInteraction();
});
setInterval(tickActiveStudy, 15000);

renderDashboard();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
