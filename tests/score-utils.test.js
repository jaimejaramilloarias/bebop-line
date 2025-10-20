import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMeasureNoteSpecs,
  midiNoteToVexFlowKey,
  NOTES_PER_MEASURE
} from '../score-utils.js';

test('midiNoteToVexFlowKey clamps MIDI input and reports accidentals', () => {
  assert.deepStrictEqual(midiNoteToVexFlowKey(60), { key: 'c/4', accidental: null });
  assert.deepStrictEqual(midiNoteToVexFlowKey(61), { key: 'c/4', accidental: '#' });
  assert.deepStrictEqual(midiNoteToVexFlowKey(61, 'flats'), { key: 'd/4', accidental: 'b' });
  assert.deepStrictEqual(midiNoteToVexFlowKey(59.6), { key: 'c/4', accidental: null });
  assert.deepStrictEqual(midiNoteToVexFlowKey(200), { key: 'g/9', accidental: null });
  assert.deepStrictEqual(midiNoteToVexFlowKey('not-a-number'), { key: 'c/-1', accidental: null });
});

test('buildMeasureNoteSpecs groups entries, propagates accents and fills rests', () => {
  const entries = Array.from({ length: 10 }, (_, index) => ({ note: 60 + index, voice: (index % 4) + 1 }));
  const accents = [1, 8];
  const measures = buildMeasureNoteSpecs(entries, accents, NOTES_PER_MEASURE);

  assert.equal(measures.length, 2);
  assert.equal(measures[0].length, NOTES_PER_MEASURE);
  assert.equal(measures[1].length, NOTES_PER_MEASURE);

  assert.equal(measures[0][1].type, 'note');
  assert.equal(measures[0][1].accent, true);
  assert.equal(measures[1][0].accent, true);
  assert.equal(measures[1][1].type, 'note');
  assert.equal(measures[1][2].type, 'rest');
  assert.equal(measures[1][7].type, 'rest');
});

test('buildMeasureNoteSpecs treats undefined entries as rests', () => {
  const entries = [
    { note: 60, voice: 1 },
    null,
    { note: 62, voice: 2 }
  ];
  const measures = buildMeasureNoteSpecs(entries, [], 3);

  assert.equal(measures.length, 1);
  assert.equal(measures[0][0].type, 'note');
  assert.equal(measures[0][1].type, 'rest');
  assert.equal(measures[0][2].type, 'note');
});
