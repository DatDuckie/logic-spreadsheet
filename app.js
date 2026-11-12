// Grid Configuration
let cols = 16;
let rows = 20;
let gridData = {}; // key: "R_C", value: { type, value, formula, inputs }

// Navigation & Mode State
// Modes:
// 'NAV'    = Moving cursor on grid & placing/toggling cells
// 'MENU'   = Locked onto top menu bar (LB/RB or D-Pad scrolls tools; grid is frozen)
// 'WIRING' = Selecting input cells for a logic gate or standard reference
let cursorCol = 0;
let cursorRow = 0;
let selectedMenuIndex = 0;
let currentMode = 'NAV'; 
let activeGateCell = null;
let wiringInputs = [];
let forceOverwriteNext = false; // True right after picking a new tool from MENU mode

// Pinch-to-Zoom State
let currentScale = 1.0;
let initialPinchDistance = null;
let initialScale = 1.0;

// Context Menu Target
let deleteTarget = null; // { type: 'ROW' | 'COL', index: number }

// Gamepad Debounce
let lastInputTime = 0;
const inputDelay = 140;

const menuItems = [
  { type: 'EMPTY', label: 'Empty', class: 'menu-empty' },
  { type: 'INPUT', label: 'Input (0/1)', class: 'menu-input' },
  { type: 'AND', label: 'AND', class: 'menu-gate' },
  { type: 'OR', label: 'OR', class: 'menu-gate' },
  { type: 'XOR', label: 'XOR', class: 'menu-gate' },
  { type: 'NOT', label: 'NOT', class: 'menu-gate' },
  { type: 'STD_REF', label: 'Ref Cell', class: 'menu-std' }
];

// Register inline Service Worker so Chrome allows PWA installation
if ('serviceWorker' in navigator) {
  const swCode = `
    self.addEventListener('install', e => self.skipWaiting());
    self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => new Response(''))));
  `;
  const blob = new Blob([swCode], { type: 'application/javascript' });
  navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(() => {});
}

// Auto-Fullscreen Request on First User Gesture
function tryEnterFullscreen() {
  const docEl = document.documentElement;
  if (!document.fullscreenElement && docEl.requestFullscreen) {
    docEl.requestFullscreen().catch(() => {});
  }
}

// Initialize Grid
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

// Haptic Feedback / Rumble Helper
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

// Render Spreadsheet Table
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
      else if (['AND', 'OR', 'XOR', 'NOT'].includes(cell.type)) cssClass += cell.value === 1 ? 'gate-on' : 'gate-off';
      else if (cell.type === 'STD_REF') cssClass += cell.value === 1 ? 'std-ref-on' : 'std-ref-off';

      if (r === cursorRow && c === cursorCol) cssClass += ' focused';
      if (currentMode === 'WIRING' && wiringInputs.some(i => i.r === r && i.c === c)) {
        cssClass += ' wiring-target';
      }

      let displayVal = '';
      if (cell.type === 'INPUT') displayVal = cell.value;
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

  // Allow tapping menu items directly on touchscreen
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
  if (!cell || cell.type === 'INPUT') return;

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
  
  // If we didn't just pick a new tool from the menu, and we're on an INPUT switch, toggle 0 <-> 1
  if (!forceOverwriteNext && currentCell.type === 'INPUT') {
    currentCell.value = currentCell.value === 1 ? 0 : 1;
    triggerRumble('medium');
    evaluateAll();
    renderGrid();
    return;
  }

  // Otherwise, place/overwrite with the chosen menu tool
  forceOverwriteNext = false;

  if (selectedType === 'EMPTY') {
    gridData[cellKey] = { type: 'EMPTY', value: 0, formula: '', inputs: [] };
    triggerRumble('light');
  } else if (selectedType === 'INPUT') {
    gridData[cellKey] = { type: 'INPUT', value: 1, formula: '', inputs: [] };
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
  if (currentMode === 'MENU') return; // Grid locked while menu is active

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

// Table Listeners (Cells + Mobile Long-Press / Desktop Right-Click Headers)
function attachTableListeners() {
  document.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const r = parseInt(cell.dataset.row);
      const c = parseInt(cell.dataset.col);
      handleCellClick(r, c);
    });
  });

  // Column Headers (Long press on mobile / Right click on PC)
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
    th.addEventListener('touchmove', () => clearTimeout(timer));
  });

  // Row Headers (Long press on mobile / Right click on PC)
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
    td.addEventListener('touchmove', () => clearTimeout(timer));
  });
}

function openDeleteMenu(x, y, type, index, label) {
  deleteTarget = { type, index };
  const menu = document.getElementById('context-menu');
  const item = document.getElementById('ctx-delete');
  item.innerText = label;

  // Keep menu inside screen bounds
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

// Two-Finger Pinch-to-Zoom on Grid Container
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
  if (e.touches.length < 2) {
    initialPinchDistance = null;
  }
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

// Gamepad API Poll Loop
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
  const btnStart = gp.buttons[9]?.pressed;

  // 1. MENU MODE: Top bar is unlocked; grid is completely frozen
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
    // Pressing Start, A, or B locks in the chosen tool and returns to the grid
    if (btnStart || btnA || btnB) {
      currentMode = 'NAV';
      forceOverwriteNext = true; // Next A press on grid will overwrite even if cell is an Input
      triggerRumble('medium');
      actionTaken = true;
    }
  }
  // 2. NAV MODE: Grid is active; Start button toggles MENU mode (or wires an existing gate)
  else if (currentMode === 'NAV') {
    if (up) { cursorRow = Math.max(0, cursorRow - 1); forceOverwriteNext = false; triggerRumble('light'); actionTaken = true; }
    if (down) { cursorRow = Math.min(rows - 1, cursorRow + 1); forceOverwriteNext = false; triggerRumble('light'); actionTaken = true; }
    if (left) { cursorCol = Math.max(0, cursorCol - 1); forceOverwriteNext = false; triggerRumble('light'); actionTaken = true; }
    if (right) { cursorCol = Math.min(cols - 1, cursorCol + 1); forceOverwriteNext = false; triggerRumble('light'); actionTaken = true; }
    
    if (btnA) {
      applyMenuItemToCursor();
      actionTaken = true;
    }
    if (btnStart) {
      // Enter MENU mode so user can scroll tools without touching the grid
      currentMode = 'MENU';
      triggerRumble('medium');
      actionTaken = true;
    }
  } 
  // 3. WIRING MODE: Selecting input sources for a gate
  else if (currentMode === 'WIRING') {
    if (up) { cursorRow = Math.max(0, cursorRow - 1); triggerRumble('light'); actionTaken = true; }
    if (down) { cursorRow = Math.min(rows - 1, cursorRow + 1); triggerRumble('light'); actionTaken = true; }
    if (left) { cursorCol = Math.max(0, cursorCol - 1); triggerRumble('light'); actionTaken = true; }
    if (right) { cursorCol = Math.min(cols - 1, cursorCol + 1); triggerRumble('light'); actionTaken = true; }

    if (btnA) {
      handleCellClick(cursorRow, cursorCol);
      actionTaken = true;
    }
    if (btnB || btnStart) {
      finishWiring();
      actionTaken = true;
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
    if (e.key === 'ArrowLeft' || e.key === 'q' || e.key === 'Q') {
      selectedMenuIndex = (selectedMenuIndex - 1 + menuItems.length) % menuItems.length;
    }
    if (e.key === 'ArrowRight' || e.key === 'e' || e.key === 'E') {
      selectedMenuIndex = (selectedMenuIndex + 1) % menuItems.length;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      currentMode = 'NAV';
      forceOverwriteNext = true;
    }
  } else if (currentMode === 'NAV') {
    if (e.key === 'ArrowUp') { cursorRow = Math.max(0, cursorRow - 1); forceOverwriteNext = false; }
    if (e.key === 'ArrowDown') { cursorRow = Math.min(rows - 1, cursorRow + 1); forceOverwriteNext = false; }
    if (e.key === 'ArrowLeft') { cursorCol = Math.max(0, cursorCol - 1); forceOverwriteNext = false; }
    if (e.key === 'ArrowRight') { cursorCol = Math.min(cols - 1, cursorCol + 1); forceOverwriteNext = false; }
    if (e.key === 'm' || e.key === 'M') currentMode = 'MENU';
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

// Initialize on Load
window.addEventListener('load', () => {
  initGrid();
  renderGrid();
  requestAnimationFrame(pollGamepads);
});
