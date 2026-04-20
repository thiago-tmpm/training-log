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


// ── HOME SCREEN STATE ──
let selectedWorkoutDay = null;


// ── UPDATE HOME DISPLAY ──
function updateHomeWorkoutDisplay(dayKey) {
  selectedWorkoutDay = dayKey;

  const nameEl   = document.getElementById('home-workout-name');
  const startBtn = document.getElementById('btn-start-workout');
  const chevron  = document.querySelector('.chevron-icon');

  if (dayKey) {
    nameEl.textContent = WORKOUT_DAY_LABELS[dayKey];
    nameEl.classList.remove('rest-day');
    startBtn.classList.remove('hidden');
    chevron.style.display = '';
  } else {
    nameEl.textContent = 'Rest Day';
    nameEl.classList.add('rest-day');
    startBtn.classList.add('hidden');
    // Still show chevron so user can select a workout on rest days
    chevron.style.display = '';
  }
}


// ── DAY SELECTOR SHEET ──
function openDaySelectSheet() {
  const container = document.getElementById('sheet-day-options');
  container.innerHTML = '';

  Object.entries(WORKOUT_DAY_LABELS).forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.className = 'sheet-option' + (key === selectedWorkoutDay ? ' selected' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      updateHomeWorkoutDisplay(key);
      closeSheet('sheet-day-select');
    });
    container.appendChild(btn);
  });

  openSheet('sheet-day-select');
}


// ── HOME SCREEN INIT ──
function initHome() {
  const today  = new Date();
  const dayKey = SCHEDULE_BY_DAY[today.getDay()];

  document.getElementById('home-date').textContent = formatDate(today);
  updateHomeWorkoutDisplay(dayKey);
}


// ── EVENT LISTENERS ──
document.addEventListener('DOMContentLoaded', () => {
  initHome();

  // Home
  document.getElementById('btn-select-day')
    .addEventListener('click', openDaySelectSheet);

  document.getElementById('btn-start-workout')
    .addEventListener('click', () => {
      if (selectedWorkoutDay) startWorkout(selectedWorkoutDay);
    });

  document.getElementById('btn-log-cardio')
    .addEventListener('click', () => showScreen('screen-cardio'));

  document.getElementById('btn-bodyweight')
    .addEventListener('click', () => showScreen('screen-bodyweight'));

  // Exercise screen
  document.getElementById('btn-skip-exercise')
    .addEventListener('click', openSkipSheet);

  document.getElementById('btn-next-exercise')
    .addEventListener('click', nextExercise);

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
