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
const DEFAULT_BPM = 240;

const NOTES_PER_MEASURE = 8;
const TICKS_PER_QUARTER = 480;
const TICKS_PER_EIGHTH = TICKS_PER_QUARTER / 2;
const EMPTY_MIDI_LINE = { events: [], measures: 0, totalTicks: 0 };

const state = {
  patternGroups: [],
  seedPattern: null,
  chords: [],
  lineNotes: [],
  midiLine: EMPTY_MIDI_LINE,
  midiAccess: null,
  midiArmed: false,
  captureQueue: [],
  awaitingRelease: false,
  activeNotes: new Set(),
  scheduledNodes: [],
  scheduledTimeouts: [],
  activePlaybackNotes: new Set(),
  playingMidiOutputId: null,
  selectedMidiOutputId: "",
  audioCtx: null
};

const elements = {
  catalog: document.querySelector(".catalog-collections"),
  matrix: document.querySelector(".matrix"),
  tempo: document.getElementById("tempo"),
  tempoValue: document.getElementById("tempo-value"),
  play: document.getElementById("play-line"),
  stop: document.getElementById("stop-line"),
  exportMidi: document.getElementById("export-midi"),
  midiLearn: document.getElementById("midi-learn"),
  clearChords: document.getElementById("clear-chords"),
  midiOutput: document.getElementById("midi-output"),
  refreshMidiOutputs: document.getElementById("refresh-midi-outputs"),
  chordsContainer: document.querySelector(".captured-chords"),
  status: document.getElementById("status"),
  themeToggle: document.getElementById("theme-toggle")
};

if (elements.tempo) {
  elements.tempo.value = String(DEFAULT_BPM);
}
if (elements.tempoValue) {
  elements.tempoValue.textContent = `${DEFAULT_BPM} BPM`;
}

function setStatus(message) {
  elements.status.textContent = message;
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

function scheduleMidiPlayback(midiOutput, midiLine, bpm) {
  const msPerTick = ((60 / bpm) / TICKS_PER_QUARTER) * 1000;
  state.activePlaybackNotes.clear();
  state.playingMidiOutputId = midiOutput.id;

  midiLine.events.forEach((event) => {
    const startDelay = Math.max(0, Math.round(event.startTicks * msPerTick));
    const durationDelay = Math.max(0, Math.round(event.durationTicks * msPerTick));

    const noteOnTimeout = setTimeout(() => {
      midiOutput.send([0x90, event.note, 100]);
      state.activePlaybackNotes.add(event.note);
    }, startDelay);

    const noteOffTimeout = setTimeout(() => {
      midiOutput.send([0x80, event.note, 0]);
      state.activePlaybackNotes.delete(event.note);
    }, startDelay + durationDelay);

    state.scheduledTimeouts.push(noteOnTimeout, noteOffTimeout);
  });

  const cleanupDelay = Math.max(0, Math.round(midiLine.totalTicks * msPerTick) + 20);
  const cleanupTimeout = setTimeout(() => {
    state.activePlaybackNotes.clear();
    state.playingMidiOutputId = null;
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
  elements.tempo.addEventListener("input", (event) => {
    const bpm = Number(event.target.value);
    elements.tempoValue.textContent = `${bpm} BPM`;
  });
}

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function findPatternById(id) {
  if (!id) return null;
  return PATTERN_LOOKUP.get(id) || null;
}

function getChordVoiceCount(chord) {
  const source = chord && chord.length ? chord : DEFAULT_CHORD;
  const unique = new Set(source);
  if (unique.size) {
    return unique.size;
  }
  return Math.min(source.length || 0, 4) || 1;
}

function getPatternPoolForChord(chord) {
  return getChordVoiceCount(chord) <= 3 ? THREE_NOTE_PATTERNS : FOUR_NOTE_PATTERNS;
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

function rebuildLineNotes() {
  const notes = [];
  const totalGroups = state.patternGroups.length;
  for (let i = 0; i < totalGroups; i++) {
    const pattern = state.patternGroups[i];
    const chord = state.chords[i] || DEFAULT_CHORD;
    const sortedChord = getSortedChord(chord);
    pattern.values.forEach((voice) => {
      notes.push(getNoteFromSortedChordVoice(voice, sortedChord));
    });
  }
  state.lineNotes = notes;
  state.midiLine = convertLineToMidi(notes);
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

function convertLineToMidi(notes) {
  const events = notes.map((note, index) => ({
    note,
    startTicks: index * TICKS_PER_EIGHTH,
    durationTicks: TICKS_PER_EIGHTH
  }));
  const measures = Math.ceil(notes.length / NOTES_PER_MEASURE);
  const totalTicks = events.length ? events[events.length - 1].startTicks + TICKS_PER_EIGHTH : 0;
  return { events, measures, totalTicks };
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
    events.push({ tick: event.startTicks, order: 0, bytes: [0x90, event.note, 100] });
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
    const pill = document.createElement("span");
    pill.className = "chord-pill";
    pill.textContent = `${index + 1}: ${chord.map(noteNumberToName).join(" ")}`;
    elements.chordsContainer.appendChild(pill);
  });
}

function clearChords() {
  state.chords = [];
  renderChords();
  updatePatternGroups([]);
  state.midiLine = EMPTY_MIDI_LINE;
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
  sendAllNotesOff();
  if (userInitiated) {
    setStatus("Reproducción detenida.");
  }
}

function playLine() {
  const midiLine = state.midiLine;
  if (!midiLine.events.length) {
    setStatus("No hay línea para reproducir.");
    return;
  }
  const bpm = Number(elements.tempo.value) || DEFAULT_BPM;
  stopPlayback(false);
  const midiOutput = getSelectedMidiOutput();
  if (midiOutput) {
    scheduleMidiPlayback(midiOutput, midiLine, bpm);
    setStatus(`Reproduciendo vía MIDI en ${midiOutput.name}.`);
    return;
  }

  const audioCtx = ensureAudioContext();
  const now = audioCtx.currentTime;
  const secondsPerTick = (60 / bpm) / TICKS_PER_QUARTER;
  midiLine.events.forEach((event) => {
    const start = now + event.startTicks * secondsPerTick;
    const duration = event.durationTicks * secondsPerTick;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = midiToFrequency(event.note);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.7, start + 0.01);
    gain.gain.linearRampToValueAtTime(0.0, start + duration * 0.9);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + duration);
    state.scheduledNodes.push(osc);
  });
  setStatus("Reproduciendo línea.");
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
  state.captureQueue = state.captureQueue.filter((item) => now - item.time < 220);
  state.captureQueue.push({ note, time: now });
  state.activeNotes.add(note);
  if (state.awaitingRelease) return;
  const uniqueMap = new Map();
  state.captureQueue.forEach((item) => uniqueMap.set(item.note, item));
  const uniqueNotes = Array.from(uniqueMap.values())
    .sort((a, b) => a.time - b.time)
    .slice(-4);
  if (uniqueNotes.length >= 3) {
    const capturedNotes = uniqueNotes.map((item) => item.note);
    const chord = capturedNotes.slice(-4);
    state.chords.push(chord);
    renderChords();
    const adjusted = ensureValidPatternsAfterCapture();
    if (!adjusted) {
      rebuildLineNotes();
    }
    const originalLength = uniqueNotes.length;
    const baseMessage =
      originalLength === 3
        ? `Acorde capturado (3 alturas): ${chord.map(noteNumberToName).join(" ")}`
        : `Acorde capturado: ${chord.map(noteNumberToName).join(" ")}`;
    setStatus(
      adjusted
        ? `${baseMessage}. Patrones ajustados para evitar notas consecutivas repetidas.`
        : baseMessage
    );
    state.awaitingRelease = true;
    state.captureQueue = [];
  }
}

function onNoteOff(note) {
  if (!state.midiArmed) return;
  state.activeNotes.delete(note);
  if (state.awaitingRelease && state.activeNotes.size === 0) {
    state.awaitingRelease = false;
  }
}

async function toggleMidiLearn() {
  if (elements.midiLearn) {
    elements.midiLearn.disabled = true;
  }

  try {
    const access = await ensureMidiAccess();
    if (!access) {
      return;
    }

    state.midiArmed = !state.midiArmed;
    state.captureQueue = [];
    state.awaitingRelease = false;
    state.activeNotes.clear();

    updateMidiInputListeners();
    updateMidiLearnButton();
    refreshMidiOutputs();

    if (state.midiArmed) {
      const hasInputs = access.inputs.size > 0;
      setStatus(
        hasInputs
          ? "MIDI Learn encendido. Captura acordes de 4 notas o de 3 alturas."
          : "MIDI Learn encendido. No se detectan entradas MIDI."
      );
    } else {
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
  } finally {
    if (elements.midiLearn) {
      elements.midiLearn.disabled = false;
    }
  }
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
  elements.play.addEventListener("click", playLine);
  elements.stop.addEventListener("click", () => stopPlayback(true));
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
}

renderCatalog();
renderMatrix();
renderChords();
updateMidiLearnButton();
attachEvents();
refreshMidiOutputs();
