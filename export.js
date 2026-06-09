'use strict';

// ── CSV EXPORT (WBS 7) ──
// Reads all five IndexedDB stores, converts each to a CSV file with an
// explicit column schema, and shares all five at once via the native iOS
// share sheet. Raw IDs are preserved as join keys for later pandas work.

// Explicit column order per store. Defining columns here (instead of
// inferring from whatever keys the first record happens to have) makes the
// CSV deterministic and fills any missing field with an empty cell rather
// than silently dropping a column.
const EXPORT_SCHEMA = {
  workout_sessions: ['session_id', 'workout_day', 'date', 'start_time', 'end_time'],
  set_logs:         ['set_id', 'session_id', 'exercise_id', 'exercise_name', 'set_number',
                     'weight_kg', 'reps', 'failure', 'machine_adjustment', 'observations', 'timestamp'],
  cardio_sessions:  ['session_id', 'cardio_type', 'date', 'start_time', 'end_time',
                     'duration_minutes', 'avg_heart_rate', 'active_kcal', 'total_kcal',
                     'effort_level', 'linked_workout_session_id', 'cardio_timing'],
  bodyweight_log:   ['log_id', 'date', 'weight_kg', 'notes'],
  water_log:        ['log_id', 'date', 'timestamp'],
  exercises:        ['exercise_id', 'name', 'workout_day', 'set_count', 'rep_range', 'status', 'sort_order'],
  workout_days:     ['workout_day_key', 'label', 'sort_order'],
  workout_schedule: ['day_of_week', 'workout_day_key']
};

// Escape one CSV field. Wrap in quotes if it contains a comma, quote, or
// newline; double any internal quotes. null/undefined → empty cell.
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Build a CSV string (header + rows) for one store.
function recordsToCsv(columns, records) {
  const lines = [columns.join(',')];
  for (const rec of records) {
    lines.push(columns.map(col => csvEscape(rec[col])).join(','));
  }
  return lines.join('\r\n');
}

// Wrap a CSV string as a UTF-8 File with a BOM, so Numbers/Excel render the
// Portuguese accents correctly instead of mojibake.
function csvToFile(csvString, filename) {
  const BOM = '\uFEFF';
  return new File([BOM + csvString], filename, { type: 'text/csv' });
}

let exportInProgress = false;

async function exportAllData() {
  if (exportInProgress) return;          // re-entry guard (reset in finally)
  exportInProgress = true;

  try {
    const datePrefix = new Date().toISOString().split('T')[0];
    const stores = Object.keys(EXPORT_SCHEMA);

    // Read every store first — single-store readonly transactions, sequential.
    const dataByStore = {};
    let totalRecords = 0;
    for (const store of stores) {
      const records = await getAllRecords(store);
      dataByStore[store] = records;
      totalRecords += records.length;
    }

    if (totalRecords === 0) {
      alert('No data to export yet.');
      return;
    }

    // One File per store. An empty store still produces a header-only file,
    // so the export is always a complete, self-describing set of five.
    const files = stores.map(store =>
      csvToFile(
        recordsToCsv(EXPORT_SCHEMA[store], dataByStore[store]),
        `training-log_${datePrefix}_${store}.csv`
      )
    );

    if (!navigator.canShare || !navigator.canShare({ files })) {
      alert('File sharing is not supported on this device.');
      return;
    }

    await navigator.share({ files, title: 'Training Log Export' });

  } catch (err) {
    // AbortError = user dismissed the share sheet. Not a failure.
    if (err && err.name === 'AbortError') {
      console.log('Export: share cancelled by user');
    } else {
      console.error('Export failed:', err);
      alert('Export failed. See console for details.');
    }
  } finally {
    exportInProgress = false;
  }
}