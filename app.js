// Grid Configuration
let cols = 16;
let rows = 20;
let gridData = {}; // key: "R_C", value: { type, value, formula, inputs }

// Navigation & State
let cursorCol = 0;
let cursorRow = 0;
let selectedMenuIndex = 0;
let currentMode = 'NAV'; // 'NAV' or 'WIRING'
let activeGateCell = null;
let wiringInputs = [];

// Gamepad Debounce
let lastInputTime = 0;
const inputDelay = 140; // Milliseconds between controller inputs

const menuItems = [
  { type: 'EMPTY', label: 'Empty', class: 'menu-empty' },
  { type: 'INPUT', label: 'Input (0/1)', class: 'menu-input' },
  { type: 'AND', label: 'AND Gate', class: 'menu-gate' },
  { type: 'OR', label: 'OR Gate', class: 'menu-gate' },
  { type: 'XOR', label: 'XOR Gate', class: 'menu-gate' },
  { type: 'NOT', label: 'NOT Gate', class: 'menu-gate' },
  { type: 'STD_REF', label: 'Standard (Ref)', class: 'menu-std' }
];

// Initialize Grid
function initGrid() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      gridData[`${r}_${c}`] = { type: 'EMPTY', value: 0, formula: '', inputs: [] };
    }
  }
}

function getCellId(r, c) {
  return String.fromCharCode(65 + c) + (r + 1);
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
    }).catch(err => {
      // Ignore if haptics are unsupported/restricted on device
    });
  }
}

// Render Spreadsheet Table
function renderGrid() {
  const container = document.getElementById('grid-container');
  let html = '<table class="spreadsheet-table"><thead><tr><th class="row-header">#</th>';
  
  for (let c = 0; c < cols; c++) {
    html += `<th class="col-header" data-col="${c}">${String.fromCharCode(65 + c)}</th>`;
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
      if (currentMode === 'WIRING' && wiringPinnedCheck(r, c)) cssClass += ' wiring-target';

      let displayVal = '';
      if (cell.type === 'INPUT') displayVal = cell.value;
      else if (['AND', 'OR', 'XOR', 'NOT'].includes(cell.type)) displayVal = `${cell.type}(${cell.value})`;
      else if (cell.type === 'STD_REF') displayVal = cell.value;

      html += `<td class="${cssClass}" data-row="${r}" data-col="${c}">${displayVal}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  updateStatusBar();
  renderMenu();
  attachTableListeners();
}

function wiringPinnedCheck(r, c) {
  return wiringInputs.some(i => i.r === r && i.c === c);
}

function renderMenu() {
  const menuBar = document.getElementById('menu-bar');
  let html = '';
  menuItems.forEach((item, idx) => {
    const activeClass = idx === selectedMenuIndex ? 'active-menu' : '';
    html += `<div class="menu-item ${item.class} ${activeClass}" data-index="${idx}">${item.label}</div>`;
  });
  menuBar.innerHTML = html;
}

function updateStatusBar() {
  const cellCoord = getCellId(cursorRow, cursorCol);
  const cell = gridData[`${cursorRow}_${cursorCol}`];
  let statusText = `Cell: ${cellCoord} | Mode: ${currentMode}`;
  if (cell && cell.formula) statusText += ` | Formula: ${cell.formula}`;
  document.getElementById('status-text').innerText = statusText;
}

// Logic Evaluation Engine
function evaluateAll() {
  for (let i = 0; i < 5; i++) {
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
  
  // Shortcut: Toggle existing input switch directly
  if (currentCell.type === 'INPUT') {
    currentCell.value = currentCell.value === 1 ? 0 : 1;
    triggerRumble('medium');
    evaluateAll();
    renderGrid();
    return;
  }

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
  cursorRow = r;
  cursorCol = c;
  if (currentMode === 'WIRING') {
    const cell = gridData[`${activeGateCell.r}_${activeGateCell.c}`];
    
    if (cell.type === 'NOT' || cell.type === 'STD_REF') {
      cell.inputs = [{ r, c }];
      cell.formula = `${cell.type}(${getCellId(r, c)})`;
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
      }
    }
    evaluateAll();
    renderGrid();
  } else {
    renderGrid();
  }
}

function finishWiring() {
  if (activeGateCell) {
    const cell = gridData[`${activeGateCell.r}_${activeGateCell.c}`];
    cell.inputs = [...wiringInputs];
    const refs = wiringInputs.map(i => getCellId(i.r, i.c)).join(', ');
    cell.formula = `${cell.type}(${refs})`;
  }
  currentMode = 'NAV';
  activeGateCell = null;
  wiringInputs = [];
  triggerRumble('medium');
  evaluateAll();
  renderGrid();
}

// Mouse & Touch Context Menus
function attachTableListeners() {
  const cells = document.querySelectorAll('.cell');
  cells.forEach(cell => {
    cell.addEventListener('click', () => {
      const r = parseInt(cell.dataset.row);
      const c = parseInt(cell.dataset.col);
      handleCellClick(r, c);
    });
  });
}

// CSV Export
function exportToCSV() {
  let csvContent = '';
  for (let r = 0; r < rows; r++) {
    let rowArr = [];
    for (let c = 0; c < cols; c++) {
      const cell = gridData[`${r}_${c}`];
      rowArr.push(cell.formula ? `"${cell.formula}"` : cell.value);
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

// Gamepad API Poll Loop with Haptics & Debounce
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

  const up = gp.buttons[12].pressed;
  const down = gp.buttons[13].pressed;
  const left = gp.buttons[14].pressed;
  const right = gp.buttons[15].pressed;
  
  const btnA = gp.buttons[0].pressed;
  const btnB = gp.buttons[1].pressed;
  const btnLB = gp.buttons[4].pressed;
  const btnRB = gp.buttons[5].pressed;
  const btnStart = gp.buttons[9].pressed;

  if (currentMode === 'NAV') {
    if (up) { cursorRow = Math.max(0, cursorRow - 1); triggerRumble('light'); actionTaken = true; }
    if (down) { cursorRow = Math.min(rows - 1, cursorRow + 1); triggerRumble('light'); actionTaken = true; }
    if (left) { cursorCol = Math.max(0, cursorCol - 1); triggerRumble('light'); actionTaken = true; }
    if (right) { cursorCol = Math.min(cols - 1, cursorCol + 1); triggerRumble('light'); actionTaken = true; }
    
    if (btnLB) { selectedMenuIndex = (selectedMenuIndex - 1 + menuItems.length) % menuItems.length; triggerRumble('light'); actionTaken = true; }
    if (btnRB) { selectedMenuIndex = (selectedMenuIndex + 1) % menuItems.length; triggerRumble('light'); actionTaken = true; }
    
    if (btnA) { applyMenuItemToCursor(); actionTaken = true; }
    if (btnStart) { 
      const cell = gridData[`${cursorRow}_${cursorCol}`];
      if (['AND', 'OR', 'XOR', 'NOT', 'STD_REF'].includes(cell.type)) {
        currentMode = 'WIRING';
        activeGateCell = { r: cursorRow, c: cursorCol };
        wiringInputs = [];
        triggerRumble('medium');
      }
      actionTaken = true; 
    }
  } 
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
    evaluateAll();
    renderGrid();
  }

  return actionTaken;
}

// Keyboard Fallbacks
window.addEventListener('keydown', (e) => {
  if (currentMode === 'NAV') {
    if (e.key === 'ArrowUp') cursorRow = Math.max(0, cursorRow - 1);
    if (e.key === 'ArrowDown') cursorRow = Math.min(rows - 1, cursorRow + 1);
    if (e.key === 'ArrowLeft') cursorCol = Math.max(0, cursorCol - 1);
    if (e.key === 'ArrowRight') cursorCol = Math.min(cols - 1, cursorCol + 1);
    if (e.key === 'q' || e.key === 'Q') selectedMenuIndex = (selectedMenuIndex - 1 + menuItems.length) % menuItems.length;
    if (e.key === 'e' || e.key === 'E') selectedMenuIndex = (selectedMenuIndex + 1) % menuItems.length;
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
