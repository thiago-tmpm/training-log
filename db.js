'use strict';

const DB_NAME    = 'training-log-db';
const DB_VERSION = 3;

let _db = null;


let _db = null;
let _dbPromise = null;


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

// Open eagerly at startup, preserving the original load behaviour.
getDB();


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