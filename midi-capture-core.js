export const MAX_CAPTURE_VOICES = 4;
export const MIN_CAPTURE_VOICES = 3;
export const CAPTURE_EXTENSION_WINDOW_MS = 120;

export function normalizeVoiceCount(value) {
  if (Number.isFinite(value)) {
    return Math.max(1, Math.min(MAX_CAPTURE_VOICES, Math.round(value)));
  }
  return null;
}

export function collectUniqueActiveNotes(captureQueue, activeNotes) {
  const filteredQueue = [];
  for (const item of captureQueue) {
    if (activeNotes.has(item.note)) {
      filteredQueue.push(item);
    }
  }

  const uniqueMap = new Map();
  for (let i = filteredQueue.length - 1; i >= 0; i--) {
    const item = filteredQueue[i];
    if (!activeNotes.has(item.note) || uniqueMap.has(item.note)) {
      continue;
    }
    uniqueMap.set(item.note, item);
  }

  const uniqueNotes = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
  return { uniqueNotes, filteredQueue };
}

export function buildChordFromUniqueNotes(uniqueNotes, { minVoices = MIN_CAPTURE_VOICES, maxVoices = MAX_CAPTURE_VOICES } = {}) {
  if (uniqueNotes.length < minVoices) {
    return null;
  }
  const capturedItems = uniqueNotes.slice(-maxVoices);
  const notes = capturedItems.map((item) => item.note).sort((a, b) => a - b);
  const voiceCount = Math.min(notes.length, maxVoices);
  const captureTime = capturedItems.length ? capturedItems[capturedItems.length - 1].time : 0;
  const chord = notes.slice();
  chord.voiceCount = voiceCount;
  return { chord, voiceCount, captureTime };
}

export function extendChordWithNote(
  chord,
  note,
  time,
  lastCaptureTime,
  { maxVoices = MAX_CAPTURE_VOICES, extensionWindowMs = CAPTURE_EXTENSION_WINDOW_MS } = {}
) {
  if (!chord) {
    return { extended: false };
  }
  if (chord.includes(note)) {
    return { extended: false };
  }
  const currentVoiceCount = normalizeVoiceCount(chord.voiceCount ?? chord.length) || chord.length;
  if (currentVoiceCount >= maxVoices) {
    return { extended: false };
  }
  if (Number.isFinite(lastCaptureTime) && lastCaptureTime > 0) {
    if (time - lastCaptureTime > extensionWindowMs) {
      return { extended: false };
    }
  }
  const updatedNotes = chord.concat(note).sort((a, b) => a - b);
  const voiceCount = Math.min(currentVoiceCount + 1, maxVoices, updatedNotes.length);
  const updatedChord = updatedNotes.slice();
  updatedChord.voiceCount = voiceCount;
  return { extended: true, chord: updatedChord, captureTime: time, voiceCount };
}
