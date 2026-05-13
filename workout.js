'use strict';

// ── WORKOUT SESSION STATE ──
let wSession = null;


// ── START SESSION ──
async function startWorkout(dayKey) {
  const exercises = EXERCISES[dayKey];

  wSession = {
    workoutDay:         dayKey,
    date:               new Date().toISOString().split('T')[0],
    startTime:          new Date().toISOString(),
    endTime:            null,
    bodyweightKg:       null,
    exerciseQueue:      exercises.map(ex => ({ ...ex })),
    currentIndex:       0,
    sets:               {},
    machineAdjustments: {},
    observations:       {},
    prefillWeights:     {}   // { [exercise_id]: { [setNumber]: weightKg } }
  };

  exercises.forEach(ex => {
    wSession.sets[ex.id] = Array.from({ length: ex.sets }, (_, i) => ({
      setNumber:   i + 1,
      weightKg:    '',
      reps:        '',
      failure:     false,
      isPrefilled: false
    }));
  });

  // Fetch last weights and machine adjustments for all exercises concurrently.
  const [weightResults, machineResults] = await Promise.all([
    Promise.all(exercises.map(ex => getLastWeightForExercise(ex.id))),
    Promise.all(exercises.map(ex => getLastMachineAdjustmentForExercise(ex.id)))
  ]);

  exercises.forEach((ex, i) => {
    // Weight prefill
    const weights = weightResults[i];
    wSession.prefillWeights[ex.id] = weights;
    wSession.sets[ex.id].forEach(set => {
      if (weights[set.setNumber] !== undefined) {
        set.weightKg    = String(weights[set.setNumber]);
        set.isPrefilled = true;
      }
    });

    // Machine adjustment prefill
    if (machineResults[i]) {
      wSession.machineAdjustments[ex.id] = machineResults[i];
    }
  });

  renderExerciseScreen();
  showScreen('screen-exercise');
}


// ── RENDER EXERCISE SCREEN ──
function renderExerciseScreen() {
  const ex     = wSession.exerciseQueue[wSession.currentIndex];
  const total  = wSession.exerciseQueue.length;
  const pos    = wSession.currentIndex + 1;
  const isLast = pos === total;

  document.getElementById('ex-progress').textContent = `${pos} / ${total}`;
  document.getElementById('ex-name').textContent      = ex.name;
  document.getElementById('ex-rep-range').textContent = ex.repRange;

  renderSetRows(ex);

  // Restore observations (always collapsed)
  document.getElementById('input-observations').value = wSession.observations[ex.id] || '';
  document.getElementById('observations-content').classList.add('hidden');
  document.getElementById('btn-observations').textContent = '+ Observations';

  // Restore machine adjustment — auto-expand if a value exists
  const machAdj = wSession.machineAdjustments[ex.id] || '';
  document.getElementById('input-machine-adj').value = machAdj;

  if (machAdj) {
    document.getElementById('machine-adj-content').classList.remove('hidden');
    document.getElementById('btn-machine-adj').textContent = '− Machine Adjustment';
  } else {
    document.getElementById('machine-adj-content').classList.add('hidden');
    document.getElementById('btn-machine-adj').textContent = '+ Machine Adjustment';
  }

  document.getElementById('btn-next-exercise').textContent =
    isLast ? 'Finish Session' : 'Next Exercise';
}


// ── RENDER SET ROWS ──
function renderSetRows(ex) {
  const container = document.getElementById('sets-container');
  container.innerHTML = '';

  wSession.sets[ex.id].forEach((set, i) => {
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = `
      <span class="set-num">${set.setNumber}</span>
      <div class="weight-group">
        <input
          type="text"
          inputmode="decimal"
          class="input-weight${set.isPrefilled ? ' prefilled' : ''}"
          value="${set.weightKg}"
          placeholder="—"
          data-ex="${ex.id}"
          data-set="${i}"
          data-field="weightKg"
          autocomplete="off"
        >
        <span class="unit">kg</span>
      </div>
      <input
        type="text"
        inputmode="numeric"
        class="input-reps"
        value="${set.reps}"
        placeholder="0"
        data-ex="${ex.id}"
        data-set="${i}"
        data-field="reps"
        autocomplete="off"
      >
      <button
        class="failure-btn${set.failure ? ' active' : ''}"
        data-ex="${ex.id}"
        data-set="${i}"
        aria-label="Failure"
        aria-pressed="${set.failure}"
      >F</button>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll('.input-weight').forEach(input => {
    input.addEventListener('focus',  handleWeightFocus);
    input.addEventListener('input',  handleSetInput);
    input.addEventListener('blur',   handleSetInput);
  });

  container.querySelectorAll('.input-reps').forEach(input => {
    input.addEventListener('input', handleSetInput);
    input.addEventListener('blur',  handleSetInput);
  });

  container.querySelectorAll('.failure-btn').forEach(btn => {
    btn.addEventListener('click', handleFailureToggle);
  });
}


// ── INPUT HANDLERS ──

// Select all text on focus so the first keystroke replaces the whole value.
// setTimeout defers the call past iOS Safari's own cursor positioning.
function handleWeightFocus(e) {
  const input = e.target;
  setTimeout(() => input.select(), 0);
}

function handleSetInput(e) {
  const { ex, set, field } = e.target.dataset;
  const idx = parseInt(set, 10);
  wSession.sets[ex][idx][field] = e.target.value;

  // Clear prefilled indicator as soon as the user edits the weight
  if (field === 'weightKg') {
    wSession.sets[ex][idx].isPrefilled = false;
    e.target.classList.remove('prefilled');
  }
}

function handleFailureToggle(e) {
  const btn    = e.currentTarget;
  const { ex, set } = btn.dataset;
  const idx    = parseInt(set, 10);
  const newVal = !wSession.sets[ex][idx].failure;
  wSession.sets[ex][idx].failure = newVal;
  btn.classList.toggle('active', newVal);
  btn.setAttribute('aria-pressed', String(newVal));
}


// ── NEXT EXERCISE ──
function nextExercise() {
  const ex = wSession.exerciseQueue[wSession.currentIndex];
  wSession.machineAdjustments[ex.id] = document.getElementById('input-machine-adj').value;
  wSession.observations[ex.id]       = document.getElementById('input-observations').value;

  if (wSession.currentIndex === wSession.exerciseQueue.length - 1) {
    finishWorkout();
  } else {
    wSession.currentIndex++;
    renderExerciseScreen();
  }
}


// ── SKIP EXERCISE ──
function openSkipSheet() {
  openSheet('sheet-skip');
}

function skipExercise(mode) {
  closeSheet('sheet-skip');
  const idx = wSession.currentIndex;

  if (mode === 'not_today') {
    wSession.exerciseQueue.splice(idx, 1);
  } else if (mode === 'come_back_later') {
    const ex = wSession.exerciseQueue.splice(idx, 1)[0];
    wSession.exerciseQueue.push(ex);
  }

  if (wSession.exerciseQueue.length === 0 ||
      wSession.currentIndex >= wSession.exerciseQueue.length) {
    finishWorkout();
  } else {
    renderExerciseScreen();
  }
}


// ── FINISH WORKOUT ──
async function finishWorkout() {
  wSession.endTime = new Date().toISOString();

  const start    = new Date(wSession.startTime);
  const end      = new Date(wSession.endTime);
  const diffMins = Math.round((end - start) / 60000);
  const hours    = Math.floor(diffMins / 60);
  const mins     = diffMins % 60;
  const duration = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const exerciseCount = wSession.exerciseQueue.length;

  document.getElementById('end-duration').textContent  = duration;
  document.getElementById('end-exercises').textContent =
    `${exerciseCount} exercise${exerciseCount !== 1 ? 's' : ''}`;

  // Pre-fill bodyweight input with last recorded value, if any
  const lastBw  = await getLastBodyweight();
  const bwInput = document.getElementById('input-bodyweight');
  bwInput.value = lastBw !== null ? String(lastBw) : '';

  showScreen('screen-session-end');
}


// ── SAVE SESSION ──
async function saveSession() {
  const btn = document.getElementById('btn-finish-session');
  btn.disabled    = true;
  btn.textContent = 'Saving...';

  const bwInput  = document.getElementById('input-bodyweight').value.trim();
  const weightKg = bwInput ? parseFloat(bwInput) : null;
  wSession.bodyweightKg = weightKg;

  try {
    await saveWorkoutSession(wSession);
    if (weightKg !== null) {
      await saveBodyweightLog(weightKg, wSession.date);
    }
  } catch (err) {
    console.error('Failed to save session:', err);
    btn.disabled    = false;
    btn.textContent = 'Finish';
    return; // Keep the user on the screen — don't lose data silently
  }

  wSession = null;
  initHome();
  showScreen('screen-home');
}


// ── EXTRAS TOGGLES ──
function toggleExtras(contentId, btnId, label) {
  const content     = document.getElementById(contentId);
  const btn         = document.getElementById(btnId);
  const isNowHidden = content.classList.toggle('hidden');
  btn.textContent   = isNowHidden ? `+ ${label}` : `− ${label}`;
}
