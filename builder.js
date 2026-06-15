'use strict';

// ── PHASE 2.3 BUILDER ──
// Slice A: READ-ONLY. Lists workout days and, drilling into one, the active
// exercises in that day in sort_order. All data comes straight from IndexedDB
// via the existing readers (getWorkoutDayLabels / getExercisesForDay).
//
// NB — no constants fallback here, on purpose. initHome()/startWorkout() fall
// back to the exercises.js constants on an IDB read failure so a glitch never
// blocks a workout. The builder does the opposite: it edits the *stored* plan,
// so showing constant data would let a later edit be made against a view that
// doesn't match storage. On failure the builder surfaces the error instead.

let builderCurrentDayKey = null;

// Minimal HTML escape. Slice A names come from IDB (currently author-seeded),
// but Slice B will let users type names, so escape now: a name containing
// < > & " ' must never break rendering or inject markup.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── OPEN / CLOSE ──
async function openBuilder() {
  await renderBuilderDayList();
  showScreen('screen-builder');
}

// Wrapped (rather than a bare showScreen call in the HTML) so later slices,
// which mutate the plan, can refresh the home screen on the way out from one
// place. In Slice A nothing changes, so it's just a navigation.
function closeBuilder() {
  showScreen('screen-home');
}

// ── DAY LIST ──
async function renderBuilderDayList() {
  const container = document.getElementById('builder-day-list');
  container.innerHTML = '';

  let labels;
  try {
    labels = await getWorkoutDayLabels();
  } catch (e) {
    console.error('Builder: failed to load workout days', e);
    container.innerHTML =
      '<p class="builder-error">Couldn\u2019t load your workout days. Close and reopen the builder to retry.</p>';
    return;
  }

  const entries = Object.entries(labels);
  if (entries.length === 0) {
    container.innerHTML = '<p class="builder-empty">No workout days yet.</p>';
    return;
  }

  entries.forEach(([key, label]) => {
    const row = document.createElement('button');
    row.className = 'builder-row';
    row.innerHTML = `
      <span class="builder-row-label">${escapeHtml(label)}</span>
      <svg class="builder-row-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 6 15 12 9 18"/>
      </svg>
    `;
    row.addEventListener('click', () => openBuilderDay(key, label));
    container.appendChild(row);
  });
}

// ── SINGLE DAY (read-only) ──
async function openBuilderDay(dayKey, label) {
  builderCurrentDayKey = dayKey;
  document.getElementById('builder-day-title').textContent = String(label).toUpperCase();

  const container = document.getElementById('builder-exercise-list');
  container.innerHTML = '';

  let exercises;
  try {
    exercises = await getExercisesForDay(dayKey);
  } catch (e) {
    console.error('Builder: failed to load exercises for', dayKey, e);
    container.innerHTML =
      '<p class="builder-error">Couldn\u2019t load this day\u2019s exercises. Go back and reopen to retry.</p>';
    showScreen('screen-builder-day');
    return;
  }

  if (exercises.length === 0) {
    container.innerHTML = '<p class="builder-empty">No exercises in this day yet.</p>';
  } else {
    exercises.forEach(ex => {
      const row = document.createElement('div');
      row.className = 'builder-ex-row';
      row.innerHTML = `
        <span class="builder-ex-name">${escapeHtml(ex.name)}</span>
        <span class="builder-ex-meta">${ex.sets} \u00d7 ${escapeHtml(ex.repRange)}</span>
      `;
      container.appendChild(row);
    });
  }

  showScreen('screen-builder-day');
}