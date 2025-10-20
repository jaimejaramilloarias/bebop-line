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

const state = {
  patternGroups: [],
  seedPattern: null,
  chords: [],
  noteEntries: [],
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
  transposeSemitones: 0
};

const elements = {
  catalog: document.querySelector(".catalog-collections"),
  matrix: document.querySelector(".matrix"),
  tempo: document.getElementById("tempo"),
  swing: document.getElementById("swing"),
  transposeValue: document.getElementById("transpose-value"),
  transposeDownSemitone: document.getElementById("transpose-down-semitone"),
  transposeUpSemitone: document.getElementById("transpose-up-semitone"),
  transposeDownOctave: document.getElementById("transpose-down-octave"),
  transposeUpOctave: document.getElementById("transpose-up-octave"),
  transposeReset: document.getElementById("transpose-reset"),
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
  scoreViewer: document.getElementById("score-viewer")
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

function setTransposeSemitones(value, { announce = true } = {}) {
  const normalized = clamp(Math.round(value) || 0, -TRANSPOSE_LIMIT, TRANSPOSE_LIMIT);
  if (normalized === state.transposeSemitones) {
    updateTransposeDisplay();
    return state.transposeSemitones;
  }
  stopPlayback(false);
  state.transposeSemitones = normalized;
  updateTransposeDisplay();
  rebuildLineNotes();
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

function setPlaybackState(playing) {
  state.isPlaying = playing;
  updatePlayToggleButton();
}

function updatePlayToggleButton() {
  if (!elements.playToggle) return;
  elements.playToggle.textContent = state.isPlaying ? "Detener" : "Reproducir";
  elements.playToggle.setAttribute("aria-pressed", String(state.isPlaying));
  elements.playToggle.classList.toggle("primary", !state.isPlaying);
  elements.playToggle.title = state.isPlaying
    ? "Detener reproducción"
    : "Reproducir línea generada";
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
    return;
  }
  const output = state.midiAccess.outputs.get(state.playingMidiOutputId);
  if (!output) {
    state.activePlaybackNotes.clear();
    state.playingMidiOutputId = null;
    return;
  }
  state.activePlaybackNotes.forEach((note) => {
    output.send([0x80, note, 0]);
  });
  output.send([0xb0, 0x7b, 0x00]);
  state.activePlaybackNotes.clear();
  state.playingMidiOutputId = null;
}

function scheduleMidiPlayback(midiOutput, midiLine, bpm, onComplete) {
  state.activePlaybackNotes.clear();
  state.playingMidiOutputId = midiOutput.id;

  let maxEndMs = 0;
  midiLine.events.forEach((event, index) => {
    const { startSeconds, durationSeconds } = getSwingTiming(index, bpm, state.swingPercent);
    const startDelay = Math.max(0, Math.round(startSeconds * 1000));
    const durationDelay = Math.max(0, Math.round(durationSeconds * 1000));
    const velocity = clamp(Math.round(event.velocity) || 0, 0, 127);

    const noteOnTimeout = setTimeout(() => {
      midiOutput.send([0x90, event.note, velocity]);
      state.activePlaybackNotes.add(event.note);
    }, startDelay);

    const noteOffTimeout = setTimeout(() => {
      midiOutput.send([0x80, event.note, 0]);
      state.activePlaybackNotes.delete(event.note);
    }, startDelay + durationDelay);

    maxEndMs = Math.max(maxEndMs, startDelay + durationDelay);
    state.scheduledTimeouts.push(noteOnTimeout, noteOffTimeout);
  });

  const cleanupDelay = Math.max(0, Math.round(maxEndMs) + 20);
  const cleanupTimeout = setTimeout(() => {
    state.activePlaybackNotes.clear();
    state.playingMidiOutputId = null;
    if (typeof onComplete === "function") {
      onComplete();
    }
  }, cleanupDelay);
  state.scheduledTimeouts.push(cleanupTimeout);
}

function updateMidiLearnButton() {
  if (!elements.midiLearn) return;
  elements.midiLearn.classList.toggle("active", state.midiArmed);
  elements.midiLearn.classList.toggle("primary", state.midiArmed);
  elements.midiLearn.setAttribute("aria-pressed", String(state.midiArmed));
  const stateLabel = elements.midiLearn.querySelector(".state");
  if (stateLabel) {
    stateLabel.textContent = state.midiArmed ? "(encendido)" : "(apagado)";
  }
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

function updatePatternGroups(groups) {
  state.patternGroups = groups;
  rebuildLineNotes();
  renderMatrix();
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
  const noteEntries = [];
  const accentIndices = [];
  let globalIndex = 0;
  const totalGroups = state.patternGroups.length;
  for (let i = 0; i < totalGroups; i++) {
    const pattern = state.patternGroups[i];
    const chord = state.chords[i] || DEFAULT_CHORD;
    const entries = createNoteEntriesForPattern(pattern, chord);
    if (pattern && Array.isArray(pattern.values) && pattern.values.length === 4) {
      const maxVoice = pattern.values.reduce((max, value) => Math.max(max, value), 0);
      const accentOffset = pattern.values.findIndex((voice) => voice === maxVoice);
      if (accentOffset >= 0 && accentOffset < entries.length) {
        accentIndices.push(globalIndex + accentOffset);
      }
    }
    noteEntries.push(...entries);
    globalIndex += entries.length;
  }
  state.noteEntries = noteEntries;
  state.accentNoteIndices = accentIndices;
  state.lineNotes = noteEntries.map((entry) => entry.note);
  state.midiLine = noteEntries.length ? convertLineToMidi(noteEntries) : EMPTY_MIDI_LINE;
  renderScore(noteEntries, accentIndices);
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

function createRestNote(VF) {
  return new VF.StaveNote({ clef: "treble", keys: ["b/4"], duration: "8r" });
}

function createStaveNoteFromMidi(VF, midi, accent = false, accidentalOverride) {
  const { key, accidental } = midiNoteToVexFlowKey(midi);
  const note = new VF.StaveNote({ clef: "treble", keys: [key], duration: "8" });
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

  const measuresPerRow = 1;
  const staveWidth = 320;
  const staveHeight = 120;
  const measureSpacing = 12;
  const rowSpacing = 48;
  const horizontalPadding = 24;
  const verticalPadding = 30;
  const bottomPadding = 30;
  const totalMeasures = measures.length;
  const rows = Math.ceil(totalMeasures / measuresPerRow);
  const columns = Math.min(totalMeasures, measuresPerRow);
  const width =
    columns * staveWidth + Math.max(columns - 1, 0) * measureSpacing + horizontalPadding * 2;
  const height =
    rows * staveHeight + Math.max(rows - 1, 0) * rowSpacing + verticalPadding + bottomPadding;

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
    if (index === 0) {
      stave.addClef("treble").addTimeSignature("4/4");
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
        return createRestNote(VF);
      }
      const { key, accidental: defaultAccidental } = midiNoteToVexFlowKey(entry.midi);
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

      return createStaveNoteFromMidi(VF, entry.midi, entry.accent, accidentalOverride);
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
    formatter.joinVoices([voice]).format([voice], staveWidth - 36);
    voice.draw(context, stave);
    beams.forEach((beam) => beam.setContext(context).draw());
  });
}

function renderMatrix() {
  elements.matrix.innerHTML = "";
  if (state.patternGroups.length === 0) {
    const empty = document.createElement("p");
    empty.textContent =
      "Captura acordes con MIDI Learn para ver la matriz y arrastra una muestra sobre un compás para ajustar su orden.";
    elements.matrix.appendChild(empty);
    return;
  }
  for (let i = 0; i < state.patternGroups.length; i += 4) {
    const rowEl = document.createElement("div");
    rowEl.className = "matrix-row";
    const rowEnd = Math.min(i + 4, state.patternGroups.length);
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

      rowEl.appendChild(groupEl);
    }
    elements.matrix.appendChild(rowEl);
  }
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteNumberToName(note) {
  const name = NOTE_NAMES[note % 12];
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
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
  state.patternGroups[index] = pattern;
  rebuildLineNotes();
  renderMatrix();
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
  const groups = state.patternGroups.slice();
  if (index < groups.length) {
    groups.splice(index, 1);
  }
  updatePatternGroups(groups);

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
  });
  const totalDurationSeconds = maxEndSeconds;
  const finishTimeout = setTimeout(() => {
    setPlaybackState(false);
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
  const entries = createNoteEntriesForPattern(pattern, chord);
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

function handleGlobalKeydown(event) {
  if (event.code !== "Space" && event.key !== " ") {
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) {
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
  if (elements.playToggle) {
    elements.playToggle.addEventListener("click", handlePlaybackToggle);
  }
  if (elements.newLine) {
    elements.newLine.addEventListener("click", regenerateLineFromChords);
  }
  if (elements.exportMidi) {
    elements.exportMidi.addEventListener("click", exportMidi);
  }
  elements.midiLearn.addEventListener("click", toggleMidiLearn);
  elements.clearChords.addEventListener("click", clearChords);
  if (elements.midiOutput) {
    elements.midiOutput.addEventListener("change", handleMidiOutputChange);
  }
  if (elements.refreshMidiOutputs) {
    elements.refreshMidiOutputs.addEventListener("click", () => refreshMidiOutputs(true));
  }
  document.addEventListener("keydown", handleGlobalKeydown);
}

renderCatalog();
renderMatrix();
renderChords();
updateMidiLearnButton();
updatePlayToggleButton();
attachEvents();
refreshMidiOutputs();
