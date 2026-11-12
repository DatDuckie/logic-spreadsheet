# LogicGrid Controls Reference

Welcome to **LogicGrid**! This guide details all the controls for both Bluetooth controllers and keyboards so you can efficiently build, wire, and interact with your logic circuits.

---

## 🎮 Controller Controls

LogicGrid is designed for seamless navigation using standard Bluetooth gamepads (like Xbox, PlayStation, or generic controllers).

### 1. Navigation & Interact Mode (`INTERACT`)
* **D-Pad / Left Stick:** Move the cursor across the grid.
* **A Button:** Toggle input switches (`0` $\leftrightarrow$ `1`) or interact with cells.
* **Select / Start Button:** 
  * If hovering over an existing gate (`AND`, `OR`, `XOR`, `NOT`, `STD_REF`), it enters **Wiring Mode** to re-edit its inputs.
  * If hovering over a normal or empty cell, it locks focus onto the top toolbar (**Menu Mode**).

### 2. Menu Mode (`MENU`)
* **LB / RB (or D-Pad Left / Right):** Scroll through the top toolbar items (Empty, Input, Always On, AND, OR, XOR, NOT, Ref Cell).
* **A, Start, or Select Button:** Lock in your selected tool and switch into **Placing Mode**.
* **B Button:** Cancel and return to **Interact Mode**.

### 3. Placing Mode (`PLACING`)
* **D-Pad / Left Stick:** Move the cursor to where you want to place your item.
* **A Button:** Stamp the selected tool onto the grid. You can stamp repeatedly.
* **B Button:** Exit placing mode and return to safe **Interact Mode** (so you don't accidentally stamp over other cells).

### 4. Wiring Mode (`WIRING`)
* **D-Pad / Left Stick:** Navigate to the cell you want to use as an input.
* **A Button:** Select that cell as an input source for your gate (duplicate selections are automatically ignored).
* **B, Start, or Select Button:** Finish wiring, evaluate the circuit formula (e.g., `=AND(A1, B2)`), and return to Placing Mode.

---

## ⌨️ Keyboard Fallbacks

If you are using a keyboard instead of a controller, use the following key bindings:

### Navigation & Interaction
* **Arrow Keys:** Move the cursor around the grid.
* **Spacebar / Enter:** Toggle input switches or stamp the currently selected tool.
* **M Key:** Open the top menu or re-edit the gate under your cursor.

### Menu & Placing
* **Q / E Keys:** Scroll left and right through the top menu items.
* **Esc / B Key:** Exit placing or wiring mode back to standard interaction mode.

---

## 📱 Mobile & Touch Controls

* **Tapping Cells:** Tap any cell in **Interact Mode** to toggle switches, or use the menu bar at the top to select tools.
* **Pinch-to-Zoom:** Use two fingers on the grid container to pinch out and zoom down to 35% to view large circuits.
* **Row/Column Management:** **Long-press** any row number (`#`) or column letter (`A, B, C...`) to open a context menu allowing you to **Insert** rows/columns (before or after) or **Delete** them with automatic formula re-indexing.
