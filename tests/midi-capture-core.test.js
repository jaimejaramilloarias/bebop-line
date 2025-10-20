import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChordFromUniqueNotes,
  CAPTURE_EXTENSION_WINDOW_MS,
  collectUniqueActiveNotes,
  extendChordWithNote
} from '../midi-capture-core.js';

test('collectUniqueActiveNotes keeps only active notes and latest occurrences', () => {
  const captureQueue = [
    { note: 60, time: 10 },
    { note: 64, time: 12 },
    { note: 60, time: 14 },
    { note: 67, time: 16 }
  ];
  const activeNotes = new Set([60, 67]);
  const { uniqueNotes, filteredQueue } = collectUniqueActiveNotes(captureQueue, activeNotes);

  assert.deepStrictEqual(filteredQueue, [
    { note: 60, time: 10 },
    { note: 60, time: 14 },
    { note: 67, time: 16 }
  ]);
  assert.deepStrictEqual(uniqueNotes, [
    { note: 60, time: 14 },
    { note: 67, time: 16 }
  ]);
});

test('buildChordFromUniqueNotes ignores sequences with fewer than three notes', () => {
  const uniqueNotes = [
    { note: 60, time: 10 },
    { note: 64, time: 12 }
  ];
  const result = buildChordFromUniqueNotes(uniqueNotes);
  assert.equal(result, null);
});

test('buildChordFromUniqueNotes captures and sorts four-note chords', () => {
  const uniqueNotes = [
    { note: 60, time: 1 },
    { note: 64, time: 3 },
    { note: 67, time: 5 },
    { note: 71, time: 9 }
  ];
  const result = buildChordFromUniqueNotes(uniqueNotes);
  assert.ok(result);
  assert.deepStrictEqual(Array.from(result.chord), [60, 64, 67, 71]);
  assert.equal(result.voiceCount, 4);
  assert.equal(result.captureTime, 9);
});

test('extendChordWithNote upgrades a captured triad to four voices within the time window', () => {
  const existing = [60, 64, 67];
  existing.voiceCount = 3;
  const now = 200;
  const result = extendChordWithNote(existing, 71, now, 150, {
    extensionWindowMs: CAPTURE_EXTENSION_WINDOW_MS
  });
  assert.equal(result.extended, true);
  assert.deepStrictEqual(Array.from(result.chord), [60, 64, 67, 71]);
  assert.equal(result.voiceCount, 4);
  assert.equal(result.captureTime, now);
});

test('extendChordWithNote rejects notes that arrive after the extension window', () => {
  const existing = [60, 64, 67];
  existing.voiceCount = 3;
  const result = extendChordWithNote(existing, 71, 400, 200, {
    extensionWindowMs: CAPTURE_EXTENSION_WINDOW_MS
  });
  assert.equal(result.extended, false);
});
