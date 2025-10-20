export const NOTES_PER_MEASURE = 8;

const VEXFLOW_PITCH_MAP = [
  { step: "c" },
  { step: "c", accidental: "#" },
  { step: "d" },
  { step: "d", accidental: "#" },
  { step: "e" },
  { step: "f" },
  { step: "f", accidental: "#" },
  { step: "g" },
  { step: "g", accidental: "#" },
  { step: "a" },
  { step: "a", accidental: "#" },
  { step: "b" }
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeMidiNote(note) {
  const numeric = Number(note);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  const rounded = Math.round(numeric);
  return clamp(rounded, 0, 127);
}

export function midiNoteToVexFlowKey(note) {
  const sanitized = sanitizeMidiNote(note);
  const pitchClass = sanitized % 12;
  const octave = Math.floor(sanitized / 12) - 1;
  const mapping = VEXFLOW_PITCH_MAP[pitchClass] || VEXFLOW_PITCH_MAP[0];
  return {
    key: `${mapping.step}/${octave}`,
    accidental: mapping.accidental || null
  };
}

export function buildMeasureNoteSpecs(noteEntries, accentIndices = [], notesPerMeasure = NOTES_PER_MEASURE) {
  if (!Array.isArray(noteEntries) || notesPerMeasure <= 0) {
    return [];
  }
  const accentSet = new Set(accentIndices);
  const measures = [];
  for (let start = 0; start < noteEntries.length; start += notesPerMeasure) {
    const measure = [];
    const slice = noteEntries.slice(start, start + notesPerMeasure);
    slice.forEach((entry, offset) => {
      if (!entry || typeof entry.note === "undefined") {
        measure.push({ type: "rest" });
        return;
      }
      measure.push({
        type: "note",
        midi: sanitizeMidiNote(entry.note),
        accent: accentSet.has(start + offset),
        voice: entry.voice
      });
    });
    while (measure.length < notesPerMeasure) {
      measure.push({ type: "rest" });
    }
    if (measure.length) {
      measures.push(measure);
    }
  }
  if (measures.length === 0 && noteEntries.length === 0) {
    return [];
  }
  return measures;
}

export function countMeasures(noteEntriesLength, notesPerMeasure = NOTES_PER_MEASURE) {
  if (!notesPerMeasure || notesPerMeasure <= 0) {
    return 0;
  }
  return Math.ceil(noteEntriesLength / notesPerMeasure);
}
