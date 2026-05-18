'use strict';

const DB_NAME    = 'training-log-db';
const DB_VERSION = 1;

let _db = null;


// ── OPEN / INIT ──
const dbReady = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = e => {
    const db = e.target.result;

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
  };

  request.onsuccess = e => {
    _db = e.target.result;
    console.log('DB: open');
    resolve(_db);
  };

  request.onerror = e => {
    console.error('DB: open failed', e.target.error);
    reject(e.target.error);
  };
});


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
  const db = await dbReady;

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
  const db = await dbReady;

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
async function getLastBodyweight() {
  const db = await dbReady;

  return new Promise((resolve, reject) => {
    const req = db.transaction('bodyweight_log', 'readonly')
      .objectStore('bodyweight_log')
      .openCursor(null, 'prev');

    req.onsuccess = e => {
      const cursor = e.target.result;
      resolve(cursor ? cursor.value.weight_kg : null);
    };
    req.onerror = e => reject(e.target.error);
  });
}


// ── GET LAST SESSION DATA FOR WORKOUT ──
// Single readonly transaction that reads all set_logs data for every
// exercise in the workout at once. Returns:
//   { [exercise_id]: { weights: { [setNumber]: kg }, machineAdjustment: string|null } }
// Replaces the previous per-exercise functions that opened 12 concurrent
// transactions, which caused reliability issues on iOS Safari.
async function getLastSessionDataForWorkout(exerciseIds) {
  const db = await dbReady;

  // Build result structure with empty defaults for every exercise.
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

          // Weights from the most recent session
          records
            .filter(r => r.session_id === maxSession && r.weight_kg !== null)
            .forEach(r => {
              results[exerciseId].weights[r.set_number] = r.weight_kg;
            });

          // Most recent machine adjustment across all sessions
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
