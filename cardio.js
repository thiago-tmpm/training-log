'use strict';

// ── CARDIO SESSION STATE ──
const EFFORT_LABELS = {
  1: 'Easy',
  2: 'Moderate',
  3: 'Hard',
  4: 'Very Hard',
  5: 'Max'
};

let cSession = {};


// ── SELECT CARDIO TYPE ──
// Called when user taps a type card. Initialises state and attempts auto-link.
async function selectCardioType(type) {
  const now = new Date();
  cSession = {
    cardioType:               type,
    date:                     localDateString(now),
    startTime:                now.toISOString(),
    endTime:                  null,
    durationMinutes:          null,
    avgHeartRate:             null,
    activeKcal:               null,
    totalKcal:                null,
    effortLevel:              null,
    linkedWorkoutSessionId:   null,
    cardioTiming:             'after'
  };

  try {
    const todaySession = await getLastWorkoutSessionByDate(cSession.date);
    if (todaySession) {
      cSession.linkedWorkoutSessionId = todaySession.session_id;
    }
  } catch (e) {
    console.warn('Cardio: auto-link failed, continuing without link.', e);
  }

  renderCardioLog();
  showScreen('screen-cardio-log');
}


// ── RENDER CARDIO LOG SCREEN ──
function renderCardioLog() {
  // Reset save button — DOM is never destroyed between sessions, only hidden.
  const btn = document.getElementById('btn-save-cardio');
  btn.disabled    = false;
  btn.textContent = 'Save';

  const titles = { run: 'RUN', bike: 'BIKE', other: 'OTHER' };
  document.getElementById('cardio-log-title').textContent = titles[cSession.cardioType];
  document.getElementById('cardio-date').value = cSession.date;

  ['cardio-duration', 'cardio-hr', 'cardio-active-kcal', 'cardio-total-kcal'].forEach(id => {
    const el = document.getElementById(id);
    el.value = '';
    el.classList.remove('input-error');
  });

  document.querySelectorAll('.effort-btn').forEach(btn => btn.classList.remove('selected'));
  document.getElementById('effort-label').textContent = '';
  cSession.effortLevel = null;
}


// ── DATE CHANGE ──
function onCardioDateChange(newDate) {
  cSession.date = newDate;
  // Clear auto-link — cannot guarantee a session exists for the new date.
  cSession.linkedWorkoutSessionId = null;
}


// ── EFFORT SELECTION ──
function selectEffort(level) {
  cSession.effortLevel = level;
  document.querySelectorAll('.effort-btn').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.level) === level);
  });
  document.getElementById('effort-label').textContent = EFFORT_LABELS[level];
}


// ── VALIDATION ──
function validateCardioForm() {
  let valid = true;
  ['cardio-duration', 'cardio-hr', 'cardio-active-kcal'].forEach(id => {
    const el = document.getElementById(id);
    if (!el.value || isNaN(parseInt(el.value, 10))) {
      el.classList.add('input-error');
      valid = false;
    } else {
      el.classList.remove('input-error');
    }
  });
  return valid;
}


// ── SAVE CARDIO SESSION ──
async function saveCardioSession() {
  if (!validateCardioForm()) return;

  cSession.endTime        = new Date().toISOString();
  cSession.durationMinutes = parseInt(document.getElementById('cardio-duration').value, 10);
  cSession.avgHeartRate   = parseInt(document.getElementById('cardio-hr').value, 10);
  cSession.activeKcal     = parseInt(document.getElementById('cardio-active-kcal').value, 10);

  const totalRaw = document.getElementById('cardio-total-kcal').value;
  cSession.totalKcal = totalRaw ? parseInt(totalRaw, 10) : null;

  cSession.cardioTiming = cSession.linkedWorkoutSessionId ? 'after' : 'separate_day';

  const btn = document.getElementById('btn-save-cardio');
  btn.disabled    = true;
  btn.textContent = 'Saving...';

  try {
    await saveCardioSessionToDB(cSession);
    renderCardioSummary();
    showScreen('screen-cardio-summary');
  } catch (e) {
    console.error('Cardio: save failed', e);
    btn.disabled    = false;
    btn.textContent = 'Save';
  }
}


// ── RENDER CARDIO SUMMARY ──
function renderCardioSummary() {
  const typeLabels = { run: 'Run', bike: 'Bike', other: 'Other' };
  const effortText = cSession.effortLevel
    ? `${cSession.effortLevel} — ${EFFORT_LABELS[cSession.effortLevel]}`
    : '—';

  const totalRow = cSession.totalKcal
    ? `<div class="end-stat">
         <span class="end-stat-label">Total kcal</span>
         <span class="end-stat-value">${cSession.totalKcal}</span>
       </div>`
    : '';

  document.getElementById('cardio-summary-stats').innerHTML = `
    <div class="end-stat">
      <span class="end-stat-label">Type</span>
      <span class="end-stat-value">${typeLabels[cSession.cardioType]}</span>
    </div>
    <div class="end-stat">
      <span class="end-stat-label">Duration</span>
      <span class="end-stat-value">${cSession.durationMinutes} min</span>
    </div>
    <div class="end-stat">
      <span class="end-stat-label">Avg HR</span>
      <span class="end-stat-value">${cSession.avgHeartRate} bpm</span>
    </div>
    <div class="end-stat">
      <span class="end-stat-label">Active kcal</span>
      <span class="end-stat-value">${cSession.activeKcal}</span>
    </div>
    ${totalRow}
    <div class="end-stat">
      <span class="end-stat-label">Effort</span>
      <span class="end-stat-value">${effortText}</span>
    </div>
  `;
}


// ── FINISH CARDIO ──
function finishCardioSession() {
  showScreen('screen-home');
  initHome();
}