import "./styles.css";
import { Editor, type ViewMode } from "./Editor.ts";
import { CadDocument, type ExtrudeMode } from "./core/model/Document.ts";
import { LineTool, PolylineTool, RectTool, CircleTool, ArcTool, TextTool } from "./tools/DrawTools.ts";
import { MoveTool, CopyTool } from "./tools/EditTools.ts";
import type { Tool } from "./tools/Tool.ts";
import type { Entity } from "./core/model/entities.ts";
import { exportDxf, importDxf } from "./io/dxf.ts";
import { exportSvg } from "./io/svg.ts";
import { exportJson, importJson } from "./io/json.ts";

const canvas = document.getElementById("cad-canvas") as HTMLCanvasElement;
const editor = new Editor(canvas);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// New-layer defaults (editable in Settings).
const newLayerDefaults = { extrudeMode: "wall" as ExtrudeMode, height: 100 };

// --- tools ------------------------------------------------------------------

const toolFactory: Record<string, () => Tool> = {
  line: () => new LineTool(),
  polyline: () => new PolylineTool(),
  rect: () => new RectTool(),
  circle: () => new CircleTool(),
  arc: () => new ArcTool(),
  text: () => new TextTool(),
  move: () => new MoveTool(),
  copy: () => new CopyTool(),
};

function activateTool(name: string): void {
  if (name === "select") {
    editor.setTool(null);
    return;
  }
  const factory = toolFactory[name];
  if (factory) editor.setTool(factory());
}

const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#toolbar button[data-tool]"));
editor.onToolChange = (name) => {
  for (const btn of toolButtons) btn.classList.toggle("active", btn.dataset.tool === name);
};

// --- file helpers -----------------------------------------------------------

const fileInput = $("file-input") as HTMLInputElement;
let pendingImport: "json" | "dxf" = "json";

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --- command dispatch -------------------------------------------------------

function runNamedCommand(cmd: string): void {
  if (cmd.startsWith("TOOL_")) {
    activateTool(cmd.slice(5));
    return;
  }
  if (cmd.startsWith("VIEW3D_")) {
    editor.setMode("3d");
    editor.setStandardView3D(cmd.slice(7) as "top" | "front" | "right" | "iso");
    return;
  }
  switch (cmd) {
    case "NEW":
      if (confirm("新しい図面を作成しますか？未保存の内容は失われます。")) {
        editor.replaceDocument(new CadDocument());
        refreshLayers();
        refreshProperties();
      }
      break;
    case "SAVE":
      download("drawing.json", exportJson(editor.doc), "application/json");
      break;
    case "OPEN":
      pendingImport = "json";
      fileInput.accept = ".json";
      fileInput.click();
      break;
    case "IMPORT_DXF":
      pendingImport = "dxf";
      fileInput.accept = ".dxf";
      fileInput.click();
      break;
    case "EXPORT_DXF":
      download("drawing.dxf", exportDxf(editor.doc), "application/dxf");
      break;
    case "EXPORT_SVG":
      download("drawing.svg", exportSvg(editor.doc), "image/svg+xml");
      break;
    case "UNDO":
      editor.history.undo();
      break;
    case "REDO":
      editor.history.redo();
      break;
    case "MOVE":
      activateTool("move");
      break;
    case "COPY":
      activateTool("copy");
      break;
    case "ERASE":
      editor.eraseSelection();
      break;
    case "ZOOM_EXTENTS":
      editor.zoomExtents();
      break;
    case "MODE_2D":
      editor.setMode("2d");
      break;
    case "MODE_3D":
      editor.setMode("3d");
      break;
    case "OPEN_SETTINGS":
      openSettings();
      break;
    case "CLOSE_SETTINGS":
      $("settings-overlay").hidden = true;
      break;
    case "TOGGLE_PANEL":
      document.body.classList.toggle("panel-open");
      break;
  }
}

// Command-line keyword aliases.
editor.commandHandlers = {
  LINE: () => activateTool("line"), L: () => activateTool("line"),
  PLINE: () => activateTool("polyline"), PL: () => activateTool("polyline"), P: () => activateTool("polyline"),
  RECTANGLE: () => activateTool("rect"), REC: () => activateTool("rect"), R: () => activateTool("rect"),
  CIRCLE: () => activateTool("circle"), C: () => activateTool("circle"),
  ARC: () => activateTool("arc"), A: () => activateTool("arc"),
  TEXT: () => activateTool("text"), T: () => activateTool("text"),
  MOVE: () => activateTool("move"), M: () => activateTool("move"),
  COPY: () => activateTool("copy"), CO: () => activateTool("copy"),
  ERASE: () => editor.eraseSelection(), E: () => editor.eraseSelection(),
  UNDO: () => editor.history.undo(), U: () => editor.history.undo(),
  REDO: () => editor.history.redo(),
  ZE: () => editor.zoomExtents(), ZOOM: () => editor.zoomExtents(),
  "2D": () => editor.setMode("2d"), "3D": () => editor.setMode("3d"),
};

// --- global click delegation (menus, commands, tools, modes) ---------------

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;

  // Menu open/close.
  const menuBtn = target.closest<HTMLElement>(".menu-btn");
  if (menuBtn && menuBtn.parentElement?.classList.contains("menu")) {
    const menu = menuBtn.parentElement;
    const wasOpen = menu.classList.contains("open");
    closeMenus();
    if (!wasOpen) menu.classList.add("open");
    return;
  }

  const cmdEl = target.closest<HTMLElement>("[data-cmd]");
  if (cmdEl) {
    runNamedCommand(cmdEl.dataset.cmd!);
    closeMenus();
    return;
  }

  const toolEl = target.closest<HTMLElement>("[data-tool]");
  if (toolEl) {
    activateTool(toolEl.dataset.tool!);
    return;
  }

  const modeEl = target.closest<HTMLElement>("[data-mode]");
  if (modeEl) {
    editor.setMode(modeEl.dataset.mode as ViewMode);
    return;
  }

  // Clicking elsewhere closes any open menu.
  closeMenus();
});

function closeMenus(): void {
  document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
}

// --- file input -------------------------------------------------------------

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const doc = pendingImport === "dxf" ? importDxf(text) : importJson(text);
    editor.replaceDocument(doc);
    refreshLayers();
    refreshProperties();
  } catch (err) {
    alert("読み込みに失敗しました: " + (err as Error).message);
  }
  fileInput.value = "";
});

// --- mode change UI ---------------------------------------------------------

editor.onModeChange = (mode) => {
  document.body.classList.toggle("mode-3d", mode === "3d");
  document.querySelectorAll<HTMLButtonElement>("#mode-switch button").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode),
  );
  $("mode-badge").textContent = mode.toUpperCase();
  canvas.style.pointerEvents = mode === "3d" ? "none" : "auto";
};

// --- command line -----------------------------------------------------------

const commandInput = $("command-input") as HTMLInputElement;
const promptLabel = $("prompt-label");
editor.onPromptChange = (text) => (promptLabel.textContent = text);

commandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    editor.submitCommandLine(commandInput.value);
    commandInput.value = "";
  } else if (e.key === "Escape") {
    commandInput.value = "";
    editor.handleKey(e);
  }
});

// Global keyboard shortcuts (when not typing).
window.addEventListener("keydown", (e) => {
  if (document.activeElement === commandInput) return;
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const map: Record<string, string> = {
      l: "line", p: "polyline", r: "rect", c: "circle", a: "arc", t: "text", m: "move",
    };
    const key = e.key.toLowerCase();
    if (map[key]) {
      activateTool(map[key]);
      return;
    }
  }
  editor.handleKey(e);
});

// --- snap settings ----------------------------------------------------------

const snapKeys = ["grid", "end", "mid", "center", "intersect"] as const;
for (const key of snapKeys) {
  const el = $(`snap-${key}`) as HTMLInputElement;
  el.addEventListener("change", () => {
    editor.snapSettings[key] = el.checked;
    updateSnapToggle();
  });
}

const gridSizeInput = $("grid-size") as HTMLInputElement;
gridSizeInput.value = String(editor.snapSettings.gridSize);
gridSizeInput.addEventListener("change", () => {
  const v = parseFloat(gridSizeInput.value);
  if (isFinite(v) && v > 0) {
    editor.snapSettings.gridSize = v;
    ($("set-grid-size") as HTMLInputElement).value = String(v);
    editor.requestRender();
  }
});

// --- status bar toggles -----------------------------------------------------

const tgSnap = $("tg-snap") as HTMLButtonElement;
const tgGrid = $("tg-grid") as HTMLButtonElement;
const tgOrtho = $("tg-ortho") as HTMLButtonElement;

function anySnap(): boolean {
  return snapKeys.some((k) => editor.snapSettings[k]);
}
function updateSnapToggle(): void {
  tgSnap.classList.toggle("on", anySnap());
}
tgSnap.addEventListener("click", () => {
  const turnOn = !anySnap();
  for (const key of snapKeys) {
    editor.snapSettings[key] = turnOn;
    ($(`snap-${key}`) as HTMLInputElement).checked = turnOn;
  }
  updateSnapToggle();
});
tgGrid.addEventListener("click", () => {
  editor.showGrid = !editor.showGrid;
  tgGrid.classList.toggle("on", editor.showGrid);
  ($("set-show-grid") as HTMLInputElement).checked = editor.showGrid;
  editor.requestRender();
});
tgOrtho.addEventListener("click", () => {
  editor.ortho = !editor.ortho;
  tgOrtho.classList.toggle("on", editor.ortho);
});

// --- layers panel -----------------------------------------------------------

const layerList = $("layer-list");
const extrudeModes: Array<{ v: ExtrudeMode; t: string }> = [
  { v: "wall", t: "壁" },
  { v: "plate", t: "板" },
  { v: "none", t: "平面" },
];

function refreshLayers(): void {
  layerList.innerHTML = "";
  for (const layer of editor.doc.layers) {
    const row = document.createElement("div");
    row.className = "layer-row" + (layer.name === editor.doc.activeLayer ? " active" : "");

    const main = document.createElement("div");
    main.className = "layer-main";

    const vis = document.createElement("button");
    vis.className = "layer-vis";
    vis.textContent = layer.visible ? "👁" : "—";
    vis.title = "表示切替";
    vis.addEventListener("click", (ev) => {
      ev.stopPropagation();
      layer.visible = !layer.visible;
      editor.requestRender();
      editor.refresh3D();
      refreshLayers();
    });

    const swatch = document.createElement("input");
    swatch.type = "color";
    swatch.value = layer.color;
    swatch.className = "layer-color";
    swatch.addEventListener("input", () => {
      layer.color = swatch.value;
      editor.requestRender();
      editor.refresh3D();
    });

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.name;

    const del = document.createElement("button");
    del.className = "layer-del";
    del.textContent = "✕";
    del.title = "レイヤ削除";
    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (layer.name === "0") return;
      editor.doc.removeLayer(layer.name);
      refreshLayers();
    });

    main.append(vis, swatch, name, del);
    main.addEventListener("click", () => {
      editor.doc.activeLayer = layer.name;
      refreshLayers();
    });

    // 3D extrude controls.
    const d3 = document.createElement("div");
    d3.className = "layer-3d";
    const modeSel = document.createElement("select");
    modeSel.title = "3D 押し出しモード";
    for (const m of extrudeModes) {
      const opt = document.createElement("option");
      opt.value = m.v;
      opt.textContent = m.t;
      if (layer.extrudeMode === m.v) opt.selected = true;
      modeSel.append(opt);
    }
    modeSel.addEventListener("change", () => {
      layer.extrudeMode = modeSel.value as ExtrudeMode;
      editor.refresh3D();
    });
    const hgt = document.createElement("input");
    hgt.type = "number";
    hgt.title = "高さ / 厚み";
    hgt.value = String(layer.height);
    hgt.addEventListener("change", () => {
      const v = parseFloat(hgt.value);
      if (isFinite(v)) {
        layer.height = v;
        editor.refresh3D();
      }
    });
    const elev = document.createElement("input");
    elev.type = "number";
    elev.title = "基準高さ (elevation)";
    elev.value = String(layer.elevation);
    elev.addEventListener("change", () => {
      const v = parseFloat(elev.value);
      if (isFinite(v)) {
        layer.elevation = v;
        editor.refresh3D();
      }
    });
    d3.append(modeSel, hgt, elev);

    row.append(main, d3);
    layerList.appendChild(row);
  }
}

$("add-layer").addEventListener("click", () => {
  const name = prompt("レイヤ名を入力", `layer${editor.doc.layers.length}`);
  if (name) {
    const l = editor.doc.addLayer(name);
    l.extrudeMode = newLayerDefaults.extrudeMode;
    l.height = newLayerDefaults.height;
    editor.doc.activeLayer = name;
    refreshLayers();
  }
});

// --- properties panel -------------------------------------------------------

const propertiesEl = $("properties");

function propRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "prop-row";
  const l = document.createElement("label");
  l.textContent = label;
  row.append(l, control);
  return row;
}

function numberInput(value: number, onChange: (v: number) => void): HTMLInputElement {
  const inp = document.createElement("input");
  inp.type = "number";
  inp.value = String(round(value));
  inp.addEventListener("change", () => {
    const v = parseFloat(inp.value);
    if (isFinite(v)) onChange(v);
  });
  return inp;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function refreshProperties(): void {
  const sel = editor.selectedEntities();
  propertiesEl.innerHTML = "";

  if (sel.length === 0) {
    const p = document.createElement("div");
    p.className = "empty";
    p.textContent = "オブジェクト未選択";
    propertiesEl.append(p);
    return;
  }

  // Common: layer + color (applies to all selected).
  const layerSel = document.createElement("select");
  for (const l of editor.doc.layers) {
    const opt = document.createElement("option");
    opt.value = l.name;
    opt.textContent = l.name;
    if (sel.length === 1 && sel[0].layer === l.name) opt.selected = true;
    layerSel.append(opt);
  }
  layerSel.addEventListener("change", () => {
    editor.commitEntityEdit(sel, sel.map((e) => ({ ...e, layer: layerSel.value })));
    refreshLayers();
  });
  propertiesEl.append(propRow("レイヤ", layerSel));

  const colorInp = document.createElement("input");
  colorInp.type = "color";
  colorInp.value = editor.doc.effectiveColor(sel[0]);
  colorInp.addEventListener("input", () => {
    editor.commitEntityEdit(sel, sel.map((e) => ({ ...e, color: colorInp.value })));
  });
  propertiesEl.append(propRow("色", colorInp));

  if (sel.length > 1) {
    const info = document.createElement("div");
    info.className = "empty";
    info.textContent = `${sel.length} 個を選択中`;
    propertiesEl.append(info);
    return;
  }

  // Single-entity type-specific fields.
  const e = sel[0];
  const commit = (next: Entity) => editor.commitEntityEdit([e], [next]);

  switch (e.type) {
    case "line":
      propertiesEl.append(
        propRow("始点X", numberInput(e.a.x, (v) => commit({ ...e, a: { ...e.a, x: v } }))),
        propRow("始点Y", numberInput(e.a.y, (v) => commit({ ...e, a: { ...e.a, y: v } }))),
        propRow("終点X", numberInput(e.b.x, (v) => commit({ ...e, b: { ...e.b, x: v } }))),
        propRow("終点Y", numberInput(e.b.y, (v) => commit({ ...e, b: { ...e.b, y: v } }))),
      );
      break;
    case "circle":
      propertiesEl.append(
        propRow("中心X", numberInput(e.center.x, (v) => commit({ ...e, center: { ...e.center, x: v } }))),
        propRow("中心Y", numberInput(e.center.y, (v) => commit({ ...e, center: { ...e.center, y: v } }))),
        propRow("半径", numberInput(e.radius, (v) => v > 0 && commit({ ...e, radius: v }))),
      );
      break;
    case "arc":
      propertiesEl.append(
        propRow("中心X", numberInput(e.center.x, (v) => commit({ ...e, center: { ...e.center, x: v } }))),
        propRow("中心Y", numberInput(e.center.y, (v) => commit({ ...e, center: { ...e.center, y: v } }))),
        propRow("半径", numberInput(e.radius, (v) => v > 0 && commit({ ...e, radius: v }))),
      );
      break;
    case "polyline": {
      const info = document.createElement("div");
      info.className = "empty";
      info.textContent = `頂点数: ${e.points.length}`;
      propertiesEl.append(info);
      const closed = document.createElement("input");
      closed.type = "checkbox";
      closed.checked = e.closed;
      closed.addEventListener("change", () => commit({ ...e, closed: closed.checked }));
      propertiesEl.append(propRow("閉じる", closed));
      break;
    }
    case "text": {
      const content = document.createElement("input");
      content.type = "text";
      content.value = e.content;
      content.addEventListener("change", () => commit({ ...e, content: content.value }));
      propertiesEl.append(
        propRow("内容", content),
        propRow("高さ", numberInput(e.height, (v) => v > 0 && commit({ ...e, height: v }))),
      );
      break;
    }
  }
}

// --- settings modal ---------------------------------------------------------

function openSettings(): void {
  ($("set-grid-size") as HTMLInputElement).value = String(editor.snapSettings.gridSize);
  ($("set-show-grid") as HTMLInputElement).checked = editor.showGrid;
  ($("set-snap-tol") as HTMLInputElement).value = String(editor.snapPixelTolerance);
  ($("set-theme") as HTMLSelectElement).value = document.body.dataset.theme ?? "dark";
  ($("set-extrude-mode") as HTMLSelectElement).value = newLayerDefaults.extrudeMode;
  ($("set-extrude-height") as HTMLInputElement).value = String(newLayerDefaults.height);
  $("settings-overlay").hidden = false;
}

$("set-grid-size").addEventListener("change", (e) => {
  const v = parseFloat((e.target as HTMLInputElement).value);
  if (isFinite(v) && v > 0) {
    editor.snapSettings.gridSize = v;
    gridSizeInput.value = String(v);
    editor.requestRender();
  }
});
$("set-show-grid").addEventListener("change", (e) => {
  editor.showGrid = (e.target as HTMLInputElement).checked;
  tgGrid.classList.toggle("on", editor.showGrid);
  editor.requestRender();
});
$("set-snap-tol").addEventListener("change", (e) => {
  const v = parseFloat((e.target as HTMLInputElement).value);
  if (isFinite(v) && v >= 2) editor.snapPixelTolerance = v;
});
$("set-theme").addEventListener("change", (e) => {
  document.body.dataset.theme = (e.target as HTMLSelectElement).value;
});
$("set-extrude-mode").addEventListener("change", (e) => {
  newLayerDefaults.extrudeMode = (e.target as HTMLSelectElement).value as ExtrudeMode;
});
$("set-extrude-height").addEventListener("change", (e) => {
  const v = parseFloat((e.target as HTMLInputElement).value);
  if (isFinite(v)) newLayerDefaults.height = v;
});
$("settings-overlay").addEventListener("click", (e) => {
  if (e.target === $("settings-overlay")) $("settings-overlay").hidden = true;
});

$("panel-backdrop").addEventListener("click", () => document.body.classList.remove("panel-open"));

// --- status / readouts ------------------------------------------------------

const stats = $("stats");
const mouseCoords = $("mouse-coords");
const coordReadout = $("coord-readout");

editor.onStatusChange = () => {
  stats.innerHTML =
    `要素数: <b>${editor.doc.count}</b><br>` +
    `選択: <b>${editor.getSelectionCount()}</b><br>` +
    `レイヤ: <b>${editor.doc.activeLayer}</b>`;
  tgOrtho.classList.toggle("on", editor.ortho);
  refreshProperties();
};

function updateCoordReadout(): void {
  const w = editor.cursorWorldReadout();
  mouseCoords.textContent = `${w.x.toFixed(3)}, ${w.y.toFixed(3)}`;
  coordReadout.textContent = `X ${w.x.toFixed(2)}  Y ${w.y.toFixed(2)}`;
}
canvas.addEventListener("pointermove", updateCoordReadout);

// --- resize -----------------------------------------------------------------

window.addEventListener("resize", () => editor.resize());
new ResizeObserver(() => editor.resize()).observe($("canvas-host"));

// --- seed demo drawing ------------------------------------------------------

seedDemo();
function seedDemo(): void {
  const doc = editor.doc;
  const walls = doc.addLayer("walls", "#8ab4f8");
  walls.extrudeMode = "wall";
  walls.height = 120;
  const slab = doc.addLayer("slab", "#a0a0aa");
  slab.extrudeMode = "plate";
  slab.height = 12;
  slab.elevation = -12;
  const dims = doc.addLayer("dims", "#ffb454");
  dims.extrudeMode = "none";
  const add = (e: Parameters<typeof doc.add>[0]) => doc.add(e, true);
  add({ id: "seed0", type: "polyline", layer: "slab", color: null, closed: true,
    points: [ { x: -20, y: -20 }, { x: 620, y: -20 }, { x: 620, y: 320 }, { x: -20, y: 320 } ] });
  add({ id: "seed1", type: "polyline", layer: "walls", color: null, closed: true,
    points: [ { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 } ] });
  add({ id: "seed2", type: "line", layer: "walls", color: null, a: { x: 400, y: 120 }, b: { x: 600, y: 120 } });
  add({ id: "seed3", type: "line", layer: "walls", color: null, a: { x: 400, y: 220 }, b: { x: 600, y: 220 } });
  add({ id: "seed4", type: "line", layer: "walls", color: null, a: { x: 600, y: 120 }, b: { x: 600, y: 220 } });
  add({ id: "seed5", type: "circle", layer: "walls", color: null, center: { x: 200, y: 150 }, radius: 60 });
  add({ id: "seed6", type: "text", layer: "dims", color: null, position: { x: 20, y: 260 }, content: "CAD App", height: 24, rotation: 0 });
  doc.notify();
  editor.zoomExtents();
}

refreshLayers();
refreshProperties();
editor.onStatusChange();
editor.zoomExtents();

// Expose the editor for debugging / embedding.
(window as unknown as { cadEditor: Editor }).cadEditor = editor;
