'use strict';

const DB_NAME    = 'training-log-db';
const DB_VERSION = 4;

let _db = null;
let _dbPromise = null;
let _upgradeOldVersion = null;   // set in onupgradeneeded only when an upgrade actually runs; gates the v4 seed


// ── OPEN / INIT ──
// iOS Safari may silently close the IndexedDB connection while the PWA is
// suspended in the background. A one-shot connection can never recover —
// every later transaction throws until a full reload. So instead of a fixed
// connection we open lazily through getDB(), which reopens whenever the
// cached connection has been dropped.
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = e => {
      const db = e.target.result;
      _upgradeOldVersion = e.oldVersion;   // captured for the post-open v4 seed gate

      if (!db.objectStoreNames.contains('workout_sessions')) {
        db.createObjectStore('workout_sessions', {
          keyPath: 'session_id', autoIncrement: true
        });
      }

      if (!db.objectStoreNames.contains('set_logs')) {
        const setStore = db.createObjectStore('set_logs', {
          keyPath: 'set_id', autoIncrement: true
        });
        setStore.createIndex('by_session',  'session_id',  { unique: false });
        setStore.createIndex('by_exercise', 'exercise_id', { unique: false });
      }

      if (!db.objectStoreNames.contains('bodyweight_log')) {
        const bwStore = db.createObjectStore('bodyweight_log', {
          keyPath: 'log_id', autoIncrement: true
        });
        bwStore.createIndex('by_date', 'date', { unique: false });
      }

      if (e.oldVersion < 2) {
        db.createObjectStore('cardio_sessions', {
          keyPath: 'session_id', autoIncrement: true
        });
      }

      if (e.oldVersion < 3) {
        db.createObjectStore('water_log', {
          keyPath: 'log_id', autoIncrement: true
        });
      }

      // ── v4: WORKOUTS BECOME USER DATA (Phase 2.1) ──
      // Create the three stores EMPTY here. Seeding the author's device from
      // the hardcoded constants happens AFTER open (see maybeSeedV4), using
      // the single-store pattern. The versionchange transaction inside
      // onupgradeneeded spans every store at once — exactly the multi-store
      // shape the decisions log says hangs silently on iOS Safari — so NO
      // data writes happen in here.
      if (!db.objectStoreNames.contains('exercises')) {
        // keyPath is the app-assigned string ID, NOT autoIncrement.
        // exercise_id is permanent identity and the join key for set_logs.
        const exStore = db.createObjectStore('exercises', { keyPath: 'exercise_id' });
        // by_day: lets the builder/logger fetch a day's exercises directly.
        // Added now because creating an index later needs another version bump;
        // additive and free. Remove if you'd rather defer.
        exStore.createIndex('by_day', 'workout_day', { unique: false });
      }
      if (!db.objectStoreNames.contains('workout_days')) {
        db.createObjectStore('workout_days', { keyPath: 'workout_day_key' });
      }
      if (!db.objectStoreNames.contains('workout_schedule')) {
        db.createObjectStore('workout_schedule', { keyPath: 'day_of_week' });
      }
    };

    request.onsuccess = e => {
      _db = e.target.result;
      console.log('DB: open');

      // If the browser drops the connection (suspension, version change),
      // clear the cache so the next getDB() opens a fresh one.
      _db.onclose = () => {
        console.warn('DB: connection closed');
        _db = null;
        _dbPromise = null;
      };
      _db.onversionchange = () => {
        _db.close();
        _db = null;
        _dbPromise = null;
      };

      resolve(_db);
    };

    request.onerror = e => {
      console.error('DB: open failed', e.target.error);
      _dbPromise = null;            // allow a retry on the next getDB()
      reject(e.target.error);
    };
  });
}

// Returns a live DB connection, opening (or reopening) as needed.
function getDB() {
  if (_db) return Promise.resolve(_db);
  if (!_dbPromise) _dbPromise = openDB();
  return _dbPromise;
}

// Belt-and-suspenders: iOS does not always fire onclose when it suspends a
// backgrounded PWA. When the app becomes visible again, drop the cached
// connection so the next operation opens a guaranteed-fresh one. close() is
// graceful — any in-flight transaction is allowed to finish first.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _db) {
    try { _db.close(); } catch (e) { /* already closing */ }
    _db = null;
    _dbPromise = null;
  }
});

// Open eagerly at startup, preserving the original load behaviour, then run
// the one-time v4 seed if this device owes one (the author's v3 → v4 upgrade).
getDB()
  .then(maybeSeedV4)
  .catch(err => console.error('DB: startup failed', err));


// ── IDBR EQUEST HELPER ──
// Wraps a single IDBRequest in a Promise.
// Each call opens its own transaction, keeping each operation
// small and independent — the most reliable pattern on iOS Safari.
function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = e => resolve(e.target.result);
    request.onerror   = e => reject(e.target.error);
  });
}


// ── SAVE WORKOUT SESSION ──
// One transaction for the session record, then one transaction per set.
// Sequential, maximally simple — avoids all multi-request transaction
// reliability issues on iOS Safari.
async function saveWorkoutSession(wSession) {
  const db = await getDB();

  // Step 1: save the session record and get its generated ID.
  const sessionId = await idbRequest(
    db.transaction('workout_sessions', 'readwrite')
      .objectStore('workout_sessions')
      .add({
        workout_day: wSession.workoutDay,
        date:        wSession.date,
        start_time:  wSession.startTime,
        end_time:    wSession.endTime
      })
  );

  // Step 2: save each set record in its own transaction.
  for (const ex of wSession.exerciseQueue) {
    for (const set of (wSession.sets[ex.id] || [])) {
      await idbRequest(
        db.transaction('set_logs', 'readwrite')
          .objectStore('set_logs')
          .add({
            session_id:         sessionId,
            exercise_id:        ex.id,
            exercise_name:      ex.name,
            set_number:         set.setNumber,
            weight_kg:          set.weightKg !== '' ? parseFloat(set.weightKg) : null,
            reps:               set.reps     !== '' ? parseInt(set.reps, 10)   : null,
            failure:            set.failure,
            machine_adjustment: wSession.machineAdjustments[ex.id] || null,
            observations:       wSession.observations[ex.id]       || null,
            timestamp:          new Date().toISOString()
          })
      );
    }
  }

  console.log('DB: session saved, id =', sessionId);
  return sessionId;
}


// ── SAVE BODYWEIGHT ──
async function saveBodyweightLog(weightKg, date, notes = null) {
  const db = await getDB();

  return idbRequest(
    db.transaction('bodyweight_log', 'readwrite')
      .objectStore('bodyweight_log')
      .add({ date, weight_kg: weightKg, notes })
  ).then(id => {
    console.log('DB: bodyweight saved', weightKg, 'kg on', date);
    return id;
  });
}


// ── GET LAST BODYWEIGHT ──
// Uses getAll() instead of a cursor to avoid leaving an abandoned cursor
// open on iOS Safari, which can block subsequent write transactions on
// the same store.
async function getLastBodyweight() {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const req = db.transaction('bodyweight_log', 'readonly')
      .objectStore('bodyweight_log')
      .getAll();

    req.onsuccess = e => {
      const records = e.target.result;
      if (!records.length) { resolve(null); return; }
      // autoIncrement IDs mean the last record is always the most recent.
      resolve(records[records.length - 1].weight_kg);
    };
    req.onerror = e => reject(e.target.error);
  });
}


// ── GET LAST SESSION DATA FOR WORKOUT ──
// Single readonly transaction that reads all set_logs data for every
// exercise in the workout at once. Returns:
//   { [exercise_id]: { weights: { [setNumber]: kg }, machineAdjustment: string|null } }
async function getLastSessionDataForWorkout(exerciseIds) {
  const db = await getDB();

  const results = {};
  exerciseIds.forEach(id => {
    results[id] = { weights: {}, machineAdjustment: null };
  });

  if (exerciseIds.length === 0) return results;

  return new Promise((resolve, reject) => {
    const tx    = db.transaction('set_logs', 'readonly');
    const index = tx.objectStore('set_logs').index('by_exercise');

    let pending = exerciseIds.length;

    exerciseIds.forEach(exerciseId => {
      const req = index.getAll(exerciseId);

      req.onsuccess = e => {
        const records = e.target.result;

        if (records.length) {
          const maxSession = Math.max(...records.map(r => r.session_id));

          records
            .filter(r => r.session_id === maxSession && r.weight_kg !== null)
            .forEach(r => {
              results[exerciseId].weights[r.set_number] = r.weight_kg;
            });

          const withAdj = records
            .filter(r => r.machine_adjustment !== null)
            .sort((a, b) => b.session_id - a.session_id);

          if (withAdj.length) {
            results[exerciseId].machineAdjustment = withAdj[0].machine_adjustment;
          }
        }

        pending--;
        if (pending === 0) resolve(results);
      };

      req.onerror = e => reject(e.target.error);
    });

    tx.onerror = e => reject(e.target.error);
  });
}


// ── GET LAST WORKOUT SESSION BY DATE ──
// Returns the most recent workout session for a given date string, or null.
async function getLastWorkoutSessionByDate(dateString) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('workout_sessions', 'readonly')
      .objectStore('workout_sessions')
      .getAll();
    req.onsuccess = e => {
      const matches = e.target.result.filter(s => s.date === dateString);
      resolve(matches.length > 0 ? matches[matches.length - 1] : null);
    };
    req.onerror = e => reject(e.target.error);
  });
}

// ── SAVE CARDIO SESSION ──
async function saveCardioSessionToDB(cSession) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('cardio_sessions', 'readwrite')
      .objectStore('cardio_sessions')
      .add({
        cardio_type:                cSession.cardioType,
        date:                       cSession.date,
        start_time:                 cSession.startTime,
        end_time:                   cSession.endTime,
        duration_minutes:           cSession.durationMinutes,
        avg_heart_rate:             cSession.avgHeartRate,
        active_kcal:                cSession.activeKcal,
        total_kcal:                 cSession.totalKcal,
        effort_level:               cSession.effortLevel,
        linked_workout_session_id:  cSession.linkedWorkoutSessionId,
        cardio_timing:              cSession.cardioTiming
      });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}


// ── LOG WATER BOTTLE ──
// One record per tap: just a date and timestamp.
async function logWaterBottle(dateString) {
  const db = await getDB();
  return idbRequest(
    db.transaction('water_log', 'readwrite')
      .objectStore('water_log')
      .add({ date: dateString, timestamp: new Date().toISOString() })
  );
}

// ── GET WATER COUNT TODAY ──
// Returns the number of bottles logged for a given date string.
async function getWaterCountToday(dateString) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('water_log', 'readonly')
      .objectStore('water_log')
      .getAll();
    req.onsuccess = e => {
      resolve(e.target.result.filter(r => r.date === dateString).length);
    };
    req.onerror = e => reject(e.target.error);
  });
}

// ── GET ALL RECORDS FROM A STORE ──
// Generic single-store readonly read. Used by CSV export. Same getAll()
// pattern as the other readers — no cursors, one store per transaction.
async function getAllRecords(storeName) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly')
      .objectStore(storeName)
      .getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── GET SCHEDULE ──
// Returns an object keyed by day-of-week (0–6) → workout_day_key | null.
// Mirrors the shape of the SCHEDULE_BY_DAY constant.
async function getSchedule() {
  const records = await getAllRecords('workout_schedule');
  const map = {};
  records.forEach(r => { map[r.day_of_week] = r.workout_day_key; });
  return map;
}

// ── GET EXERCISES FOR DAY ──
// Returns exercises for one workout day, sorted by sort_order, in the
// camelCase shape that workout.js expects (sets, repRange — not set_count,
// rep_range). Translation happens here at the read boundary.
async function getExercisesForDay(dayKey) {
  const records = await getAllRecords('exercises');
  return records
    .filter(r => r.workout_day === dayKey && r.status === 'active')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(r => ({
      id:       r.exercise_id,
      name:     r.name,
      sets:     r.set_count,
      repRange: r.rep_range
    }));
}

// ── GET WORKOUT DAY LABELS ──
// Returns an object keyed by workout_day_key → label string.
// Mirrors the shape of the WORKOUT_DAY_LABELS constant.
async function getWorkoutDayLabels() {
  const records = await getAllRecords('workout_days');
  const map = {};
  records
    .sort((a, b) => a.sort_order - b.sort_order)
    .forEach(r => { map[r.workout_day_key] = r.label; });
  return map;
}

// ── v4 MIGRATION SEED + VERIFICATION (Phase 2.1) ──
// One-time, author-only seed: copies the hardcoded exercise list, retired
// list, day labels, and weekday schedule into the new stores WITH THEIR
// EXISTING IDs, so historical set_logs stay joined. New users (fresh install,
// oldVersion 0) seed nothing — they build their own workout later.
//
// Resumable: a localStorage flag marks the seed "pending" the instant the
// upgrade is detected, cleared only after verification passes. onupgradeneeded
// fires once per version bump and will NOT run again, but the flag survives an
// app kill, so the next launch retries. Every write is an idempotent put()
// keyed on the store's keyPath — a retry overwrites with identical data
// instead of duplicating or throwing.

const SEED_FLAG_KEY = 'training-log-seed-v4';

// Write every record of one store in a single single-store transaction.
// Completion is counted via req.onsuccess (tx.oncomplete is unreliable on iOS).
function seedStore(db, storeName, records) {
  return new Promise((resolve, reject) => {
    if (records.length === 0) { resolve(); return; }
    const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
    let remaining = records.length;
    let rejected  = false;
    records.forEach(rec => {
      const req = store.put(rec);
      req.onsuccess = () => { if (!rejected && --remaining === 0) resolve(); };
      req.onerror   = e => { if (!rejected) { rejected = true; reject(e.target.error); } };
    });
  });
}

async function seedV4(db) {
  // exercises: active (status 'active', sort_order = 0-based position in its
  // day) + retired (status 'retired'). camelCase constants → snake_case store
  // fields, matching the data-model doc and the CSV/export convention.
  const exerciseRecords = [];
  Object.entries(EXERCISES).forEach(([dayKey, list]) => {
    list.forEach((ex, i) => exerciseRecords.push({
      exercise_id: ex.id,
      name:        ex.name,
      workout_day: dayKey,
      set_count:   ex.sets,
      rep_range:   ex.repRange,
      status:      'active',
      sort_order:  i
    }));
  });
  Object.entries(RETIRED_EXERCISES).forEach(([id, ex], i) => exerciseRecords.push({
    exercise_id: id,
    name:        ex.name,
    workout_day: ex.day,
    set_count:   ex.sets,
    rep_range:   ex.repRange,
    status:      'retired',
    sort_order:  i        // unused for retired (not shown in a day sequence)
  }));

  const dayRecords = Object.entries(WORKOUT_DAY_LABELS).map(([key, label], i) => ({
    workout_day_key: key,
    label,
    sort_order: i
  }));

  // workout_day_key is null on rest days — stored as-is.
  const scheduleRecords = Object.entries(SCHEDULE_BY_DAY).map(([dow, key]) => ({
    day_of_week:     Number(dow),
    workout_day_key: key
  }));

  // One single-store transaction per store — never multi-store on iOS Safari.
  await seedStore(db, 'exercises',        exerciseRecords);
  await seedStore(db, 'workout_days',     dayRecords);
  await seedStore(db, 'workout_schedule', scheduleRecords);
}

// Read the seeded stores back and confirm every expected exercise ID is
// present. Missing IDs are the failure that orphans history — the critical
// check. Returns { missing[], expected, stored }.
async function verifyV4Seed() {
  const expectedIds = [];
  Object.values(EXERCISES).forEach(list => list.forEach(ex => expectedIds.push(ex.id)));
  Object.keys(RETIRED_EXERCISES).forEach(id => expectedIds.push(id));

  const stored    = await getAllRecords('exercises');
  const storedIds = new Set(stored.map(r => r.exercise_id));
  const missing   = expectedIds.filter(id => !storedIds.has(id));

  // Cheap sanity checks on the other two stores — a count mismatch is a flag.
  const days  = await getAllRecords('workout_days');
  const sched = await getAllRecords('workout_schedule');
  if (days.length  !== Object.keys(WORKOUT_DAY_LABELS).length)
    console.warn('DB: workout_days count mismatch — got', days.length);
  if (sched.length !== Object.keys(SCHEDULE_BY_DAY).length)
    console.warn('DB: workout_schedule count mismatch — got', sched.length);

  return { missing, expected: expectedIds.length, stored: storedIds.size };
}

// Run once after open. Seeds + verifies only when a seed is owed.
async function maybeSeedV4(db) {
  // Mark the seed owed the moment we detect the author's v3 → v4 upgrade.
  if (_upgradeOldVersion === 3) {
    try { localStorage.setItem(SEED_FLAG_KEY, 'pending'); } catch (_) {}
  }
  // Nothing owed: fresh installs (oldVersion 0) and every normal launch.
  if (localStorage.getItem(SEED_FLAG_KEY) !== 'pending') return;

  try {
    await seedV4(db);
    const { missing, expected, stored } = await verifyV4Seed();

    if (missing.length) {
      // Loud, immediate, fixable — the whole point of verifying. Flag stays
      // 'pending', so fixing the cause and relaunching re-runs the seed.
      console.error('DB: v4 seed verification FAILED — missing IDs:', missing);
      alert('Migration verification FAILED.\nMissing exercise IDs: ' +
            missing.join(', ') +
            '\nDo not trust this device until re-migrated. See console.');
      return;
    }

    localStorage.setItem(SEED_FLAG_KEY, 'complete');
    console.log(`DB: v4 seed verified — ${stored}/${expected} exercise IDs present`);
    // Author-only, one-time visible confirmation (testers never hit the
    // pending flag). Remove this alert if you find it intrusive.
    alert(`Migration OK — ${expected} exercise IDs seeded and verified.`);
  } catch (err) {
    console.error('DB: v4 seed/verify threw', err);
    alert('Migration error — see console. Device not safe to trust until resolved.');
    // Flag remains 'pending' → retried next launch.
  }
}