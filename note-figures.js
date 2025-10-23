const TWO_PI = Math.PI * 2;

const FIGURE_IDS = [
  "solid-square",
  "outline-square",
  "solid-rounded-square",
  "outline-rounded-square",
  "solid-circle",
  "ring",
  "solid-triangle-up",
  "outline-triangle-up",
  "solid-diamond",
  "outline-diamond",
  "solid-sparkle",
  "outline-sparkle",
  "solid-asterisk",
  "outline-asterisk",
  "solid-clover",
  "outline-clover",
  "solid-lemniscate",
  "outline-lemniscate"
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

class NormalizedPathBuilder {
  constructor() {
    this.subpaths = [];
    this.current = null;
  }

  beginSubpath() {
    if (this.current) {
      return;
    }
    this.current = { commands: [], closed: false };
    this.subpaths.push(this.current);
  }

  ensureSubpath() {
    if (!this.current) {
      this.beginSubpath();
    }
  }

  moveTo(x, y) {
    this.ensureSubpath();
    this.current.commands.push({ type: "move", x, y });
  }

  lineTo(x, y) {
    this.ensureSubpath();
    this.current.commands.push({ type: "line", x, y });
  }

  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    this.ensureSubpath();
    this.current.commands.push({
      type: "bezier",
      c1x,
      c1y,
      c2x,
      c2y,
      x,
      y
    });
  }

  quadraticCurveTo(cx, cy, x, y) {
    this.ensureSubpath();
    this.current.commands.push({ type: "quadratic", cx, cy, x, y });
  }

  arc(cx, cy, radius, startAngle, endAngle, counterclockwise = false) {
    this.ensureSubpath();
    this.current.commands.push({
      type: "arc",
      cx,
      cy,
      radius,
      startAngle,
      endAngle,
      counterclockwise
    });
  }

  closePath() {
    if (!this.current) return;
    this.current.closed = true;
    this.current = null;
  }

  build(options = {}) {
    if (this.current) {
      this.closePath();
    }
    return { subpaths: this.subpaths.slice(), fillRule: options.fillRule ?? "nonzero" };
  }
}

function rotatePoint(x, y, angle) {
  if (angle === 0) {
    return { x, y };
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos
  };
}

function addRectangle(builder, width, height, rotation = 0) {
  const hw = width / 2;
  const hh = height / 2;
  const points = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh]
  ].map(([x, y]) => rotatePoint(x, y, rotation));
  builder.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    builder.lineTo(points[i].x, points[i].y);
  }
  builder.closePath();
}

function circleIntersections([x0, y0], [x1, y1], r0, r1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d === 0) {
    return [];
  }
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const hSq = r0 * r0 - a * a;
  if (hSq < 0) {
    return [];
  }
  const h = Math.sqrt(hSq);
  const xm = x0 + (a * dx) / d;
  const ym = y0 + (a * dy) / d;
  const rx = (-dy * h) / d;
  const ry = (dx * h) / d;
  return [
    { x: xm + rx, y: ym + ry },
    { x: xm - rx, y: ym - ry }
  ];
}

function buildSolidSquare() {
  const b = new NormalizedPathBuilder();
  b.moveTo(-0.5, -0.5);
  b.lineTo(0.5, -0.5);
  b.lineTo(0.5, 0.5);
  b.lineTo(-0.5, 0.5);
  b.closePath();
  return b.build();
}

function buildRoundedSquare() {
  const radius = 0.32;
  const b = new NormalizedPathBuilder();
  b.moveTo(-0.5 + radius, -0.5);
  b.lineTo(0.5 - radius, -0.5);
  b.arc(0.5 - radius, -0.5 + radius, radius, -Math.PI / 2, 0);
  b.lineTo(0.5, 0.5 - radius);
  b.arc(0.5 - radius, 0.5 - radius, radius, 0, Math.PI / 2);
  b.lineTo(-0.5 + radius, 0.5);
  b.arc(-0.5 + radius, 0.5 - radius, radius, Math.PI / 2, Math.PI);
  b.lineTo(-0.5, -0.5 + radius);
  b.arc(-0.5 + radius, -0.5 + radius, radius, Math.PI, Math.PI * 1.5);
  b.closePath();
  return b.build();
}

function buildCircle() {
  const b = new NormalizedPathBuilder();
  b.moveTo(0.5, 0);
  b.arc(0, 0, 0.5, 0, TWO_PI);
  b.closePath();
  return b.build();
}

function buildRing() {
  const outer = 0.5;
  const inner = 0.32;
  const b = new NormalizedPathBuilder();
  b.moveTo(outer, 0);
  b.arc(0, 0, outer, 0, TWO_PI);
  b.closePath();
  b.moveTo(inner, 0);
  b.arc(0, 0, inner, 0, TWO_PI, true);
  b.closePath();
  return b.build({ fillRule: "evenodd" });
}

function buildTriangle() {
  const b = new NormalizedPathBuilder();
  b.moveTo(0, -0.5);
  b.lineTo(0.5, 0.5);
  b.lineTo(-0.5, 0.5);
  b.closePath();
  return b.build();
}

function buildDiamond() {
  const b = new NormalizedPathBuilder();
  b.moveTo(0, -0.5);
  b.lineTo(0.45, 0);
  b.lineTo(0, 0.5);
  b.lineTo(-0.45, 0);
  b.closePath();
  return b.build();
}

function buildSparkle() {
  const b = new NormalizedPathBuilder();
  b.moveTo(0, -0.5);
  b.bezierCurveTo(0.22, -0.45, 0.38, -0.25, 0.48, 0);
  b.bezierCurveTo(0.38, 0.25, 0.22, 0.45, 0, 0.5);
  b.bezierCurveTo(-0.22, 0.45, -0.38, 0.25, -0.48, 0);
  b.bezierCurveTo(-0.38, -0.25, -0.22, -0.45, 0, -0.5);
  b.closePath();
  return b.build();
}

function buildAsterisk() {
  const armWidth = 0.2;
  const armLength = 0.5;
  const builder = new NormalizedPathBuilder();
  for (let i = 0; i < 3; i += 1) {
    const angle = (Math.PI / 3) * i;
    addRectangle(builder, armWidth, armLength * 2, angle);
  }
  return builder.build();
}

function buildClover() {
  const radius = 0.32;
  const offset = 0.18;
  const top = [0, -offset];
  const right = [offset, 0];
  const bottom = [0, offset];
  const left = [-offset, 0];
  const intersectionsTR = circleIntersections(top, right, radius, radius);
  const intersectionsRB = circleIntersections(right, bottom, radius, radius);
  const intersectionsBL = circleIntersections(bottom, left, radius, radius);
  const intersectionsLT = circleIntersections(left, top, radius, radius);
  const pickOuter = (points) =>
    points.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))[1] ?? points[0];
  const pTR = pickOuter(intersectionsTR);
  const pRB = pickOuter(intersectionsRB);
  const pBL = pickOuter(intersectionsBL);
  const pLT = pickOuter(intersectionsLT);
  const builder = new NormalizedPathBuilder();
  builder.moveTo(pTR.x, pTR.y);
  builder.arc(right[0], right[1], radius, Math.atan2(pTR.y - right[1], pTR.x - right[0]), Math.atan2(pRB.y - right[1], pRB.x - right[0]));
  builder.arc(bottom[0], bottom[1], radius, Math.atan2(pRB.y - bottom[1], pRB.x - bottom[0]), Math.atan2(pBL.y - bottom[1], pBL.x - bottom[0]));
  builder.arc(left[0], left[1], radius, Math.atan2(pBL.y - left[1], pBL.x - left[0]), Math.atan2(pLT.y - left[1], pLT.x - left[0]));
  builder.arc(top[0], top[1], radius, Math.atan2(pLT.y - top[1], pLT.x - top[0]), Math.atan2(pTR.y - top[1], pTR.x - top[0]));
  builder.closePath();
  return builder.build();
}

function buildLemniscate() {
  const builder = new NormalizedPathBuilder();
  const segments = 128;
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * TWO_PI;
    const denom = 1 + Math.sin(t) ** 2;
    const x = (Math.cos(t) / denom) * 0.5;
    const y = (Math.sin(t) * Math.cos(t) / denom) * 1.1;
    points.push({ x, y });
  }
  builder.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    builder.lineTo(points[i].x, points[i].y);
  }
  builder.closePath();
  return builder.build();
}

const FIGURE_LIBRARY = new Map([
  ["solid-square", { path: buildSolidSquare(), defaults: { fill: "#000000", stroke: null } }],
  ["outline-square", { path: buildSolidSquare(), defaults: { fill: null, stroke: "#000000" } }],
  ["solid-rounded-square", { path: buildRoundedSquare(), defaults: { fill: "#000000", stroke: null } }],
  ["outline-rounded-square", { path: buildRoundedSquare(), defaults: { fill: null, stroke: "#000000" } }],
  ["solid-circle", { path: buildCircle(), defaults: { fill: "#000000", stroke: null } }],
  ["ring", { path: buildRing(), defaults: { fill: "#000000", stroke: null } }],
  ["solid-triangle-up", { path: buildTriangle(), defaults: { fill: "#000000", stroke: null } }],
  ["outline-triangle-up", { path: buildTriangle(), defaults: { fill: null, stroke: "#000000" } }],
  ["solid-diamond", { path: buildDiamond(), defaults: { fill: "#000000", stroke: null } }],
  ["outline-diamond", { path: buildDiamond(), defaults: { fill: null, stroke: "#000000" } }],
  ["solid-sparkle", { path: buildSparkle(), defaults: { fill: "#000000", stroke: null } }],
  ["outline-sparkle", { path: buildSparkle(), defaults: { fill: null, stroke: "#000000" } }],
  ["solid-asterisk", { path: buildAsterisk(), defaults: { fill: "#000000", stroke: null } }],
  ["outline-asterisk", { path: buildAsterisk(), defaults: { fill: null, stroke: "#000000" } }],
  ["solid-clover", { path: buildClover(), defaults: { fill: "#000000", stroke: null } }],
  ["outline-clover", { path: buildClover(), defaults: { fill: null, stroke: "#000000" } }],
  ["solid-lemniscate", { path: buildLemniscate(), defaults: { fill: "#000000", stroke: null } }],
  ["outline-lemniscate", { path: buildLemniscate(), defaults: { fill: null, stroke: "#000000" } }]
]);

function resolveStatefulOption(option, state, fallback) {
  if (option == null) {
    return fallback;
  }
  if (typeof option === "string" || typeof option === "number") {
    return option;
  }
  if (state === "post" && option.post !== undefined) {
    return option.post;
  }
  if (state === "pre" && option.pre !== undefined) {
    return option.pre;
  }
  if (option.default !== undefined) {
    return option.default;
  }
  return fallback;
}

function createTransform({
  x = 0,
  y = 0,
  width = 20,
  height = 20,
  elongation = 1,
  rotation = 0
} = {}) {
  const normalizedElongation = Math.max(1, Number.isFinite(elongation) ? elongation : 1);
  return {
    translateX: x,
    translateY: y,
    width,
    height,
    elongation: normalizedElongation,
    rotation,
    cos: Math.cos(rotation),
    sin: Math.sin(rotation)
  };
}

function transformPoint(x, y, transform) {
  const sx = x * transform.width;
  const sy = y * transform.height * transform.elongation;
  const xr = sx * transform.cos - sy * transform.sin;
  const yr = sx * transform.sin + sy * transform.cos;
  return {
    x: xr + transform.translateX,
    y: yr + transform.translateY
  };
}

function applyPathToContext(ctx, path, transform) {
  for (const subpath of path.subpaths) {
    let current = null;
    for (const command of subpath.commands) {
      if (command.type === "move") {
        current = transformPoint(command.x, command.y, transform);
        ctx.moveTo(current.x, current.y);
      } else if (command.type === "line") {
        current = transformPoint(command.x, command.y, transform);
        ctx.lineTo(current.x, current.y);
      } else if (command.type === "bezier") {
        const c1 = transformPoint(command.c1x, command.c1y, transform);
        const c2 = transformPoint(command.c2x, command.c2y, transform);
        const end = transformPoint(command.x, command.y, transform);
        current = end;
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
      } else if (command.type === "quadratic") {
        const c = transformPoint(command.cx, command.cy, transform);
        const end = transformPoint(command.x, command.y, transform);
        current = end;
        ctx.quadraticCurveTo(c.x, c.y, end.x, end.y);
      } else if (command.type === "arc") {
        const { cx, cy, radius, startAngle, endAngle, counterclockwise } = command;
        const center = transformPoint(cx, cy, transform);
        const scaleX = transform.width;
        const scaleY = transform.height * transform.elongation;
        if (Math.abs(scaleX - scaleY) < 1e-6) {
          ctx.arc(center.x, center.y, radius * scaleX, startAngle + transform.rotation, endAngle + transform.rotation, counterclockwise);
        } else {
          const segments = arcToBezierSegments(cx, cy, radius, startAngle, endAngle, counterclockwise);
          for (const segment of segments) {
            const c1 = transformPoint(segment.c1.x, segment.c1.y, transform);
            const c2 = transformPoint(segment.c2.x, segment.c2.y, transform);
            const end = transformPoint(segment.end.x, segment.end.y, transform);
            ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
          }
        }
      }
    }
    if (subpath.closed) {
      ctx.closePath();
    }
  }
}

function arcToBezierSegments(cx, cy, radius, startAngle, endAngle, counterclockwise) {
  let sweep = counterclockwise ? startAngle - endAngle : endAngle - startAngle;
  if (!Number.isFinite(sweep)) {
    sweep = 0;
  }
  if (Math.abs(sweep) >= TWO_PI) {
    sweep = counterclockwise ? -TWO_PI : TWO_PI;
  }
  const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const delta = sweep / segments;
  const beziers = [];
  for (let i = 0; i < segments; i += 1) {
    const theta1 = startAngle + delta * i;
    const theta2 = theta1 + delta;
    const t = Math.tan(delta / 4);
    const factor = (4 / 3) * t;
    const cos1 = Math.cos(theta1);
    const sin1 = Math.sin(theta1);
    const cos2 = Math.cos(theta2);
    const sin2 = Math.sin(theta2);
    const p0 = { x: cx + radius * cos1, y: cy + radius * sin1 };
    const p3 = { x: cx + radius * cos2, y: cy + radius * sin2 };
    const p1 = {
      x: p0.x - factor * radius * sin1,
      y: p0.y + factor * radius * cos1
    };
    const p2 = {
      x: p3.x + factor * radius * sin2,
      y: p3.y - factor * radius * cos2
    };
    beziers.push({ c1: p1, c2: p2, end: p3 });
  }
  if (counterclockwise) {
    beziers.reverse();
  }
  return beziers;
}

function buildSvgPath(path, transform) {
  let d = "";
  const addCommand = (cmd) => {
    d += cmd;
  };
  for (const subpath of path.subpaths) {
    let started = false;
    let lastPoint = null;
    for (const command of subpath.commands) {
      if (command.type === "move") {
        const point = transformPoint(command.x, command.y, transform);
        addCommand(`M${point.x.toFixed(3)} ${point.y.toFixed(3)}`);
        lastPoint = point;
        started = true;
      } else if (command.type === "line") {
        const point = transformPoint(command.x, command.y, transform);
        addCommand(`L${point.x.toFixed(3)} ${point.y.toFixed(3)}`);
        lastPoint = point;
      } else if (command.type === "bezier") {
        const c1 = transformPoint(command.c1x, command.c1y, transform);
        const c2 = transformPoint(command.c2x, command.c2y, transform);
        const end = transformPoint(command.x, command.y, transform);
        addCommand(`C${c1.x.toFixed(3)} ${c1.y.toFixed(3)} ${c2.x.toFixed(3)} ${c2.y.toFixed(3)} ${end.x.toFixed(3)} ${end.y.toFixed(3)}`);
        lastPoint = end;
      } else if (command.type === "quadratic") {
        const c = transformPoint(command.cx, command.cy, transform);
        const end = transformPoint(command.x, command.y, transform);
        addCommand(`Q${c.x.toFixed(3)} ${c.y.toFixed(3)} ${end.x.toFixed(3)} ${end.y.toFixed(3)}`);
        lastPoint = end;
      } else if (command.type === "arc") {
        const beziers = arcToBezierSegments(command.cx, command.cy, command.radius, command.startAngle, command.endAngle, command.counterclockwise);
        for (const segment of beziers) {
          const c1 = transformPoint(segment.c1.x, segment.c1.y, transform);
          const c2 = transformPoint(segment.c2.x, segment.c2.y, transform);
          const end = transformPoint(segment.end.x, segment.end.y, transform);
          addCommand(`C${c1.x.toFixed(3)} ${c1.y.toFixed(3)} ${c2.x.toFixed(3)} ${c2.y.toFixed(3)} ${end.x.toFixed(3)} ${end.y.toFixed(3)}`);
          lastPoint = end;
        }
      }
    }
    if (subpath.closed) {
      addCommand("Z");
    } else if (started && lastPoint) {
      addCommand(`L${lastPoint.x.toFixed(3)} ${lastPoint.y.toFixed(3)}`);
    }
  }
  return d;
}

export function getFigureDefinition(id) {
  const entry = FIGURE_LIBRARY.get(id);
  if (!entry) {
    throw new Error(`Unknown figure id: ${id}`);
  }
  return entry;
}

export function renderNoteFigure(ctx, id, options = {}) {
  const { path, defaults } = getFigureDefinition(id);
  const {
    state = "pre",
    x = 0,
    y = 0,
    width = 24,
    height = 24,
    elongation = 1,
    rotation = 0,
    opacity = 1,
    fill,
    stroke,
    strokeWidth,
    glow,
    lineJoin = "round",
    lineCap = "round"
  } = options;
  const transform = createTransform({ x, y, width, height, elongation, rotation });
  const fillColor = resolveStatefulOption(fill, state, defaults.fill);
  const strokeColor = resolveStatefulOption(stroke, state, defaults.stroke);
  const strokePx = clamp(Number(resolveStatefulOption(strokeWidth, state, defaults.stroke ? 1.5 : 0)) || 0, 0, 200);
  const glowConfig = resolveStatefulOption(glow, state, null);
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.lineJoin = lineJoin;
  ctx.lineCap = lineCap;
  ctx.beginPath();
  applyPathToContext(ctx, path, transform);
  if (glowConfig && glowConfig.blur > 0 && glowConfig.color) {
    ctx.shadowColor = glowConfig.color;
    ctx.shadowBlur = glowConfig.blur;
  } else {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  }
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill(path.fillRule);
    if (glowConfig && glowConfig.applyToStroke === false) {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }
  }
  if (strokeColor && strokePx > 0) {
    if (glowConfig && glowConfig.applyToStroke !== false) {
      ctx.shadowColor = glowConfig.color ?? ctx.shadowColor;
      ctx.shadowBlur = glowConfig.blur ?? ctx.shadowBlur;
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokePx;
    ctx.stroke();
  }
  ctx.restore();
}

export function createSvgForFigure(id, options = {}) {
  const { path, defaults } = getFigureDefinition(id);
  const {
    width = 120,
    height = 120,
    elongation = 1,
    rotation = 0,
    state = "pre",
    fill,
    stroke,
    strokeWidth,
    glow,
    viewBoxPadding = 12
  } = options;
  const transform = createTransform({
    x: width / 2,
    y: height / 2,
    width: width - viewBoxPadding,
    height: height - viewBoxPadding,
    elongation,
    rotation
  });
  const fillColor = resolveStatefulOption(fill, state, defaults.fill);
  const strokeColor = resolveStatefulOption(stroke, state, defaults.stroke);
  const strokePx = resolveStatefulOption(strokeWidth, state, defaults.stroke ? 4 : 0) ?? 0;
  const glowConfig = resolveStatefulOption(glow, state, null);
  const pathData = buildSvgPath(path, transform);
  const attributes = [
    `fill="${fillColor ?? "none"}"`,
    strokeColor ? `stroke="${strokeColor}"` : null,
    strokeColor ? `stroke-width="${strokePx}"` : null,
    `fill-rule="${path.fillRule}"`
  ]
    .filter(Boolean)
    .join(" ");
  let filterId = "";
  let filterDef = "";
  if (glowConfig && glowConfig.blur > 0 && glowConfig.color) {
    filterId = `glow-${Math.random().toString(36).slice(2)}`;
    filterDef = `<defs><filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${glowConfig.blur}" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  }
  const filterAttr = filterId ? ` filter="url(#${filterId})"` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${filterDef}<path d="${pathData}" ${attributes}${filterAttr}/></svg>`;
  return svg;
}

export function getFigurePath(id, options = {}) {
  const { path } = getFigureDefinition(id);
  const {
    x = 0,
    y = 0,
    width = 24,
    height = 24,
    elongation = 1,
    rotation = 0
  } = options;
  const transform = createTransform({ x, y, width, height, elongation, rotation });
  return {
    d: buildSvgPath(path, transform),
    fillRule: path.fillRule
  };
}

export { FIGURE_IDS };

