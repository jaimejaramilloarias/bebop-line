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
  midiLearn: document.getElementById("midi-learn"),
  generateFromChords: document.getElementById("generate-from-chords"),
  clearChords: document.getElementById("clear-chords"),
  chordsContainer: document.querySelector(".captured-chords"),
  status: document.getElementById("status"),
  themeToggle: document.getElementById("theme-toggle")
};

function setStatus(message) {
  elements.status.textContent = message;
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

function noteNumberToName(note) {
  const name = NOTE_NAMES[note % 12];
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
}

function midiNoteToVexKey(note) {
  const name = NOTE_NAMES[note % 12];
  const octave = Math.floor(note / 12) - 1;
  const letter = name[0].toLowerCase();
  const accidental = name.length > 1 ? name.slice(1) : "";
  return { key: `${letter}/${octave}`, accidental };
}

function createVexFlowNote(VF, note) {
  const { key, accidental } = midiNoteToVexKey(note);
  const staveNote = new VF.StaveNote({ keys: [key], duration: "8", stem_direction: 1 });
  if (accidental) {
    staveNote.addAccidental(0, new VF.Accidental(accidental));
  }
  return staveNote;
}

function renderStaff() {
  elements.staff.innerHTML = "";
  const totalNotes = state.lineNotes.length;
  if (!totalNotes) {
    const empty = document.createElement("p");
    empty.textContent = "La partitura aparecerá al generar una línea.";
    elements.staff.appendChild(empty);
    return;
  }

  const VF = window.Vex && window.Vex.Flow;
  if (!VF) {
    const warning = document.createElement("p");
    warning.textContent = "No fue posible cargar la notación. Revisa tu conexión a internet.";
    elements.staff.appendChild(warning);
    return;
  }

  const notesPerMeasure = 8;
  const measures = Math.ceil(totalNotes / notesPerMeasure);
  const measuresPerRow = Math.min(3, measures);
  const staveWidth = 260;
  const measureGap = 28;
  const xPadding = 24;
  const yPadding = 24;
  const rowHeight = 150;
  const rows = Math.ceil(measures / measuresPerRow);
  const width = Math.max(360, xPadding * 2 + measuresPerRow * staveWidth + (measuresPerRow - 1) * measureGap);
  const height = yPadding * 2 + rows * rowHeight;

  const wrapper = document.createElement("div");
  wrapper.className = "vexflow-wrapper";
  elements.staff.appendChild(wrapper);

  const renderer = new VF.Renderer(wrapper, VF.Renderer.Backends.SVG);
  renderer.resize(width, height);
  const context = renderer.getContext();
  const themeColor = getComputedStyle(document.body).color;
  if (typeof context.setFillStyle === "function") {
    context.setFillStyle(themeColor);
    context.setStrokeStyle(themeColor);
  }

  for (let measureIndex = 0; measureIndex < measures; measureIndex++) {
    const row = Math.floor(measureIndex / measuresPerRow);
    const column = measureIndex % measuresPerRow;
    const x = xPadding + column * (staveWidth + measureGap);
    const y = yPadding + row * rowHeight;
    const stave = new VF.Stave(x, y, staveWidth);
    if (measureIndex === 0) {
      stave.addClef("treble").addTimeSignature("4/4");
    }
    stave.setContext(context).draw();

    const sliceStart = measureIndex * notesPerMeasure;
    const sliceEnd = sliceStart + notesPerMeasure;
    const measureNotes = state.lineNotes.slice(sliceStart, sliceEnd);
    const vexNotes = measureNotes.map((note) => createVexFlowNote(VF, note));
    while (vexNotes.length < notesPerMeasure) {
      vexNotes.push(new VF.StaveNote({ keys: ["b/4"], duration: "8r" }));
    }

    const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT);
    voice.addTickables(vexNotes);
    new VF.Formatter().joinVoices([voice]).format([voice], staveWidth - 18);
    voice.draw(context, stave);

    const beams = VF.Beam.generateBeams(vexNotes.filter((note) => note.getDuration() === "8"));
    beams.forEach((beam) => beam.setContext(context).draw());
  }

  const svgElement = wrapper.querySelector("svg");
  if (svgElement) {
    svgElement.setAttribute("role", "img");
    svgElement.setAttribute("aria-label", "Partitura generada");
  }
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

async function toggleMidiLearn() {
  if (!navigator.requestMIDIAccess) {
    setStatus("Web MIDI no disponible en este navegador.");
    return;
  }

  if (elements.midiLearn) {
    elements.midiLearn.disabled = true;
  }

  try {
    if (!state.midiAccess) {
      try {
        state.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      } catch (error) {
        setStatus("No fue posible acceder a MIDI.");
        return;
      }
    }

    state.midiArmed = !state.midiArmed;
    state.captureQueue = [];
    state.awaitingRelease = false;
    state.activeNotes.clear();

    if (state.midiAccess) {
      state.midiAccess.inputs.forEach((input) => {
        input.onmidimessage = state.midiArmed ? handleMidiMessage : null;
      });
    }

    updateMidiLearnButton();

    if (state.midiArmed) {
      const hasInputs = state.midiAccess && state.midiAccess.inputs.size > 0;
      setStatus(
        hasInputs
          ? "MIDI Learn encendido. Captura acordes de 4 notas para generar líneas."
          : "MIDI Learn encendido. No se detectan entradas MIDI."
      );
    } else {
      setStatus("MIDI Learn apagado.");
    }
  } finally {
    if (elements.midiLearn) {
      elements.midiLearn.disabled = false;
    }
  }
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
  elements.midiLearn.addEventListener("click", toggleMidiLearn);
  elements.generateFromChords.addEventListener("click", generateFromChords);
  elements.clearChords.addEventListener("click", clearChords);
}

renderCatalog();
renderMatrix();
renderStaff();
renderChords();
updateMidiLearnButton();
attachEvents();
