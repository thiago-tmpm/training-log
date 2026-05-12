'use strict';

const DB_NAME    = 'training-log-db';
const DB_VERSION = 1;

let _db = null;


// ── OPEN / INIT ──
// dbReady is a Promise that resolves once the database is open.
// All other functions await it before touching the DB.
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


// ── SAVE WORKOUT SESSION ──
// Writes one workout_sessions record and one set_logs record per set,
// all in a single transaction. Returns the generated session_id.
// Resolves after all requests are queued — does not wait for tx.oncomplete,
// which has known reliability issues on iOS Safari.
// Bodyweight is intentionally excluded — stored separately in bodyweight_log.
async function saveWorkoutSession(wSession) {
  const db = await dbReady;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['workout_sessions', 'set_logs'], 'readwrite');

    tx.onerror = e => {
      console.error('DB: transaction error', e.target.error);
      reject(e.target.error);
    };

    const sessionStore = tx.objectStore('workout_sessions');
    const setStore     = tx.objectStore('set_logs');

    const sessionReq = sessionStore.add({
      workout_day: wSession.workoutDay,
      date:        wSession.date,
      start_time:  wSession.startTime,
      end_time:    wSession.endTime
    });

    sessionReq.onerror = e => reject(e.target.error);

    sessionReq.onsuccess = e => {
      const sessionId = e.target.result;

      wSession.exerciseQueue.forEach(ex => {
        (wSession.sets[ex.id] || []).forEach(set => {
          setStore.add({
            session_id:         sessionId,
            exercise_id:        ex.id,
            set_number:         set.setNumber,
            weight_kg:          set.weightKg !== '' ? parseFloat(set.weightKg) : null,
            reps:               set.reps     !== '' ? parseInt(set.reps, 10)   : null,
            failure:            set.failure,
            machine_adjustment: wSession.machineAdjustments[ex.id] || null,
            observations:       wSession.observations[ex.id]       || null,
            timestamp:          new Date().toISOString()
          });
        });
      });

      // All requests are queued. Resolve now — the transaction commits in
      // the background. Waiting for tx.oncomplete is unreliable on iOS Safari.
      console.log('DB: session saved, id =', sessionId);
      resolve(sessionId);
    };
  });
}


// ── SAVE BODYWEIGHT ──
async function saveBodyweightLog(weightKg, date, notes = null) {
  const db = await dbReady;

  return new Promise((resolve, reject) => {
    const tx    = db.transaction('bodyweight_log', 'readwrite');
    const store = tx.objectStore('bodyweight_log');

    const req = store.add({ date, weight_kg: weightKg, notes });

    req.onsuccess = () => {
      console.log('DB: bodyweight saved', weightKg, 'kg on', date);
      resolve(req.result);
    };
    req.onerror = e => reject(e.target.error);
  });
}


// ── GET LAST BODYWEIGHT ──
// Returns the most recently saved weight_kg, or null if none exists.
async function getLastBodyweight() {
  const db = await dbReady;

  return new Promise((resolve, reject) => {
    const tx    = db.transaction('bodyweight_log', 'readonly');
    const store = tx.objectStore('bodyweight_log');

    // Open a cursor in descending key order — first record is the most recent.
    const req = store.openCursor(null, 'prev');

    req.onsuccess = e => {
      const cursor = e.target.result;
      resolve(cursor ? cursor.value.weight_kg : null);
    };

    req.onerror = e => reject(e.target.error);
  });
}


// ── GET LAST WEIGHTS FOR EXERCISE ──
// Returns { [setNumber]: weightKg } from the most recent session
// that contains data for this exercise_id.
// Returns {} if no prior data exists.
async function getLastWeightForExercise(exerciseId) {
  const db = await dbReady;

  return new Promise((resolve, reject) => {
    const tx    = db.transaction('set_logs', 'readonly');
    const index = tx.objectStore('set_logs').index('by_exercise');
    const req   = index.getAll(exerciseId);

    req.onsuccess = e => {
      const records = e.target.result;
      if (!records.length) { resolve({}); return; }

      // Highest session_id = most recent session
      const maxSession = Math.max(...records.map(r => r.session_id));
      const weights    = {};

      records
        .filter(r => r.session_id === maxSession && r.weight_kg !== null)
        .forEach(r => { weights[r.set_number] = r.weight_kg; });

      resolve(weights);
    };

    req.onerror = e => reject(e.target.error);
  });
}
