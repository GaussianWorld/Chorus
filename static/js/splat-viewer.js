import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

function makeVector(values) {
  return new THREE.Vector3(values[0], values[1], values[2]);
}

function hasWebGL2() {
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2"));
}

function normalizeDatasets(manifest) {
  if (Array.isArray(manifest.datasets) && manifest.datasets.length) {
    return manifest.datasets;
  }
  return [
    {
      id: "scenes",
      name: "Scenes",
      scenes: Array.isArray(manifest.scenes) ? manifest.scenes : [],
    },
  ];
}

function disposeMaterial(material) {
  if (!material) return;
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((item) => {
    Object.values(item).forEach((value) => {
      if (value?.isTexture && typeof value.dispose === "function") {
        value.dispose();
      }
    });
    if (typeof item.dispose === "function") item.dispose();
  });
}

class ChorusSplatViewer {
  constructor(root) {
    this.root = root;
    this.manifestUrl = root.dataset.manifest;
    this.datasetId = root.dataset.datasetId;
    this.stage = root.querySelector("[data-role='viewer-stage'], #viewer-stage");
    this.canvasHost = root.querySelector("[data-role='viewer-canvases'], #viewer-canvases");
    this.splitter = root.querySelector("[data-role='viewer-splitter'], #viewer-splitter");
    this.controlsPanel = root.querySelector("[data-role='viewer-controls'], #viewer-controls");
    this.status = root.querySelector("[data-role='viewer-status'], #viewer-status");
    this.pcaLabel = root.querySelector("[data-role='pca-label'], #pca-label");
    this.sceneTabsHost = root.querySelector("[data-role='scene-rail'], #scene-tabs");
    this.modeToggle = root.querySelector("[data-role='mode-toggle'], .mode-toggle");
    this.modeButtons = [...root.querySelectorAll("[data-pca-mode]")];
    this.sceneTabs = [...root.querySelectorAll(".scene-card")];

    this.manifest = null;
    this.datasets = [];
    this.activeDataset = null;
    this.activeScene = null;
    this.pcaMode = root.dataset.pcaMode || "3dgs";
    this.splitRatio = 0.5;
    this.draggingSplit = false;
    this.renderFrameId = null;
    this.renderTailFrames = 0;
    this.renderContinuously = false;
    this.renderCount = 0;
    this.renderRequestCount = 0;
    this.lastRenderAt = null;
    this.disposed = false;
    this.sceneLoadToken = 0;
    this.leftLoadToken = 0;
    this.rightLoadToken = 0;
  }

  async init(manifest = null) {
    if (!hasWebGL2()) {
      throw new Error("WebGL2 is not available in this browser.");
    }

    if (manifest) {
      this.manifest = manifest;
    } else {
      const response = await fetch(this.manifestUrl);
      if (!response.ok) {
        throw new Error(`Failed to load ${this.manifestUrl}`);
      }
      this.manifest = await response.json();
    }
    this.datasets = normalizeDatasets(this.manifest);
    this.activeDataset =
      this.datasets.find((dataset) => dataset.id === this.datasetId) ||
      this.datasets[0] ||
      null;
    if (!this.activeDataset?.scenes?.length) {
      throw new Error("No scenes were found in the splat manifest.");
    }

    this.updateModeButtons();
    if (!this.sceneTabsHost?.children.length) {
      this.renderSceneRail();
    }

    this.createRenderers();
    this.bindControls();
    this.bindUi();
    this.resize();

    const requestedSceneId = this.root.dataset.selectedSceneId;
    const initialScene = this.getScene(requestedSceneId) || this.activeDataset.scenes[0];
    await this.loadScene(initialScene.id, { reset: true });
    this.showViewerChrome();
    this.requestRender(24);
    return this;
  }

  createRenderers() {
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 1000);
    this.camera.up.set(0, 0, 1);

    this.leftScene = new THREE.Scene();
    this.rightScene = new THREE.Scene();
    this.leftScene.background = new THREE.Color(0x111817);
    this.rightScene.background = new THREE.Color(0x111817);

    this.leftRenderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.rightRenderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });

    this.leftRenderer.domElement.className = "viewer-layer-left";
    this.rightRenderer.domElement.className = "viewer-layer-right";
    this.leftRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.rightRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    this.hitSurface = document.createElement("div");
    this.hitSurface.className = "viewer-hit-surface";

    this.canvasHost.replaceChildren(
      this.leftRenderer.domElement,
      this.rightRenderer.domElement,
      this.hitSurface
    );

    this.leftSpark = new SparkRenderer({
      renderer: this.leftRenderer,
      enableLod: true,
      lodSplatCount: 900_000,
      lodRenderScale: 1.35,
    });
    this.rightSpark = new SparkRenderer({
      renderer: this.rightRenderer,
      enableLod: true,
      lodSplatCount: 900_000,
      lodRenderScale: 1.35,
    });

    this.leftScene.add(this.leftSpark);
    this.rightScene.add(this.rightSpark);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);
  }

  bindControls() {
    this.controls = new OrbitControls(this.camera, this.hitSurface);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 120;

    this.controlsStartHandler = () => {
      this.renderContinuously = true;
      this.requestRender(12);
    };
    this.controlsChangeHandler = () => {
      this.requestRender(8);
    };
    this.controlsEndHandler = () => {
      this.renderContinuously = false;
      this.requestRender(24);
    };
    this.controls.addEventListener("start", this.controlsStartHandler);
    this.controls.addEventListener("change", this.controlsChangeHandler);
    this.controls.addEventListener("end", this.controlsEndHandler);
  }

  bindUi() {
    this.controlsPanel.addEventListener("click", (event) => {
      const button = event.target.closest("[data-view-control]");
      if (!button) return;
      const action = button.dataset.viewControl;
      if (action === "zoom-in") this.zoom(0.78);
      if (action === "zoom-out") this.zoom(1.25);
      if (action === "reset") this.resetView();
    });

    this.splitPointerDownHandler = (event) => {
      event.preventDefault();
      this.draggingSplit = true;
      this.renderContinuously = true;
      this.requestRender(8);
      this.splitter.setPointerCapture?.(event.pointerId);
      this.controls.enabled = false;
    };
    this.pointerMoveHandler = (event) => {
      if (!this.draggingSplit) return;
      const rect = this.stage.getBoundingClientRect();
      const x = event.clientX - rect.left;
      this.setSplit(x / Math.max(1, rect.width));
    };
    this.pointerUpHandler = (event) => {
      if (!this.draggingSplit) return;
      this.draggingSplit = false;
      this.renderContinuously = false;
      this.requestRender(16);
      this.controls.enabled = true;
      this.splitter.releasePointerCapture?.(event.pointerId);
    };

    this.splitter.addEventListener("pointerdown", this.splitPointerDownHandler);
    window.addEventListener("pointermove", this.pointerMoveHandler);
    window.addEventListener("pointerup", this.pointerUpHandler);
  }

  showViewerChrome() {
    this.splitter.hidden = false;
    this.controlsPanel.hidden = false;
    this.setSplit(this.splitRatio);
  }

  setStatus(message) {
    if (this.status && !this.disposed) this.status.textContent = message;
  }

  renderSceneRail() {
    if (!this.sceneTabsHost || !this.activeDataset) return;
    const scenes = this.activeDataset.scenes || [];
    this.sceneTabsHost.replaceChildren(
      ...scenes.map((scene) => {
        const button = document.createElement("button");
        button.className = "scene-card";
        button.type = "button";
        button.dataset.sceneId = scene.id;

        const image = document.createElement("img");
        image.src = scene.thumbnail;
        image.alt = `${scene.title || scene.label || scene.id} thumbnail`;
        image.loading = "lazy";
        image.decoding = "async";

        const label = document.createElement("span");
        label.textContent = scene.label || scene.sourceId || scene.id;

        button.append(image, label);
        return button;
      })
    );
    this.sceneTabs = [...this.sceneTabsHost.querySelectorAll(".scene-card")];
    this.updateSceneTabs(this.root.dataset.selectedSceneId);
  }

  getScene(sceneId) {
    const activeScenes = this.activeDataset?.scenes || [];
    return activeScenes.find((scene) => scene.id === sceneId);
  }

  isSceneCurrent(scene, token) {
    return !this.disposed && this.activeScene === scene && this.sceneLoadToken === token;
  }

  async loadScene(sceneId, options = {}) {
    const scene = this.getScene(sceneId);
    if (!scene || this.disposed) return;

    const sceneToken = ++this.sceneLoadToken;
    const leftToken = ++this.leftLoadToken;
    const rightToken = ++this.rightLoadToken;
    this.activeScene = scene;
    this.root.dataset.selectedSceneId = scene.id;
    this.updateSceneTabs(scene.id);
    this.setStatus(`Loading ${scene.title || scene.label || scene.id}`);
    this.clearLeft();
    this.clearRight();
    this.requestRender(4);

    const leftTask = this.createSplatMesh(scene.rgb3dgs, { label: "Rendering", lod: true })
      .then((mesh) => {
        if (!this.isSceneCurrent(scene, sceneToken) || this.leftLoadToken !== leftToken) {
          this.disposeStandalone(mesh);
          return;
        }
        this.leftMesh = mesh;
        this.leftScene.add(mesh);
        this.requestRender(12);
      })
      .catch((error) => {
        if (!this.isSceneCurrent(scene, sceneToken) || this.leftLoadToken !== leftToken) {
          console.warn("Ignoring stale rendering load failure.", error);
          return;
        }
        throw error;
      });

    const rightMode = this.pcaMode;
    const rightTask = this.createPcaObject(scene, rightMode)
      .then((mesh) => {
        if (
          !this.isSceneCurrent(scene, sceneToken) ||
          this.rightLoadToken !== rightToken ||
          this.pcaMode !== rightMode
        ) {
          this.disposeStandalone(mesh);
          return;
        }
        this.rightMesh = mesh;
        this.rightScene.add(mesh);
        this.requestRender(12);
      })
      .catch((error) => {
        if (
          !this.isSceneCurrent(scene, sceneToken) ||
          this.rightLoadToken !== rightToken ||
          this.pcaMode !== rightMode
        ) {
          console.warn("Ignoring stale PCA load failure.", error);
          return;
        }
        throw error;
      });

    const results = await Promise.allSettled([leftTask, rightTask]);
    if (!this.isSceneCurrent(scene, sceneToken)) return;

    const failure = results.find((result) => result.status === "rejected");
    if (failure) {
      this.setStatus("Scene failed to load");
      throw failure.reason;
    }

    if (options.reset) this.resetView();
    this.setStatus(`${scene.title || scene.label || scene.id} loaded`);
    this.requestRender(24);
  }

  async setPcaMode(mode) {
    if (!mode || this.disposed) return;
    this.pcaMode = mode;
    this.root.dataset.pcaMode = mode;
    this.updateModeButtons();
    if (!this.activeScene) return;

    const scene = this.activeScene;
    const rightToken = ++this.rightLoadToken;
    const cameraPosition = this.camera.position.clone();
    const target = this.controls.target.clone();
    this.clearRight();
    this.requestRender(4);
    this.setStatus(`Loading PCA ${mode}`);

    let mesh;
    try {
      mesh = await this.createPcaObject(scene, mode);
    } catch (error) {
      if (
        this.disposed ||
        this.activeScene !== scene ||
        this.rightLoadToken !== rightToken ||
        this.pcaMode !== mode
      ) {
        console.warn("Ignoring stale PCA mode load failure.", error);
        return;
      }
      throw error;
    }
    if (
      this.disposed ||
      this.activeScene !== scene ||
      this.rightLoadToken !== rightToken ||
      this.pcaMode !== mode
    ) {
      this.disposeStandalone(mesh);
      return;
    }

    this.rightMesh = mesh;
    this.rightScene.add(mesh);
    this.camera.position.copy(cameraPosition);
    this.controls.target.copy(target);
    this.controls.update();
    this.setStatus(`PCA ${mode} loaded`);
    this.requestRender(24);
  }

  updateModeButtons() {
    if (this.modeToggle) this.modeToggle.dataset.mode = this.pcaMode;
    this.modeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.pcaMode === this.pcaMode);
    });
    if (this.pcaLabel) this.pcaLabel.textContent = "Chorus PCA";
  }

  async createPcaObject(scene, mode) {
    if (mode === "points") {
      return this.createPointCloud(scene.pcaPoints, scene);
    }
    return this.createSplatMesh(scene.pca3dgs, { label: "PCA", lod: true });
  }

  async createSplatMesh(url, { label, lod }) {
    this.setStatus(`Loading ${label} asset`);
    const mesh = new SplatMesh({
      url,
      lod,
      raycastable: false,
      onProgress: (event) => {
        if (!event?.total || this.disposed) return;
        const pct = Math.round((event.loaded / event.total) * 100);
        this.setStatus(`${label} ${pct}%`);
        this.requestRender(2);
      },
    });
    await mesh.initialized;
    return mesh;
  }

  async createPointCloud(url, scene) {
    return this.createThreePoints(url, scene);
  }

  async createThreePoints(url, scene) {
    this.setStatus("Loading PCA points asset");
    const loader = new PLYLoader();
    const geometry = await loader.loadAsync(url);
    geometry.computeBoundingBox();
    const min = makeVector(scene.bboxMin);
    const max = makeVector(scene.bboxMax);
    const radius = max.distanceTo(min) * 0.5;
    const material = new THREE.PointsMaterial({
      size: THREE.MathUtils.clamp(radius / 500, 0.018, 0.07),
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.96,
    });
    return new THREE.Points(geometry, material);
  }

  resetView() {
    if (!this.activeScene) return;
    const min = makeVector(this.activeScene.bboxMin);
    const max = makeVector(this.activeScene.bboxMax);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(max.distanceTo(min) * 0.5, 1);
    this.controls.target.copy(center);
    this.camera.position.set(
      center.x + radius * 0.9,
      center.y - radius * 1.65,
      center.z + radius * 0.82
    );
    this.camera.near = Math.max(radius / 700, 0.01);
    this.camera.far = Math.max(radius * 10, 100);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender(24);
  }

  zoom(scale) {
    const direction = this.camera.position.clone().sub(this.controls.target);
    this.camera.position.copy(this.controls.target).add(direction.multiplyScalar(scale));
    this.controls.update();
    this.requestRender(18);
  }

  setSplit(ratio) {
    if (!this.rightRenderer || !this.splitter) return;
    this.splitRatio = Math.min(0.92, Math.max(0.08, ratio));
    const pct = `${this.splitRatio * 100}%`;
    this.rightRenderer.domElement.style.clipPath = `inset(0 0 0 ${pct})`;
    this.splitter.style.left = pct;
    this.requestRender(this.draggingSplit ? 2 : 8);
  }

  updateSceneTabs(sceneId) {
    this.sceneTabs = [...this.root.querySelectorAll(".scene-card")];
    this.sceneTabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.sceneId === sceneId);
    });
  }

  resize() {
    if (!this.stage || !this.camera || !this.leftRenderer || !this.rightRenderer) return;
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.leftRenderer.setSize(width, height, false);
    this.rightRenderer.setSize(width, height, false);
    this.setSplit(this.splitRatio);
    this.requestRender(8);
  }

  render() {
    this.renderCount += 1;
    this.lastRenderAt = performance.now();
    this.leftRenderer?.render(this.leftScene, this.camera);
    this.rightRenderer?.render(this.rightScene, this.camera);
  }

  requestRender(tailFrames = 0) {
    if (this.disposed) return;
    this.renderRequestCount += 1;
    this.renderTailFrames = Math.max(this.renderTailFrames, tailFrames);
    if (this.renderFrameId !== null) return;
    this.renderFrameId = requestAnimationFrame(() => this.renderScheduledFrame());
  }

  renderScheduledFrame() {
    this.renderFrameId = null;
    if (this.disposed) return;

    const controlsChanged = Boolean(this.controls?.update?.());
    this.render();

    if (this.renderTailFrames > 0) {
      this.renderTailFrames -= 1;
    }

    if (this.renderContinuously || controlsChanged || this.renderTailFrames > 0) {
      this.requestRender(0);
    }
  }

  getRenderStats() {
    return {
      activeScene: this.activeScene?.id || null,
      disposed: this.disposed,
      pcaMode: this.pcaMode,
      renderContinuously: this.renderContinuously,
      renderCount: this.renderCount,
      renderRequestCount: this.renderRequestCount,
      scheduled: this.renderFrameId !== null,
      tailFrames: this.renderTailFrames,
      lastRenderAt: this.lastRenderAt,
    };
  }

  clearLeft() {
    this.clearSceneRenderables(this.leftScene, this.leftSpark);
    this.leftMesh = null;
  }

  clearRight() {
    this.clearSceneRenderables(this.rightScene, this.rightSpark);
    this.rightMesh = null;
  }

  clearSceneRenderables(scene, keepObject) {
    if (!scene) return;
    [...scene.children].forEach((child) => {
      if (child !== keepObject) this.disposeObject(child, scene);
    });
  }

  disposeObject(object, scene) {
    if (!object) return;
    scene?.remove(object);
    this.disposeStandalone(object);
  }

  disposeStandalone(object) {
    if (!object) return;
    const seen = new Set();
    const disposeNode = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      [...(node.children || [])].forEach(disposeNode);
      if (typeof node.dispose === "function") node.dispose();
      if (node.geometry) node.geometry.dispose();
      if (node.material) disposeMaterial(node.material);
    };
    disposeNode(object);
  }

  dispose() {
    this.disposed = true;
    this.sceneLoadToken += 1;
    this.leftLoadToken += 1;
    this.rightLoadToken += 1;
    this.renderContinuously = false;
    this.renderTailFrames = 0;
    if (this.renderFrameId !== null) {
      cancelAnimationFrame(this.renderFrameId);
      this.renderFrameId = null;
    }
    this.resizeObserver?.disconnect();
    if (this.controls) {
      if (this.controlsStartHandler) {
        this.controls.removeEventListener("start", this.controlsStartHandler);
      }
      if (this.controlsChangeHandler) {
        this.controls.removeEventListener("change", this.controlsChangeHandler);
      }
      if (this.controlsEndHandler) {
        this.controls.removeEventListener("end", this.controlsEndHandler);
      }
    }
    this.controls?.dispose();
    if (this.splitter && this.splitPointerDownHandler) {
      this.splitter.removeEventListener("pointerdown", this.splitPointerDownHandler);
    }
    if (this.pointerMoveHandler) window.removeEventListener("pointermove", this.pointerMoveHandler);
    if (this.pointerUpHandler) window.removeEventListener("pointerup", this.pointerUpHandler);
    this.clearLeft();
    this.clearRight();
    this.disposeObject(this.leftSpark, this.leftScene);
    this.disposeObject(this.rightSpark, this.rightScene);
    this.leftRenderer?.dispose();
    this.rightRenderer?.dispose();
    this.leftRenderer?.domElement.remove();
    this.rightRenderer?.domElement.remove();
    this.hitSurface?.remove();
    this.canvasHost?.replaceChildren();
  }
}

export async function initChorusSplatViewer(root, manifest = null) {
  const viewer = new ChorusSplatViewer(root);
  await viewer.init(manifest);
  return viewer;
}
