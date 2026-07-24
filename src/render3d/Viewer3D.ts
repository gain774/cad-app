import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CadDocument } from "../core/model/Document.ts";
import { boundsValid } from "../core/math/geometry.ts";
import { buildScene3D } from "./geometry3d.ts";

/**
 * Renders the 2D document as an interactive 3D model using Three.js. The 2D
 * geometry is extruded (walls / plates, per layer) and shown with orbit
 * controls. Lives on its own canvas that overlays the 2D canvas when active.
 */
export class Viewer3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private content = new THREE.Group();
  private grid: THREE.GridHelper;
  private running = false;
  private frameHandle = 0;
  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor(private host: HTMLElement, private doc: CadDocument) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "cad-canvas-3d";
    this.canvas.style.display = "none";
    host.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.background = new THREE.Color(0x15161a);

    // CAD convention: Z is up, XY is the ground plane.
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1_000_000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(400, -400, 400);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    // Lighting.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(0.5, -0.7, 1);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-0.6, 0.5, 0.4);
    this.scene.add(fill);

    // Ground grid (rotated to the XY plane) and axes.
    this.grid = new THREE.GridHelper(2000, 40, 0x3a3a44, 0x2a2a30);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
    const axes = new THREE.AxesHelper(120);
    this.scene.add(axes);

    this.scene.add(this.content);
  }

  /** Rebuild the 3D geometry from the current document. */
  rebuild(): void {
    // Dispose previous content.
    for (const child of [...this.content.children]) this.content.remove(child);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];

    const built = buildScene3D(this.doc);

    for (const [color, geom] of built.solids) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        metalness: 0.1,
        roughness: 0.75,
        side: THREE.DoubleSide,
        flatShading: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      this.content.add(mesh);
      this.disposables.push(geom, mat);

      // Crisp CAD-style edges on the solids.
      const edgeGeom = new THREE.EdgesGeometry(geom, 25);
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x11121a, transparent: true, opacity: 0.35 });
      this.content.add(new THREE.LineSegments(edgeGeom, edgeMat));
      this.disposables.push(edgeGeom, edgeMat);
    }

    for (const [color, positions] of built.lines) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const m = new THREE.LineBasicMaterial({ color: new THREE.Color(color) });
      this.content.add(new THREE.LineSegments(g, m));
      this.disposables.push(g, m);
    }
  }

  /** Fit the camera so all content is in view. */
  frameContent(): void {
    const b = this.doc.totalBounds();
    let cx = 0;
    let cy = 0;
    let radius = 300;
    if (boundsValid(b)) {
      cx = (b.minX + b.maxX) / 2;
      cy = (b.minY + b.maxY) / 2;
      const dx = b.maxX - b.minX;
      const dy = b.maxY - b.minY;
      // Include a representative extrusion height in the framing.
      let maxH = 0;
      for (const l of this.doc.layers) {
        if (l.extrudeMode !== "none") maxH = Math.max(maxH, l.elevation + l.height);
      }
      radius = Math.max(Math.hypot(dx, dy) * 0.6, maxH, 200);
    }
    const target = new THREE.Vector3(cx, cy, radius * 0.15);
    this.controls.target.copy(target);
    const dist = radius * 2.2;
    this.camera.position.set(cx + dist * 0.7, cy - dist * 0.8, dist * 0.7);
    this.camera.near = Math.max(radius / 1000, 0.05);
    this.camera.far = radius * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Show the 3D canvas and start rendering. */
  activate(): void {
    this.canvas.style.display = "block";
    this.rebuild();
    this.resize();
    this.frameContent();
    this.running = true;
    this.loop();
  }

  /** Hide the 3D canvas and stop rendering. */
  deactivate(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.canvas.style.display = "none";
  }

  private loop = (): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  /** Set the standard views (top/front/iso). */
  setStandardView(view: "top" | "front" | "right" | "iso"): void {
    const t = this.controls.target;
    const d = this.camera.position.distanceTo(t) || 800;
    switch (view) {
      case "top":
        this.camera.position.set(t.x, t.y, t.z + d);
        break;
      case "front":
        this.camera.position.set(t.x, t.y - d, t.z);
        break;
      case "right":
        this.camera.position.set(t.x + d, t.y, t.z);
        break;
      case "iso":
        this.camera.position.set(t.x + d * 0.6, t.y - d * 0.7, t.z + d * 0.6);
        break;
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  dispose(): void {
    this.deactivate();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
