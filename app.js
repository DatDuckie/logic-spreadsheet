// Grid Configuration
let cols = 16;
let rows = 20;
let gridData = {}; // key: "R_C", value: { type, value, formula, inputs, history }

// Navigation & Strict State System
let cursorCol = 0;
let cursorRow = 0;
let selectedMenuIndex = 0;
let currentMode = 'INTERACT'; 
let activeGateCell = null;
let wiringInputs = [];

// Pinch-to-Zoom State
let currentScale = 1.0;
let initialPinchDistance = null;
let initialScale = 1.0;

// Context Menu Target
let contextTarget = null;

// Gamepad & Keyboard Timing Configuration
let lastInputTime = 0;
const tapDelay = 220; 
const inputDelay = 140;

const menuItems = [
  { type: 'EMPTY', label: 'Empty', class: 'menu-empty' },
  { type: 'INPUT', label: 'Input (0/1)', class: 'menu-input' },
  { type: 'ON_CONST', label: 'Always On', class: 'menu-const' },
  { type: 'AND', label: 'AND', class: 'menu-gate' },
  { type: 'OR', label: 'OR', class: 'menu-gate' },
  { type: 'XOR', label: 'XOR', class: 'menu-gate' },
  { type: 'NOT', label: 'NOT', class: 'menu-gate' },
  { type: 'STD_REF', label: 'Ref Cell', class: 'menu-std' }
];

if ('serviceWorker' in navigator) {
  const swCode = `
    self.addEventListener('install', e => self.skipWaiting());
    self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => new Response(''))));
  `;
  const blob = new Blob([swCode], { type: 'application/javascript' });
  navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(() => {});
}

function tryEnterFullscreen() {
  const docEl = document.documentElement;
  if (!document.fullscreenElement && docEl.requestFullscreen) {
    docEl.requestFullscreen().catch(() => {});
  }
}

function initGrid() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      gridData[`${r}_${c}`] = { type: 'EMPTY', value: 0, formula: '', inputs: [], history: [] };
    }
  }
}

function getColLetter(c) {
  let label = '';
  let num = c;
  while (num >= 0) {
    label = String.fromCharCode(65 + (num % 26)) + label;
    num = Math.floor(num / 26) - 1;
  }
  return label;
}

function getCellId(r, c) {
  return getColLetter(c) + (r + 1);
}

function triggerRumble(type = 'light') {
  const gamepads = navigator.getGamepads();
  const gp = gamepads[0];
  
  if (gp && gp.vibrationActuator) {
    const duration = type === 'medium' ? 70 : 35;
    const weakMag = type === 'medium' ? 0.5 : 0.2;
    const strongMag = type === 'medium' ? 0.7 : 0.3;

    gp.vibrationActuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration: duration,
      weakMagnitude: weakMag,
      strongMagnitude: strongMag
    }).catch(() => {});
  }
}

function renderGrid() {
  const wrapper = document.getElementById('grid-zoom-wrapper');
  let html = '<table class="spreadsheet-table"><thead><tr><th class="row-header">#</th>';
  
  for (let c = 0; c < cols; c++) {
    html += `<th class="col-header" data-col="${c}">${getColLetter(c)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let r = 0; r < rows; r++) {
    html += `<tr><td class="row-header" data-row="${r}">${r + 1}</td>`;
    for (let c = 0; c < cols; c++) {
      const cellKey = `${r}_${c}`;
      const cell = gridData[cellKey] || { type: 'EMPTY', value: 0 };
      
      let cssClass = 'cell ';
      if (cell.type === 'EMPTY') cssClass += 'empty';
      else if (cell.type === 'INPUT') cssClass += cell.value === 1 ? 'input-on' : 'input-off';
      else if (cell.type === 'ON_CONST') cssClass += cell.value === 1 ? 'const-on' : 'const-off';
      else if (['AND', 'OR', 'XOR', 'NOT'].includes(cell.type)) cssClass += cell.value === 1 ? 'gate-on' : 'gate-off';
      else if (cell.type === 'STD_REF') cssClass += cell.value === 1 ? 'std-ref-on' : 'std-ref-off';

      if (r === cursorRow && c === cursorCol) cssClass += ' focused';
      if (currentMode === 'WIRING' && wiringInputs.some(i => i.r === r && i.c === c)) {
        cssClass += ' wiring-target';
      }

      let displayVal = '';
      if (cell.type === 'INPUT' || cell.type === 'ON_CONST') displayVal = cell.value;
      else if (['AND', 'OR', 'XOR', 'NOT'].includes(cell.type)) displayVal = `${cell.type}(${cell.value})`;
      else if (cell.type === 'STD_REF') displayVal = cell.value;

      html += `<td class="${cssClass}" data-row="${r}" data-col="${c}">${displayVal}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  updateStatusBar();
  renderMenu();
  attachTableListeners();
}

function renderMenu() {
  const header = document.querySelector('header');
  header.classList.toggle('menu-locked', currentMode === 'MENU');

  const menuBar = document.getElementById('menu-bar');
  let html = '';
  menuItems.forEach((item, idx) => {
    const activeClass = idx === selectedMenuIndex ? 'active-menu' : '';
    html += `<div class="menu-item ${item.class} ${activeClass}" data-index="${idx}">${item.label}</div>`;
  });
  menuBar.innerHTML = html;

  document.querySelectorAll('.menu-item').forEach(el => {
    el.addEventListener('click', () => {
      tryEnterFullscreen();
      selectedMenuIndex = parseInt(el.dataset.index);
      currentMode = 'PLACING';
      triggerRumble('light');
      renderGrid();
    });
  });
}

function updateStatusBar() {
  const cellCoord = getCellId(cursorRow, cursorCol);
  const cell = gridData[`${cursorRow}_${cursorCol}`];
  let modeLabel = currentMode;
  if (currentMode === 'INTERACT') modeLabel = 'INTERACT (Left Stick/D-Pad to move)';
  if (currentMode === 'MENU') modeLabel = 'MENU (Right Stick / LB/RB to select tool, Start to confirm)';
  if (currentMode === 'PLACING') modeLabel = `PLACING: ${menuItems[selectedMenuIndex].label} (A to stamp, B to exit)`;
  if (currentMode === 'WIRING') modeLabel = 'WIRING (Select inputs with A, B or Select to finish)';
  
  let statusText = `Cell: ${cellCoord} | Mode: ${modeLabel}`;
  if (cell && cell.formula) statusText += ` | =${cell.formula}`;
  document.getElementById('status-text').innerText = statusText;
  document.getElementById('zoom-text').innerText = `Zoom: ${Math.round(currentScale * 100)}%`;
}

// Logic Evaluation Engine
function evaluateAll() {
  for (let i = 0; i < 6; i++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        evaluateCell(r, c);
      }
    }
  }
}

function evaluateCell(r, c) {
  const cell = gridData[`${r}_${c}`];
  if (!cell) return;

  if (cell.type === 'INPUT') return;
  if (cell.type === 'ON_CONST') {
    cell.value = 1;
    return;
  }

  if (cell.type === 'STD_REF' && cell.inputs.length === 1) {
    const target = gridData[`${cell.inputs[0].r}_${cell.inputs[0].c}`];
    cell.value = target ? target.value : 0;
  } else if (cell.type === 'NOT' && cell.inputs.length === 1) {
    const target = gridData[`${cell.inputs[0].r}_${cell.inputs[0].c}`];
    cell.value = target ? (target.value === 1 ? 0 : 1) : 0;
  } else if (cell.type === 'AND' && cell.inputs.length > 0) {
    let res = 1;
    cell.inputs.forEach(inp => {
      const target = gridData[`${inp.r}_${inp.c}`];
      if (!target || target.value === 0) res = 0;
    });
    cell.value = res;
  } else if (cell.type === 'OR' && cell.inputs.length > 0) {
    let res = 0;
    cell.inputs.forEach(inp => {
      const target = gridData[`${inp.r}_${inp.c}`];
      if (target && target.value === 1) res = 1;
    });
    cell.value = res;
  } else if (cell.type === 'XOR' && cell.inputs.length > 0) {
    let sum = 0;
    cell.inputs.forEach(inp => {
      const target = gridData[`${inp.r}_${inp.c}`];
      if (target && target.value === 1) sum++;
    });
    cell.value = (sum % 2 === 1) ? 1 : 0;
  }
}

function applyMenuItemToCursor() {
  const cellKey = `${cursorRow}_${cursorCol}`;
  const currentCell = gridData[cellKey];
  const selectedType = menuItems[selectedMenuIndex].type;
  
  if (currentMode === 'INTERACT') {
    if (currentCell.type === 'INPUT') {
      currentCell.value = currentCell.value === 1 ? 0 : 1;
      triggerRumble('medium');
      evaluateAll();
      renderGrid();
    }
    return;
  }

  if (currentMode === 'PLACING') {
    if (selectedType === 'EMPTY') {
      gridData[cellKey] = { type: 'EMPTY', value: 0, formula: '', inputs: [] };
      triggerRumble('light');
    } else if (selectedType === 'INPUT') {
      gridData[cellKey] = { type: 'INPUT', value: 1, formula: '', inputs: [] };
      triggerRumble('medium');
    } else if (selectedType === 'ON_CONST') {
      gridData[cellKey] = { type: 'ON_CONST', value: 1, formula: '', inputs: [] };
      triggerRumble('medium');
    } else if (['AND', 'OR', 'XOR', 'NOT', 'STD_REF'].includes(selectedType)) {
      currentMode = 'WIRING';
      activeGateCell = { r: cursorRow, c: cursorCol };
      wiringInputs = [];
      gridData[cellKey] = { type: selectedType, value: 0, formula: '', inputs: [] };
      triggerRumble('light');
    }
    
    evaluateAll();
    renderGrid();

    if (currentMode !== 'WIRING') {
      currentMode = 'INTERACT';
    }
  }
}

function handleCellClick(r, c) {
  tryEnterFullscreen();
  if (currentMode === 'MENU') return;

  cursorRow = r;
  cursorCol = c;

  if (currentMode === 'WIRING') {
    if (!activeGateCell) {
      currentMode = 'INTERACT';
      return;
    }
    
    const cell = gridData[`${activeGateCell.r}_${activeGateCell.c}`];
    if (!cell) {
      currentMode = 'INTERACT';
      activeGateCell = null;
      return;
    }
    
    if (cell.type === 'NOT' || cell.type === 'STD_REF') {
      cell.inputs = [{ r, c }];
      cell.formula = cell.type === 'STD_REF' ? `${getCellId(r, c)}` : `${cell.type}(${getCellId(r, c)})`;
      currentMode = 'INTERACT';
      activeGateCell = null;
      triggerRumble('medium');
    } else {
      const alreadyAdded = wiringInputs.some(inp => inp.r === r && inp.c === c);
      if (alreadyAdded) {
        triggerRumble('light');
        return;
      }

      if (wiringInputs.length < 10) {
        wiringInputs.push({ r, c });
        triggerRumble('light');
      }
      if (wiringInputs.length >= 10) {
        finishWiring();
        return;
      }
    }
    evaluateAll();
    renderGrid();
  } 
  else if (currentMode === 'INTERACT') {
    const cellKey = `${r}_${c}`;
    const currentCell = gridData[cellKey];
    if (currentCell && currentCell.type === 'INPUT') {
      currentCell.value = currentCell.value === 1 ? 0 : 1;
      triggerRumble('medium');
      evaluateAll();
      renderGrid();
    }
  } 
  else if (currentMode === 'PLACING') {
    applyMenuItemToCursor();
  }
}

function finishWiring() {
  if (activeGateCell) {
    const cell = gridData[`${activeGateCell.r}_${activeGateCell.c}`];
    cell.inputs = [...wiringInputs];
    const refs = wiringInputs.map(i => getCellId(i.r, i.c)).join(', ');
    cell.formula = refs ? `${cell.type}(${refs})` : '';
  }
  currentMode = 'INTERACT';
  activeGateCell = null;
  wiringInputs = [];
  triggerRumble('medium');
  evaluateAll();
  renderGrid();
}

// Reset Grid
document.getElementById('reset-btn').addEventListener('click', () => {
  if (confirm('Reset entire grid?')) {
    initGrid();
    cursorRow = 0;
    cursorCol = 0;
    currentMode = 'INTERACT';
    currentScale = 1.0;
    zoomWrapper.style.transform = `scale(1.0)`;
    triggerRumble('medium');
    renderGrid();
  }
});

// Row/Col Insertion & Deletion Logic
function executeGridAction(actionType) {
  if (!contextTarget) return;
  const { type, index } = contextTarget;
  const newGrid = {};

  if (type === 'ROW') {
    const insertAt = actionType === 'BEFORE' ? index : index + 1;
    rows++;
    for (let r = 0; r < rows; r++) {
      if (r === insertAt) {
        for (let c = 0; c < cols; c++) {
          newGrid[`${r}_${c}`] = { type: 'EMPTY', value: 0, formula: '', inputs: [] };
        }
        continue;
      }
      const oldR = r > insertAt ? r - 1 : r;
      for (let c = 0; c < cols; c++) {
        const cell = { ...gridData[`${oldR}_${c}`] };
        cell.inputs = cell.inputs.map(inp => ({
