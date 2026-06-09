'use strict';

// ── SERVICE WORKER ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('SW registered, scope:', reg.scope))
      .catch(err => console.error('SW registration failed:', err));
  });
}


// ── SCREEN ROUTER ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}


// ── BOTTOM SHEET UTILITIES ──
function openSheet(id) {
  document.getElementById(id).classList.add('open');
}

function closeSheet(id) {
  document.getElementById(id).classList.remove('open');
}


// ── DATE HELPER ──
function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month:   'short',
    day:     'numeric'
  }).toUpperCase();
}

// Local calendar-day string, YYYY-MM-DD, in the device's own timezone.
// Replaces `new Date().toISOString().split('T')[0]`, which returns the UTC
// day and so rolls over to "tomorrow" during the evening hours in any
// negative-offset timezone (and to "yesterday" in the morning for positive
// offsets). Use this anywhere a *calendar day* is meant; keep toISOString()
// only for full instant-in-time timestamps (start_time, end_time, timestamp).
function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}


// ── HOME SCREEN STATE ──
let selectedWorkoutDay = null;


// ── WATER TRACKING ──
let waterCount = 0;

async function initWaterCount() {
  const today = localDateString();
  try {
    waterCount = await getWaterCountToday(today);
  } catch (e) {
    console.warn('Water: failed to load count', e);
    waterCount = 0;
  }
  updateWaterDisplay();
}

function updateWaterDisplay() {
  document.getElementById('home-water-count').textContent = waterCount;
  const badge = document.getElementById('fab-water-count');
  badge.textContent = waterCount > 0 ? waterCount : '';
}

async function handleWaterTap() {
  const today = localDateString();
  try {
    await logWaterBottle(today);
    waterCount++;
    updateWaterDisplay();
  } catch (e) {
    console.error('Water: log failed', e);
  }
}


// ── UPDATE HOME DISPLAY ──
function updateHomeWorkoutDisplay(dayKey, labels) {
  selectedWorkoutDay = dayKey;

  const nameEl   = document.getElementById('home-workout-name');
  const startBtn = document.getElementById('btn-start-workout');
  const chevron  = document.querySelector('.chevron-icon');

  if (dayKey) {
    nameEl.textContent = (labels && labels[dayKey]) || dayKey;
    nameEl.classList.remove('rest-day');
    startBtn.classList.remove('hidden');
    chevron.style.display = '';
  } else {
    nameEl.textContent = 'Rest Day';
    nameEl.classList.add('rest-day');
    startBtn.classList.add('hidden');
    chevron.style.display = '';
  }
}


// ── DAY SELECTOR SHEET ──
async function openDaySelectSheet() {
  const container = document.getElementById('sheet-day-options');
  container.innerHTML = '';

  let labels = {};
  try {
    labels = await getWorkoutDayLabels();
  } catch (e) {
    console.warn('openDaySelectSheet: failed to load labels, falling back', e);
    labels = { ...WORKOUT_DAY_LABELS };
  }

  Object.entries(labels).forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.className = 'sheet-option' + (key === selectedWorkoutDay ? ' selected' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      updateHomeWorkoutDisplay(key, labels);
      closeSheet('sheet-day-select');
    });
    container.appendChild(btn);
  });

  openSheet('sheet-day-select');
}


// ── HOME SCREEN INIT ──
async function initHome() {
  const today = new Date();
  document.getElementById('home-date').textContent = formatDate(today);
  initWaterCount();

  let schedule = {};
  let labels   = {};
  try {
    [schedule, labels] = await Promise.all([getSchedule(), getWorkoutDayLabels()]);
  } catch (e) {
    console.warn('initHome: IDB read failed, falling back to constants', e);
    schedule = { ...SCHEDULE_BY_DAY };
    labels   = { ...WORKOUT_DAY_LABELS };
  }

  const dayKey = schedule[today.getDay()] ?? null;
  updateHomeWorkoutDisplay(dayKey, labels);
}


// ── EVENT LISTENERS ──
document.addEventListener('DOMContentLoaded', () => {
  initHome();
  maybeShowResumePrompt();

  // Home
  document.getElementById('btn-select-day')
    .addEventListener('click', openDaySelectSheet);

  document.getElementById('btn-start-workout')
    .addEventListener('click', () => {
      if (selectedWorkoutDay) startWorkout(selectedWorkoutDay);
    });

  document.getElementById('btn-log-cardio')
    .addEventListener('click', () => showScreen('screen-cardio-type'));

  document.getElementById('btn-bodyweight')
    .addEventListener('click', () => showScreen('screen-bodyweight'));

  document.getElementById('btn-export')
    .addEventListener('click', exportAllData);
  
    document.getElementById('btn-water-home')
    .addEventListener('click', handleWaterTap);

  document.getElementById('btn-water-fab')
    .addEventListener('click', handleWaterTap);

  // Resume prompt
  document.getElementById('btn-resume-yes')
    .addEventListener('click', resumeWorkout);

  document.getElementById('btn-resume-no')
    .addEventListener('click', discardWorkoutDraft);

  // Exercise screen
  document.getElementById('btn-prev-exercise')
    .addEventListener('click', prevExercise);

  document.getElementById('btn-skip-exercise')
    .addEventListener('click', openSkipSheet);

  document.getElementById('btn-next-exercise')
    .addEventListener('click', nextExercise);

  // Persist extras on every keystroke so an abrupt kill mid-typing
  // loses nothing. Textareas are static DOM, so bind once.
  document.getElementById('input-machine-adj')
    .addEventListener('input', saveCurrentExtras);
  
    document.getElementById('input-observations')
    .addEventListener('input', saveCurrentExtras);

  // Session end screen
  document.getElementById('btn-finish-session')
    .addEventListener('click', saveSession);

  // Tap overlay backdrop to close any sheet
  document.querySelectorAll('.sheet-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeSheet(overlay.id);
    });
  });
});
