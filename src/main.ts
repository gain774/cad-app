import "./styles.css";
import { Editor } from "./Editor.ts";
import { CadDocument } from "./core/model/Document.ts";
import { LineTool, PolylineTool, RectTool, CircleTool, ArcTool, TextTool } from "./tools/DrawTools.ts";
import { MoveTool, CopyTool } from "./tools/EditTools.ts";
import type { Tool } from "./tools/Tool.ts";
import { exportDxf, importDxf } from "./io/dxf.ts";
import { exportSvg } from "./io/svg.ts";
import { exportJson, importJson } from "./io/json.ts";

const canvas = document.getElementById("cad-canvas") as HTMLCanvasElement;
const editor = new Editor(canvas);

// --- tool factory -----------------------------------------------------------

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

// --- toolbar ----------------------------------------------------------------

const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#toolbar button[data-tool]"));
for (const btn of toolButtons) {
  btn.addEventListener("click", () => activateTool(btn.dataset.tool!));
}

editor.onToolChange = (name) => {
  for (const btn of toolButtons) {
    btn.classList.toggle("active", btn.dataset.tool === name);
  }
};

// Edit command buttons in the toolbar (move/copy/erase).
document.querySelectorAll<HTMLButtonElement>("#toolbar button[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => runNamedCommand(btn.dataset.cmd!));
});

// --- top bar commands -------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>("#topbar button[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => runNamedCommand(btn.dataset.cmd!));
});

const fileInput = document.getElementById("file-input") as HTMLInputElement;
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

function runNamedCommand(cmd: string): void {
  switch (cmd) {
    case "NEW":
      if (confirm("新しい図面を作成しますか？未保存の内容は失われます。")) {
        editor.replaceDocument(new CadDocument());
        refreshLayers();
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
  }
}

// Register command-line aliases (AutoCAD-style keywords).
editor.commandHandlers = {
  LINE: () => activateTool("line"),
  L: () => activateTool("line"),
  PLINE: () => activateTool("polyline"),
  PL: () => activateTool("polyline"),
  P: () => activateTool("polyline"),
  RECTANGLE: () => activateTool("rect"),
  REC: () => activateTool("rect"),
  R: () => activateTool("rect"),
  CIRCLE: () => activateTool("circle"),
  C: () => activateTool("circle"),
  ARC: () => activateTool("arc"),
  A: () => activateTool("arc"),
  TEXT: () => activateTool("text"),
  T: () => activateTool("text"),
  MOVE: () => activateTool("move"),
  M: () => activateTool("move"),
  COPY: () => activateTool("copy"),
  CO: () => activateTool("copy"),
  ERASE: () => editor.eraseSelection(),
  E: () => editor.eraseSelection(),
  UNDO: () => editor.history.undo(),
  U: () => editor.history.undo(),
  REDO: () => editor.history.redo(),
  ZE: () => editor.zoomExtents(),
  ZOOM: () => editor.zoomExtents(),
};

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const doc = pendingImport === "dxf" ? importDxf(text) : importJson(text);
    editor.replaceDocument(doc);
    refreshLayers();
  } catch (err) {
    alert("読み込みに失敗しました: " + (err as Error).message);
  }
  fileInput.value = "";
});

// --- command line -----------------------------------------------------------

const commandInput = document.getElementById("command-input") as HTMLInputElement;
const promptLabel = document.getElementById("prompt-label") as HTMLSpanElement;

editor.onPromptChange = (text) => {
  promptLabel.textContent = text;
};

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

// Global keyboard shortcuts (when not typing in the command line).
window.addEventListener("keydown", (e) => {
  const typing = document.activeElement === commandInput;
  if (typing) return;
  // Single-letter tool shortcuts.
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const map: Record<string, string> = {
      l: "line",
      p: "polyline",
      r: "rect",
      c: "circle",
      a: "arc",
      t: "text",
      m: "move",
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

const bindCheck = (id: string, key: keyof typeof editor.snapSettings) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.addEventListener("change", () => {
    (editor.snapSettings[key] as boolean) = el.checked;
  });
};
bindCheck("snap-grid", "grid");
bindCheck("snap-end", "end");
bindCheck("snap-mid", "mid");
bindCheck("snap-center", "center");
bindCheck("snap-intersect", "intersect");

const gridSizeInput = document.getElementById("grid-size") as HTMLInputElement;
gridSizeInput.addEventListener("change", () => {
  const v = parseFloat(gridSizeInput.value);
  if (isFinite(v) && v > 0) {
    editor.snapSettings.gridSize = v;
    editor.requestRender();
  }
});

// --- layers panel -----------------------------------------------------------

const layerList = document.getElementById("layer-list") as HTMLDivElement;
const addLayerBtn = document.getElementById("add-layer") as HTMLButtonElement;

function refreshLayers(): void {
  layerList.innerHTML = "";
  for (const layer of editor.doc.layers) {
    const row = document.createElement("div");
    row.className = "layer-row" + (layer.name === editor.doc.activeLayer ? " active" : "");

    const vis = document.createElement("button");
    vis.className = "layer-vis";
    vis.textContent = layer.visible ? "👁" : "—";
    vis.title = "表示切替";
    vis.addEventListener("click", (ev) => {
      ev.stopPropagation();
      layer.visible = !layer.visible;
      editor.requestRender();
      refreshLayers();
    });

    const swatch = document.createElement("input");
    swatch.type = "color";
    swatch.value = layer.color;
    swatch.className = "layer-color";
    swatch.addEventListener("input", () => {
      layer.color = swatch.value;
      editor.requestRender();
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

    row.addEventListener("click", () => {
      editor.doc.activeLayer = layer.name;
      refreshLayers();
    });

    row.append(vis, swatch, name, del);
    layerList.appendChild(row);
  }
}

addLayerBtn.addEventListener("click", () => {
  const name = prompt("レイヤ名を入力", `layer${editor.doc.layers.length}`);
  if (name) {
    editor.doc.addLayer(name);
    editor.doc.activeLayer = name;
    refreshLayers();
  }
});

// --- status / readouts ------------------------------------------------------

const stats = document.getElementById("stats") as HTMLDivElement;
const mouseCoords = document.getElementById("mouse-coords") as HTMLSpanElement;
const coordReadout = document.getElementById("coord-readout") as HTMLDivElement;

editor.onStatusChange = () => {
  stats.innerHTML =
    `要素数: <b>${editor.doc.count}</b><br>` +
    `選択: <b>${editor.getSelectionCount()}</b><br>` +
    `レイヤ: <b>${editor.doc.activeLayer}</b>`;
};

function updateCoordReadout(): void {
  const w = editor.cursorWorldReadout();
  mouseCoords.textContent = `${w.x.toFixed(3)}, ${w.y.toFixed(3)}`;
  coordReadout.textContent = `X ${w.x.toFixed(2)}  Y ${w.y.toFixed(2)}`;
}
canvas.addEventListener("pointermove", updateCoordReadout);

// --- resize -----------------------------------------------------------------

window.addEventListener("resize", () => editor.resize());
new ResizeObserver(() => editor.resize()).observe(document.getElementById("canvas-host")!);

// --- seed a small demo drawing so the canvas isn't empty on first load ------

seedDemo();
function seedDemo(): void {
  const doc = editor.doc;
  doc.addLayer("walls", "#8ab4f8");
  doc.addLayer("dims", "#ffb454");
  const add = (e: Parameters<typeof doc.add>[0]) => doc.add(e, true);
  // A simple room outline.
  add({ id: "seed1", type: "polyline", layer: "walls", color: null, closed: true,
    points: [ { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 } ] });
  add({ id: "seed2", type: "line", layer: "walls", color: null, a: { x: 400, y: 120 }, b: { x: 600, y: 120 } });
  add({ id: "seed3", type: "line", layer: "walls", color: null, a: { x: 400, y: 220 }, b: { x: 600, y: 220 } });
  add({ id: "seed4", type: "line", layer: "walls", color: null, a: { x: 600, y: 120 }, b: { x: 600, y: 220 } });
  add({ id: "seed5", type: "circle", layer: "dims", color: null, center: { x: 200, y: 150 }, radius: 60 });
  add({ id: "seed6", type: "text", layer: "dims", color: null, position: { x: 20, y: 260 }, content: "CAD App", height: 24, rotation: 0 });
  doc.notify();
  editor.zoomExtents();
}

refreshLayers();
editor.onStatusChange();
editor.zoomExtents();
