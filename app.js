// ── SERVICE WORKER REGISTRATION ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('SW registered, scope:', reg.scope))
      .catch(err => console.error('SW registration failed:', err));
  });
}


// ── WORKOUT SCHEDULE ──
// Keyed by getDay() result: 0 = Sunday, 1 = Monday, ... 6 = Saturday
const WORKOUT_SCHEDULE = {
  0: null,            // Sunday  → Rest
  1: 'Lower 1',       // Monday
  2: 'Push',          // Tuesday
  3: 'Pull',          // Wednesday
  4: null,            // Thursday → Rest
  5: 'Lower 2',       // Friday
  6: 'Upper Body'     // Saturday
};


// ── SCREEN ROUTER ──
// Hides all screens and shows the one with the given id.
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}


// ── DATE HELPERS ──
function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month:   'short',
    day:     'numeric'
  }).toUpperCase();
}


// ── HOME SCREEN INIT ──
function initHome() {
  const today   = new Date();
  const dayIdx  = today.getDay();
  const workout = WORKOUT_SCHEDULE[dayIdx];

  // Date label
  document.getElementById('home-date').textContent = formatDate(today);

  // Workout name
  const nameEl = document.getElementById('home-workout-name');
  const startBtn = document.getElementById('btn-start-workout');

  if (workout) {
    nameEl.textContent = workout;
    nameEl.classList.remove('rest-day');
    startBtn.classList.remove('hidden');
  } else {
    nameEl.textContent = 'Rest Day';
    nameEl.classList.add('rest-day');
    startBtn.classList.add('hidden');
  }
}


// ── EVENT LISTENERS ──
document.addEventListener('DOMContentLoaded', () => {
  initHome();

  document.getElementById('btn-start-workout')
    .addEventListener('click', () => showScreen('screen-workout'));

  document.getElementById('btn-log-cardio')
    .addEventListener('click', () => showScreen('screen-cardio'));

  document.getElementById('btn-bodyweight')
    .addEventListener('click', () => showScreen('screen-bodyweight'));
});
