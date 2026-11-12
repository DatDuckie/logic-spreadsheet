// Grid Configuration
let cols = 16;
let rows = 20;
let gridData = {}; // key: "R_C", value: { type, value, formula, inputs }

// Navigation & Mode State
let cursorCol = 0;
let cursorRow = 0;
let selectedMenuIndex = 0;
let currentMode = 'NAV'; // 'NAV', 'MENU', 'WIRING'
let activeGateCell = null;
let wiringInputs = [];
let forceOverwriteNext = false;

// Pinch-to-Zoom State
let currentScale = 1.0;
let initialPinchDistance = null;
let initialScale = 1.0;

// Context Menu Target
let deleteTarget = null;

// Gamepad & Keyboard Timing Configuration (Throttled D-pad movement to prevent overshooting)
let lastInputTime = 0;
const tapDelay = 220; // ~0.22s delay for comfortable single taps and smooth holding
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

// Register inline Service Worker for PWA offline caching
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
      gridData[`${r}_${c}`] = { type: 'EMPTY', value: 0, formula: '', inputs: [] };
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
  if (currentMode === 'MENU') {
    header.classList.add('menu-locked');
  } else {
    header.classList.remove('menu-locked');
  }

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
      forceOverwriteNext = true;
      currentMode = 'NAV';
      triggerRumble('light');
      renderGrid();
    });
  });
}

function updateStatusBar() {
  const cellCoord = getCellId(cursorRow, cursorCol);
  const cell = gridData[`${cursorRow}_${cursorCol}`];
  let modeLabel = currentMode;
  if (currentMode === 'MENU') modeLabel = 'MENU (Grid Locked)';
  if (currentMode === 'WIRING') modeLabel = 'WIRING (Select inputs, B to finish)';
  
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

// Action Handlers
function applyMenuItemToCursor() {
  const cellKey = `${cursorRow}_${cursorCol}`;
  const currentCell = gridData[cellKey];
  const selectedType = menuItems[selectedMenuIndex].type;
  
  if (!forceOverwriteNext && currentCell.type === 'INPUT') {
    currentCell.value = currentCell.value === 1 ? 0 : 1;
    triggerRumble('medium');
    evaluateAll();
    renderGrid();
    return;
  }

  forceOverwriteNext = false;

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
}

function handleCellClick(r, c) {
  tryEnterFullscreen();
  if (currentMode === 'MENU') return;

  cursorRow = r;
  cursorCol = c;

  if (currentMode === 'WIRING') {
    const cell = gridData[`${activeGateCell.r}_${activeGateCell.c}`];
    
    if (cell.type === 'NOT' || cell.type === 'STD_REF') {
      cell.inputs = [{ r, c }];
      cell.formula = cell.type === 'STD_REF' ? `${getCellId(r, c)}` : `${cell.type}(${getCellId(r, c)})`;
      currentMode = 'NAV';
      activeGateCell = null;
      triggerRumble('medium');
    } else {
      // Prevent duplicate cell input in multi-input gates
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
  } else {
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
  currentMode = 'NAV';
  activeGateCell = null;
  wiringInputs = [];
  triggerRumble('medium');
  evaluateAll();
  renderGrid();
}

// Delete Row or Column & Re-index Formulas
function executeDelete() {
  if (!deleteTarget) return;
  const newGrid = {};

  if (deleteTarget.type === 'ROW' && rows > 1) {
    const delR = deleteTarget.index;
    for (let r = 0; r < rows; r++) {
      if (r === delR) continue;
      const newR = r > delR ? r - 1 : r;
      for (let c = 0; c < cols; c++) {
        const cell = { ...gridData[`${r}_${c}`] };
        cell.inputs = cell.inputs
          .filter(inp => inp.r !== delR)
          .map(inp => ({ r: inp.r > delR ? inp.r - 1 : inp.r, c: inp.c }));
        if (cell.formula && cell.inputs.length > 0) {
          const refs = cell.inputs.map(i => getCellId(i.r, i.c)).join(', ');
          cell.formula = cell.type === 'STD_REF' ? refs : `${cell.type}(${refs})`;
        } else if (cell.formula) {
          cell.formula = '';
        }
        newGrid[`${newR}_${c}`] = cell;
      }
    }
    rows--;
    if (cursorRow >= rows) cursorRow = rows - 1;
  } else if (deleteTarget.type === 'COL' && cols > 1) {
    const delC = deleteTarget.index;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c === delC) continue;
        const newC = c > delC ? c - 1 : c;
        const cell = { ...gridData[`${r}_${c}`] };
        cell.inputs = cell.inputs
          .filter(inp => inp.c !== delC)
          .map(inp => ({ r: inp.r, c: inp.c > delC ? inp.c - 1 : inp.c }));
        if (cell.formula && cell.inputs.length > 0) {
          const refs = cell.inputs.map(i => getCellId(i.r, i.c)).join(', ');
          cell.formula = cell.type === 'STD_REF' ? refs : `${cell.type}(${refs})`;
        } else if (cell.formula) {
          cell.formula = '';
        }
        newGrid[`${r}_${newC}`] = cell;
      }
    }
    cols--;
    if (cursorCol >= cols) cursorCol = cols - 1;
  }

  gridData = newGrid;
  deleteTarget = null;
  document.getElementById('context-menu').style.display = 'none';
  triggerRumble('medium');
  evaluateAll();
  renderGrid();
}

document.getElementById('ctx-delete').addEventListener('click', (e) => {
  e.stopPropagation();
  executeDelete();
});

function attachTableListeners() {
  document.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const r = parseInt(cell.dataset.row);
      const c = parseInt(cell.dataset.col);
      handleCellClick(r, c);
    });
  });

  document.querySelectorAll('.col-header').forEach(th => {
    let timer;
    const colIdx = parseInt(th.dataset.col);
    th.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openDeleteMenu(e.clientX, e.clientY, 'COL', colIdx, `Delete Column ${getColLetter(colIdx)}`);
    });
    th.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      timer = setTimeout(() => {
        openDeleteMenu(touch.clientX, touch.clientY, 'COL', colIdx, `Delete Column ${getColLetter(colIdx)}`);
      }, 550);
    }, { passive: true });
    th.addEventListener('touchend', () => clearTimeout(timer));
  });

  document.querySelectorAll('.row-header[data-row]').forEach(td => {
    let timer;
    const rowIdx = parseInt(td.dataset.row);
    td.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openDeleteMenu(e.clientX, e.clientY, 'ROW', rowIdx, `Delete Row ${rowIdx + 1}`);
    });
    td.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      timer = setTimeout(() => {
        openDeleteMenu(touch.clientX, touch.clientY, 'ROW', rowIdx, `Delete Row ${rowIdx + 1}`);
      }, 550);
    }, { passive: true });
    td.addEventListener('touchend', () => clearTimeout(timer));
  });
}

function openDeleteMenu(x, y, type, index, label) {
  deleteTarget = { type, index };
  const menu = document.getElementById('context-menu');
  const item = document.getElementById('ctx-delete');
  item.innerText = label;
  const safeX = Math.min(x, window.innerWidth - 170);
  const safeY = Math.min(y, window.innerHeight - 60);
  menu.style.left = `${Math.max(10, safeX)}px`;
  menu.style.top = `${Math.max(10, safeY)}px`;
  menu.style.display = 'block';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#context-menu')) {
    document.getElementById('context-menu').style.display = 'none';
  }
});

// Pinch-to-Zoom
const gridContainer = document.getElementById('grid-container');
const zoomWrapper = document.getElementById('grid-zoom-wrapper');

function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

gridContainer.addEventListener('touchstart', (e) => {
  tryEnterFullscreen();
  if (e.touches.length === 2) {
    initialPinchDistance = getTouchDistance(e.touches);
    initialScale = currentScale;
  }
}, { passive: true });

gridContainer.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && initialPinchDistance) {
    e.preventDefault();
    const currentDist = getTouchDistance(e.touches);
    const scaleFactor = currentDist / initialPinchDistance;
    currentScale = Math.min(1.5, Math.max(0.35, initialScale * scaleFactor));
    zoomWrapper.style.transform = `scale(${currentScale})`;
    updateStatusBar();
  }
}, { passive: false });

gridContainer.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) initialPinchDistance = null;
});

// CSV Export
function exportToCSV() {
  tryEnterFullscreen();
  let csvContent = '';
  for (let r = 0; r < rows; r++) {
    let rowArr = [];
    for (let c = 0; c < cols; c++) {
      const cell = gridData[`${r}_${c}`];
      rowArr.push(cell.formula ? `"=${cell.formula}"` : cell.value);
    }
    csvContent += rowArr.join(',') + '\r\n';
  }
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'logic_circuit_sheet.csv';
  a.click();
}

document.getElementById('export-btn').addEventListener('click', exportToCSV);

// Gamepad API Poll Loop with 0.22s Throttled D-Pad Movement
function pollGamepads() {
  const gamepads = navigator.getGamepads();
  const gp = gamepads[0];

  if (gp) {
    const currentTime = performance.now();
    if (currentTime - lastInputTime > inputDelay) {
      if (handleControllerInput(gp)) {
        lastInputTime = currentTime;
      }
    }
  }
  requestAnimationFrame(pollGamepads);
}

function handleControllerInput(gp) {
  let actionTaken = false;

  const up = gp.buttons[12]?.pressed;
  const down = gp.buttons[13]?.pressed;
  const left = gp.buttons[14]?.pressed;
  const right = gp.buttons[15]?.pressed;
  
  const btnA = gp.buttons[0]?.pressed;
  const btnB = gp.buttons[1]?.pressed;
  const btnLB = gp.buttons[4]?.pressed;
  const btnRB = gp.buttons[5]?.pressed;
  const btnSelect = gp.buttons[8]?.pressed;
  const btnStart = gp.buttons[9]?.pressed;

  const anyDirection = up || down || left || right;
  const currentTime = performance.now();

  if (currentMode === 'MENU') {
    if (btnLB || left) {
      selectedMenuIndex = (selectedMenuIndex - 1 + menuItems.length) % menuItems.length;
      triggerRumble('light');
      actionTaken = true;
    }
    if (btnRB || right) {
      selectedMenuIndex = (selectedMenuIndex + 1) % menuItems.length;
      triggerRumble('light');
      actionTaken = true;
    }
    if (btnStart || btnSelect || btnA || btnB) {
      currentMode = 'NAV';
      forceOverwriteNext = true;
      triggerRumble('medium');
      actionTaken = true;
    }
  }
  else if (currentMode === 'NAV' || currentMode === 'WIRING') {
    // Throttled D-Pad movement (0.22s delay per step to prevent overshooting)
    if (anyDirection && (currentTime - lastInputTime > tapDelay)) {
      if (up) cursorRow = Math.max(0, cursorRow - 1);
      if (down) cursorRow = Math.min(rows - 1, cursorRow + 1);
      if (left) cursorCol = Math.max(0, cursorCol - 1);
      if (right) cursorCol = Math.min(cols - 1, cursorCol + 1);
      
      if (currentMode === 'NAV') forceOverwriteNext = false;
      triggerRumble('light');
      lastInputTime = currentTime;
      actionTaken = true;
    }

    if (currentMode === 'NAV') {
      if (btnA) {
        applyMenuItemToCursor();
        actionTaken = true;
      }
      if (btnSelect || btnStart) {
        const cell = gridData[`${cursorRow}_${cursorCol}`];
        if (['AND', 'OR', 'XOR', 'NOT', 'STD_REF'].includes(cell.type)) {
          currentMode = 'WIRING';
          activeGateCell = { r: cursorRow, c: cursorCol };
          wiringInputs = [...cell.inputs]; // Load existing inputs for quick re-editing
          triggerRumble('medium');
        } else {
          currentMode = 'MENU';
          triggerRumble('medium');
        }
        actionTaken = true;
      }
    } else if (currentMode === 'WIRING') {
      if (btnA) {
        handleCellClick(cursorRow, cursorCol);
        actionTaken = true;
      }
      if (btnB || btnStart || btnSelect) {
        finishWiring();
        actionTaken = true;
      }
    }
  }

  if (actionTaken) {
    tryEnterFullscreen();
    evaluateAll();
    renderGrid();
  }

  return actionTaken;
}

// Keyboard Fallbacks
window.addEventListener('keydown', (e) => {
  if (currentMode === 'MENU') {
    if (e.key === 'ArrowLeft' || e.key === 'q') selectedMenuIndex = (selectedMenuIndex - 1 + menuItems.length) % menuItems.length;
    if (e.key === 'ArrowRight' || e.key === 'e') selectedMenuIndex = (selectedMenuIndex + 1) % menuItems.length;
    if (e.key === 'Enter' || e.key === 'Escape') { currentMode = 'NAV'; forceOverwriteNext = true; }
  } else if (currentMode === 'NAV') {
    if (e.key === 'ArrowUp') { cursorRow = Math.max(0, cursorRow - 1); forceOverwriteNext = false; }
    if (e.key === 'ArrowDown') { cursorRow = Math.min(rows - 1, cursorRow + 1); forceOverwriteNext = false; }
    if (e.key === 'ArrowLeft') { cursorCol = Math.max(0, cursorCol - 1); forceOverwriteNext = false; }
    if (e.key === 'ArrowRight') { cursorCol = Math.min(cols - 1, cursorCol + 1); forceOverwriteNext = false; }
    if (e.key === 'm' || e.key === 'M') {
      const cell = gridData[`${cursorRow}_${cursorCol}`];
      if (['AND', 'OR', 'XOR', 'NOT', 'STD_REF'].includes(cell.type)) {
        currentMode = 'WIRING';
        activeGateCell = { r: cursorRow, c: cursorCol };
        wiringInputs = [...cell.inputs];
      } else {
        currentMode = 'MENU';
      }
    }
    if (e.key === 'Enter' || e.key === ' ') applyMenuItemToCursor();
  } else if (currentMode === 'WIRING') {
    if (e.key === 'ArrowUp') cursorRow = Math.max(0, cursorRow - 1);
    if (e.key === 'ArrowDown') cursorRow = Math.min(rows - 1, cursorRow + 1);
    if (e.key === 'ArrowLeft') cursorCol = Math.max(0, cursorCol - 1);
    if (e.key === 'ArrowRight') cursorCol = Math.min(cols - 1, cursorCol + 1);
    if (e.key === 'Enter') handleCellClick(cursorRow, cursorCol);
    if (e.key === 'b' || e.key === 'B' || e.key === 'Escape') finishWiring();
  }
  evaluateAll();
  renderGrid();
  e.preventDefault();
});

window.addEventListener('load', () => {
  initGrid();
  renderGrid();
  requestAnimationFrame(pollGamepads);
});
