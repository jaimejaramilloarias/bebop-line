import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIGURE_IDS,
  getFigureDefinition,
  getFigurePath
} from "../note-figures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(__dirname, "artifacts");

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

function generateGridSvg({
  title,
  states = ["pre"],
  elongation = 1,
  fillResolver,
  strokeResolver,
  strokeWidthResolver,
  glowResolver,
  rotationResolver,
  opacityResolver
}) {
  const combinations = [];
  for (const figureId of FIGURE_IDS) {
    for (const state of states) {
      combinations.push({ figureId, state });
    }
  }
  const baseColumns = 6;
  const columns = Math.max(baseColumns * states.length, 1);
  const cellSize = 160;
  const titleHeight = title ? 48 : 0;
  const margin = 36;
  const rows = Math.ceil(combinations.length / columns);
  const width = margin * 2 + columns * cellSize;
  const height = titleHeight + margin * 2 + rows * cellSize;
  let defs = "";
  const glowMap = new Map();
  let shapesMarkup = "";
  const getGlowFilter = (glow) => {
    if (!glow || !glow.color || !(glow.blur > 0)) {
      return null;
    }
    const opacity = glow.opacity ?? 1;
    const key = `${glow.color}|${glow.blur}|${opacity}`;
    if (!glowMap.has(key)) {
      const id = `glow-${glowMap.size + 1}`;
      glowMap.set(key, id);
      defs += `\n      <filter id="${id}" x="-60%" y="-60%" width="220%" height="220%">`;
      defs += `\n        <feGaussianBlur in="SourceGraphic" stdDeviation="${glow.blur}" result="blur"/>`;
      defs += `\n        <feFlood flood-color="${glow.color}" flood-opacity="${opacity}" result="flood"/>`;
      defs += `\n        <feComposite in="flood" in2="blur" operator="in" result="colored"/>`;
      defs += `\n        <feMerge><feMergeNode in="colored"/><feMergeNode in="SourceGraphic"/></feMerge>`;
      defs += `\n      </filter>`;
    }
    return glowMap.get(key);
  };

  combinations.forEach(({ figureId, state }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cx = margin + column * cellSize + cellSize / 2;
    const cy = titleHeight + margin + row * cellSize + cellSize / 2;
    const size = cellSize * 0.55;
    const elongationValue = typeof elongation === "function" ? elongation(figureId, state) : elongation;
    const rotation = rotationResolver ? rotationResolver(figureId, state) : 0;
    const { d, fillRule } = getFigurePath(figureId, {
      x: cx,
      y: cy,
      width: size,
      height: size,
      elongation: elongationValue,
      rotation
    });
    const defaults = getFigureDefinition(figureId).defaults;
    const fill = fillResolver ? fillResolver(figureId, state, defaults) : defaults.fill ?? "none";
    const stroke = strokeResolver ? strokeResolver(figureId, state, defaults) : defaults.stroke;
    const strokeWidth = strokeWidthResolver ? strokeWidthResolver(figureId, state, defaults) : stroke ? 8 : 0;
    const opacity = opacityResolver ? opacityResolver(figureId, state, defaults) : 1;
    const glow = glowResolver ? glowResolver(figureId, state, defaults) : null;
    const filterId = getGlowFilter(glow);
    const filterAttr = filterId ? ` filter=\"url(#${filterId})\"` : "";
    const fillAttr = ` fill=\"${fill ?? "none"}\"`;
    const strokeAttr = stroke ? ` stroke=\"${stroke}\" stroke-width=\"${strokeWidth}\" stroke-linejoin=\"round\" stroke-linecap=\"round\"` : "";
    const opacityAttr = opacity !== 1 ? ` opacity=\"${opacity}\"` : "";
    shapesMarkup += `\n    <path d=\"${d}\" fill-rule=\"${fillRule}\"${fillAttr}${strokeAttr}${filterAttr}${opacityAttr}/>`;
    shapesMarkup += `\n    <text x=\"${cx}\" y=\"${cy + size * 0.75}\" font-size=\"12\" fill=\"#555\" text-anchor=\"middle\" font-family=\"Inter, Arial, sans-serif\">${figureId}${states.length > 1 ? ` (${state})` : ""}</text>`;
  });

  const defsMarkup = defs ? `  <defs>${defs}\n  </defs>` : "";
  const titleMarkup = title
    ? `  <text x=\"${width / 2}\" y=\"24\" font-size=\"22\" font-weight=\"600\" text-anchor=\"middle\" font-family=\"Inter, Arial, sans-serif\">${title}</text>`
    : "";
  const svg = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\">\n  <rect x=\"0\" y=\"0\" width=\"${width}\" height=\"${height}\" fill=\"#ffffff\"/>\n${defsMarkup}\n${titleMarkup}${shapesMarkup}\n</svg>\n`;
  return svg;
}

function writeArtifact(name, svg) {
  const filePath = path.join(ARTIFACT_DIR, name);
  fs.writeFileSync(filePath, svg, "utf8");
  return filePath;
}

test("visual grid: base figures", () => {
  const svg = generateGridSvg({
    title: "Figuras base (estado pre)",
    states: ["pre"],
    elongation: 1,
    fillResolver: (figureId, _state, defaults) => defaults.fill ?? "none",
    strokeResolver: (_figureId, _state, defaults) => defaults.stroke,
    strokeWidthResolver: (_figureId, _state, defaults) => (defaults.stroke ? 8 : 0)
  });
  const filePath = writeArtifact("figures-base.svg", svg);
  const pathCount = (svg.match(/<path/g) ?? []).length;
  assert.strictEqual(pathCount >= FIGURE_IDS.length, true, "should render each figure");
  assert.ok(fs.existsSync(filePath));
});

test("visual grid: figuras alargadas", () => {
  const svg = generateGridSvg({
    title: "Figuras con alargamiento 2×",
    states: ["pre"],
    elongation: 2,
    fillResolver: (figureId, _state, defaults) => defaults.fill ?? "none",
    strokeResolver: (_figureId, _state, defaults) => defaults.stroke,
    strokeWidthResolver: (_figureId, _state, defaults) => (defaults.stroke ? 8 : 0)
  });
  const filePath = writeArtifact("figures-elongated.svg", svg);
  assert.ok(svg.includes("2×"));
  assert.ok(fs.existsSync(filePath));
});

test("visual grid: comparación de contornos pre/post", () => {
  const svg = generateGridSvg({
    title: "Comparación de contornos pre/post",
    states: ["pre", "post"],
    elongation: 1.4,
    fillResolver: (figureId, state, defaults) => {
      if (defaults.fill) {
        return state === "post" ? "#111111" : "#333333";
      }
      return "none";
    },
    strokeResolver: (figureId, state, defaults) => {
      if (defaults.stroke) {
        return state === "post" ? "#111111" : "#666666";
      }
      return state === "post" ? "#d12f6a" : "none";
    },
    strokeWidthResolver: (figureId, state, defaults) => {
      if (defaults.stroke) {
        return state === "post" ? 10 : 6;
      }
      return state === "post" ? 8 : 0;
    }
  });
  const filePath = writeArtifact("figures-contours.svg", svg);
  const strokeMatches = svg.match(/stroke-width=\"10\"/g) ?? [];
  assert.ok(strokeMatches.length >= 6, "expected thicker post-release contours");
  assert.ok(fs.existsSync(filePath));
});

test("visual grid: glow y opacidad", () => {
  const svg = generateGridSvg({
    title: "Glow configurable", 
    states: ["pre", "post"],
    elongation: 1,
    fillResolver: (figureId, state, defaults) => {
      if (defaults.fill) {
        return state === "post" ? "#0f0f0f" : "#4c4c4c";
      }
      return state === "post" ? "#0f0f0f" : "none";
    },
    strokeResolver: (figureId, state, defaults) => (defaults.stroke ? "#111111" : state === "post" ? "#0f0f0f" : "none"),
    strokeWidthResolver: (_figureId, state, defaults) => (defaults.stroke ? 8 : state === "post" ? 6 : 0),
    glowResolver: (_figureId, state) =>
      state === "post"
        ? { color: "#8c5bff", blur: 12, opacity: 0.75 }
        : null,
    opacityResolver: (_figureId, state) => (state === "post" ? 1 : 0.8)
  });
  const filePath = writeArtifact("figures-glow.svg", svg);
  assert.ok(svg.includes("Glow configurable"));
  assert.ok(svg.includes("filter=\"url(#glow-"));
  assert.ok(fs.existsSync(filePath));
});
