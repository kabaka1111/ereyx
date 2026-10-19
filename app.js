'use strict';

/* ============================================================
 * Mini Figma — канвас-редактор на чистом JS
 * Модель: state.nodes — массив объектов, порядок = z-order (начало = низ).
 * Экран = мир * scale + offset. Мир: фрейм 1440×900 с началом в (0,0).
 * ============================================================ */

/* ---------- Константы ---------- */
const FRAME = { w: 1440, h: 900 };
const FONT = "'Inter','Segoe UI',system-ui,sans-serif";
const MIN_SCALE = 0.02, MAX_SCALE = 64;

/* ---------- Состояние ---------- */
const state = {
  nodes: [],
  selection: new Set(),
  tool: 'select',
  editingId: null, // id текста, который редактируется прямо сейчас
};
const vp = { x: 0, y: 0, scale: 1 }; // viewport: смещение и масштаб

let gesture = null;      // активный жест: pan | move | resize | marquee | draw
let spaceDown = false;   // зажат пробел — режим панорамы
let lastFill = '#4F8CFF';
let lastStroke = '#111827';
let lastNudge = 0;       // кластеризация стрелок-сдвигов в один шаг undo
let dragLayerId = null;  // id перетаскиваемого слоя
let cssW = 0, cssH = 0, dpr = 1;
let idc = 0;

const uid = () => 'n' + (crypto.randomUUID ? crypto.randomUUID() : (++idc) + '-' + Date.now());
const byId = id => state.nodes.find(n => n.id === id);
const selectedNodes = () => state.nodes.filter(n => state.selection.has(n.id));

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const stage = $('stage');
const te = $('textEditor');
const hint = $('hint');
const zoomLabel = $('zoomLabel');
const undoBtn = $('undoBtn');
const redoBtn = $('redoBtn');
const layerList = $('layerList');
const emptyMsg = $('emptyMsg');
const fields = $('fields');
const pxI = $('px'), pyI = $('py'), pwI = $('pw'), phI = $('ph');
const fillChk = $('fillChk'), fillColorI = $('fillColor'), fillHexI = $('fillHex');
const strokeChk = $('strokeChk'), strokeColorI = $('strokeColor'), strokeHexI = $('strokeHex'), strokeWidthI = $('strokeWidth');
const opacityI = $('opacity'), opacityOut = $('opacityOut');
const radiusRow = $('radiusRow'), radiusI = $('radius');
const textRow = $('textRow'), textSizeI = $('textSize'), textContentI = $('textContent');
const dupBtn = $('dupBtn'), delBtn = $('delBtn');

/* Измерение текста — на отдельном холсте с единичной матрицей,
 * чтобы метрики не зависели от текущего масштаба основного холста. */
const mctx = document.createElement('canvas').getContext('2d');
const fontStr = size => `500 ${size}px ${FONT}`;
function fitText(n) {
  mctx.font = fontStr(n.fontSize);
  n.w = Math.max(8, Math.ceil(mctx.measureText(n.text || ' ').width) + 4);
  n.h = Math.ceil(n.fontSize * 1.35);
}

/* ---------- История (снимки модели) ---------- */
let history = [], hi = -1;
const serialize = () => JSON.stringify(state.nodes);
function pushHistory() {
  history = history.slice(0, hi + 1);
  history.push(serialize());
  if (history.length > 200) history.shift();
  hi = history.length - 1;
  updateHistoryButtons();
}
function restore() {
  state.nodes = JSON.parse(history[hi]);
  const ids = new Set(state.nodes.map(n => n.id));
  for (const id of [...state.selection]) if (!ids.has(id)) state.selection.delete(id);
  renderAll();
}
function doUndo() { if (hi <= 0) return; hi--; restore(); }
function doRedo() { if (hi >= history.length - 1) return; hi++; restore(); }
function updateHistoryButtons() {
  undoBtn.disabled = hi <= 0;
  redoBtn.disabled = hi >= history.length - 1;
}

/* ---------- Фабрика объектов ---------- */
const NAME_PREFIX = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', text: 'Text' };
function nextName(type) {
  const pref = NAME_PREFIX[type];
  let i = 1;
  while (state.nodes.some(n => n.name === `${pref} ${i}`)) i++;
  return `${pref} ${i}`;
}
function makeNode(type, props) {
  const base = {
    id: uid(), type, name: nextName(type),
    x: 0, y: 0, w: 100, h: 100,
    fill: lastFill, stroke: null, strokeWidth: 2,
    opacity: 100, radius: 0, visible: true,
    text: '', fontSize: 24,
  };
  if (type === 'text') base.fill = '#111827';
  if (type === 'line') { base.fill = null; base.stroke = lastStroke; }
  return Object.assign(base, props);
}

/* ---------- Геометрия ---------- */
function bounds(n) {
  if (n.type === 'line') {
    return { x: Math.min(n.x, n.x + n.w), y: Math.min(n.y, n.y + n.h), w: Math.abs(n.w), h: Math.abs(n.h) };
  }
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}
function unionBounds(sel) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of sel) {
    const b = bounds(n);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
const normRect = (a, b) => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
});
const intersects = (a, b) =>
  !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);

function distSeg(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!l2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/* Тест попадания: сверху вниз по z-order, клип по фрейму */
function hitTest(p) {
  if (p.x < 0 || p.y < 0 || p.x > FRAME.w || p.y > FRAME.h) return null;
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i];
    if (!n.visible) continue;
    if (n.type === 'line') {
      if (distSeg(p, { x: n.x, y: n.y }, { x: n.x + n.w, y: n.y + n.h }) <= 6 / vp.scale) return n;
      continue;
    }
    const b = bounds(n);
    if (n.type === 'ellipse') {
      const rx = Math.max(1e-6, b.w / 2), ry = Math.max(1e-6, b.h / 2);
      const dx = (p.x - (b.x + rx)) / rx, dy = (p.y - (b.y + ry)) / ry;
      if (dx * dx + dy * dy <= 1) return n;
    } else if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      return n;
    }
  }
  return null;
}

/* ---------- Ручки масштабирования ---------- */
const handlesFor = n => n.type !== 'line';
function handlePositions(b) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return [
    { id: 'nw', cx: b.x, cy: b.y }, { id: 'n', cx, cy: b.y }, { id: 'ne', cx: b.x + b.w, cy: b.y },
    { id: 'e', cx: b.x + b.w, cy }, { id: 'se', cx: b.x + b.w, cy: b.y + b.h },
    { id: 's', cx, cy: b.y + b.h }, { id: 'sw', cx: b.x, cy: b.y + b.h }, { id: 'w', cx, cy },
  ];
}
function hitHandle(p, b) {
  const t = 6 / vp.scale;
  for (const h of handlePositions(b)) {
    if (Math.abs(p.x - h.cx) <= t && Math.abs(p.y - h.cy) <= t) return h.id;
  }
  return null;
}
function resizeBBox(start, handle, dx, dy) {
  let { x, y, w, h } = start;
  if (handle.includes('w')) { x = start.x + dx; w = start.w - dx; }
  if (handle.includes('e')) { w = start.w + dx; }
  if (handle.includes('n')) { y = start.y + dy; h = start.h - dy; }
  if (handle.includes('s')) { h = start.h + dy; }
  if (w < 1) { w = 1; if (handle.includes('w')) x = start.x + start.w - 1; }
  if (h < 1) { h = 1; if (handle.includes('n')) y = start.y + start.h - 1; }
  return { x, y, w, h };
}
const HC = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
};

/* ---------- Координаты и вьюпорт ---------- */
function toWorld(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left - vp.x) / vp.scale, y: (e.clientY - r.top - vp.y) / vp.scale };
}
function zoomAt(cx, cy, ns) {
  ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, ns));
  const wx = (cx - vp.x) / vp.scale, wy = (cy - vp.y) / vp.scale;
  vp.scale = ns;
  vp.x = cx - wx * ns;
  vp.y = cy - wy * ns;
  render();
}
function fitView() {
  const m = 48;
  const s = Math.min((cssW - m * 2) / FRAME.w, (cssH - m * 2) / FRAME.h);
  vp.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  vp.x = (cssW - FRAME.w * vp.scale) / 2;
  vp.y = (cssH - FRAME.h * vp.scale) / 2;
}

/* ---------- Отрисовка ---------- */
function roundRect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
function drawNode(g, n) {
  if (!n.visible || n.id === state.editingId) return;
  g.save();
  g.globalAlpha *= n.opacity / 100;
  const b = bounds(n);
  if (n.type === 'rect') {
    roundRect(g, b.x, b.y, b.w, b.h, Math.min(n.radius, b.w / 2, b.h / 2));
    if (n.fill) { g.fillStyle = n.fill; g.fill(); }
    if (n.stroke && n.strokeWidth > 0) { g.strokeStyle = n.stroke; g.lineWidth = n.strokeWidth; g.stroke(); }
  } else if (n.type === 'ellipse') {
    g.beginPath();
    g.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(0.01, b.w / 2), Math.max(0.01, b.h / 2), 0, 0, Math.PI * 2);
    if (n.fill) { g.fillStyle = n.fill; g.fill(); }
    if (n.stroke && n.strokeWidth > 0) { g.strokeStyle = n.stroke; g.lineWidth = n.strokeWidth; g.stroke(); }
  } else if (n.type === 'line') {
    g.beginPath();
    g.moveTo(n.x, n.y);
    g.lineTo(n.x + n.w, n.y + n.h);
    g.strokeStyle = n.stroke || '#111827';
    g.lineWidth = Math.max(1, n.strokeWidth);
    g.lineCap = 'round';
    g.stroke();
  } else if (n.type === 'text' && n.text) {
    g.fillStyle = n.fill || '#111827';
    g.font = fontStr(n.fontSize);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(n.text, n.x, n.y + n.h / 2);
  }
  g.restore();
}
function drawSelectionUI() {
  const sel = selectedNodes();
  ctx.lineWidth = 1.5 / vp.scale;
  ctx.strokeStyle = '#0D99FF';
  for (const n of sel) {
    const b = bounds(n);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }
  if (gesture && gesture.type === 'marquee' && gesture.cur) {
    const b = normRect(gesture.start, gesture.cur);
    ctx.fillStyle = 'rgba(13,153,255,0.08)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.lineWidth = 1 / vp.scale;
    ctx.strokeStyle = '#0D99FF';
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }
  if (sel.length === 1 && handlesFor(sel[0])) {
    const b = bounds(sel[0]);
    const hs = 8 / vp.scale;
    ctx.lineWidth = 1.5 / vp.scale;
    for (const h of handlePositions(b)) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(h.cx - hs / 2, h.cy - hs / 2, hs, hs);
      ctx.strokeStyle = '#0D99FF';
      ctx.strokeRect(h.cx - hs / 2, h.cy - hs / 2, hs, hs);
    }
  }
}
function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#1E1E1E';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.translate(vp.x, vp.y);
  ctx.scale(vp.scale, vp.scale);

  // фрейм-холст с тенью
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 40 / vp.scale;
  ctx.shadowOffsetY = 10 / vp.scale;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, FRAME.w, FRAME.h);
  ctx.restore();

  // содержимое — с клипом по фрейму (как в Figma)
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, FRAME.w, FRAME.h);
  ctx.clip();
  for (const n of state.nodes) drawNode(ctx, n);
  ctx.restore();

  // подпись фрейма
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = fontStr(12 / vp.scale);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('Frame 1', 0, -8 / vp.scale);

  drawSelectionUI();
  zoomLabel.textContent = Math.round(vp.scale * 100) + '%';
}

/* ---------- Слои ---------- */
const ICONS = { rect: '▭', ellipse: '◯', line: '╱', text: 'T' };
function renderLayers() {
  layerList.textContent = '';
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i];
    const li = document.createElement('li');
    li.className = 'layer' + (state.selection.has(n.id) ? ' sel' : '') + (n.visible ? '' : ' hidden-node');
    li.draggable = true;

    const grip = document.createElement('span'); grip.className = 'grip'; grip.textContent = '⠿';
    const eye = document.createElement('button'); eye.className = 'eye';
    eye.title = 'Показать/скрыть'; eye.textContent = n.visible ? '👁' : '—';
    const ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = ICONS[n.type];
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = n.name;
    li.append(grip, eye, ico, nm);

    eye.addEventListener('click', ev => {
      ev.stopPropagation();
      n.visible = !n.visible;
      pushHistory();
      renderAll();
    });
    li.addEventListener('click', () => {
      if (!state.selection.has(n.id)) state.selection = new Set([n.id]);
      renderAll();
    });
    li.addEventListener('dblclick', () => startRename(li, n));

    // перетаскивание для смены порядка слоёв
    li.addEventListener('dragstart', ev => {
      dragLayerId = n.id;
      ev.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => {
      dragLayerId = null;
      layerList.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
      li.classList.remove('dragging');
    });
    li.addEventListener('dragover', ev => { ev.preventDefault(); li.classList.add('drag-over'); });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', ev => {
      ev.preventDefault();
      li.classList.remove('drag-over');
      const after = ev.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
      dropLayer(n, after);
    });

    layerList.appendChild(li);
  }
}
function dropLayer(target, after) {
  if (!dragLayerId || dragLayerId === target.id) return;
  const arr = state.nodes;
  const from = arr.findIndex(x => x.id === dragLayerId);
  if (from < 0) return;
  const [node] = arr.splice(from, 1);
  let to = arr.findIndex(x => x.id === target.id);
  if (after) to += 1;
  arr.splice(to, 0, node);
  pushHistory();
  renderAll();
}
function startRename(li, n) {
  const nm = li.querySelector('.nm');
  if (!nm) return;
  const inp = document.createElement('input');
  inp.className = 'rename';
  inp.value = n.name;
  nm.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    if (save && inp.value.trim()) { n.name = inp.value.trim(); pushHistory(); }
    renderLayers();
  };
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') finish(true);
    if (ev.key === 'Escape') finish(false);
  });
}

/* ---------- Панель свойств ---------- */
function setVal(el, v) { if (document.activeElement !== el) el.value = v; }
function syncProps() {
  const sel = selectedNodes();
  const has = sel.length > 0;
  emptyMsg.style.display = has ? 'none' : 'block';
  fields.style.display = has ? 'block' : 'none';
  if (!has) return;
  const first = sel[0];
  const multi = sel.length > 1;
  const b = multi ? unionBounds(sel) : bounds(first);
  setVal(pxI, Math.round(b.x)); setVal(pyI, Math.round(b.y));
  setVal(pwI, Math.round(b.w)); setVal(phI, Math.round(b.h));
  pxI.disabled = pyI.disabled = pwI.disabled = phI.disabled = multi;

  // Заливка
  fillChk.classList.toggle('off', !first.fill);
  fillChk.style.background = first.fill || 'transparent';
  const fc = first.fill || lastFill;
  fillColorI.value = fc; fillColorI.disabled = !first.fill;
  setVal(fillHexI, fc.slice(1).toUpperCase()); fillHexI.disabled = !first.fill;

  // Обводка
  strokeChk.classList.toggle('off', !first.stroke);
  strokeChk.style.background = first.stroke || 'transparent';
  const sc = first.stroke || lastStroke;
  strokeColorI.value = sc; strokeColorI.disabled = !first.stroke;
  setVal(strokeHexI, sc.slice(1).toUpperCase()); strokeHexI.disabled = !first.stroke;
  setVal(strokeWidthI, first.strokeWidth);

  // Прозрачность
  setVal(opacityI, first.opacity);
  opacityOut.textContent = first.opacity + '%';

  // Скругление — только для прямоугольников
  radiusRow.style.display = sel.some(n => n.type === 'rect') ? 'flex' : 'none';
  setVal(radiusI, first.radius);

  // Текст — только при одиночном выделении текстового узла
  const onlyText = sel.length === 1 && first.type === 'text';
  textRow.style.display = onlyText ? 'flex' : 'none';
  if (onlyText) { setVal(textSizeI, first.fontSize); setVal(textContentI, first.text); }
}

function normHex(s) {
  s = String(s).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null;
}
function applyToSelection(fn) { for (const n of selectedNodes()) fn(n); }

function bindProps() {
  const applyGeom = () => {
    const sel = selectedNodes();
    if (sel.length !== 1) return;
    const n = sel[0];
    n.x = +pxI.value || 0;
    n.y = +pyI.value || 0;
    n.w = Math.max(1, +pwI.value || 1);
    n.h = Math.max(1, +phI.value || 1);
    pushHistory(); renderAll();
  };
  [pxI, pyI, pwI, phI].forEach(el => el.addEventListener('change', applyGeom));

  fillChk.addEventListener('click', () => {
    const sel = selectedNodes();
    if (!sel.length) return;
    const turnOn = !sel[0].fill;
    applyToSelection(n => { n.fill = turnOn ? lastFill : null; });
    pushHistory(); renderAll();
  });
  fillColorI.addEventListener('input', () => {
    lastFill = fillColorI.value;
    applyToSelection(n => { n.fill = fillColorI.value; });
    render();
  });
  fillColorI.addEventListener('change', () => { pushHistory(); renderAll(); });
  fillHexI.addEventListener('change', () => {
    const v = normHex(fillHexI.value);
    if (!v) { syncProps(); return; }
    lastFill = v;
    applyToSelection(n => { n.fill = v; });
    pushHistory(); renderAll();
  });

  strokeChk.addEventListener('click', () => {
    const sel = selectedNodes();
    if (!sel.length) return;
    const turnOn = !sel[0].stroke;
    applyToSelection(n => { n.stroke = turnOn ? lastStroke : null; });
    pushHistory(); renderAll();
  });
  strokeColorI.addEventListener('input', () => {
    lastStroke = strokeColorI.value;
    applyToSelection(n => { n.stroke = strokeColorI.value; });
    render();
  });
  strokeColorI.addEventListener('change', () => { pushHistory(); renderAll(); });
  strokeHexI.addEventListener('change', () => {
    const v = normHex(strokeHexI.value);
    if (!v) { syncProps(); return; }
    lastStroke = v;
    applyToSelection(n => { n.stroke = v; });
    pushHistory(); renderAll();
  });
  strokeWidthI.addEventListener('change', () => {
    const w = Math.max(0, Math.min(100, +strokeWidthI.value || 0));
    applyToSelection(n => { n.strokeWidth = w; });
    pushHistory(); renderAll();
  });

  opacityI.addEventListener('input', () => {
    applyToSelection(n => { n.opacity = +opacityI.value; });
    opacityOut.textContent = opacityI.value + '%';
    render();
  });
  opacityI.addEventListener('change', () => { pushHistory(); render(); });

  radiusI.addEventListener('input', () => {
    const r = Math.max(0, Math.min(500, +radiusI.value || 0));
    applyToSelection(n => { if (n.type === 'rect') n.radius = r; });
    render();
  });
  radiusI.addEventListener('change', () => { pushHistory(); render(); });

  textSizeI.addEventListener('change', () => {
    const sel = selectedNodes();
    if (sel.length !== 1 || sel[0].type !== 'text') return;
    const n = sel[0];
    n.fontSize = Math.min(400, Math.max(4, +textSizeI.value || 24));
    fitText(n);
    pushHistory(); renderAll();
  });
  textContentI.addEventListener('input', () => {
    const sel = selectedNodes();
    if (sel.length !== 1 || sel[0].type !== 'text') return;
    const n = sel[0];
    n.text = textContentI.value;
    fitText(n);
    render();
  });
  textContentI.addEventListener('change', () => { pushHistory(); renderAll(); });

  dupBtn.addEventListener('click', duplicateSelection);
  delBtn.addEventListener('click', deleteSelection);
}

/* ---------- Операции над выделением ---------- */
function deleteSelection() {
  if (!state.selection.size) return;
  state.nodes = state.nodes.filter(n => !state.selection.has(n.id));
  state.selection.clear();
  pushHistory();
  renderAll();
}
function duplicateSelection() {
  const sel = selectedNodes();
  if (!sel.length) return;
  const clones = sel.map(n => {
    const c = JSON.parse(JSON.stringify(n));
    c.id = uid();
    c.x += 12; c.y += 12;
    c.name = nextName(n.type);
    return c;
  });
  const arr = state.nodes;
  sel.forEach((n, i) => arr.splice(arr.indexOf(n) + 1, 0, clones[i]));
  state.selection = new Set(clones.map(c => c.id));
  pushHistory();
  renderAll();
}
function nudge(dx, dy) {
  applyToSelection(n => { n.x += dx; n.y += dy; });
  const now = Date.now();
  if (now - lastNudge > 700) { pushHistory(); lastNudge = now; } // серия стрелок = один шаг истории
  syncProps();
  render();
}

/* ---------- Редактор текста поверх канваса ---------- */
function openEditor(n) {
  state.editingId = n.id;
  te.value = n.text || '';
  te.style.left = (vp.x + n.x * vp.scale) + 'px';
  te.style.top = (vp.y + n.y * vp.scale) + 'px';
  te.style.width = Math.max(24, n.w * vp.scale) + 'px';
  te.style.height = Math.max(24, n.h * vp.scale) + 'px';
  te.style.fontSize = (n.fontSize * vp.scale) + 'px';
  te.style.lineHeight = (n.h * vp.scale) + 'px';
  te.style.color = n.fill || '#111827';
  te.classList.add('open');
  te.focus();
  te.setSelectionRange(te.value.length, te.value.length);
  render();
}
function endTextEdit() {
  if (!state.editingId) return;
  const id = state.editingId;
  state.editingId = null;
  const val = te.value;
  te.classList.remove('open');
  te.value = '';
  const n = byId(id);
  if (n) {
    if (!val.trim()) {
      // пустой текстовый слой удаляется, как в Figma
      state.nodes = state.nodes.filter(x => x.id !== id);
      state.selection.delete(id);
    } else {
      n.text = val;
      fitText(n);
    }
    pushHistory();
  }
  renderAll();
}

/* ---------- Указатель ---------- */
function cursorForTool() { return state.tool === 'select' ? 'default' : 'crosshair'; }
function updateHover(e) {
  if (state.tool !== 'select' || spaceDown) { canvas.style.cursor = spaceDown ? 'grab' : cursorForTool(); return; }
  const p = toWorld(e);
  const sel = selectedNodes();
  if (sel.length === 1 && handlesFor(sel[0])) {
    const hid = hitHandle(p, bounds(sel[0]));
    if (hid) { canvas.style.cursor = HC[hid]; return; }
  }
  canvas.style.cursor = hitTest(p) ? 'move' : 'default';
}

canvas.addEventListener('pointerdown', e => {
  endTextEdit();
  canvas.setPointerCapture(e.pointerId);

  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y };
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;

  const p = toWorld(e);

  if (state.tool === 'select') {
    const sel = selectedNodes();
    if (sel.length === 1 && handlesFor(sel[0])) {
      const hid = hitHandle(p, bounds(sel[0]));
      if (hid) {
        gesture = { type: 'resize', id: sel[0].id, handle: hid, start: p, bbox: { ...bounds(sel[0]) }, moved: false };
        return;
      }
    }
    const node = hitTest(p);
    if (node) {
      if (e.shiftKey) {
        if (state.selection.has(node.id)) state.selection.delete(node.id);
        else state.selection.add(node.id);
        if (!state.selection.has(node.id)) { renderAll(); return; } // сняли выделение — жест не начинаем
      } else if (!state.selection.has(node.id)) {
        state.selection = new Set([node.id]);
        renderAll();
      }
      gesture = {
        type: 'move', start: p,
        snap: selectedNodes().map(n => ({ id: n.id, x: n.x, y: n.y })),
        moved: false,
      };
      return;
    }
    // клик по пустому месту — рамка выделения
    gesture = { type: 'marquee', start: p, cur: p, base: new Set(e.shiftKey ? state.selection : []) };
    if (!e.shiftKey && state.selection.size) { state.selection.clear(); renderAll(); }
    return;
  }

  // инструмент «Текст»: клик создаёт слой и сразу открывает редактор
  if (state.tool === 'text') {
    const n = makeNode('text', { x: p.x, y: p.y, text: '' });
    fitText(n);
    state.nodes.push(n);
    state.selection = new Set([n.id]);
    setTool('select');
    renderAll();
    openEditor(n);
    return;
  }

  // рисование фигур
  const n = makeNode(state.tool, { x: p.x, y: p.y, w: 0, h: 0 });
  state.nodes.push(n);
  state.selection = new Set([n.id]);
  gesture = { type: 'draw', id: n.id, start: p };
  renderAll();
});

canvas.addEventListener('pointermove', e => {
  if (!gesture) { updateHover(e); return; }
  const p = toWorld(e);

  if (gesture.type === 'pan') {
    vp.x = gesture.vx + (e.clientX - gesture.sx);
    vp.y = gesture.vy + (e.clientY - gesture.sy);
    render();
    return;
  }
  if (gesture.type === 'move') {
    const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
    if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) gesture.moved = true;
    for (const s of gesture.snap) {
      const n = byId(s.id);
      if (n) { n.x = s.x + dx; n.y = s.y + dy; }
    }
    syncProps();
    render();
    return;
  }
  if (gesture.type === 'resize') {
    const n = byId(gesture.id);
    if (n) {
      const nb = resizeBBox(gesture.bbox, gesture.handle, p.x - gesture.start.x, p.y - gesture.start.y);
      n.x = nb.x; n.y = nb.y; n.w = nb.w; n.h = nb.h;
      gesture.moved = true;
      syncProps();
      render();
    }
    return;
  }
  if (gesture.type === 'marquee') { gesture.cur = p; render(); return; }
  if (gesture.type === 'draw') {
    const n = byId(gesture.id);
    if (n) { n.w = p.x - gesture.start.x; n.h = p.y - gesture.start.y; render(); }
  }
});

canvas.addEventListener('pointerup', e => {
  const g = gesture;
  if (!g) return;
  if (g.type === 'pan') {
    gesture = null;
    canvas.style.cursor = spaceDown ? 'grab' : cursorForTool();
    return;
  }
  gesture = null;

  if (g.type === 'draw') {
    const n = byId(g.id);
    if (n) {
      if (n.type === 'line') {
        if (Math.abs(n.w) < 3 && Math.abs(n.h) < 3) { n.w = 120; n.h = 0; } // клик без тяга = горизонталь
      } else {
        if (Math.abs(n.w) < 3 || Math.abs(n.h) < 3) { n.w = 120; n.h = 80; } // клик без тяга = дефолтный размер
        if (n.w < 0) { n.x += n.w; n.w = -n.w; }
        if (n.h < 0) { n.y += n.h; n.h = -n.h; }
      }
      pushHistory();
    }
    setTool('select');
    renderAll();
    return;
  }
  if (g.type === 'marquee') {
    const b = normRect(g.start, g.cur || g.start);
    const hits = new Set(g.base);
    for (const n of state.nodes) if (n.visible && intersects(bounds(n), b)) hits.add(n.id);
    state.selection = hits;
    renderAll();
    return;
  }
  if ((g.type === 'move' || g.type === 'resize') && g.moved) {
    pushHistory();
    renderAll();
    return;
  }
  render();
});

canvas.addEventListener('dblclick', e => {
  const n = hitTest(toWorld(e));
  if (n && n.type === 'text') openEditor(n);
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    zoomAt(e.offsetX, e.offsetY, vp.scale * Math.exp(-e.deltaY * 0.0015));
  } else {
    vp.x -= e.deltaX;
    vp.y -= e.deltaY;
    render();
  }
}, { passive: false });

/* ---------- Инструменты ---------- */
const HINTS = {
  select: 'V — выделение · R — прямоугольник · O — эллипс · L — линия · T — текст · Пробел — панорама · Ctrl+0 — вписать · Ctrl+Z — отмена',
  rect: 'Тяните мышью, чтобы нарисовать прямоугольник',
  ellipse: 'Тяните мышью, чтобы нарисовать эллипс',
  line: 'Тяните мышью, чтобы провести линию',
  text: 'Кликните по холсту, чтобы добавить текст',
};
function setTool(t) {
  state.tool = t;
  document.querySelectorAll('#toolbar .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  canvas.style.cursor = cursorForTool();
  hint.textContent = HINTS[t];
}

/* ---------- Клавиатура ---------- */
function cancelGesture() {
  if (!gesture) return;
  if (gesture.type === 'move' || gesture.type === 'resize') {
    for (const s of gesture.snap || []) {
      const n = byId(s.id);
      if (n) { n.x = s.x; n.y = s.y; }
    }
    if (gesture.type === 'resize') {
      const n = byId(gesture.id);
      if (n) Object.assign(n, gesture.bbox);
    }
  }
  // при прорисовке (draw) отменяем созданный узел
  if (gesture.type === 'draw') state.nodes = state.nodes.filter(n => n.id !== gesture.id);
  gesture = null;
  renderAll();
}

window.addEventListener('keydown', e => {
  const t = e.target;
  const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

  if (e.key === ' ' && !inField) { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (inField) { t.blur(); return; }
    cancelGesture();
    endTextEdit();
    if (state.selection.size) { state.selection.clear(); renderAll(); }
    return;
  }
  if (inField) return;

  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl && key === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (ctrl && key === 'y') { e.preventDefault(); doRedo(); return; }
  if (ctrl && key === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (ctrl && key === '0') { e.preventDefault(); fitView(); render(); return; }
  if (ctrl) return;

  switch (key) {
    case 'v': setTool('select'); break;
    case 'r': setTool('rect'); break;
    case 'o': setTool('ellipse'); break;
    case 'l': setTool('line'); break;
    case 't': setTool('text'); break;
    case 'delete': case 'backspace': e.preventDefault(); deleteSelection(); break;
    case 'arrowup': e.preventDefault(); nudge(0, e.shiftKey ? -10 : -1); break;
    case 'arrowdown': e.preventDefault(); nudge(0, e.shiftKey ? 10 : 1); break;
    case 'arrowleft': e.preventDefault(); nudge(e.shiftKey ? -10 : -1, 0); break;
    case 'arrowright': e.preventDefault(); nudge(e.shiftKey ? 10 : 1, 0); break;
    case '=': case '+': zoomAt(cssW / 2, cssH / 2, vp.scale * 1.25); break;
    case '-': zoomAt(cssW / 2, cssH / 2, vp.scale / 1.25); break;
  }
});
window.addEventListener('keyup', e => {
  if (e.key === ' ') { spaceDown = false; canvas.style.cursor = cursorForTool(); }
});

/* ---------- Экспорт ---------- */
function exportPNG() {
  const s = 2; // 2× для retina
  const c = document.createElement('canvas');
  c.width = FRAME.w * s;
  c.height = FRAME.h * s;
  const g = c.getContext('2d');
  g.scale(s, s);
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, FRAME.w, FRAME.h);
  g.save();
  g.beginPath(); g.rect(0, 0, FRAME.w, FRAME.h); g.clip();
  for (const n of state.nodes) drawNode(g, n);
  g.restore();
  c.toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'mini-figma.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}

/* ---------- Стартовое содержимое ---------- */
function seedSample() {
  const t1 = makeNode('text', { x: 120, y: 110, text: 'Mini Figma', fontSize: 64, fill: '#111827' });
  fitText(t1);
  const t2 = makeNode('text', { x: 120, y: 215, text: 'Канвас, фигуры, слои и история — всё в одном файле.', fontSize: 20, fill: '#6B7280' });
  fitText(t2);
  const r1 = makeNode('rect', { x: 120, y: 300, w: 320, h: 200, radius: 16, fill: '#4F8CFF' });
  const e1 = makeNode('ellipse', { x: 500, y: 300, w: 200, h: 200, fill: '#FF7A59' });
  const l1 = makeNode('line', { x: 120, y: 580, w: 580, h: 0, stroke: '#111827', strokeWidth: 3 });
  const r2 = makeNode('rect', { x: 120, y: 640, w: 580, h: 120, radius: 12, fill: '#F3F4F6' });
  state.nodes.push(t1, t2, r1, e1, l1, r2);
}

/* ---------- Инициализация ---------- */
function renderAll() { render(); renderLayers(); syncProps(); }
function resizeCanvas() {
  const r = stage.getBoundingClientRect();
  cssW = r.width; cssH = r.height;
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
}

document.querySelectorAll('#toolbar .tool').forEach(b => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});
undoBtn.addEventListener('click', doUndo);
redoBtn.addEventListener('click', doRedo);
$('zoomOutBtn').addEventListener('click', () => zoomAt(cssW / 2, cssH / 2, vp.scale / 1.25));
$('zoomInBtn').addEventListener('click', () => zoomAt(cssW / 2, cssH / 2, vp.scale * 1.25));
$('fitBtn').addEventListener('click', () => { fitView(); render(); });
$('exportBtn').addEventListener('click', exportPNG);
te.addEventListener('input', () => {
  const n = byId(state.editingId);
  if (!n) return;
  n.text = te.value;
  fitText(n);
  render();
});
te.addEventListener('blur', endTextEdit);
window.addEventListener('resize', () => { resizeCanvas(); render(); });
bindProps();

seedSample();
pushHistory();
resizeCanvas();
fitView();
setTool('select');
renderAll();
