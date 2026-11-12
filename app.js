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
          r: inp.r >= insertAt ? inp.r + 1 : inp.r,
          c: inp.c
        }));
        if (cell.formula && cell.inputs.length > 0) {
          const refs = cell.inputs.map(i => getCellId(i.r, i.c)).join(', ');
          cell.formula = cell.type === 'STD_REF' ? refs : `${cell.type}(${refs})`;
        }
        newGrid[`${r}_${c}`] = cell;
      }
    }
  } else if (type === 'COL') {
    const insertAt = actionType === 'BEFORE' ? index : index + 1;
    cols++;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c === insertAt) {
          newGrid[`${r}_${c}`] = { type: 'EMPTY', value: 0, formula: '', inputs: [] };
          continue;
        }
        const oldC = c > insertAt ? c - 1 : c;
        const cell = { ...gridData[`${r}_${oldC}`] };
        cell.inputs = cell.inputs.map(inp => ({
          r: inp.r,
          c: inp.c >= insertAt ? inp.c + 1 : inp.c
        }));
        if (cell.formula && cell.inputs.length > 0) {
          const refs = cell.inputs.map(i => getCellId(i.r, i.c)).join(', ');
          cell.formula = cell.type === 'STD_REF' ? refs : `${cell.type}(${refs})`;
        }
        newGrid[`${r}_${c}`] = cell;
      }
    }
  }

  gridData = newGrid;
  contextTarget = null;
  document.getElementById('context-menu').style.display = 'none';
  triggerRumble('medium');
  evaluateAll();
  renderGrid();
}

function executeDelete() {
  if (!contextTarget) return;
  const { type, index } = contextTarget;
  const newGrid = {};

  if (type === 'ROW' && rows > 1) {
    const delR = index;
    for (let r = 0; r < rows; r++) {
      if (r === delR) continue;
      const newR = r > delR ? r - 1 : r;
      for (let c = 0; c < cols; c++) {
        const cell = { ...gridData[`${r}_${c}`] };
        cell.inputs = cell.inputs.filter(inp => inp.r !== delR).map(inp => ({
          r: inp.r > delR ? inp.r - 1 : inp.r,
          c: inp.c
        }));
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
  } else if (type === 'COL' && cols > 1) {
    const delC = index;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c === delC) continue;
        const newC = c > delC ? c - 1 : c;
        const cell = { ...gridData[`${r}_${c}`] };
        cell.inputs = cell.inputs.filter(inp => inp.c !== delC).map(inp => ({
          r: inp.r,
          c: inp.c > delC ? inp.c - 1 : inp.c
        }));
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
  contextTarget = null;
  document.getElementById('context-menu').style.display = 'none';
  triggerRumble('medium');
  evaluateAll();
  renderGrid();
}

document.getElementById('ctx-insert-before').addEventListener('click', (e) => { e.stopPropagation(); executeGridAction('BEFORE'); });
document.getElementById('ctx-insert-after').addEventListener('click', (e) => { e.stopPropagation(); executeGridAction('AFTER'); });
document.getElementById('ctx-delete').addEventListener('click', (e) => { e.stopPropagation(); executeDelete(); });

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
      openContextMenu(e.clientX, e.clientY, 'COL', colIdx);
    });
    th.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      timer = setTimeout(() => {
        openContextMenu(touch.clientX, touch.clientY, 'COL', colIdx);
      }, 550);
    }, { passive: true });
    th.addEventListener('touchend', () => clearTimeout(timer));
  });

  document.querySelectorAll('.row-header[data-row]').forEach(td => {
    let timer;
    const rowIdx = parseInt(td.dataset.row);
    td.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, 'ROW', rowIdx);
    });
    const th = td;
    th.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      timer = setTimeout(() => {
        openContextMenu(touch.clientX, touch.clientY, 'ROW', rowIdx);
      }, 550);
    }, { passive: true });
    th.addEventListener('touchend', () => clearTimeout(timer));
  });
}

function openContextMenu(x, y, type, index) {
  contextTarget = { type, index };
  const menu = document.getElementById('context-menu');
  const safeX = Math.min(x, window.innerWidth - 180);
  const safeY = Math.min(y, window.innerHeight - 120);
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

// Gamepad Poll Loop with Joystick Support (Left Stick = Grid Navigation, Right Stick = Menu Scrolling)
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

  // D-Pad buttons
  const up = gp.buttons[12]?.pressed;
  const down = gp.buttons[13]?.pressed;
  const left = gp.buttons[14]?.pressed;
  const right = gp.buttons[15]?.pressed;
  
  // Joysticks (Axes) with deadzone threshold (0.5)
  const leftStickX = gp.axes[0] || 0;
  const leftStickY = gp.axes[1] || 0;
  const rightStickX = gp.axes[2] || 0; // Right stick X for menu horizontal scrolling

  const joyUp = leftStickY < -0.5 || up;
  const joyDown = leftStickY > 0.5 || down;
  const joyLeft = leftStickX < -0.5 || left;
  const joyRight = leftStickX > 0.5 || right;

  const btnA = gp.buttons[0]?.pressed;
  const btnB = gp.buttons[1]?.pressed;
  const btnLB = gp.buttons[4]?.pressed;
  const btnRB = gp.buttons[5]?.pressed;
  const btnSelect = gp.buttons[8]?.pressed; // Dedicated select for re-wiring
  const btnStart = gp.buttons[9]?.pressed;   // Dedicated start for menu

  const anyDirection = joyUp || joyDown || joyLeft || joyRight;
  const currentTime = performance.now();

  // 1. MENU MODE: Controlled by Start button, LB/RB, or Right Joystick X axis
  if (currentMode === 'MENU') {
    if (btnLB || joyLeft || rightStickX < -0.5) {
      selectedMenuIndex = (selectedMenuIndex - 1 + menuItems.length) % menuItems.length;
      triggerRumble('light');
      actionTaken = true;
    }
    if (btnRB || joyRight || rightStickX > 0.5) {
      selectedMenuIndex = (selectedMenuIndex + 1) % menuItems.length;
      triggerRumble('light');
      actionTaken = true;
    }
    if (btnStart || btnA) {
      currentMode = 'PLACING';
      triggerRumble('medium');
      actionTaken = true;
    }
    if (btnB) {
      currentMode = 'INTERACT';
      triggerRumble('light');
      actionTaken = true;
    }
  }
  // 2. INTERACT MODE: Safe navigation via Left Stick / D-Pad
  else if (currentMode === 'INTERACT') {
    if (anyDirection && (currentTime - lastInputTime > tapDelay)) {
      if (joyUp) cursorRow = Math.max(0, cursorRow - 1);
      if (joyDown) cursorRow = Math.min(rows - 1, cursorRow + 1);
      if (joyLeft) cursorCol = Math.max(0, cursorCol - 1);
      if (joyRight) cursorCol = Math.min(cols - 1, cols - 1 < 0 ? 0 : cols - 1); // bounds check
      cursorCol = Math.max(0, Math.min(cols - 1, cursorCol));
      
      triggerRumble('light');
      lastInputTime = currentTime;
      actionTaken = true;
    }

    if (btnA) {
      applyMenuItemToCursor();
      actionTaken = true;
    }
    if (btnStart) {
      currentMode = 'MENU';
      triggerRumble('medium');
      actionTaken = true;
    }
    if (btnSelect) {
      const cell = gridData[`${cursorRow}_${cursorCol}`];
      if (['AND', 'OR', 'XOR', 'NOT', 'STD_REF'].includes(cell.type)) {
        currentMode = 'WIRING';
        activeGateCell = { r: cursorRow, c: cursorCol };
        wiringInputs = [...cell.inputs];
        triggerRumble('medium');
        actionTaken = true;
      }
    }
  }
  // 3. PLACING MODE: Moving via Left Stick / D-Pad
  else if (currentMode === 'PLACING') {
    if (anyDirection && (currentTime - lastInputTime > tapDelay)) {
      if (joyUp) cursorRow = Math.max(0, cursorRow - 1);
      if (joyDown) cursorRow = Math.min(rows - 1, cursorRow + 1);
      if (joyLeft) cursorCol = Math.max(0, cursorCol - 1);
      if (joyRight) cursorCol = Math.min(cols - 1, cursorCol + 1);
      
      triggerRumble('light');
      lastInputTime = currentTime;
      actionTaken = true;
    }

    if (btnA) {
      applyMenuItemToCursor();
      actionTaken = true;
    }
    if (btnB) {
      currentMode = 'INTERACT';
      triggerRumble('medium');
      actionTaken = true;
    }
  }
  // 4. WIRING MODE: Moving via Left Stick / D-Pad
  else if (currentMode === 'WIRING') {
    if (anyDirection && (currentTime - lastInputTime > tapDelay)) {
      if (joyUp) cursorRow = Math.max(0, cursorRow - 1);
      if (joyDown) cursorRow = Math.min(rows - 1, cursorRow + 1);
      if (joyLeft) cursorCol = Math.max(0, cursorCol - 1);
      if (joyRight) cursorCol = Math.min(cols - 1, cursorCol + 1);
      
      triggerRumble('light');
      lastInputTime = currentTime;
      actionTaken = true;
    }

    if (btnA) {
      handleCellClick(cursorRow, cursorCol);
      actionTaken = true;
    }
    if (btnB || btnSelect) {
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
    if (e.key === 'ArrowLeft' || e.key === 'q') selectedMenuIndex = (selectedMenuIndex - 1 + menuItems.length) % menuItems.length;
    if (e.key === 'ArrowRight' || e.key === 'e') selectedMenuIndex = (selectedMenuIndex + 1) % menuItems.length;
    if (e.key === 'Enter' || e.key === 'Escape') { currentMode = 'PLACING'; }
  } else if (currentMode === 'INTERACT') {
    if (e.key === 'ArrowUp') cursorRow = Math.max(0, cursorRow - 1);
    if (e.key === 'ArrowDown') cursorRow = Math.min(rows - 1, cursorRow + 1);
    if (e.key === 'ArrowLeft') cursorCol = Math.max(0, cursorCol - 1);
    if (e.key === 'ArrowRight') cursorCol = Math.min(cols - 1, cursorCol + 1);
    if (e.key === 'm' || e.key === 'M') currentMode = 'MENU';
    if (e.key === 'Enter' || e.key === ' ') applyMenuItemToCursor();
  } else if (currentMode === 'PLACING') {
    if (e.key === 'ArrowUp') cursorRow = Math.max(0, cursorRow - 1);
    if (e.key === 'ArrowDown') cursorRow = Math.min(rows - 1, cursorRow + 1);
    if (e.key === 'ArrowLeft') cursorCol = Math.max(0, cursorCol - 1);
    if (e.key === 'ArrowRight') cursorCol = Math.min(cols - 1, cursorCol + 1);
    if (e.key === 'Escape' || e.key === 'b' || e.key === 'B') currentMode = 'INTERACT';
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
