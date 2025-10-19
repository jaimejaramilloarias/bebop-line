const PATTERNS = [
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
].map((text) => ({ id: text, values: text.split("").map(Number) }));

const DEFAULT_CHORD = [60, 64, 67, 71]; // Cmaj7

const state = {
  patternGroups: [],
  seedPattern: null,
  chords: [],
  lineNotes: [],
  midiAccess: null,
  midiArmed: false,
  captureQueue: [],
  awaitingRelease: false,
  activeNotes: new Set(),
  scheduledNodes: [],
  audioCtx: null
};

const elements = {
  catalog: document.querySelector(".catalog-grid"),
  matrix: document.querySelector(".matrix"),
  staff: document.querySelector(".staff"),
  generate: document.getElementById("generate-patterns"),
  clear: document.getElementById("clear-patterns"),
  groupCount: document.getElementById("group-count"),
  tempo: document.getElementById("tempo"),
  tempoValue: document.getElementById("tempo-value"),
  play: document.getElementById("play-line"),
  stop: document.getElementById("stop-line"),
  connectMidi: document.getElementById("connect-midi"),
  armMidi: document.getElementById("arm-midi"),
  generateFromChords: document.getElementById("generate-from-chords"),
  clearChords: document.getElementById("clear-chords"),
  chordsContainer: document.querySelector(".captured-chords"),
  status: document.getElementById("status"),
  themeToggle: document.getElementById("theme-toggle")
};

function setStatus(message) {
  elements.status.textContent = message;
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

elements.tempo.addEventListener("input", (event) => {
  const bpm = Number(event.target.value);
  elements.tempoValue.textContent = `${bpm} BPM`;
});

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function generateSequence(count, seed) {
  if (count <= 0) return [];
  const sequence = [];
  let currentPattern = seed ? PATTERNS.find((p) => p.id === seed) : null;
  if (!currentPattern) {
    currentPattern = randomChoice(PATTERNS);
  }
  sequence.push(currentPattern);

  for (let i = 1; i < count; i++) {
    const previous = sequence[i - 1];
    const candidates = PATTERNS.filter((p) => previous.values[3] !== p.values[0]);
    const next = randomChoice(candidates.length ? candidates : PATTERNS);
    sequence.push(next);
  }
  return sequence;
}

function updatePatternGroups(groups) {
  state.patternGroups = groups;
  rebuildLineNotes();
  renderMatrix();
  renderStaff();
}

function rebuildLineNotes() {
  const notes = [];
  const totalGroups = state.patternGroups.length;
  for (let i = 0; i < totalGroups; i++) {
    const pattern = state.patternGroups[i];
    const chord = state.chords[i] || DEFAULT_CHORD;
    const sortedChord = [...chord].sort((a, b) => a - b);
    pattern.values.forEach((voice) => {
      const index = Math.min(Math.max(voice - 1, 0), sortedChord.length - 1);
      notes.push(sortedChord[index]);
    });
  }
  state.lineNotes = notes;
}

function renderMatrix() {
  elements.matrix.innerHTML = "";
  if (state.patternGroups.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "Genera patrones o captura acordes para ver la matriz.";
    elements.matrix.appendChild(empty);
    return;
  }
  const rows = [];
  for (let i = 0; i < state.patternGroups.length; i += 4) {
    rows.push(state.patternGroups.slice(i, i + 4));
  }
  rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "matrix-row";
    row.forEach((pattern) => {
      const groupEl = document.createElement("div");
      groupEl.className = "matrix-group";
      pattern.values.forEach((voice) => {
        const cell = document.createElement("div");
        cell.className = "matrix-cell";
        const circle = document.createElement("div");
        circle.className = "matrix-circle";
        circle.style.marginTop = `${(4 - voice) * 12}px`;
        cell.appendChild(circle);
        groupEl.appendChild(cell);
      });
      rowEl.appendChild(groupEl);
    });
    elements.matrix.appendChild(rowEl);
  });
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

function noteNumberToName(note) {
  const name = NOTE_NAMES[note % 12];
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
}

function noteToStaffOffset(note) {
  const octave = Math.floor(note / 12) - 1;
  const letter = NOTE_NAMES[note % 12][0];
  const letterIndex = LETTERS.indexOf(letter);
  const totalSteps = octave * 7 + letterIndex;
  const referenceOctave = 4;
  const referenceLetterIndex = LETTERS.indexOf("E");
  const referenceSteps = referenceOctave * 7 + referenceLetterIndex;
  return totalSteps - referenceSteps;
}

function renderStaff() {
  elements.staff.innerHTML = "";
  const svgNS = "http://www.w3.org/2000/svg";
  const totalNotes = state.lineNotes.length;
  if (!totalNotes) {
    const empty = document.createElement("p");
    empty.textContent = "La partitura aparecerá al generar una línea.";
    elements.staff.appendChild(empty);
    return;
  }
  const notesPerMeasure = 8;
  const measures = Math.ceil(totalNotes / notesPerMeasure);
  const noteSpacing = 28;
  const measureGap = 24;
  const leftMargin = 30;
  const staffHeight = 140;
  const width = leftMargin + measures * notesPerMeasure * noteSpacing + (measures - 1) * measureGap + 20;
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${staffHeight}`);
  svg.setAttribute("role", "img");

  const stepHeight = 6;
  const bottomLineY = 92; // E4

  // Staff lines
  for (let i = 0; i < 5; i++) {
    const y = bottomLineY - i * stepHeight * 2;
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", "10");
    line.setAttribute("x2", `${width - 10}`);
    line.setAttribute("y1", `${y}`);
    line.setAttribute("y2", `${y}`);
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);
  }

  // Notes
  state.lineNotes.forEach((note, index) => {
    const measureIndex = Math.floor(index / notesPerMeasure);
    const positionInMeasure = index % notesPerMeasure;
    const x =
      leftMargin +
      measureIndex * (notesPerMeasure * noteSpacing + measureGap) +
      positionInMeasure * noteSpacing;
    const offset = noteToStaffOffset(note);
    const y = bottomLineY - offset * stepHeight;

    const noteHead = document.createElementNS(svgNS, "ellipse");
    noteHead.setAttribute("cx", `${x}`);
    noteHead.setAttribute("cy", `${y}`);
    noteHead.setAttribute("rx", "6.5");
    noteHead.setAttribute("ry", "4.5");
    noteHead.setAttribute("fill", "currentColor");
    svg.appendChild(noteHead);

    const stem = document.createElementNS(svgNS, "line");
    stem.setAttribute("x1", `${x + 6}");
    stem.setAttribute("x2", `${x + 6}");
    stem.setAttribute("y1", `${y}`);
    stem.setAttribute("y2", `${y - 28}`);
    stem.setAttribute("stroke", "currentColor");
    stem.setAttribute("stroke-width", "1.3");
    svg.appendChild(stem);

    // Ledger lines when needed
    const staffTop = bottomLineY - stepHeight * 8;
    const staffBottom = bottomLineY + stepHeight * 2;
    if (y < staffTop || y > staffBottom) {
      const ledger = document.createElementNS(svgNS, "line");
      ledger.setAttribute("x1", `${x - 10}`);
      ledger.setAttribute("x2", `${x + 10}`);
      ledger.setAttribute("y1", `${y}`);
      ledger.setAttribute("y2", `${y}`);
      ledger.setAttribute("stroke", "currentColor");
      ledger.setAttribute("stroke-width", "1");
      svg.appendChild(ledger);
    }
  });

  // Measure separators
  for (let i = 1; i < measures; i++) {
    const x = leftMargin - noteSpacing / 2 + i * (notesPerMeasure * noteSpacing + measureGap);
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", `${x}`);
    line.setAttribute("x2", `${x}`);
    line.setAttribute("y1", `${bottomLineY - stepHeight * 8}`);
    line.setAttribute("y2", `${bottomLineY + stepHeight * 2}`);
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1.5");
    svg.appendChild(line);
  }

  elements.staff.appendChild(svg);
}

function renderCatalog() {
  elements.catalog.innerHTML = "";
  PATTERNS.forEach((pattern) => {
    const item = document.createElement("button");
    item.className = "catalog-item";
    item.type = "button";
    item.setAttribute("role", "listitem");
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
    elements.catalog.appendChild(item);
  });
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

function handleGenerate() {
  const count = Number(elements.groupCount.value) || 1;
  const groups = generateSequence(count, state.seedPattern);
  updatePatternGroups(groups);
  setStatus(`Generados ${groups.length} grupos.`);
}

function clearPatterns() {
  state.patternGroups = [];
  state.lineNotes = [];
  renderMatrix();
  renderStaff();
  setStatus("Patrones limpiados.");
}

function clearChords() {
  state.chords = [];
  renderChords();
  rebuildLineNotes();
  renderStaff();
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

function stopPlayback() {
  state.scheduledNodes.forEach((node) => {
    try {
      node.stop();
    } catch (_) {
      // ignore
    }
  });
  state.scheduledNodes = [];
}

function playLine() {
  if (!state.lineNotes.length) {
    setStatus("No hay línea para reproducir.");
    return;
  }
  const audioCtx = ensureAudioContext();
  const now = audioCtx.currentTime;
  const bpm = Number(elements.tempo.value);
  const eighthDuration = 60 / bpm / 2;
  stopPlayback();
  state.lineNotes.forEach((note, index) => {
    const start = now + index * eighthDuration;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = midiToFrequency(note);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.7, start + 0.01);
    gain.gain.linearRampToValueAtTime(0.0, start + eighthDuration * 0.9);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + eighthDuration);
    state.scheduledNodes.push(osc);
  });
  setStatus("Reproduciendo línea.");
}

function requestMidi() {
  if (!navigator.requestMIDIAccess) {
    setStatus("Web MIDI no disponible en este navegador.");
    return;
  }
  navigator.requestMIDIAccess({ sysex: false })
    .then((access) => {
      state.midiAccess = access;
      setStatus("Dispositivos MIDI listos.");
    })
    .catch(() => setStatus("No fue posible acceder a MIDI."));
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
  if (uniqueNotes.length === 4) {
    const chord = uniqueNotes.map((item) => item.note).sort((a, b) => a - b);
    state.chords.push(chord);
    renderChords();
    rebuildLineNotes();
    renderStaff();
    setStatus(`Acorde capturado: ${chord.map(noteNumberToName).join(" ")}`);
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

function toggleMidiArm() {
  if (!state.midiAccess) {
    setStatus("Conecta un dispositivo MIDI primero.");
    return;
  }
  state.midiArmed = !state.midiArmed;
  elements.armMidi.textContent = state.midiArmed ? "Desarmar captura" : "Armar captura";
  elements.armMidi.setAttribute("aria-pressed", String(state.midiArmed));
  state.captureQueue = [];
  state.awaitingRelease = false;
  state.activeNotes.clear();
  state.midiAccess.inputs.forEach((input) => {
    if (state.midiArmed) {
      input.onmidimessage = handleMidiMessage;
    } else {
      input.onmidimessage = null;
    }
  });
  setStatus(state.midiArmed ? "Captura MIDI armada." : "Captura MIDI desactivada.");
}

function generateFromChords() {
  if (!state.chords.length) {
    setStatus("Captura acordes para generar la línea.");
    return;
  }
  const groups = generateSequence(state.chords.length, state.seedPattern);
  updatePatternGroups(groups);
  setStatus(`Línea generada para ${state.chords.length} acordes.`);
}

function attachEvents() {
  elements.generate.addEventListener("click", handleGenerate);
  elements.clear.addEventListener("click", clearPatterns);
  elements.play.addEventListener("click", playLine);
  elements.stop.addEventListener("click", stopPlayback);
  elements.connectMidi.addEventListener("click", requestMidi);
  elements.armMidi.addEventListener("click", toggleMidiArm);
  elements.generateFromChords.addEventListener("click", generateFromChords);
  elements.clearChords.addEventListener("click", clearChords);
}

renderCatalog();
renderMatrix();
renderStaff();
renderChords();
attachEvents();
