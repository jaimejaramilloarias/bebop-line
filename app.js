import {
  CAPTURE_EXTENSION_WINDOW_MS,
  buildChordFromUniqueNotes,
  collectUniqueActiveNotes,
  extendChordWithNote,
  normalizeVoiceCount
} from "./midi-capture-core.js";
import {
  NOTES_PER_MEASURE,
  buildMeasureNoteSpecs,
  midiNoteToVexFlowKey,
  countMeasures
} from "./score-utils.js";

const FOUR_NOTE_PATTERN_IDS = [
  "1234",
  "4321",
  "1432",
  "4123",
  "2341",
  "3214",
  "4231",
  "1324",
  "1423",
  "4132"
];

const THREE_NOTE_PATTERN_IDS = ["1231", "3213", "1321", "3123", "1213", "3231"];

function createPattern(text) {
  const values = text.split("").map(Number);
  const maxVoice = values.reduce((max, value) => Math.max(max, value), 0);
  return { id: text, values, maxVoice };
}

const FOUR_NOTE_PATTERNS = FOUR_NOTE_PATTERN_IDS.map(createPattern);
const THREE_NOTE_PATTERNS = THREE_NOTE_PATTERN_IDS.map(createPattern);
const ALL_PATTERNS = [...FOUR_NOTE_PATTERNS, ...THREE_NOTE_PATTERNS];
const PATTERN_LOOKUP = new Map(ALL_PATTERNS.map((pattern) => [pattern.id, pattern]));

const DEFAULT_CHORD = [60, 64, 67, 71]; // Cmaj7
DEFAULT_CHORD.voiceCount = DEFAULT_CHORD.length;
const DEFAULT_BPM = 280;

const TICKS_PER_QUARTER = 480;
const TICKS_PER_EIGHTH = TICKS_PER_QUARTER / 2;
const EMPTY_MIDI_LINE = { events: [], measures: 0, totalTicks: 0 };
const VELOCITY_BY_VOICE = {
  1: 60,
  2: 90,
  3: 110,
  4: 127
};
const DEFAULT_SWING_PERCENT = 28;
const TRANSPOSE_LIMIT = 36;
const SCORE_PLACEHOLDER_MESSAGE = "Captura acordes con MIDI Learn para generar la partitura.";
const MATRIX_MIN_GROUP_WIDTH = 168;
const MATRIX_GAP_PX = 12;
const MATRIX_MAX_GROUPS_PER_ROW = 6;
const SCORE_MIN_STAVE_WIDTH = 260;
const SCORE_MAX_STAVE_WIDTH = 360;
const SCORE_MAX_MEASURES_PER_ROW = 4;
const SCORE_MEASURE_SPACING = 48;
const SCORE_HORIZONTAL_PADDING = 40;
const SCORE_VERTICAL_PADDING = 40;
const SCORE_BOTTOM_PADDING = 48;
const SCORE_ROW_SPACING = 60;
const MIDI_PANEL_MIN_WIDTH = 72;
const MIDI_PANEL_MAX_WIDTH = 360;
const VISUALIZATIONS_MIN_WIDTH = 420;
const PANEL_DIVIDER_WIDTH = 14;
const RESPONSIVE_BREAKPOINT = 900;
const VIRTUAL_KEYBOARD_FIRST_NOTE = 48;
const VIRTUAL_KEYBOARD_LAST_NOTE = 84;
const VIRTUAL_KEYBOARD_PREVIEW_DURATION_MS = 600;
const VIRTUAL_KEYBOARD_PREVIEW_VELOCITY = 96;
const HISTORY_LIMIT = 100;
const DEFAULT_CLEF = "treble";
const DEFAULT_ENHARMONIC_MODE = "sharps";
const MATRIX_SELECTION_EMPTY_MESSAGE = "Sin selección.";

const state = {
  patternGroups: [],
  seedPattern: null,
  chords: [],
  noteEntries: [],
  playbackNoteEntries: [],
  accentNoteIndices: [],
  lineNotes: [],
  midiLine: EMPTY_MIDI_LINE,
  midiAccess: null,
  midiArmed: false,
  captureQueue: [],
  awaitingRelease: false,
  activeNotes: new Set(),
  lastCaptureTime: 0,
  scheduledNodes: [],
  scheduledTimeouts: [],
  activePlaybackNotes: new Set(),
  playingMidiOutputId: null,
  selectedMidiOutputId: "",
  audioCtx: null,
  isPlaying: false,
  replacementIndex: null,
  lastCapturedChordIndex: null,
  pendingReplacementDisarm: false,
  swingPercent: DEFAULT_SWING_PERCENT,
  transposeSemitones: 0,
  displayTransposeSemitones: 0,
  midiPanelWidth: null,
  virtualKeyboardPendingNotes: new Set(),
  virtualKeyboardKeyMap: new Map(),
  virtualKeyboardPlaybackNotes: new Map(),
  virtualKeyboardPreviewTimeouts: new Map(),
  groupTranspositions: [],
  selectedPatternIndices: new Set(),
  history: [],
  future: [],
  lastSnapshotSignature: null,
  enharmonicMode: DEFAULT_ENHARMONIC_MODE,
  scoreClef: DEFAULT_CLEF
};

const elements = {
  layout: document.querySelector("main"),
  midiPanel: document.querySelector(".midi-panel"),
  panelResizers: Array.from(document.querySelectorAll(".panel-resizer")),
  visualizations: document.querySelector(".visualizations"),
  catalog: document.querySelector(".catalog-collections"),
  patternDictionaryButton: document.getElementById("open-pattern-dictionary"),
  undoAction: document.getElementById("undo-action"),
  redoAction: document.getElementById("redo-action"),
  matrix: document.querySelector(".matrix"),
  matrixClearSelection: document.getElementById("matrix-clear-selection"),
  matrixTransposeDownSemitone: document.getElementById("matrix-transpose-down-semitone"),
  matrixTransposeUpSemitone: document.getElementById("matrix-transpose-up-semitone"),
  matrixTransposeDownOctave: document.getElementById("matrix-transpose-down-octave"),
  matrixTransposeUpOctave: document.getElementById("matrix-transpose-up-octave"),
  matrixTransposeReset: document.getElementById("matrix-transpose-reset"),
  matrixSelectionSummary: document.getElementById("matrix-selection-summary"),
  tempo: document.getElementById("tempo"),
  swing: document.getElementById("swing"),
  transposeValue: document.getElementById("transpose-value"),
  transposeDownSemitone: document.getElementById("transpose-down-semitone"),
  transposeUpSemitone: document.getElementById("transpose-up-semitone"),
  transposeDownOctave: document.getElementById("transpose-down-octave"),
  transposeUpOctave: document.getElementById("transpose-up-octave"),
  transposeReset: document.getElementById("transpose-reset"),
  viewTransposeButtons: Array.from(document.querySelectorAll(".view-transpose-button")),
  enharmonicToggle: document.getElementById("enharmonic-toggle"),
  clefToggle: document.getElementById("clef-toggle"),
  playToggle: document.getElementById("play-toggle"),
  newLine: document.getElementById("regenerate-line"),
  exportMidi: document.getElementById("export-midi"),
  midiLearn: document.getElementById("midi-learn"),
  clearChords: document.getElementById("clear-chords"),
  midiOutput: document.getElementById("midi-output"),
  refreshMidiOutputs: document.getElementById("refresh-midi-outputs"),
  chordsContainer: document.querySelector(".captured-chords"),
  status: document.getElementById("status"),
  themeToggle: document.getElementById("theme-toggle"),
  scoreViewer: document.getElementById("score-viewer"),
  virtualKeyboard: document.querySelector(".virtual-keyboard"),
  virtualKeyboardKeysWrapper: document.querySelector(".virtual-keyboard__keys"),
  virtualKeyboardWhiteKeys: document.querySelector(".virtual-keyboard__white-keys"),
  virtualKeyboardBlackKeys: document.querySelector(".virtual-keyboard__black-keys"),
  virtualKeyboardSelection: document.getElementById("virtual-keyboard-selection")
};

if (elements.tempo) {
  elements.tempo.value = String(DEFAULT_BPM);
}
if (elements.swing) {
  elements.swing.value = String(DEFAULT_SWING_PERCENT);
}

function setStatus(message) {
  elements.status.textContent = message;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function cloneChordForSnapshot(chord) {
  if (!Array.isArray(chord)) {
    return { notes: [], voiceCount: 0 };
  }
  const notes = chord.slice();
  const voiceCount = Number.isInteger(chord.voiceCount) ? chord.voiceCount : notes.length;
  return { notes, voiceCount };
}

function restoreChordFromSnapshot(snapshotChord) {
  const notes = Array.isArray(snapshotChord?.notes) ? snapshotChord.notes.slice() : [];
  const chord = notes.slice();
  const voiceCount = Number.isInteger(snapshotChord?.voiceCount)
    ? snapshotChord.voiceCount
    : notes.length;
  chord.voiceCount = voiceCount;
  return chord;
}

function captureSnapshot() {
  return {
    patternIds: state.patternGroups.map((pattern) => pattern?.id ?? null),
    chords: state.chords.map(cloneChordForSnapshot),
    transposeSemitones: state.transposeSemitones,
    displayTransposeSemitones: state.displayTransposeSemitones,
    groupTranspositions: state.groupTranspositions.slice(),
    selectedIndices: Array.from(state.selectedPatternIndices),
    enharmonicMode: state.enharmonicMode,
    scoreClef: state.scoreClef
  };
}

function snapshotSignature(snapshot) {
  return JSON.stringify(snapshot);
}

function updateUndoRedoButtons() {
  if (elements.undoAction) {
    elements.undoAction.disabled = state.history.length <= 1;
  }
  if (elements.redoAction) {
    elements.redoAction.disabled = state.future.length === 0;
  }
}

function initializeHistory() {
  const snapshot = captureSnapshot();
  state.history = [snapshot];
  state.future = [];
  state.lastSnapshotSignature = snapshotSignature(snapshot);
  updateUndoRedoButtons();
}

function restoreSnapshot(snapshot) {
  state.transposeSemitones = snapshot.transposeSemitones ?? 0;
  state.displayTransposeSemitones = snapshot.displayTransposeSemitones ?? 0;
  state.enharmonicMode = snapshot.enharmonicMode ?? DEFAULT_ENHARMONIC_MODE;
  state.scoreClef = snapshot.scoreClef ?? DEFAULT_CLEF;
  state.groupTranspositions = Array.isArray(snapshot.groupTranspositions)
    ? snapshot.groupTranspositions.slice()
    : [];
  state.chords = snapshot.chords.map(restoreChordFromSnapshot);
  const patterns = snapshot.patternIds
    .map((id) => (id ? PATTERN_LOOKUP.get(id) || null : null))
    .filter((pattern) => pattern);
  updatePatternGroups(patterns, { recordHistory: false, preserveTranspositions: true });
  state.selectedPatternIndices = new Set(
    (snapshot.selectedIndices || []).filter(
      (index) => Number.isInteger(index) && index >= 0 && index < state.patternGroups.length
    )
  );
  renderChords();
  renderMatrix();
  updateTransposeDisplay();
  updateViewTransposeButtons();
  updateEnharmonicToggle();
  updateClefToggle();
  updateMatrixSelectionSummary();
}

function commitHistory({ force = false } = {}) {
  const snapshot = captureSnapshot();
  const signature = snapshotSignature(snapshot);
  if (!force && signature === state.lastSnapshotSignature) {
    return;
  }
  state.history.push(snapshot);
  if (state.history.length > HISTORY_LIMIT) {
    state.history.shift();
  }
  state.future = [];
  state.lastSnapshotSignature = signature;
  updateUndoRedoButtons();
}

function undoLastAction() {
  if (state.history.length <= 1) {
    return;
  }
  const current = state.history.pop();
  if (current) {
    state.future.push(current);
  }
  const snapshot = state.history[state.history.length - 1];
  if (snapshot) {
    state.lastSnapshotSignature = snapshotSignature(snapshot);
    restoreSnapshot(snapshot);
    updateUndoRedoButtons();
    setStatus("Se deshizo el último cambio.");
  }
}

function redoLastAction() {
  if (!state.future.length) {
    return;
  }
  const snapshot = state.future.pop();
  if (!snapshot) {
    return;
  }
  state.history.push(snapshot);
  state.lastSnapshotSignature = snapshotSignature(snapshot);
  restoreSnapshot(snapshot);
  updateUndoRedoButtons();
  setStatus("Se rehízo el cambio deshecho.");
}

function isSingleColumnLayout() {
  if (typeof window === "undefined") {
    return false;
  }
  if (typeof window.matchMedia === "function") {
    return window.matchMedia(`(max-width: ${RESPONSIVE_BREAKPOINT}px)`).matches;
  }
  return window.innerWidth <= RESPONSIVE_BREAKPOINT;
}

function getInnerWidth(element) {
  if (!element) return 0;
  const styles = getComputedStyle(element);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
  return element.clientWidth - paddingLeft - paddingRight;
}

function calculateGroupsPerRow() {
  const totalGroups = state.patternGroups.length || 0;
  const maxGroups = totalGroups ? Math.min(MATRIX_MAX_GROUPS_PER_ROW, totalGroups) : MATRIX_MAX_GROUPS_PER_ROW;
  const availableWidth = getInnerWidth(elements.visualizations);
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return Math.min(4, Math.max(1, maxGroups));
  }
  const raw = Math.floor((availableWidth + MATRIX_GAP_PX) / (MATRIX_MIN_GROUP_WIDTH + MATRIX_GAP_PX));
  const fallback = Math.min(4, Math.max(1, maxGroups));
  const columns = clamp(raw, 1, Math.max(1, maxGroups));
  return columns || fallback || 1;
}

function calculateMeasuresPerRow(totalMeasures) {
  if (!totalMeasures) return 0;
  const maxMeasures = Math.max(1, Math.min(totalMeasures, SCORE_MAX_MEASURES_PER_ROW));
  const availableWidth = getInnerWidth(elements.scoreViewer);
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return Math.min(2, maxMeasures);
  }
  const raw = Math.floor((availableWidth + SCORE_MEASURE_SPACING) / (SCORE_MIN_STAVE_WIDTH + SCORE_MEASURE_SPACING));
  const fallback = Math.min(2, maxMeasures);
  const columns = clamp(raw, 1, maxMeasures);
  return columns || fallback || 1;
}

function setMidiPanelWidth(width) {
  if (!elements.layout || !Number.isFinite(width)) {
    return null;
  }
  const layoutWidth = elements.layout.clientWidth || 0;
  let maxWidth = MIDI_PANEL_MAX_WIDTH;
  if (layoutWidth) {
    const maxByLayout = layoutWidth - VISUALIZATIONS_MIN_WIDTH - PANEL_DIVIDER_WIDTH * 2;
    if (Number.isFinite(maxByLayout)) {
      maxWidth = Math.max(MIDI_PANEL_MIN_WIDTH, Math.min(MIDI_PANEL_MAX_WIDTH, maxByLayout));
    }
  }
  const clampedWidth = clamp(Math.round(width), MIDI_PANEL_MIN_WIDTH, maxWidth);
  elements.layout.style.setProperty("--midi-panel-width", `${clampedWidth}px`);
  state.midiPanelWidth = clampedWidth;
  return clampedWidth;
}

function refreshLayoutAfterResize() {
  renderMatrix();
  renderScore(state.noteEntries ?? [], state.accentNoteIndices ?? []);
}

let resizeAnimationFrame = null;

function handlePanelResizePointerDown(event) {
  const resizer = event.currentTarget;
  if (!resizer) {
    return;
  }
  if (event.button !== undefined && event.button !== 0 && event.pointerType === "mouse") {
    return;
  }
  if (isSingleColumnLayout()) {
    return;
  }
  if (!elements.panelResizers.length || !elements.midiPanel || !elements.layout) {
    return;
  }
  if (typeof window === "undefined") {
    return;
  }

  event.preventDefault();
  const initialWidth = elements.midiPanel.getBoundingClientRect().width;
  const startX = event.clientX;
  const pointerId = event.pointerId;

  resizer.classList.add("panel-resizer--active");
  if (typeof resizer.setPointerCapture === "function") {
    try {
      resizer.setPointerCapture(pointerId);
    } catch (_) {
      // ignore
    }
  }

  const handleMove = (moveEvent) => {
    const delta = moveEvent.clientX - startX;
    setMidiPanelWidth(initialWidth + delta);
  };

  const stop = () => {
    if (resizer.classList.contains("panel-resizer--active")) {
      resizer.classList.remove("panel-resizer--active");
    }
    if (typeof resizer.releasePointerCapture === "function") {
      try {
        resizer.releasePointerCapture(pointerId);
      } catch (_) {
        // ignore
      }
    }
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    refreshLayoutAfterResize();
  };

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

function handlePanelResizeDoubleClick(event) {
  if (!elements.layout) {
    return;
  }
  event.preventDefault();
  elements.layout.style.removeProperty("--midi-panel-width");
  state.midiPanelWidth = null;
  refreshLayoutAfterResize();
}

function handleWindowResize() {
  if (typeof window === "undefined") {
    return;
  }
  if (resizeAnimationFrame !== null) {
    window.cancelAnimationFrame(resizeAnimationFrame);
  }
  resizeAnimationFrame = window.requestAnimationFrame(() => {
    resizeAnimationFrame = null;
    if (state.midiPanelWidth !== null) {
      const applied = setMidiPanelWidth(state.midiPanelWidth);
      if (applied !== null) {
        state.midiPanelWidth = applied;
      }
    }
    refreshLayoutAfterResize();
  });
}

function setSwingPercent(percent, { updateInput = false } = {}) {
  const normalized = clamp(Number(percent) || 0, 0, 100);
  state.swingPercent = normalized;
  if (updateInput && elements.swing) {
    elements.swing.value = String(normalized);
  }
  return normalized;
}

function describeTranspose(value) {
  if (!value) {
    return "Sin transposición";
  }
  const sign = value > 0 ? "+" : "−";
  const abs = Math.abs(value);
  const octaves = Math.floor(abs / 12);
  const semitones = abs % 12;
  const parts = [];
  if (octaves) {
    parts.push(`${octaves} ${octaves === 1 ? "octava" : "octavas"}`);
  }
  if (semitones) {
    parts.push(`${semitones} ${semitones === 1 ? "semitono" : "semitonos"}`);
  }
  const descriptor = parts.join(" + ") || `${abs} ${abs === 1 ? "semitono" : "semitonos"}`;
  return `${sign}${descriptor}`;
}

function updateTransposeDisplay() {
  if (!elements.transposeValue) return;
  elements.transposeValue.textContent = describeTranspose(state.transposeSemitones);
}

function setTransposeSemitones(value, { announce = true, recordHistory = true } = {}) {
  const normalized = clamp(Math.round(value) || 0, -TRANSPOSE_LIMIT, TRANSPOSE_LIMIT);
  if (normalized === state.transposeSemitones) {
    updateTransposeDisplay();
    return state.transposeSemitones;
  }
  stopPlayback(false);
  state.transposeSemitones = normalized;
  updateTransposeDisplay();
  rebuildLineNotes();
  if (recordHistory) {
    commitHistory();
  }
  if (announce) {
    const message = normalized
      ? `Transposición ajustada a ${describeTranspose(normalized)}.`
      : "Transposición restablecida.";
    setStatus(message);
  }
  return normalized;
}

function changeTranspose(delta) {
  setTransposeSemitones(state.transposeSemitones + delta);
}

function updateViewTransposeButtons() {
  if (!elements.viewTransposeButtons) return;
  elements.viewTransposeButtons.forEach((button) => {
    const value = Number(button.dataset.transposeDisplay || "0");
    const active = value === state.displayTransposeSemitones;
    button.setAttribute("aria-pressed", String(active));
  });
}

function setDisplayTransposeSemitones(value, { announce = true, recordHistory = true } = {}) {
  const normalized = clamp(Math.round(value) || 0, -TRANSPOSE_LIMIT, TRANSPOSE_LIMIT);
  if (normalized === state.displayTransposeSemitones) {
    updateViewTransposeButtons();
    return state.displayTransposeSemitones;
  }
  stopPlayback(false);
  state.displayTransposeSemitones = normalized;
  updateViewTransposeButtons();
  rebuildLineNotes();
  if (recordHistory) {
    commitHistory();
  }
  if (announce) {
    const message = normalized
      ? `Lectura transpuesta ${describeTranspose(normalized)}.`
      : "Lectura en tono de concierto.";
    setStatus(message);
  }
  return normalized;
}

function updateEnharmonicToggle() {
  if (!elements.enharmonicToggle) return;
  const preferFlats = state.enharmonicMode === "flats";
  elements.enharmonicToggle.setAttribute("aria-pressed", String(preferFlats));
  elements.enharmonicToggle.title = preferFlats
    ? "Preferir sostenidos en la notación"
    : "Preferir bemoles en la notación";
}

function toggleEnharmonicMode() {
  state.enharmonicMode = state.enharmonicMode === "flats" ? "sharps" : "flats";
  stopPlayback(false);
  updateEnharmonicToggle();
  rebuildLineNotes();
  commitHistory();
  const message =
    state.enharmonicMode === "flats"
      ? "Notación ajustada para preferir bemoles."
      : "Notación ajustada para preferir sostenidos.";
  setStatus(message);
}

function updateClefToggle() {
  if (!elements.clefToggle) return;
  const isBass = state.scoreClef === "bass";
  elements.clefToggle.setAttribute("aria-pressed", String(isBass));
  elements.clefToggle.title = isBass
    ? "Cambiar a clave de sol"
    : "Cambiar a clave de fa";
}

function toggleClef() {
  state.scoreClef = state.scoreClef === "bass" ? "treble" : "bass";
  stopPlayback(false);
  updateClefToggle();
  rebuildLineNotes();
  commitHistory();
  const message = state.scoreClef === "bass" ? "Partitura en clave de fa." : "Partitura en clave de sol.";
  setStatus(message);
}

function setPlaybackState(playing) {
  state.isPlaying = playing;
  updatePlayToggleButton();
}

function updatePlayToggleButton() {
  if (!elements.playToggle) return;
  const icon = elements.playToggle.querySelector("span[aria-hidden]");
  if (icon) {
    icon.textContent = state.isPlaying ? "⏹" : "▶";
  }
  const srLabel = elements.playToggle.querySelector(".sr-only");
  if (srLabel) {
    srLabel.textContent = state.isPlaying
      ? "Detener la reproducción"
      : "Reproducir la línea";
  }
  elements.playToggle.setAttribute("aria-pressed", String(state.isPlaying));
  elements.playToggle.classList.toggle("control-button--primary", !state.isPlaying);
  elements.playToggle.title = state.isPlaying
    ? "Detener la línea generada"
    : "Reproducir la línea generada";
}

async function ensureMidiAccess() {
  if (!navigator.requestMIDIAccess) {
    setStatus("Web MIDI no disponible en este navegador.");
    return null;
  }
  if (!state.midiAccess) {
    try {
      state.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      state.midiAccess.onstatechange = () => {
        refreshMidiOutputs();
        updateMidiInputListeners();
      };
    } catch (error) {
      setStatus("No fue posible acceder a MIDI.");
      state.midiAccess = null;
      return null;
    }
  }
  return state.midiAccess;
}

function updateMidiInputListeners() {
  if (!state.midiAccess) return;
  state.midiAccess.inputs.forEach((input) => {
    input.onmidimessage = state.midiArmed ? handleMidiMessage : null;
  });
}

async function refreshMidiOutputs(showStatus = false) {
  if (!elements.midiOutput) return;
  if (!navigator.requestMIDIAccess) {
    if (showStatus) {
      setStatus("Web MIDI no disponible en este navegador.");
    }
    return;
  }

  const access = state.midiAccess || (await ensureMidiAccess());
  if (!access) {
    if (showStatus) {
      setStatus("No fue posible acceder a MIDI.");
    }
    return;
  }

  const previousSelection = state.selectedMidiOutputId;
  elements.midiOutput.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Reproducción interna (WebAudio)";
  elements.midiOutput.appendChild(defaultOption);

  const outputs = Array.from(access.outputs.values());
  outputs.forEach((output) => {
    const option = document.createElement("option");
    option.value = output.id;
    const manufacturer = output.manufacturer ? ` - ${output.manufacturer}` : "";
    option.textContent = `${output.name}${manufacturer}`;
    if (output.id === previousSelection) {
      option.selected = true;
    }
    elements.midiOutput.appendChild(option);
  });

  if (previousSelection && !access.outputs.has(previousSelection)) {
    state.selectedMidiOutputId = "";
    elements.midiOutput.value = "";
    if (showStatus) {
      setStatus("El puerto MIDI seleccionado ya no está disponible.");
    }
  } else if (previousSelection) {
    elements.midiOutput.value = previousSelection;
  } else {
    elements.midiOutput.value = "";
  }

  if (showStatus) {
    setStatus(
      outputs.length
        ? "Puertos MIDI actualizados."
        : "No hay puertos MIDI de salida disponibles."
    );
  }
}

function handleMidiOutputChange(event) {
  const selectedId = event.target.value;
  stopPlayback(false);
  state.selectedMidiOutputId = selectedId;
  const output = getSelectedMidiOutput();
  if (selectedId && output) {
    setStatus(`Salida MIDI seleccionada: ${output.name}`);
  } else if (selectedId && !output) {
    setStatus("El puerto MIDI seleccionado no está disponible.");
    state.selectedMidiOutputId = "";
    event.target.value = "";
  } else {
    setStatus("Reproducción interna (WebAudio).");
  }
}

function getSelectedMidiOutput() {
  if (!state.midiAccess || !state.selectedMidiOutputId) {
    return null;
  }
  return state.midiAccess.outputs.get(state.selectedMidiOutputId) || null;
}

function sendAllNotesOff() {
  if (!state.midiAccess || !state.playingMidiOutputId) {
    state.activePlaybackNotes.clear();
    state.playingMidiOutputId = null;
    clearVirtualKeyboardPlaybackHighlights();
    return;
  }
  const output = state.midiAccess.outputs.get(state.playingMidiOutputId);
  if (!output) {
    state.activePlaybackNotes.clear();
    state.playingMidiOutputId = null;
    clearVirtualKeyboardPlaybackHighlights();
    return;
  }
  state.activePlaybackNotes.forEach((note) => {
    output.send([0x80, note, 0]);
  });
  output.send([0xb0, 0x7b, 0x00]);
  state.activePlaybackNotes.clear();
  state.playingMidiOutputId = null;
  clearVirtualKeyboardPlaybackHighlights();
}

function scheduleMidiPlayback(midiOutput, midiLine, bpm, onComplete) {
  state.activePlaybackNotes.clear();
  state.playingMidiOutputId = midiOutput.id;
  clearVirtualKeyboardPlaybackHighlights();

  let maxEndMs = 0;
  midiLine.events.forEach((event, index) => {
    const { startSeconds, durationSeconds } = getSwingTiming(index, bpm, state.swingPercent);
    const startDelay = Math.max(0, Math.round(startSeconds * 1000));
    const durationDelay = Math.max(0, Math.round(durationSeconds * 1000));
    const velocity = clamp(Math.round(event.velocity) || 0, 0, 127);

    const noteOnTimeout = setTimeout(() => {
      midiOutput.send([0x90, event.note, velocity]);
      state.activePlaybackNotes.add(event.note);
      setVirtualKeyboardNotePlaying(event.note, true);
    }, startDelay);

    const noteOffTimeout = setTimeout(() => {
      midiOutput.send([0x80, event.note, 0]);
      state.activePlaybackNotes.delete(event.note);
      setVirtualKeyboardNotePlaying(event.note, false);
    }, startDelay + durationDelay);

    maxEndMs = Math.max(maxEndMs, startDelay + durationDelay);
    state.scheduledTimeouts.push(noteOnTimeout, noteOffTimeout);
  });

  const cleanupDelay = Math.max(0, Math.round(maxEndMs) + 20);
  const cleanupTimeout = setTimeout(() => {
    state.activePlaybackNotes.clear();
    state.playingMidiOutputId = null;
    clearVirtualKeyboardPlaybackHighlights();
    if (typeof onComplete === "function") {
      onComplete();
    }
  }, cleanupDelay);
  state.scheduledTimeouts.push(cleanupTimeout);
}

function updateMidiLearnButton() {
  if (!elements.midiLearn) return;
  elements.midiLearn.classList.toggle("active", state.midiArmed);
  elements.midiLearn.classList.toggle("control-button--primary", state.midiArmed);
  elements.midiLearn.setAttribute("aria-pressed", String(state.midiArmed));
  const stateLabel = elements.midiLearn.querySelector(".state");
  if (stateLabel) {
    stateLabel.textContent = state.midiArmed ? "(encendido)" : "(apagado)";
  }
  const title = state.midiArmed
    ? "Desactivar la captura MIDI continua"
    : "Activar la captura MIDI continua";
  elements.midiLearn.title = title;
}

function restoreTheme() {
  const stored = localStorage.getItem("voicing-theme");
  if (stored === "dark") {
    document.body.classList.add("dark");
  }
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem("voicing-theme", document.body.classList.contains("dark") ? "dark" : "light");
}

elements.themeToggle.addEventListener("click", toggleTheme);
restoreTheme();

if (elements.tempo) {
  const enforceTempoBounds = () => {
    const min = Number(elements.tempo.min) || 40;
    const max = Number(elements.tempo.max) || 320;
    const sanitized = clamp(Math.round(Number(elements.tempo.value) || DEFAULT_BPM), min, max);
    elements.tempo.value = String(sanitized);
    return sanitized;
  };
  elements.tempo.addEventListener("change", enforceTempoBounds);
  elements.tempo.addEventListener("blur", enforceTempoBounds);
  enforceTempoBounds();
}

if (elements.swing) {
  elements.swing.addEventListener("input", (event) => {
    setSwingPercent(event.target.value);
  });
  const enforceSwingBounds = () => {
    const normalized = setSwingPercent(elements.swing.value);
    elements.swing.value = String(normalized);
  };
  elements.swing.addEventListener("change", enforceSwingBounds);
  elements.swing.addEventListener("blur", enforceSwingBounds);
  setSwingPercent(elements.swing.value, { updateInput: true });
}

updateTransposeDisplay();

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function findPatternById(id) {
  if (!id) return null;
  return PATTERN_LOOKUP.get(id) || null;
}

function getChordVoiceCount(chord) {
  const storedCount = chord && normalizeVoiceCount(chord.voiceCount);
  if (storedCount) {
    return storedCount;
  }

  const hasLength = chord && typeof chord.length === "number" && chord.length > 0;
  const source = hasLength ? chord : DEFAULT_CHORD;
  const limited = Array.from(source).slice(0, 4).filter((note) => Number.isFinite(note));
  const computed = normalizeVoiceCount(limited.length);
  if (computed) {
    return computed;
  }

  return normalizeVoiceCount(DEFAULT_CHORD.voiceCount) || 1;
}

function getPatternPoolForChord(chord) {
  const voiceCount = getChordVoiceCount(chord);
  return voiceCount >= 4 ? FOUR_NOTE_PATTERNS : THREE_NOTE_PATTERNS;
}

function patternFitsChord(pattern, chord) {
  if (!pattern) return false;
  const voiceCount = getChordVoiceCount(chord);
  if (voiceCount >= 4) {
    return pattern.maxVoice === 4;
  }
  return pattern.maxVoice <= voiceCount;
}

function updatePatternGroups(groups, { recordHistory = true, preserveTranspositions = false } = {}) {
  state.patternGroups = Array.isArray(groups) ? groups.slice() : [];
  if (preserveTranspositions) {
    const next = new Array(state.patternGroups.length).fill(0);
    for (let i = 0; i < next.length; i++) {
      next[i] = state.groupTranspositions[i] || 0;
    }
    state.groupTranspositions = next;
    state.selectedPatternIndices = new Set(
      Array.from(state.selectedPatternIndices).filter(
        (index) => Number.isInteger(index) && index >= 0 && index < state.patternGroups.length
      )
    );
  } else {
    state.groupTranspositions = new Array(state.patternGroups.length).fill(0);
    state.selectedPatternIndices.clear();
  }
  rebuildLineNotes();
  renderMatrix();
  if (recordHistory) {
    commitHistory();
  }
}

function createNoteEntriesForPattern(pattern, chord, transposeSemitones = state.transposeSemitones) {
  if (!pattern) {
    return [];
  }
  const sortedChord = getSortedChord(chord || DEFAULT_CHORD);
  return pattern.values.map((voice) => {
    const note = getNoteFromSortedChordVoice(voice, sortedChord);
    const transposed = clamp(note + transposeSemitones, 0, 127);
    return { note: transposed, voice };
  });
}

function rebuildLineNotes() {
  const displayEntries = [];
  const playbackEntries = [];
  const accentIndices = [];
  let globalIndex = 0;
  const totalGroups = state.patternGroups.length;
  for (let i = 0; i < totalGroups; i++) {
    const pattern = state.patternGroups[i];
    const chord = state.chords[i] || DEFAULT_CHORD;
    const groupTranspose = state.groupTranspositions[i] || 0;
    const playbackTranspose = state.transposeSemitones + groupTranspose;
    const displayTranspose = playbackTranspose + state.displayTransposeSemitones;
    const playbackGroup = createNoteEntriesForPattern(pattern, chord, playbackTranspose);
    const displayGroup = createNoteEntriesForPattern(pattern, chord, displayTranspose);
    if (pattern && Array.isArray(pattern.values) && pattern.values.length === 4) {
      const maxVoice = pattern.values.reduce((max, value) => Math.max(max, value), 0);
      const accentOffset = pattern.values.findIndex((voice) => voice === maxVoice);
      if (accentOffset >= 0 && accentOffset < displayGroup.length) {
        accentIndices.push(globalIndex + accentOffset);
      }
    }
    playbackEntries.push(...playbackGroup);
    displayEntries.push(...displayGroup);
    globalIndex += displayGroup.length;
  }
  state.noteEntries = displayEntries;
  state.playbackNoteEntries = playbackEntries;
  state.accentNoteIndices = accentIndices;
  state.lineNotes = playbackEntries.map((entry) => entry.note);
  state.midiLine = playbackEntries.length ? convertLineToMidi(playbackEntries) : EMPTY_MIDI_LINE;
  renderScore(displayEntries, accentIndices);
}

function getSortedChord(chord) {
  return [...chord].sort((a, b) => a - b);
}

function getNoteFromChordVoice(voice, chord) {
  const sortedChord = getSortedChord(chord);
  return getNoteFromSortedChordVoice(voice, sortedChord);
}

function getNoteFromSortedChordVoice(voice, sortedChord) {
  const index = Math.min(Math.max(voice - 1, 0), sortedChord.length - 1);
  return sortedChord[index];
}

function getVelocityForVoice(voice) {
  const key = clamp(Math.round(voice) || 4, 1, 4);
  return VELOCITY_BY_VOICE[key] ?? VELOCITY_BY_VOICE[4];
}

function convertLineToMidi(noteEntries) {
  const events = noteEntries.map((entry, index) => ({
    note: entry.note,
    startTicks: index * TICKS_PER_EIGHTH,
    durationTicks: TICKS_PER_EIGHTH,
    velocity: getVelocityForVoice(entry.voice)
  }));
  if (events.length > 0) {
    events[events.length - 1].velocity = 127;
  }
  const measures = countMeasures(noteEntries.length, NOTES_PER_MEASURE);
  const totalTicks = events.length ? events[events.length - 1].startTicks + TICKS_PER_EIGHTH : 0;
  return { events, measures, totalTicks };
}

function getSwingRatios(percent) {
  const swing = clamp(Number(percent) || 0, 0, 100) / 100;
  const first = 0.5 + 0.25 * swing;
  const second = 0.5 - 0.25 * swing;
  return { first, second };
}

function getSwingTiming(index, bpm, percent) {
  const safeBpm = Math.max(1, Number(bpm) || DEFAULT_BPM);
  const quarterDuration = 60 / safeBpm;
  const { first, second } = getSwingRatios(percent);
  const pairIndex = Math.floor(index / 2);
  const isFirst = index % 2 === 0;
  const firstDuration = quarterDuration * first;
  const secondDuration = quarterDuration * second;
  const startSeconds = pairIndex * quarterDuration + (isFirst ? 0 : firstDuration);
  const durationSeconds = isFirst ? firstDuration : secondDuration;
  return { startSeconds, durationSeconds };
}

function setScorePlaceholder(message = SCORE_PLACEHOLDER_MESSAGE) {
  if (!elements.scoreViewer) return;
  elements.scoreViewer.innerHTML = "";
  const placeholder = document.createElement("p");
  placeholder.className = "score-placeholder";
  placeholder.textContent = message;
  elements.scoreViewer.appendChild(placeholder);
}

function createRestNote(VF, clef) {
  const restKey = clef === "bass" ? "d/3" : "b/4";
  return new VF.StaveNote({ clef, keys: [restKey], duration: "8r" });
}

function createStaveNoteFromMidi(
  VF,
  midi,
  accent = false,
  accidentalOverride,
  clef,
  enharmonicMode
) {
  const { key, accidental } = midiNoteToVexFlowKey(midi, enharmonicMode);
  const note = new VF.StaveNote({ clef, keys: [key], duration: "8" });
  const finalAccidental =
    accidentalOverride === undefined ? accidental : accidentalOverride;
  if (finalAccidental) {
    note.addAccidental(0, new VF.Accidental(finalAccidental));
  }
  if (accent) {
    note.addArticulation(0, new VF.Articulation("a>").setPosition(VF.Modifier.Position.ABOVE));
  }
  return note;
}

function renderScore(noteEntries, accentIndices = []) {
  if (!elements.scoreViewer) return;
  if (!noteEntries.length) {
    setScorePlaceholder();
    return;
  }
  const VF = window.Vex?.Flow;
  if (!VF) {
    setScorePlaceholder("La partitura requiere soporte de VexFlow en el navegador.");
    return;
  }

  const measures = buildMeasureNoteSpecs(noteEntries, accentIndices, NOTES_PER_MEASURE);
  if (!measures.length) {
    setScorePlaceholder();
    return;
  }

  const container = elements.scoreViewer;
  container.innerHTML = "";

  const totalMeasures = measures.length;
  const measuresPerRow = Math.max(1, calculateMeasuresPerRow(totalMeasures));
  const columns = Math.min(totalMeasures, measuresPerRow);
  const rows = Math.ceil(totalMeasures / measuresPerRow);
  const staveHeight = 120;
  const measureSpacing = SCORE_MEASURE_SPACING;
  const rowSpacing = SCORE_ROW_SPACING;
  const horizontalPadding = SCORE_HORIZONTAL_PADDING;
  const verticalPadding = SCORE_VERTICAL_PADDING;
  const bottomPadding = SCORE_BOTTOM_PADDING;
  const spacingBetweenMeasures = Math.max(columns - 1, 0) * measureSpacing;
  const availableWidth = getInnerWidth(container);
  const minimumWidthForMeasures = columns * SCORE_MIN_STAVE_WIDTH;
  const widthForStaves = Math.max(availableWidth - spacingBetweenMeasures, minimumWidthForMeasures);
  const staveWidth = clamp(
    Math.floor(widthForStaves / columns),
    SCORE_MIN_STAVE_WIDTH,
    SCORE_MAX_STAVE_WIDTH
  );
  const width = columns * staveWidth + spacingBetweenMeasures + horizontalPadding * 2;
  const height =
    rows * staveHeight + Math.max(rows - 1, 0) * rowSpacing + verticalPadding + bottomPadding;
  const clef = state.scoreClef || DEFAULT_CLEF;
  const enharmonicMode = state.enharmonicMode || DEFAULT_ENHARMONIC_MODE;

  const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  renderer.resize(width, height);
  const context = renderer.getContext();
  context.setFont("Arial", 10, "").setBackgroundFillStyle("transparent");

  measures.forEach((measure, index) => {
    const row = Math.floor(index / measuresPerRow);
    const column = index % measuresPerRow;
    const x =
      horizontalPadding + column * (staveWidth + measureSpacing);
    const y = verticalPadding + row * (staveHeight + rowSpacing);
    const stave = new VF.Stave(x, y, staveWidth);
    if (column === 0) {
      stave.addClef(clef);
      let addedTimeSignature = false;
      if (VF.TimeSignature) {
        try {
          const timeSignature = new VF.TimeSignature("4/4");
          if (typeof timeSignature.setXShift === "function") {
            timeSignature.setXShift(-6);
          }
          if (typeof stave.addModifier === "function") {
            if (VF.StaveModifier?.Position !== undefined) {
              stave.addModifier(timeSignature, VF.StaveModifier.Position.BEGIN);
            } else {
              stave.addModifier(timeSignature);
            }
            addedTimeSignature = true;
          }
        } catch (_) {
          addedTimeSignature = false;
        }
      }
      if (!addedTimeSignature) {
        stave.addTimeSignature("4/4");
      }
    }
    if (column > 0) {
      stave.setBegBarType(VF.Barline.type.NONE);
    }
    if (index === totalMeasures - 1) {
      stave.setEndBarType(VF.Barline.type.END);
    }
    stave.setContext(context).draw();

    const accidentalState = new Map();

    const tickables = measure.map((entry) => {
      if (entry.type === "rest") {
        return createRestNote(VF, clef);
      }
      const { key, accidental: defaultAccidental } = midiNoteToVexFlowKey(
        entry.midi,
        enharmonicMode
      );
      const previousAccidental = accidentalState.get(key);
      let accidentalOverride;

      if (defaultAccidental) {
        if (previousAccidental === defaultAccidental) {
          accidentalOverride = null;
        } else {
          accidentalOverride = defaultAccidental;
        }
        accidentalState.set(key, defaultAccidental);
      } else {
        if (previousAccidental && previousAccidental !== "n") {
          accidentalOverride = "n";
        } else {
          accidentalOverride = null;
        }
        accidentalState.set(key, null);
      }

      return createStaveNoteFromMidi(
        VF,
        entry.midi,
        entry.accent,
        accidentalOverride,
        clef,
        enharmonicMode
      );
    });

    const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setStrict(false);
    voice.addTickables(tickables);

    const beams = [];
    let beamGroup = [];
    measure.forEach((entry, noteIndex) => {
      if (entry.type !== "note") {
        beamGroup = [];
        return;
      }
      beamGroup.push(tickables[noteIndex]);
      if (beamGroup.length === 4) {
        beams.push(new VF.Beam(beamGroup));
        beamGroup = [];
      }
    });

    const formatter = new VF.Formatter();
    formatter.joinVoices([voice]).format([voice], staveWidth - 80);
    voice.draw(context, stave);
    beams.forEach((beam) => beam.setContext(context).draw());
  });
}

function formatTransposeBadge(value) {
  if (!value) {
    return "";
  }
  const sign = value > 0 ? "+" : "−";
  return `${sign}${Math.abs(value)}`;
}

function updateMatrixSelectionSummary() {
  if (!elements.matrixSelectionSummary) return;
  const count = state.selectedPatternIndices.size;
  if (!count) {
    elements.matrixSelectionSummary.textContent = MATRIX_SELECTION_EMPTY_MESSAGE;
    return;
  }
  const indices = Array.from(state.selectedPatternIndices).sort((a, b) => a - b);
  const offsets = indices.map((index) => state.groupTranspositions[index] || 0);
  const uniform = offsets.every((value) => value === offsets[0]);
  const descriptor = uniform ? describeTranspose(offsets[0]) : "Ajustes mixtos";
  if (count === 1) {
    elements.matrixSelectionSummary.textContent = `Compás ${indices[0] + 1}: ${descriptor}.`;
    return;
  }
  elements.matrixSelectionSummary.textContent = `${count} compases: ${descriptor}.`;
}

function clearMatrixSelection({ announce = false } = {}) {
  if (!state.selectedPatternIndices.size) {
    updateMatrixSelectionSummary();
    return;
  }
  state.selectedPatternIndices.clear();
  renderMatrix();
  updateMatrixSelectionSummary();
  if (announce) {
    setStatus("Selección de compases borrada.");
  }
}

function handleMatrixGroupClick(event, index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.patternGroups.length) {
    return;
  }
  const target = event.target;
  if (target instanceof HTMLElement && target.closest(".matrix-group-button")) {
    return;
  }
  const additive = event.metaKey || event.ctrlKey || event.shiftKey;
  if (!additive) {
    if (state.selectedPatternIndices.size === 1 && state.selectedPatternIndices.has(index)) {
      state.selectedPatternIndices.clear();
    } else {
      state.selectedPatternIndices = new Set([index]);
    }
  } else {
    if (state.selectedPatternIndices.has(index)) {
      state.selectedPatternIndices.delete(index);
    } else {
      state.selectedPatternIndices.add(index);
    }
  }
  renderMatrix();
  updateMatrixSelectionSummary();
}

function transposeSelectedGroups(delta) {
  if (!state.selectedPatternIndices.size) {
    setStatus("Selecciona al menos un compás para ajustar su transposición.");
    return;
  }
  let changed = false;
  const applied = [];
  state.selectedPatternIndices.forEach((index) => {
    const current = state.groupTranspositions[index] || 0;
    const next = clamp(current + delta, -TRANSPOSE_LIMIT, TRANSPOSE_LIMIT);
    if (next !== current) {
      state.groupTranspositions[index] = next;
      changed = true;
      applied.push({ index, value: next });
    }
  });
  if (!changed) {
    setStatus("Los compases seleccionados ya tienen ese ajuste.");
    return;
  }
  stopPlayback(false);
  rebuildLineNotes();
  renderMatrix();
  updateMatrixSelectionSummary();
  commitHistory();
  if (applied.length === 1) {
    const { index, value } = applied[0];
    const descriptor = value ? describeTranspose(value) : "Sin transposición";
    setStatus(`Compás ${index + 1} ajustado a ${descriptor}.`);
  } else {
    setStatus("Transposición aplicada a los compases seleccionados.");
  }
}

function resetSelectedGroupTranspositions() {
  if (!state.selectedPatternIndices.size) {
    setStatus("No hay compases seleccionados para restablecer.");
    return;
  }
  let changed = false;
  state.selectedPatternIndices.forEach((index) => {
    if ((state.groupTranspositions[index] || 0) !== 0) {
      state.groupTranspositions[index] = 0;
      changed = true;
    }
  });
  if (!changed) {
    setStatus("Los compases seleccionados ya estaban sin ajuste.");
    return;
  }
  stopPlayback(false);
  rebuildLineNotes();
  renderMatrix();
  updateMatrixSelectionSummary();
  commitHistory();
  setStatus("Transposición restablecida en los compases seleccionados.");
}

function renderMatrix() {
  elements.matrix.innerHTML = "";
  if (state.patternGroups.length === 0) {
    const empty = document.createElement("p");
    empty.textContent =
      "Captura acordes con MIDI Learn para ver la matriz y arrastra una muestra sobre un compás para ajustar su orden.";
    elements.matrix.appendChild(empty);
    updateMatrixSelectionSummary();
    return;
  }
  const groupsPerRow = Math.max(1, calculateGroupsPerRow());
  const totalGroups = state.patternGroups.length;
  for (let i = 0; i < totalGroups; i += groupsPerRow) {
    const rowEl = document.createElement("div");
    rowEl.className = "matrix-row";
    const rowEnd = Math.min(i + groupsPerRow, totalGroups);
    const columnsInRow = rowEnd - i;
    rowEl.style.setProperty("--matrix-columns", String(columnsInRow));
    for (let j = i; j < rowEnd; j++) {
      const pattern = state.patternGroups[j];
      const groupEl = document.createElement("div");
      groupEl.className = "matrix-group";
      groupEl.dataset.index = String(j);
      groupEl.setAttribute("role", "group");
      groupEl.setAttribute("aria-label", `Compás ${j + 1} con patrón ${pattern.id}`);
      groupEl.addEventListener("dragenter", handleMatrixDragEnter);
      groupEl.addEventListener("dragover", handleMatrixDragOver);
      groupEl.addEventListener("dragleave", handleMatrixDragLeave);
      groupEl.addEventListener("drop", handleMatrixDrop);
      groupEl.addEventListener("click", (event) => handleMatrixGroupClick(event, j));
      if (state.selectedPatternIndices.has(j)) {
        groupEl.classList.add("matrix-group--selected");
      }

      const playButton = document.createElement("button");
      playButton.type = "button";
      playButton.className = "matrix-group-button matrix-group-button--play";
      playButton.title = `Reproducir patrón ${pattern.id}`;
      playButton.setAttribute(
        "aria-label",
        `Reproducir patrón ${pattern.id} del compás ${j + 1}`
      );
      playButton.draggable = false;
      playButton.addEventListener("click", (event) => {
        event.stopPropagation();
        playPatternAtIndex(j);
      });
      const playIcon = document.createElement("span");
      playIcon.className = "matrix-group-button-icon";
      playIcon.setAttribute("aria-hidden", "true");
      playIcon.textContent = "▶";
      playButton.appendChild(playIcon);
      groupEl.appendChild(playButton);

      const regenerateButton = document.createElement("button");
      regenerateButton.type = "button";
      regenerateButton.className = "matrix-group-button matrix-group-button--shuffle";
      regenerateButton.title = `Generar variación para el compás ${j + 1}`;
      regenerateButton.setAttribute(
        "aria-label",
        `Generar una variación aleatoria para el compás ${j + 1}`
      );
      regenerateButton.draggable = false;
      regenerateButton.addEventListener("click", (event) => {
        event.stopPropagation();
        regeneratePatternAtIndex(j);
      });
      const regenerateIcon = document.createElement("span");
      regenerateIcon.className = "matrix-group-button-icon";
      regenerateIcon.setAttribute("aria-hidden", "true");
      regenerateIcon.textContent = "⟳";
      regenerateButton.appendChild(regenerateIcon);
      groupEl.appendChild(regenerateButton);

      pattern.values.forEach((voice) => {
        const cell = document.createElement("div");
        cell.className = "matrix-cell";
        const circle = document.createElement("div");
        circle.className = "matrix-circle";
        circle.style.marginTop = `${(4 - voice) * 12}px`;
        cell.appendChild(circle);
        groupEl.appendChild(cell);
      });

      const label = document.createElement("span");
      label.className = "matrix-pattern-id";
      label.textContent = pattern.id;
      groupEl.appendChild(label);

      const transposeValue = state.groupTranspositions[j] || 0;
      if (transposeValue) {
        const badge = document.createElement("span");
        badge.className = "matrix-group-transpose";
        badge.textContent = formatTransposeBadge(transposeValue);
        groupEl.appendChild(badge);
      }

      if (j === rowEnd - 1) {
        groupEl.classList.add("matrix-group--last-in-row");
      }

      rowEl.appendChild(groupEl);
    }
    elements.matrix.appendChild(rowEl);
  }
  updateMatrixSelectionSummary();
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function getCssNumericValue(computedStyles, property, fallback) {
  if (!computedStyles) {
    return fallback;
  }
  const raw = computedStyles.getPropertyValue(property);
  const numeric = Number.parseFloat(raw);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function setVirtualKeyboardNoteSelected(note, selected) {
  const key = state.virtualKeyboardKeyMap.get(note);
  if (!key) {
    return;
  }
  key.classList.toggle("virtual-keyboard__key--selected", selected);
  key.setAttribute("aria-pressed", String(selected));
}

function setVirtualKeyboardNotePlaying(note, playing) {
  const key = state.virtualKeyboardKeyMap.get(note);
  if (!key) {
    return;
  }
  const counts = state.virtualKeyboardPlaybackNotes;
  const current = counts.get(note) || 0;
  if (playing) {
    const next = current + 1;
    if (next === 1) {
      key.classList.add("virtual-keyboard__key--playing");
    }
    counts.set(note, next);
    return;
  }
  const next = Math.max(0, current - 1);
  if (next === 0) {
    key.classList.remove("virtual-keyboard__key--playing");
    counts.delete(note);
  } else {
    counts.set(note, next);
  }
}

function clearVirtualKeyboardPlaybackHighlights() {
  state.virtualKeyboardPlaybackNotes.forEach((_, note) => {
    const key = state.virtualKeyboardKeyMap.get(note);
    if (key) {
      key.classList.remove("virtual-keyboard__key--playing");
    }
  });
  state.virtualKeyboardPlaybackNotes.clear();
  const previews = Array.from(state.virtualKeyboardPreviewTimeouts.values());
  state.virtualKeyboardPreviewTimeouts.clear();
  previews.forEach((data) => {
    clearTimeout(data.timeoutId);
    if (typeof data.cleanup === "function") {
      try {
        data.cleanup();
      } catch (_) {
        // ignore cleanup errors
      }
    }
  });
}

function updateVirtualKeyboardSelection() {
  if (!elements.virtualKeyboardSelection) {
    return;
  }
  const notes = Array.from(state.virtualKeyboardPendingNotes).sort((a, b) => a - b);
  if (!notes.length) {
    elements.virtualKeyboardSelection.textContent =
      "Selecciona tres o cuatro notas y usa la barra espaciadora para guardar el grupo.";
    return;
  }
  const names = notes.map(noteNumberToName);
  const countText = notes.length === 1 ? "1 nota" : `${notes.length} notas`;
  elements.virtualKeyboardSelection.textContent = `Grupo actual (${countText}): ${names.join(
    " – "
  )}.`;
}

function clearVirtualKeyboardPendingNotes() {
  for (const note of state.virtualKeyboardPendingNotes) {
    setVirtualKeyboardNoteSelected(note, false);
  }
  state.virtualKeyboardPendingNotes.clear();
}

function scheduleVirtualKeyboardPreviewCleanup(note, cleanup) {
  const existing = state.virtualKeyboardPreviewTimeouts.get(note);
  if (existing) {
    clearTimeout(existing.timeoutId);
    if (typeof existing.cleanup === "function") {
      try {
        existing.cleanup();
      } catch (_) {
        // ignore errors from previous preview cleanup
      }
    }
  }
  const timeoutId = setTimeout(() => {
    try {
      cleanup();
    } finally {
      state.virtualKeyboardPreviewTimeouts.delete(note);
    }
  }, VIRTUAL_KEYBOARD_PREVIEW_DURATION_MS);
  state.virtualKeyboardPreviewTimeouts.set(note, { timeoutId, cleanup });
}

function previewVirtualKeyboardNote(note) {
  if (!Number.isFinite(note)) {
    return;
  }
  if (!state.virtualKeyboardKeyMap.has(note)) {
    return;
  }

  setVirtualKeyboardNotePlaying(note, true);

  const midiOutput = getSelectedMidiOutput();
  if (midiOutput) {
    const velocity = clamp(Math.round(VIRTUAL_KEYBOARD_PREVIEW_VELOCITY), 1, 127);
    try {
      midiOutput.send([0x90, note, velocity]);
    } catch (_) {
      setVirtualKeyboardNotePlaying(note, false);
      return;
    }
    const cleanup = () => {
      try {
        midiOutput.send([0x80, note, 0]);
      } catch (_) {
        // ignore failures when sending note off
      }
      setVirtualKeyboardNotePlaying(note, false);
    };
    scheduleVirtualKeyboardPreviewCleanup(note, cleanup);
    return;
  }

  const audioCtx = ensureAudioContext();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  const durationSeconds = VIRTUAL_KEYBOARD_PREVIEW_DURATION_MS / 1000;
  const attackEnd = now + Math.min(0.02, durationSeconds * 0.3);
  const peakGain = 0.6;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peakGain, attackEnd);
  gain.gain.linearRampToValueAtTime(0, now + durationSeconds);

  osc.type = "sine";
  osc.frequency.value = midiToFrequency(note);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + durationSeconds);

  const cleanup = () => {
    try {
      osc.stop();
    } catch (_) {
      // ignore errors when stopping preview oscillator
    }
    setVirtualKeyboardNotePlaying(note, false);
  };
  scheduleVirtualKeyboardPreviewCleanup(note, cleanup);
}

function toggleVirtualKeyboardNote(note) {
  if (!Number.isFinite(note)) {
    return;
  }
  const pending = state.virtualKeyboardPendingNotes;
  if (pending.has(note)) {
    pending.delete(note);
    setVirtualKeyboardNoteSelected(note, false);
    updateVirtualKeyboardSelection();
    return;
  }
  if (pending.size >= 4) {
    setStatus(
      "Cada grupo admite hasta 4 notas. Pulsa la barra espaciadora para guardar el grupo actual."
    );
    return;
  }
  pending.add(note);
  setVirtualKeyboardNoteSelected(note, true);
  updateVirtualKeyboardSelection();
}

function buildVirtualKeyboard() {
  if (
    typeof window === "undefined" ||
    !elements.virtualKeyboardWhiteKeys ||
    !elements.virtualKeyboardBlackKeys
  ) {
    return;
  }

  elements.virtualKeyboardWhiteKeys.innerHTML = "";
  elements.virtualKeyboardBlackKeys.innerHTML = "";
  state.virtualKeyboardKeyMap.clear();

  const computedStyles = window.getComputedStyle(document.documentElement);
  const whiteWidth = getCssNumericValue(computedStyles, "--vk-white-key-width", 36);
  const blackWidth = getCssNumericValue(computedStyles, "--vk-black-key-width", 22);

  const whiteFragment = document.createDocumentFragment();
  const blackFragment = document.createDocumentFragment();
  const whiteKeys = [];
  const pendingBlackKeys = [];

  let whiteKeyCount = 0;
  for (let note = VIRTUAL_KEYBOARD_FIRST_NOTE; note <= VIRTUAL_KEYBOARD_LAST_NOTE; note++) {
    const noteName = NOTE_NAMES[note % 12];
    const isSharp = noteName.includes("#");
    const octave = Math.floor(note / 12) - 1;
    const displayName = `${noteName.replace("#", "♯")}${octave}`;
    const ariaName = isSharp
      ? `Nota ${noteName[0]} sostenido ${octave}`
      : `Nota ${noteName} ${octave}`;

    if (!isSharp) {
      const key = document.createElement("button");
      key.type = "button";
      key.className = "virtual-keyboard__key virtual-keyboard__key--white";
      key.dataset.midi = String(note);
      key.title = displayName;
      key.setAttribute("aria-label", ariaName);
      key.setAttribute("aria-pressed", "false");
      key.addEventListener("click", () => {
        previewVirtualKeyboardNote(note);
        toggleVirtualKeyboardNote(note);
      });

      if (noteName === "C") {
        const marker = document.createElement("span");
        marker.className = "virtual-keyboard__octave-label";
        marker.textContent = `C${octave}`;
        key.appendChild(marker);
      }

      whiteFragment.appendChild(key);
      whiteKeys.push(key);
      state.virtualKeyboardKeyMap.set(note, key);
      whiteKeyCount += 1;
      continue;
    }

    const key = document.createElement("button");
    key.type = "button";
    key.className = "virtual-keyboard__key virtual-keyboard__key--black";
    key.dataset.midi = String(note);
    key.title = displayName;
    key.setAttribute("aria-label", ariaName);
    key.setAttribute("aria-pressed", "false");
    key.addEventListener("click", (event) => {
      event.stopPropagation();
      previewVirtualKeyboardNote(note);
      toggleVirtualKeyboardNote(note);
    });

    pendingBlackKeys.push({
      note,
      key,
      precedingIndex: Math.max(0, whiteKeyCount - 1),
      followingIndex: whiteKeyCount
    });
  }

  elements.virtualKeyboardWhiteKeys.appendChild(whiteFragment);

  for (const { note, key, precedingIndex, followingIndex } of pendingBlackKeys) {
    const previousWhite = whiteKeys[precedingIndex] || null;
    const nextWhite = whiteKeys[followingIndex] || null;

    let boundary = 0;
    if (nextWhite) {
      boundary = nextWhite.offsetLeft;
    } else if (previousWhite) {
      boundary = previousWhite.offsetLeft + previousWhite.offsetWidth;
    }

    const left = Math.max(0, Math.round(boundary - blackWidth / 2));
    key.style.left = `${left}px`;

    blackFragment.appendChild(key);
    state.virtualKeyboardKeyMap.set(note, key);
  }

  elements.virtualKeyboardBlackKeys.appendChild(blackFragment);

  if (elements.virtualKeyboardKeysWrapper) {
    const totalWidth = whiteKeyCount * whiteWidth;
    elements.virtualKeyboardKeysWrapper.style.width = `${Math.round(totalWidth)}px`;
  }

  updateVirtualKeyboardSelection();
}

function commitVirtualKeyboardChord() {
  const notes = Array.from(state.virtualKeyboardPendingNotes).sort((a, b) => a - b);
  if (notes.length < 3) {
    setStatus("Selecciona al menos 3 notas para guardar un grupo.");
    return false;
  }
  if (notes.length > 4) {
    setStatus("Cada grupo admite hasta 4 notas. Quita una nota antes de guardar.");
    return false;
  }

  stopPlayback(false);
  if (state.midiArmed) {
    void setMidiLearnState(false, { skipGenerate: true });
  }

  const chord = notes.slice();
  chord.voiceCount = chord.length;
  state.chords.push(chord);
  state.replacementIndex = null;
  state.pendingReplacementDisarm = false;
  state.lastCapturedChordIndex = null;
  renderChords();

  const result = generateLineFromCapturedChords();
  let statusMessage = "Grupo guardado.";
  if (result.success) {
    const label = notes.map(noteNumberToName).join(" ");
    statusMessage = `Grupo ${state.chords.length} guardado: ${label}.`;
  } else if (result.reason === "invalid") {
    updatePatternGroups([]);
    state.midiLine = EMPTY_MIDI_LINE;
    statusMessage =
      "Grupo guardado, pero no fue posible generar una línea válida con todos los acordes.";
  } else {
    updatePatternGroups([]);
    state.midiLine = EMPTY_MIDI_LINE;
    statusMessage = "Grupo guardado. Captura más acordes para generar la línea.";
  }

  clearVirtualKeyboardPendingNotes();
  updateVirtualKeyboardSelection();
  setStatus(statusMessage);
  return true;
}

function noteNumberToName(note) {
  const name = NOTE_NAMES[note % 12];
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
}

function buildPatternDictionaryHtml() {
  const renderPatternPreview = (pattern) => {
    const cells = pattern.values
      .map((voice, index) => {
        const offset = Math.max(0, (4 - voice) * 12);
        return `
          <span class="pattern-preview-cell" aria-hidden="true">
            <span
              class="pattern-preview-dot"
              style="margin-top: ${offset}px"
              data-voice="${voice}"
              data-step="${index + 1}"
            ></span>
          </span>
        `;
      })
      .join("");

    return `
      <div class="pattern-preview" aria-hidden="true">
        ${cells}
      </div>
    `;
  };

  const renderSection = (title, patterns) => {
    const items = patterns
      .map((pattern) => {
        const preview = renderPatternPreview(pattern);
        const voicesText = pattern.values.join(" → ");
        const ariaLabel = `Patrón ${pattern.id}: ${voicesText}`;
        return `
          <li>
            <div class="pattern-card" role="group" aria-label="${ariaLabel}">
              <span class="pattern-id">${pattern.id}</span>
              ${preview}
              <span class="pattern-voices">${voicesText}</span>
            </div>
          </li>
        `;
      })
      .join("");
    return `
      <section class="dictionary-section">
        <h2>${title}</h2>
        <ul class="pattern-list">${items}</ul>
      </section>
    `;
  };

  return `<!DOCTYPE html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>Diccionario de patrones melódicos</title>
      <style>
        :root {
          color-scheme: light dark;
        }
        body {
          font-family: "Inter", "Segoe UI", system-ui, sans-serif;
          margin: 0;
          padding: 2rem clamp(1.5rem, 4vw, 3rem);
          background: #f7f5ff;
          color: #1d1d1f;
        }
        @media (prefers-color-scheme: dark) {
          body {
            background: #141218;
            color: #f5f7ff;
          }
        }
        h1 {
          margin-top: 0;
          font-size: clamp(1.4rem, 3vw, 2rem);
        }
        h2 {
          font-size: 1.15rem;
          margin-bottom: 0.5rem;
          margin-top: 1.75rem;
        }
        p {
          line-height: 1.6;
          max-width: 60ch;
        }
        .dictionary-section:first-of-type h2 {
          margin-top: 1.25rem;
        }
        .pattern-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 1rem 1.5rem;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        }
        .pattern-list li {
          display: flex;
          align-items: stretch;
          color: inherit;
        }
        .pattern-card {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem 1.1rem 1.25rem;
          border-radius: 14px;
          border: 1px solid rgba(103, 63, 181, 0.28);
          background: rgba(103, 63, 181, 0.12);
          font-variant-numeric: tabular-nums;
          text-align: center;
        }
        .pattern-id {
          font-family: "Roboto Mono", monospace;
          font-weight: 600;
          letter-spacing: 0.08em;
          font-size: 0.8rem;
        }
        .pattern-voices {
          opacity: 0.75;
          font-size: 0.9rem;
        }
        .pattern-preview {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0.35rem;
          width: 100%;
          max-width: 200px;
        }
        .pattern-preview-cell {
          height: 60px;
          border-radius: 999px;
          border: 1px dashed rgba(103, 63, 181, 0.4);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          padding-top: 6px;
        }
        .pattern-preview-dot {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #673fb5;
        }
        @media (prefers-color-scheme: dark) {
          .pattern-card {
            border-color: rgba(151, 131, 214, 0.5);
            background: rgba(151, 131, 214, 0.12);
          }
          .pattern-preview-cell {
            border-color: rgba(151, 131, 214, 0.5);
          }
          .pattern-preview-dot {
            background: #bba5ff;
          }
        }
      </style>
    </head>
    <body>
      <h1>Diccionario de patrones melódicos</h1>
      <p>
        Cada patrón describe el orden relativo de las voces (1 grave → 4 aguda) dentro de un compás.
        Úsalos como guía para planear líneas y asegurar transiciones suaves entre acordes.
      </p>
      ${renderSection("Patrones de 4 alturas", FOUR_NOTE_PATTERNS)}
      ${renderSection("Patrones de 3 alturas", THREE_NOTE_PATTERNS)}
    </body>
  </html>`;
}

function openPatternDictionaryWindow() {
  if (typeof window === "undefined") {
    setStatus("La ventana del diccionario solo está disponible en el navegador.");
    return;
  }
  const html = buildPatternDictionaryHtml();
  const features = "width=560,height=680,noopener=yes";
  if (
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    const fallbackRef = window.open("", "patternDictionary", features);
    if (!fallbackRef) {
      setStatus("El navegador bloqueó la ventana del diccionario.");
      return;
    }
    fallbackRef.document.open();
    fallbackRef.document.write(html);
    fallbackRef.document.close();
    if (typeof fallbackRef.focus === "function") {
      fallbackRef.focus();
    }
    return;
  }

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const ref = window.open(url, "patternDictionary", features);
  if (!ref) {
    URL.revokeObjectURL(url);
    setStatus("El navegador bloqueó la ventana del diccionario.");
    return;
  }
  const cleanup = () => {
    URL.revokeObjectURL(url);
    if (typeof ref.removeEventListener === "function") {
      ref.removeEventListener("load", cleanup);
    }
  };
  if (typeof ref.addEventListener === "function") {
    ref.addEventListener("load", cleanup, { once: true });
  } else {
    setTimeout(cleanup, 2000);
  }
  if (typeof ref.focus === "function") {
    ref.focus();
  }
}

function handleCatalogDragStart(event, patternId) {
  event.dataTransfer.setData("text/pattern", patternId);
  event.dataTransfer.effectAllowed = "copy";
  event.currentTarget.classList.add("dragging");
}

function handleCatalogDragEnd(event) {
  event.currentTarget.classList.remove("dragging");
}

function canAcceptPattern(event) {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("text/pattern");
}

function handleMatrixDragEnter(event) {
  if (!canAcceptPattern(event)) return;
  event.preventDefault();
  event.currentTarget.classList.add("drop-ready");
}

function handleMatrixDragOver(event) {
  if (!canAcceptPattern(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function handleMatrixDragLeave(event) {
  if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) {
    return;
  }
  event.currentTarget.classList.remove("drop-ready");
}

function handleMatrixDrop(event) {
  if (!canAcceptPattern(event)) return;
  event.preventDefault();
  event.currentTarget.classList.remove("drop-ready");
  const patternId = event.dataTransfer.getData("text/pattern");
  const pattern = findPatternById(patternId);
  if (!pattern) return;
  const index = Number(event.currentTarget.dataset.index);
  if (Number.isNaN(index)) return;
  const chord = state.chords[index] || DEFAULT_CHORD;
  if (!patternFitsChord(pattern, chord)) {
    const voiceCount = getChordVoiceCount(chord);
    const expected = voiceCount >= 4 ? "4" : String(voiceCount);
    setStatus(
      `Este compás requiere un patrón de ${expected} alturas. No se aplicó ${pattern.id}.`
    );
    return;
  }
  stopPlayback(false);
  state.patternGroups[index] = pattern;
  rebuildLineNotes();
  renderMatrix();
  commitHistory();
  setStatus(`Patrón ${pattern.id} aplicado al compás ${index + 1}.`);
}

function encodeVariableLength(value) {
  const bytes = [];
  let buffer = value & 0x7f;
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }
  return bytes;
}

function createMidiFile(midiLine, bpm) {
  const tempoBpm = Math.max(1, Math.round(bpm));
  const tempo = Math.max(1, Math.round(60000000 / tempoBpm));
  const events = [
    { tick: 0, order: -1, bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff] }
  ];

  midiLine.events.forEach((event) => {
    const velocity = clamp(Math.round(event.velocity) || 0, 0, 127);
    events.push({ tick: event.startTicks, order: 0, bytes: [0x90, event.note, velocity] });
    events.push({ tick: event.startTicks + event.durationTicks, order: 1, bytes: [0x80, event.note, 0] });
  });

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const trackBytes = [];
  let lastTick = 0;
  events.forEach((event) => {
    const delta = Math.max(0, event.tick - lastTick);
    lastTick = event.tick;
    trackBytes.push(...encodeVariableLength(delta), ...event.bytes);
  });

  const endDelta = Math.max(0, midiLine.totalTicks - lastTick);
  trackBytes.push(...encodeVariableLength(endDelta), 0xff, 0x2f, 0x00);

  const trackLength = trackBytes.length;
  const header = [
    0x4d,
    0x54,
    0x68,
    0x64,
    0x00,
    0x00,
    0x00,
    0x06,
    0x00,
    0x00,
    0x00,
    0x01,
    (TICKS_PER_QUARTER >> 8) & 0xff,
    TICKS_PER_QUARTER & 0xff
  ];
  const trackHeader = [
    0x4d,
    0x54,
    0x72,
    0x6b,
    (trackLength >> 24) & 0xff,
    (trackLength >> 16) & 0xff,
    (trackLength >> 8) & 0xff,
    trackLength & 0xff
  ];

  return new Uint8Array([...header, ...trackHeader, ...trackBytes]);
}

function exportMidi() {
  const midiLine = state.midiLine;
  if (!midiLine.events.length) {
    setStatus("No hay línea para exportar.");
    return;
  }
  const bpm = Number(elements.tempo.value) || DEFAULT_BPM;
  const data = createMidiFile(midiLine, bpm);
  const blob = new Blob([data], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `voicing-line-${today}.mid`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setStatus("Archivo MIDI exportado.");
}

function createCatalogButton(pattern) {
  const item = document.createElement("button");
  item.className = "catalog-item";
  item.type = "button";
  item.setAttribute("role", "listitem");
  item.setAttribute("draggable", "true");
  item.textContent = pattern.id;
  item.title = `Usar ${pattern.id} como semilla`;
  if (state.seedPattern === pattern.id) {
    item.classList.add("active");
  }
  item.addEventListener("click", () => {
    state.seedPattern = pattern.id;
    setStatus(`Semilla seleccionada: ${pattern.id}`);
    renderCatalog();
  });
  item.addEventListener("dragstart", (event) => handleCatalogDragStart(event, pattern.id));
  item.addEventListener("dragend", handleCatalogDragEnd);
  return item;
}

function renderCatalogSection(title, patterns, gridExtraClass = "") {
  if (!elements.catalog) return;
  const section = document.createElement("div");
  section.className = "catalog-section";
  section.setAttribute("role", "group");
  section.setAttribute("aria-label", title);

  const subtitle = document.createElement("div");
  subtitle.className = "catalog-subtitle";
  subtitle.textContent = title;
  section.appendChild(subtitle);

  const grid = document.createElement("div");
  grid.className = gridExtraClass ? `catalog-grid ${gridExtraClass}` : "catalog-grid";
  grid.setAttribute("role", "list");
  patterns.forEach((pattern) => {
    grid.appendChild(createCatalogButton(pattern));
  });
  section.appendChild(grid);

  elements.catalog.appendChild(section);
}

function renderCatalog() {
  if (!elements.catalog) return;
  elements.catalog.innerHTML = "";
  renderCatalogSection("Patrones de 4 alturas", FOUR_NOTE_PATTERNS, "catalog-grid--four");
  renderCatalogSection("Patrones de 3 alturas", THREE_NOTE_PATTERNS, "catalog-grid--three");
}

function renderChords() {
  elements.chordsContainer.innerHTML = "";
  if (!state.chords.length) {
    const empty = document.createElement("span");
    empty.textContent = "Sin acordes capturados.";
    elements.chordsContainer.appendChild(empty);
    return;
  }
  state.chords.forEach((chord, index) => {
    const pill = document.createElement("div");
    pill.className = "chord-pill";
    if (state.midiArmed && state.replacementIndex === index) {
      pill.classList.add("chord-pill--editing");
    }

    const mainButton = document.createElement("button");
    mainButton.type = "button";
    mainButton.className = "chord-pill__main";
    mainButton.textContent = `${index + 1}: ${chord.map(noteNumberToName).join(" ")}`;
    mainButton.title = "Reemplazar este acorde con una nueva captura";
    mainButton.setAttribute("aria-label", `Reemplazar acorde ${index + 1}`);
    mainButton.addEventListener("click", () => startChordReplacement(index));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "chord-pill__remove";
    removeButton.textContent = "×";
    removeButton.title = "Eliminar este acorde";
    removeButton.setAttribute("aria-label", `Eliminar acorde ${index + 1}`);
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void removeChordAt(index);
    });

    pill.appendChild(mainButton);
    pill.appendChild(removeButton);
    elements.chordsContainer.appendChild(pill);
  });
}

async function startChordReplacement(index) {
  if (index < 0 || index >= state.chords.length) {
    return;
  }
  await setMidiLearnState(true, { replacementIndex: index });
}

async function removeChordAt(index) {
  if (index < 0 || index >= state.chords.length) {
    return;
  }

  state.chords.splice(index, 1);
  if (index < state.groupTranspositions.length) {
    state.groupTranspositions.splice(index, 1);
  }
  const updatedSelection = new Set();
  state.selectedPatternIndices.forEach((value) => {
    if (value === index) {
      return;
    }
    updatedSelection.add(value > index ? value - 1 : value);
  });
  state.selectedPatternIndices = updatedSelection;
  const groups = state.patternGroups.slice();
  if (index < groups.length) {
    groups.splice(index, 1);
  }
  updatePatternGroups(groups, { preserveTranspositions: true });

  if (!state.chords.length) {
    state.midiLine = EMPTY_MIDI_LINE;
  } else {
    const adjusted = ensureValidPatternsAfterCapture();
    if (!adjusted) {
      rebuildLineNotes();
    }
  }

  let disarmReplacement = false;
  if (state.replacementIndex !== null) {
    if (index === state.replacementIndex) {
      state.replacementIndex = null;
      state.pendingReplacementDisarm = false;
      disarmReplacement = true;
    } else if (index < state.replacementIndex) {
      state.replacementIndex -= 1;
    }
  }

  state.lastCapturedChordIndex = null;

  if (disarmReplacement && state.midiArmed) {
    await setMidiLearnState(false, { skipGenerate: true });
  } else {
    renderChords();
  }

  const message = state.chords.length
    ? `Acorde ${index + 1} eliminado.`
    : "Acordes borrados. No quedan capturas.";
  setStatus(message);
}

function clearChords() {
  state.chords = [];
  state.replacementIndex = null;
  state.pendingReplacementDisarm = false;
  state.lastCapturedChordIndex = null;
  renderChords();
  updatePatternGroups([]);
  state.midiLine = EMPTY_MIDI_LINE;
  state.lastCaptureTime = 0;
  setStatus("Acordes borrados.");
}

function ensureAudioContext() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return state.audioCtx;
}

function midiToFrequency(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function stopPlayback(userInitiated = true) {
  state.scheduledNodes.forEach((node) => {
    try {
      node.stop();
    } catch (_) {
      // ignore
    }
  });
  state.scheduledNodes = [];
  state.scheduledTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
  state.scheduledTimeouts = [];
  clearVirtualKeyboardPlaybackHighlights();
  setPlaybackState(false);
  sendAllNotesOff();
  if (userInitiated) {
    setStatus("Reproducción detenida.");
  }
}

function playMidiLineWithStatus(
  midiLine,
  { emptyStatus, midiStartStatus, audioStartStatus, endStatus } = {}
) {
  if (!midiLine.events.length) {
    setStatus(emptyStatus ?? "No hay línea para reproducir.");
    return;
  }
  const bpm = Number(elements.tempo.value) || DEFAULT_BPM;
  stopPlayback(false);
  const midiOutput = getSelectedMidiOutput();
  const resolvedEndStatus = endStatus ?? "Reproducción finalizada.";

  if (midiOutput) {
    setPlaybackState(true);
    scheduleMidiPlayback(midiOutput, midiLine, bpm, () => {
      setPlaybackState(false);
      if (resolvedEndStatus) {
        setStatus(resolvedEndStatus);
      }
    });
    const startMessage =
      typeof midiStartStatus === "function"
        ? midiStartStatus(midiOutput.name)
        : midiStartStatus ?? `Reproduciendo vía MIDI en ${midiOutput.name}.`;
    if (startMessage) {
      setStatus(startMessage);
    }
    return;
  }

  const audioCtx = ensureAudioContext();
  const now = audioCtx.currentTime;
  clearVirtualKeyboardPlaybackHighlights();
  let maxEndSeconds = 0;
  midiLine.events.forEach((event, index) => {
    const { startSeconds, durationSeconds } = getSwingTiming(index, bpm, state.swingPercent);
    const start = now + startSeconds;
    const duration = durationSeconds;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = midiToFrequency(event.note);
    const velocity = clamp(Math.round(event.velocity) || 0, 0, 127);
    const peakGain = 0.7 * (velocity / 127);
    const attackEnd = start + Math.min(0.03, duration * 0.3);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peakGain, attackEnd);
    gain.gain.linearRampToValueAtTime(0.0, start + duration * 0.9);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + duration);
    state.scheduledNodes.push(osc);
    maxEndSeconds = Math.max(maxEndSeconds, startSeconds + duration);

    const startMs = Math.max(0, Math.round(startSeconds * 1000));
    const durationMs = Math.max(0, Math.round(durationSeconds * 1000));
    const highlightOn = setTimeout(() => setVirtualKeyboardNotePlaying(event.note, true), startMs);
    const highlightOff = setTimeout(
      () => setVirtualKeyboardNotePlaying(event.note, false),
      startMs + durationMs
    );
    state.scheduledTimeouts.push(highlightOn, highlightOff);
  });
  const totalDurationSeconds = maxEndSeconds;
  const finishTimeout = setTimeout(() => {
    setPlaybackState(false);
    clearVirtualKeyboardPlaybackHighlights();
    if (resolvedEndStatus) {
      setStatus(resolvedEndStatus);
    }
  }, Math.max(0, Math.round(totalDurationSeconds * 1000)) + 20);
  state.scheduledTimeouts.push(finishTimeout);
  setPlaybackState(true);
  const startMessage =
    typeof audioStartStatus === "function"
      ? audioStartStatus()
      : audioStartStatus ?? "Reproduciendo línea.";
  if (startMessage) {
    setStatus(startMessage);
  }
}

function playPatternAtIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.patternGroups.length) {
    setStatus("No hay patrón disponible para reproducir en ese compás.");
    return;
  }
  const pattern = state.patternGroups[index];
  if (!pattern) {
    setStatus("No hay patrón disponible para reproducir en ese compás.");
    return;
  }
  const chord = state.chords[index] || DEFAULT_CHORD;
  const playbackTranspose = state.transposeSemitones + (state.groupTranspositions[index] || 0);
  const entries = createNoteEntriesForPattern(pattern, chord, playbackTranspose);
  if (!entries.length) {
    setStatus(`No hay notas disponibles para el compás ${index + 1}.`);
    return;
  }
  const midiLine = convertLineToMidi(entries);
  const ordinal = index + 1;
  const patternId = pattern.id;
  playMidiLineWithStatus(midiLine, {
    emptyStatus: `No hay notas disponibles para el compás ${ordinal}.`,
    midiStartStatus: (outputName) =>
      `Reproduciendo patrón ${patternId} del compás ${ordinal} vía MIDI en ${outputName}.`,
    audioStartStatus: () => `Reproduciendo patrón ${patternId} del compás ${ordinal}.`,
    endStatus: `Reproducción del patrón ${patternId} del compás ${ordinal} finalizada.`
  });
}

function playLine() {
  playMidiLineWithStatus(state.midiLine);
}

function regeneratePatternAtIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.patternGroups.length) {
    setStatus("No hay patrón disponible para regenerar en ese compás.");
    return;
  }

  const currentPattern = state.patternGroups[index];
  const chord = state.chords[index] || DEFAULT_CHORD;
  const pool = getPatternPoolForChord(chord);
  if (!pool.length) {
    setStatus("No hay variaciones disponibles para este compás.");
    return;
  }

  stopPlayback(false);

  const previousPattern = index > 0 ? state.patternGroups[index - 1] : null;
  const previousChord = index > 0 ? state.chords[index - 1] || DEFAULT_CHORD : null;
  const nextPattern = index < state.patternGroups.length - 1 ? state.patternGroups[index + 1] : null;
  const nextChord = index < state.patternGroups.length - 1 ? state.chords[index + 1] || DEFAULT_CHORD : null;

  const validPatterns = pool.filter((pattern) => {
    if (!patternFitsChord(pattern, chord)) {
      return false;
    }
    if (patternHasConsecutiveDuplicateNotes(pattern, chord)) {
      return false;
    }
    if (previousPattern) {
      const prevLastVoice = previousPattern.values[previousPattern.values.length - 1];
      const prevLastNote = getNoteFromChordVoice(prevLastVoice, previousChord);
      const firstNote = getNoteFromChordVoice(pattern.values[0], chord);
      if (prevLastNote === firstNote || !isIntervalWithinMajorSeventh(prevLastNote, firstNote)) {
        return false;
      }
    }
    if (nextPattern) {
      const lastVoice = pattern.values[pattern.values.length - 1];
      const lastNote = getNoteFromChordVoice(lastVoice, chord);
      const nextFirstNote = getNoteFromChordVoice(nextPattern.values[0], nextChord);
      if (lastNote === nextFirstNote || !isIntervalWithinMajorSeventh(lastNote, nextFirstNote)) {
        return false;
      }
    }
    return true;
  });

  if (!validPatterns.length) {
    setStatus(`No hay variaciones compatibles para el compás ${index + 1}.`);
    return;
  }

  const alternatives = currentPattern
    ? validPatterns.filter((pattern) => pattern !== currentPattern)
    : validPatterns;
  const candidates = alternatives.length ? alternatives : validPatterns;
  if (!candidates.length) {
    setStatus(`No hay variaciones compatibles para el compás ${index + 1}.`);
    return;
  }

  const replacement = randomChoice(candidates);
  if (replacement === currentPattern) {
    setStatus(`El compás ${index + 1} ya usa la única opción compatible disponible.`);
    return;
  }

  state.patternGroups[index] = replacement;
  rebuildLineNotes();
  renderMatrix();
  commitHistory();
  setStatus(`Variación aplicada: patrón ${replacement.id} en el compás ${index + 1}.`);
}

function handlePlaybackToggle() {
  if (state.isPlaying) {
    stopPlayback(true);
  } else {
    playLine();
  }
}

function shouldIgnoreSpaceToggleTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tagName)) {
    return true;
  }
  const role = target.getAttribute("role");
  const interactiveRoles = new Set([
    "button",
    "checkbox",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "radio",
    "slider",
    "switch",
    "tab",
    "textbox",
    "treeitem"
  ]);
  if (role && interactiveRoles.has(role)) {
    return true;
  }
  return false;
}

function handleVirtualKeyboardSpace(event) {
  if (!elements.virtualKeyboard) {
    return false;
  }
  const target = event.target;
  const withinKeyboard =
    target instanceof HTMLElement && elements.virtualKeyboard.contains(target);
  if (!withinKeyboard && shouldIgnoreSpaceToggleTarget(target)) {
    return false;
  }
  if (state.virtualKeyboardPendingNotes.size === 0) {
    return false;
  }
  if (state.virtualKeyboardPendingNotes.size < 3) {
    setStatus("Selecciona al menos 3 notas para guardar un grupo.");
    return true;
  }
  commitVirtualKeyboardChord();
  return true;
}

function handleGlobalKeydown(event) {
  if (event.code !== "Space" && event.key !== " ") {
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) {
    return;
  }
  if (handleVirtualKeyboardSpace(event)) {
    event.preventDefault();
    return;
  }
  if (shouldIgnoreSpaceToggleTarget(event.target)) {
    return;
  }
  event.preventDefault();
  handlePlaybackToggle();
}

function handleMidiMessage(event) {
  const [statusByte, note, velocity] = event.data;
  const command = statusByte & 0xf0;
  if (command === 0x90 && velocity > 0) {
    onNoteOn(note);
  } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
    onNoteOff(note);
  }
}

function onNoteOn(note) {
  setVirtualKeyboardNotePlaying(note, true);
  if (!state.midiArmed) return;
  const now = performance.now();
  state.captureQueue.push({ note, time: now });
  state.activeNotes.add(note);
  if (state.awaitingRelease) {
    if (extendCapturedChordIfNeeded(note, now)) {
      state.captureQueue = [];
    }
    return;
  }

  const { uniqueNotes, filteredQueue } = collectUniqueActiveNotes(
    state.captureQueue,
    state.activeNotes
  );
  state.captureQueue = filteredQueue;

  const capture = buildChordFromUniqueNotes(uniqueNotes);
  if (!capture) {
    return;
  }

  const { chord, voiceCount, captureTime } = capture;
  let targetIndex = null;
  if (state.replacementIndex !== null && state.replacementIndex >= 0 && state.replacementIndex < state.chords.length) {
    targetIndex = state.replacementIndex;
    state.chords[targetIndex] = chord;
  } else {
    state.chords.push(chord);
    targetIndex = state.chords.length - 1;
  }
  state.lastCapturedChordIndex = targetIndex;
  state.lastCaptureTime = captureTime;
  renderChords();
  const adjusted = ensureValidPatternsAfterCapture();
  if (!adjusted) {
    rebuildLineNotes();
    commitHistory();
  }
  const prefix =
    state.replacementIndex !== null && state.replacementIndex === targetIndex
      ? "Acorde reemplazado"
      : "Acorde capturado";
  const baseMessage =
    voiceCount === 3
      ? `${prefix} (3 alturas): ${chord.map(noteNumberToName).join(" ")}`
      : `${prefix}: ${chord.map(noteNumberToName).join(" ")}`;
  setStatus(
    adjusted
      ? `${baseMessage}. Patrones ajustados para evitar notas consecutivas repetidas.`
      : baseMessage
  );
  state.awaitingRelease = true;
  state.captureQueue = [];
  if (state.replacementIndex !== null) {
    state.pendingReplacementDisarm = true;
  }
}

function extendCapturedChordIfNeeded(note, time) {
  const lastIndex = state.lastCapturedChordIndex;
  if (lastIndex === null || lastIndex < 0 || lastIndex >= state.chords.length) {
    return false;
  }
  const lastChord = state.chords[lastIndex];
  if (!lastChord) {
    return false;
  }
  const result = extendChordWithNote(lastChord, note, time, state.lastCaptureTime, {
    extensionWindowMs: CAPTURE_EXTENSION_WINDOW_MS
  });
  if (!result.extended) {
    return false;
  }

  state.chords[lastIndex] = result.chord;
  state.lastCaptureTime = result.captureTime;
  renderChords();
  const adjusted = ensureValidPatternsAfterCapture();
  if (!adjusted) {
    rebuildLineNotes();
    commitHistory();
  }
  const prefix = state.replacementIndex !== null ? "Acorde reemplazado" : "Acorde actualizado";
  const baseMessage =
    result.voiceCount === 3
      ? `${prefix} (3 alturas): ${result.chord.map(noteNumberToName).join(" ")}`
      : `${prefix} a ${result.voiceCount} notas: ${result.chord
          .map(noteNumberToName)
          .join(" ")}`;
  setStatus(
    adjusted
      ? `${baseMessage}. Patrones ajustados para evitar notas consecutivas repetidas.`
      : baseMessage
  );
  return true;
}

async function onNoteOff(note) {
  setVirtualKeyboardNotePlaying(note, false);
  if (!state.midiArmed) return;
  state.activeNotes.delete(note);
  state.captureQueue = state.captureQueue.filter((item) => item.note !== note);
  if (state.awaitingRelease && state.activeNotes.size === 0) {
    state.awaitingRelease = false;
    if (state.pendingReplacementDisarm && state.replacementIndex !== null) {
      state.pendingReplacementDisarm = false;
      await setMidiLearnState(false, { skipGenerate: true });
    }
  }
}

async function setMidiLearnState(armed, { replacementIndex = null, skipGenerate = false } = {}) {
  if (elements.midiLearn) {
    elements.midiLearn.disabled = true;
  }

  try {
    const access = await ensureMidiAccess();
    if (!access) {
      state.midiArmed = false;
      state.replacementIndex = null;
      state.lastCapturedChordIndex = null;
      state.pendingReplacementDisarm = false;
      state.captureQueue = [];
      state.awaitingRelease = false;
      state.activeNotes.clear();
      updateMidiInputListeners();
      updateMidiLearnButton();
      renderChords();
      return false;
    }

    state.midiArmed = armed;
    state.captureQueue = [];
    state.awaitingRelease = false;
    state.activeNotes.clear();
    state.lastCaptureTime = 0;
    state.lastCapturedChordIndex = null;
    state.replacementIndex = armed ? replacementIndex : null;
    state.pendingReplacementDisarm = false;

    updateMidiInputListeners();
    updateMidiLearnButton();
    refreshMidiOutputs();

    if (state.midiArmed) {
      const hasInputs = access.inputs.size > 0;
      if (state.replacementIndex !== null) {
        const chordNumber = state.replacementIndex + 1;
        setStatus(
          hasInputs
            ? `MIDI Learn encendido para reemplazar el acorde ${chordNumber}. Toca 3 o 4 notas simultáneas.`
            : `MIDI Learn encendido para reemplazar el acorde ${chordNumber}, pero no se detectan entradas MIDI.`
        );
      } else {
        setStatus(
          hasInputs
            ? "MIDI Learn encendido. Captura acordes de 4 notas o de 3 alturas."
            : "MIDI Learn encendido. No se detectan entradas MIDI."
        );
      }
    } else {
      state.replacementIndex = null;
      if (!skipGenerate) {
        const result = generateLineFromCapturedChords();
        if (result.success) {
          setStatus(
            `MIDI Learn apagado. Línea generada automáticamente para ${state.chords.length} acordes.`
          );
        } else if (result.reason === "empty") {
          setStatus("MIDI Learn apagado. Captura acordes para generar la línea.");
        } else {
          setStatus(
            "MIDI Learn apagado. No fue posible generar una línea con los acordes capturados."
          );
        }
      }
    }

    renderChords();
    return true;
  } finally {
    if (elements.midiLearn) {
      elements.midiLearn.disabled = false;
    }
  }
}

async function toggleMidiLearn() {
  await setMidiLearnState(!state.midiArmed);
}

function isIntervalWithinMajorSeventh(noteA, noteB) {
  const interval = Math.abs(noteA - noteB);
  return interval <= 11;
}

function patternsHaveValidBoundaries(groups, chords) {
  if (!groups.length) return true;
  for (let i = 0; i < groups.length - 1; i++) {
    const currentPattern = groups[i];
    const nextPattern = groups[i + 1];
    const currentChord = chords[i] || DEFAULT_CHORD;
    const nextChord = chords[i + 1] || DEFAULT_CHORD;
    const lastNote = getNoteFromChordVoice(currentPattern.values[3], currentChord);
    const firstNoteNext = getNoteFromChordVoice(nextPattern.values[0], nextChord);
    if (lastNote === firstNoteNext || !isIntervalWithinMajorSeventh(lastNote, firstNoteNext)) {
      return false;
    }
  }
  return true;
}

function patternHasConsecutiveDuplicateNotes(pattern, chord) {
  const sortedChord = getSortedChord(chord);
  const notes = pattern.values.map((voice) => getNoteFromSortedChordVoice(voice, sortedChord));
  for (let i = 1; i < notes.length; i++) {
    if (notes[i] === notes[i - 1]) {
      return true;
    }
  }
  return false;
}

function sequenceAvoidsConsecutiveDuplicateNotes(sequence, chords) {
  let previousNote = null;
  for (let i = 0; i < sequence.length; i++) {
    const chord = chords[i] || DEFAULT_CHORD;
    const sortedChord = getSortedChord(chord);
    for (const voice of sequence[i].values) {
      const note = getNoteFromSortedChordVoice(voice, sortedChord);
      if (previousNote !== null && note === previousNote) {
        return false;
      }
      previousNote = note;
    }
  }
  return true;
}

function buildSequenceWithConstraints(chords, seed, enforceSeed) {
  const count = chords.length;
  const sequence = new Array(count);
  const seedPattern = findPatternById(seed);

  function isPatternValidAtIndex(pattern, index) {
    const chord = chords[index] || DEFAULT_CHORD;
    if (!patternFitsChord(pattern, chord)) {
      return false;
    }
    if (patternHasConsecutiveDuplicateNotes(pattern, chord)) {
      return false;
    }
    if (index === 0) return true;
    const prevPattern = sequence[index - 1];
    const prevChord = chords[index - 1] || DEFAULT_CHORD;
    const lastNote = getNoteFromChordVoice(prevPattern.values[3], prevChord);
    const firstNoteNext = getNoteFromChordVoice(pattern.values[0], chord);
    if (lastNote === firstNoteNext || !isIntervalWithinMajorSeventh(lastNote, firstNoteNext)) {
      return false;
    }
    return true;
  }

  function dfs(index) {
    if (index === count) {
      return true;
    }

    const chord = chords[index] || DEFAULT_CHORD;
    const pool = getPatternPoolForChord(chord);
    let candidates = pool;
    if (index === 0 && seedPattern && patternFitsChord(seedPattern, chord)) {
      if (enforceSeed) {
        candidates = [seedPattern];
      } else if (!sequence[0]) {
        candidates = [seedPattern, ...pool.filter((p) => p !== seedPattern)];
      }
    }

    for (const pattern of candidates) {
      if (!isPatternValidAtIndex(pattern, index)) continue;
      sequence[index] = pattern;
      if (dfs(index + 1)) {
        return true;
      }
    }
    sequence[index] = null;
    return false;
  }

  return dfs(0) ? sequence.slice() : null;
}

function patternsFitChords(groups, chords) {
  for (let i = 0; i < groups.length; i++) {
    const chord = chords[i] || DEFAULT_CHORD;
    if (!patternFitsChord(groups[i], chord)) {
      return false;
    }
  }
  return true;
}

function generateRandomSequenceForChords(chords, seed) {
  const count = chords.length;
  if (!count) return [];
  const sequence = new Array(count);
  const firstChord = chords[0] || DEFAULT_CHORD;
  let firstPattern = findPatternById(seed);
  if (!patternFitsChord(firstPattern, firstChord) || !firstPattern) {
    firstPattern = randomChoice(getPatternPoolForChord(firstChord));
  }
  sequence[0] = firstPattern;

  for (let i = 1; i < count; i++) {
    const chord = chords[i] || DEFAULT_CHORD;
    const pool = getPatternPoolForChord(chord);
    const previous = sequence[i - 1];
    const filtered = pool.filter((pattern) => previous.values[3] !== pattern.values[0]);
    const available = filtered.length ? filtered : pool;
    sequence[i] = randomChoice(available);
  }

  return sequence;
}

function generateValidSequenceForChords(chords, seed) {
  const count = chords.length;
  if (!count) return [];
  const maxAttempts = 500;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const sequence = generateRandomSequenceForChords(chords, seed);
    if (
      patternsFitChords(sequence, chords) &&
      patternsHaveValidBoundaries(sequence, chords) &&
      sequenceAvoidsConsecutiveDuplicateNotes(sequence, chords)
    ) {
      return sequence;
    }
  }
  const enforcedSeed = buildSequenceWithConstraints(chords, seed, true);
  if (enforcedSeed && patternsFitChords(enforcedSeed, chords)) {
    return enforcedSeed;
  }
  const flexibleSeed = buildSequenceWithConstraints(chords, seed, false);
  if (flexibleSeed && patternsFitChords(flexibleSeed, chords)) {
    return flexibleSeed;
  }
  const fallback = generateRandomSequenceForChords(chords, null);
  if (
    patternsFitChords(fallback, chords) &&
    patternsHaveValidBoundaries(fallback, chords) &&
    sequenceAvoidsConsecutiveDuplicateNotes(fallback, chords)
  ) {
    return fallback;
  }
  return [];
}

function generateLineFromCapturedChords() {
  if (!state.chords.length) {
    updatePatternGroups([]);
    state.midiLine = EMPTY_MIDI_LINE;
    return { success: false, reason: "empty" };
  }
  const groups = generateValidSequenceForChords(state.chords, state.seedPattern);
  if (!groups.length) {
    return { success: false, reason: "invalid" };
  }
  updatePatternGroups(groups);
  return { success: true, groups };
}

function regenerateLineFromChords() {
  stopPlayback(false);
  if (!state.chords.length) {
    setStatus("No hay acordes capturados. Usa MIDI Learn para generar la línea.");
    return;
  }
  const result = generateLineFromCapturedChords();
  if (result.success) {
    setStatus(`Nueva línea generada para ${state.chords.length} acordes.`);
    return;
  }
  if (result.reason === "invalid") {
    setStatus("No fue posible generar una nueva línea con los acordes actuales.");
    return;
  }
  setStatus("No hay acordes capturados. Captura acordes para generar la línea.");
}

function ensureValidPatternsAfterCapture() {
  if (!state.patternGroups.length) return false;
  if (state.patternGroups.length !== state.chords.length) return false;
  if (
    patternsFitChords(state.patternGroups, state.chords) &&
    patternsHaveValidBoundaries(state.patternGroups, state.chords) &&
    sequenceAvoidsConsecutiveDuplicateNotes(state.patternGroups, state.chords)
  ) {
    return false;
  }
  const sequence = generateValidSequenceForChords(state.chords, state.seedPattern);
  if (!sequence.length) return false;
  updatePatternGroups(sequence);
  return true;
}

function attachEvents() {
  if (elements.undoAction) {
    elements.undoAction.addEventListener("click", undoLastAction);
  }
  if (elements.redoAction) {
    elements.redoAction.addEventListener("click", redoLastAction);
  }
  if (elements.transposeDownSemitone) {
    elements.transposeDownSemitone.addEventListener("click", () => changeTranspose(-1));
  }
  if (elements.transposeUpSemitone) {
    elements.transposeUpSemitone.addEventListener("click", () => changeTranspose(1));
  }
  if (elements.transposeDownOctave) {
    elements.transposeDownOctave.addEventListener("click", () => changeTranspose(-12));
  }
  if (elements.transposeUpOctave) {
    elements.transposeUpOctave.addEventListener("click", () => changeTranspose(12));
  }
  if (elements.transposeReset) {
    elements.transposeReset.addEventListener("click", () => setTransposeSemitones(0));
  }
  if (elements.matrixClearSelection) {
    elements.matrixClearSelection.addEventListener("click", () =>
      clearMatrixSelection({ announce: true })
    );
  }
  if (elements.matrixTransposeDownSemitone) {
    elements.matrixTransposeDownSemitone.addEventListener("click", () => transposeSelectedGroups(-1));
  }
  if (elements.matrixTransposeUpSemitone) {
    elements.matrixTransposeUpSemitone.addEventListener("click", () => transposeSelectedGroups(1));
  }
  if (elements.matrixTransposeDownOctave) {
    elements.matrixTransposeDownOctave.addEventListener("click", () => transposeSelectedGroups(-12));
  }
  if (elements.matrixTransposeUpOctave) {
    elements.matrixTransposeUpOctave.addEventListener("click", () => transposeSelectedGroups(12));
  }
  if (elements.matrixTransposeReset) {
    elements.matrixTransposeReset.addEventListener("click", resetSelectedGroupTranspositions);
  }
  if (elements.viewTransposeButtons && elements.viewTransposeButtons.length) {
    elements.viewTransposeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const value = Number(button.dataset.transposeDisplay || "0");
        setDisplayTransposeSemitones(value);
      });
    });
  }
  if (elements.playToggle) {
    elements.playToggle.addEventListener("click", handlePlaybackToggle);
  }
  if (elements.newLine) {
    elements.newLine.addEventListener("click", regenerateLineFromChords);
  }
  if (elements.exportMidi) {
    elements.exportMidi.addEventListener("click", exportMidi);
  }
  if (elements.patternDictionaryButton) {
    elements.patternDictionaryButton.addEventListener("click", openPatternDictionaryWindow);
  }
  elements.midiLearn.addEventListener("click", toggleMidiLearn);
  elements.clearChords.addEventListener("click", clearChords);
  if (elements.enharmonicToggle) {
    elements.enharmonicToggle.addEventListener("click", toggleEnharmonicMode);
  }
  if (elements.clefToggle) {
    elements.clefToggle.addEventListener("click", toggleClef);
  }
  if (elements.midiOutput) {
    elements.midiOutput.addEventListener("change", handleMidiOutputChange);
  }
  if (elements.refreshMidiOutputs) {
    elements.refreshMidiOutputs.addEventListener("click", () => refreshMidiOutputs(true));
  }
  document.addEventListener("keydown", handleGlobalKeydown);
  if (elements.panelResizers.length) {
    elements.panelResizers.forEach((resizer) => {
      resizer.addEventListener("pointerdown", handlePanelResizePointerDown);
      resizer.addEventListener("dblclick", handlePanelResizeDoubleClick);
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleWindowResize);
  }
}

buildVirtualKeyboard();
renderCatalog();
renderMatrix();
renderChords();
updateMidiLearnButton();
updatePlayToggleButton();
updateViewTransposeButtons();
updateEnharmonicToggle();
updateClefToggle();
updateMatrixSelectionSummary();
initializeHistory();
attachEvents();
refreshMidiOutputs();
