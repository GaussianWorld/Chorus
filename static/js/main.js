const topbar = document.getElementById("topbar");
const heroSection = document.querySelector(".hero");
const sections = [...document.querySelectorAll(".section")];
const tocLinks = [...document.querySelectorAll(".toc-link")];
const topnav = document.querySelector(".topnav");
const tocIndicator = document.querySelector(".toc-indicator");
const tocTargetIds = new Set(tocLinks.map((link) => getTocId(link)).filter(Boolean));
const tocSections = sections.filter((section) => tocTargetIds.has(section.id));
const TOC_SCROLL_MARKER_RATIO = 0.38;
const TOC_LOCK_CLEAR_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);
const SECTION_OBSERVER_OPTIONS = {
  rootMargin: "-30% 0px -52% 0px",
  threshold: [0.08, 0.18, 0.32, 0.5],
};
let tocLockId = null;

function setTopbarState() {
  if (!topbar) return;
  const visible = window.scrollY > 8;
  topbar.classList.toggle("is-visible", visible);
  topbar.classList.toggle("is-scrolled", visible && window.scrollY > 48);
}

function getTocId(link) {
  return getHashId(link?.getAttribute("href"));
}

function getHashId(hash) {
  return hash?.replace(/^#/, "") || "";
}

function hasTocTarget(id) {
  return Boolean(id && tocTargetIds.has(id));
}

function getLockedTocId() {
  return tocLockId && document.getElementById(tocLockId) ? tocLockId : null;
}

function lockTocToSection(id) {
  if (!hasTocTarget(id)) return;
  tocLockId = id;
  setActiveSection(id);
}

function clearTocLock() {
  tocLockId = null;
}

function positionTocIndicator(link = document.querySelector(".toc-link.is-active")) {
  if (!topnav || !tocIndicator || !link) return;
  const styles = window.getComputedStyle(link);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const textLeft = link.offsetLeft + paddingLeft;
  tocIndicator.style.setProperty("--toc-anchor-left", `${textLeft}px`);
  tocIndicator.style.setProperty("--toc-opacity", "1");
}

function scrollTocLinkIntoView(link) {
  if (!topnav?.classList.contains("is-overflowing") || !link) return;
  const maxScroll = Math.max(0, topnav.scrollWidth - topnav.clientWidth);
  const centeredLeft = link.offsetLeft - (topnav.clientWidth - link.offsetWidth) / 2;
  topnav.scrollTo({
    left: Math.min(Math.max(centeredLeft, 0), maxScroll),
    behavior: "smooth",
  });
}

function setActiveSection(id) {
  let activeLink = null;
  tocLinks.forEach((link) => {
    const active = link.getAttribute("href") === `#${id}`;
    link.classList.toggle("is-active", active);
    if (active) activeLink = link;
  });
  positionTocIndicator(activeLink);
  scrollTocLinkIntoView(activeLink);
}

function updateActiveSectionFromScroll() {
  const lockedId = getLockedTocId();
  if (lockedId) {
    setActiveSection(lockedId);
    return;
  }

  const marker = window.scrollY + window.innerHeight * TOC_SCROLL_MARKER_RATIO;
  let activeId = tocSections[0]?.id;
  tocSections.forEach((section) => {
    if (section.offsetTop <= marker) activeId = section.id;
  });
  if (activeId) setActiveSection(activeId);
}

function scheduleActiveSectionUpdate() {
  if (scheduleActiveSectionUpdate.queued) return;
  scheduleActiveSectionUpdate.queued = true;
  requestAnimationFrame(() => {
    scheduleActiveSectionUpdate.queued = false;
    updateActiveSectionFromScroll();
  });
}

function loadVideo(video) {
  if (!video || video.dataset.loaded === "true") return;
  const src = video.dataset.src;
  if (!src) return;
  const source = document.createElement("source");
  source.src = src;
  source.type = "video/mp4";
  video.appendChild(source);
  video.dataset.loaded = "true";
  video.load();
}

function setupHero() {
  const videos = [...document.querySelectorAll(".hero-video")];
  const tabs = [...document.querySelectorAll(".hero-tab")];
  const switcher = document.querySelector(".hero-switcher");
  let activeIndex = 0;
  let heroVisible = true;
  let switcherTimer = null;

  function playActive() {
    const video = videos[activeIndex];
    loadVideo(video);
    if (heroVisible) {
      video.play().catch(() => {});
    }
  }

  function setHero(index) {
    const previousIndex = activeIndex;
    activeIndex = index;
    switcher?.style.setProperty("--active-index", String(index));
    if (switcher && previousIndex !== index) {
      window.clearTimeout(switcherTimer);
      switcher.classList.remove("is-transitioning");
      void switcher.offsetWidth;
      switcher.classList.add("is-transitioning");
      switcherTimer = window.setTimeout(() => {
        switcher.classList.remove("is-transitioning");
      }, 860);
    }
    videos.forEach((video, i) => {
      const active = i === index;
      video.classList.toggle("is-active", active);
      if (active) {
        playActive();
      } else {
        video.pause();
      }
    });
    tabs.forEach((tab, i) => tab.classList.toggle("is-active", i === index));
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setHero(Number(tab.dataset.heroIndex || 0));
    });
  });

  const observer = new IntersectionObserver(
    ([entry]) => {
      heroVisible = entry.isIntersecting;
      if (heroVisible) {
        playActive();
      } else {
        videos.forEach((video) => video.pause());
      }
    },
    { threshold: 0.22 }
  );
  if (heroSection) observer.observe(heroSection);
  setHero(0);
}

function setupTocNavigation() {
  function lockHashSection() {
    lockTocToSection(getHashId(window.location.hash));
  }

  tocLinks.forEach((link) => {
    link.addEventListener("click", () => {
      lockTocToSection(getTocId(link));
    });
  });

  ["wheel", "touchmove"].forEach((eventName) => {
    window.addEventListener(eventName, clearTocLock, { passive: true });
  });
  window.addEventListener("keydown", (event) => {
    if (TOC_LOCK_CLEAR_KEYS.has(event.key)) {
      clearTocLock();
    }
  });
  topnav?.addEventListener("scroll", () => positionTocIndicator(), { passive: true });
  document.fonts?.ready?.then(() => positionTocIndicator());
  // Hash clicks hold the TOC marker on the requested label until the user scrolls again.
  window.addEventListener("hashchange", lockHashSection);
  lockHashSection();
}

function setupTocOverflowScroll() {
  if (!topnav) return;

  function syncOverflowState() {
    const overflowing = topnav.scrollWidth > topnav.clientWidth + 1;
    topnav.classList.toggle("is-overflowing", overflowing);
    topnav.classList.toggle("is-at-start", !overflowing || topnav.scrollLeft <= 1);
    topnav.classList.toggle(
      "is-at-end",
      !overflowing || topnav.scrollLeft + topnav.clientWidth >= topnav.scrollWidth - 1
    );
    positionTocIndicator();
  }

  function isWheelInsideTopbar(event) {
    if (!topbar) return false;
    const rect = topbar.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  function handleTocWheel(event) {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;

    const pageScrollX = window.scrollX;
    const pageScrollY = window.scrollY;
    const restorePageScroll = () => {
      requestAnimationFrame(() => {
        if (window.scrollX !== pageScrollX || window.scrollY !== pageScrollY) {
          window.scrollTo(pageScrollX, pageScrollY);
        }
      });
    };

    // Keep wheel events over the TOC bar from leaking into vertical page scrolling.
    event.preventDefault();
    restorePageScroll();
    if (!topnav.classList.contains("is-overflowing")) return;

    const maxScroll = Math.max(0, topnav.scrollWidth - topnav.clientWidth);
    const nextScroll = Math.min(Math.max(topnav.scrollLeft + delta, 0), maxScroll);
    if (nextScroll === topnav.scrollLeft) return;
    topnav.scrollLeft = nextScroll;
    syncOverflowState();
  }

  window.addEventListener("wheel", (event) => {
    if (!isWheelInsideTopbar(event)) return;
    handleTocWheel(event);
  }, { passive: false, capture: true });

  topnav.addEventListener("scroll", syncOverflowState, { passive: true });
  window.addEventListener("resize", syncOverflowState);
  document.fonts?.ready?.then(syncOverflowState);
  requestAnimationFrame(() => {
    syncOverflowState();
    scrollTocLinkIntoView(document.querySelector(".toc-link.is-active"));
  });
}

function setupLazyVideos() {
  const videos = [...document.querySelectorAll(".lazy-video")];
  if (!videos.length) return;

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const toggleButton = document.querySelector("[data-demo-video-toggle]");
  let pausedByUser = false;

  function shouldAutoPlay() {
    return !pausedByUser && !reducedMotionQuery.matches && !document.hidden;
  }

  function pauseVideo(video) {
    video.pause();
  }

  function playVideo(video) {
    loadVideo(video);
    if (shouldAutoPlay()) {
      video.play().catch(() => {});
    } else {
      pauseVideo(video);
    }
  }

  function syncVisibleVideos() {
    videos.forEach((video) => {
      if (video.dataset.inViewport === "true") {
        playVideo(video);
      } else {
        pauseVideo(video);
      }
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.32;
        video.dataset.inViewport = visible ? "true" : "false";
        if (visible) {
          playVideo(video);
        } else {
          pauseVideo(video);
        }
      });
    },
    {
      rootMargin: "0px 0px -8% 0px",
      threshold: [0, 0.2, 0.32, 0.5, 0.75],
    }
  );
  videos.forEach((video) => {
    video.dataset.inViewport = "false";
    observer.observe(video);
  });

  document.addEventListener("visibilitychange", syncVisibleVideos);
  reducedMotionQuery.addEventListener?.("change", () => {
    if (reducedMotionQuery.matches) {
      videos.forEach(pauseVideo);
    } else {
      syncVisibleVideos();
    }
  });

  function setToggleState() {
    if (!toggleButton) return;
    toggleButton.classList.toggle("is-paused", pausedByUser);
    toggleButton.setAttribute("aria-pressed", pausedByUser ? "true" : "false");
    toggleButton.setAttribute("aria-label", pausedByUser ? "Play demo videos" : "Pause demo videos");
  }

  toggleButton?.addEventListener("click", () => {
    pausedByUser = !pausedByUser;
    setToggleState();
    syncVisibleVideos();
  });
  setToggleState();
}

function setupSectionHighlighting() {
  const observer = new IntersectionObserver(
    (entries) => {
      const lockedId = getLockedTocId();
      if (lockedId) {
        setActiveSection(lockedId);
        return;
      }
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]) setActiveSection(visible[0].target.id);
    },
    SECTION_OBSERVER_OPTIONS
  );
  tocSections.forEach((section) => observer.observe(section));
  updateActiveSectionFromScroll();
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      console.warn("Clipboard API unavailable, using fallback copy.", error);
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function showCitationToast(message = "Citation copied to clipboard") {
  const toast = document.querySelector("[data-citation-toast]");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showCitationToast.timer);
  showCitationToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2600);
}

function setupCopyButton() {
  const button = document.querySelector(".copy-button");
  const citationButton = document.querySelector("[data-citation-copy]");
  const bibtex = document.getElementById("bibtex-content");
  if (!bibtex) return;

  button?.addEventListener("click", async () => {
    if (button.classList.contains("is-copied")) return;
    try {
      await copyTextToClipboard(bibtex.textContent.trim());
      button.classList.add("is-copied");
      window.setTimeout(() => button.classList.remove("is-copied"), 1800);
    } catch (error) {
      console.error("Failed to copy BibTeX", error);
    }
  });

  citationButton?.addEventListener("click", async () => {
    try {
      await copyTextToClipboard(bibtex.textContent.trim());
      citationButton.classList.add("is-copied");
      showCitationToast();
      window.setTimeout(() => citationButton.classList.remove("is-copied"), 1800);
    } catch (error) {
      console.error("Failed to copy citation", error);
      showCitationToast("Citation copy failed");
    }
  });
}

// Animation pacing stays in CSS; this parser keeps JS tolerant of ms/s values.
function cssDurationToMs(value, fallbackMs) {
  const text = String(value || "").trim();
  if (!text) return fallbackMs;
  const number = Number.parseFloat(text);
  if (!Number.isFinite(number)) return fallbackMs;
  if (text.endsWith("ms")) return number;
  if (text.endsWith("s")) return number * 1000;
  return fallbackMs;
}

function measureInputSwapTokens(card) {
  const tokens = [...card.querySelectorAll(".input-token")];
  tokens.forEach((token) => {
    const shell = token.querySelector(".token-shell");
    if (!shell) return;
    const previousWidth = token.style.getPropertyValue("--token-open-width");
    token.style.removeProperty("--token-open-width");
    const width = Math.ceil(Math.max(shell.getBoundingClientRect().width, shell.scrollWidth));
    if (previousWidth) token.style.setProperty("--token-open-width", previousWidth);
    if (width > 0) token.style.setProperty("--token-open-width", `${width}px`);
  });
}

function setupInputSwapAnimation() {
  const cards = [...document.querySelectorAll("[data-input-swap]")];
  if (!cards.length) return;

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  cards.forEach((card) => {
    measureInputSwapTokens(card);
    document.fonts?.ready?.then(() => measureInputSwapTokens(card));
    window.addEventListener("resize", () => measureInputSwapTokens(card), { passive: true });

    let timers = [];
    const afterTitle = card.querySelector(".morph-title-after");
    const beforeTitle = card.querySelector(".morph-title-before");

    function clearTimers() {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
    }

    function schedule(callback, delay) {
      const timer = window.setTimeout(callback, delay);
      timers.push(timer);
      return timer;
    }

    function setAfterState(isAfter) {
      card.classList.toggle("is-after", isAfter);
      afterTitle?.setAttribute("aria-hidden", isAfter ? "false" : "true");
      beforeTitle?.setAttribute("aria-hidden", isAfter ? "true" : "false");
    }

    function readTiming() {
      const styles = window.getComputedStyle(card);
      return {
        beforeHold: cssDurationToMs(styles.getPropertyValue("--swap-before-hold"), 1450),
        transition: cssDurationToMs(styles.getPropertyValue("--swap-transition"), 950),
        afterHold: cssDurationToMs(styles.getPropertyValue("--swap-after-hold"), 3150),
      };
    }

    function runCycle() {
      clearTimers();
      if (reducedMotionQuery.matches) {
        setAfterState(true);
        return;
      }

      const timing = readTiming();
      setAfterState(false);
      schedule(() => {
        setAfterState(true);
        schedule(() => {
          setAfterState(false);
          schedule(runCycle, timing.transition);
        }, timing.transition + timing.afterHold);
      }, timing.beforeHold);
    }

    runCycle();
    reducedMotionQuery.addEventListener?.("change", runCycle);
  });
}

function setupViewerLoader() {
  const panels = [...document.querySelectorAll("[data-viewer-panel]")];
  if (!panels.length) return;

  const manifestUrl = panels[0].dataset.manifest;
  let manifestPromise = null;
  let activeViewer = null;
  let activePanel = null;
  let loadToken = 0;

  function getManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch(manifestUrl).then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${manifestUrl}`);
        return response.json();
      });
    }
    return manifestPromise;
  }

  function browserHasWebGL2() {
    try {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2"));
    } catch {
      return false;
    }
  }

  function getStatus(panel) {
    return panel.querySelector("[data-role='viewer-status']");
  }

  function getLoadButton(panel) {
    return panel.querySelector("[data-viewer-load]");
  }

  function setStatus(panel, message) {
    const status = getStatus(panel);
    if (status) status.textContent = message;
  }

  function setLoadButtonsDisabled(disabled) {
    panels.forEach((panel) => {
      const button = getLoadButton(panel);
      if (button) button.disabled = disabled;
    });
  }

  function restoreLoadButton(panel) {
    const button = getLoadButton(panel);
    if (!button) return;
    button.disabled = false;
    button.textContent = button.dataset.defaultLabel || "Load viewer";
  }

  function setPanelMode(panel, mode) {
    panel.dataset.pcaMode = mode;
    const toggle = panel.querySelector("[data-role='mode-toggle']");
    if (toggle) toggle.dataset.mode = mode;
    panel.querySelectorAll("[data-pca-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.pcaMode === mode);
    });
  }

  function setSelectedScene(panel, sceneId) {
    panel.dataset.selectedSceneId = sceneId;
    panel.querySelectorAll(".scene-card").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.sceneId === sceneId);
    });
  }

  function resetPanelUi(panel, message = "Ready") {
    panel.classList.remove("is-active");
    panel.querySelector("[data-role='viewer-placeholder']")?.classList.remove("is-hidden");
    panel.querySelector("[data-role='viewer-splitter']")?.setAttribute("hidden", "");
    panel.querySelector("[data-role='viewer-controls']")?.setAttribute("hidden", "");
    restoreLoadButton(panel);
    setStatus(panel, message);
  }

  function findDataset(manifest, datasetId) {
    const datasets = Array.isArray(manifest.datasets) ? manifest.datasets : [];
    return datasets.find((dataset) => dataset.id === datasetId);
  }

  function renderSceneRail(panel, dataset) {
    const rail = panel.querySelector("[data-role='scene-rail']");
    if (!rail || !dataset) return;
    const scenes = dataset.scenes || [];
    const selected = scenes.some((scene) => scene.id === panel.dataset.selectedSceneId)
      ? panel.dataset.selectedSceneId
      : scenes[0]?.id;
    panel.dataset.selectedSceneId = selected || "";
    rail.replaceChildren(
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
    setSelectedScene(panel, selected);
  }

  function disposeActiveViewer(nextPanel = null) {
    if (!activeViewer) return;
    activeViewer.dispose();
    if (activePanel && activePanel !== nextPanel) {
      resetPanelUi(activePanel, "Paused");
    }
    activeViewer = null;
    activePanel = null;
  }

  panels.forEach((panel) => {
    const loadButton = getLoadButton(panel);
    if (loadButton) {
      loadButton.dataset.defaultLabel = loadButton.textContent.trim();
    }
    setPanelMode(panel, panel.dataset.pcaMode || "3dgs");

    panel.addEventListener("click", (event) => {
      const card = event.target.closest(".scene-card");
      if (!card || !panel.contains(card)) return;
      setSelectedScene(panel, card.dataset.sceneId);
      if (activePanel === panel && activeViewer) {
        activeViewer.loadScene(card.dataset.sceneId, { reset: true }).catch((error) => {
          setStatus(panel, "Scene failed to load");
          console.error(error);
        });
      }
    });

    panel.querySelectorAll("[data-pca-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.pcaMode;
        if (!mode || panel.dataset.pcaMode === mode) return;
        setPanelMode(panel, mode);
        if (activePanel === panel && activeViewer) {
          activeViewer.setPcaMode(mode).catch((error) => {
            setStatus(panel, "PCA mode failed to load");
            console.error(error);
          });
        }
      });
    });

    loadButton?.addEventListener("click", async () => {
      if (activePanel === panel && activeViewer) return;
      if (!browserHasWebGL2()) {
        loadButton.disabled = true;
        loadButton.textContent = "Unavailable";
        setStatus(panel, "WebGL2 unavailable in this browser");
        return;
      }

      const token = ++loadToken;
      disposeActiveViewer(panel);
      setLoadButtonsDisabled(true);
      loadButton.textContent = "Loading";
      setStatus(panel, "Loading Spark and scene manifest");

      try {
        const manifest = await getManifest();
        const { initChorusSplatViewer } = await import("./splat-viewer.js");
        if (token !== loadToken) return;
        const viewer = await initChorusSplatViewer(panel, manifest);
        if (token !== loadToken) {
          viewer.dispose();
          return;
        }
        activeViewer = viewer;
        activePanel = panel;
        window.chorusSplatViewer = viewer;
        panel.classList.add("is-active");
        panel.querySelector("[data-role='viewer-placeholder']")?.classList.add("is-hidden");
        loadButton.textContent = "Loaded";
        setStatus(panel, "Viewer loaded");
      } catch (error) {
        resetPanelUi(panel, /WebGL2/i.test(error?.message || "")
          ? "WebGL2 unavailable in this browser"
          : "Viewer failed to load");
        console.error(error);
      } finally {
        setLoadButtonsDisabled(false);
        if (activePanel === panel && activeViewer) {
          loadButton.disabled = true;
          loadButton.textContent = "Loaded";
        } else if (!panel.classList.contains("is-active")) {
          restoreLoadButton(panel);
        }
      }
    });
  });

  function hydrateSceneRails() {
    getManifest()
      .then((manifest) => {
        panels.forEach((panel) => {
          renderSceneRail(panel, findDataset(manifest, panel.dataset.datasetId));
        });
      })
      .catch((error) => {
        panels.forEach((panel) => {
          setStatus(panel, "Scene manifest failed to load");
        });
        console.error(error);
      });
  }

  const demoSection = document.getElementById("demo") || panels[0];
  if ("IntersectionObserver" in window && demoSection) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        hydrateSceneRails();
      },
      { rootMargin: "900px 0px 900px 0px", threshold: 0 }
    );
    observer.observe(demoSection);
  } else {
    window.setTimeout(hydrateSceneRails, 0);
  }
}

window.addEventListener(
  "scroll",
  () => {
    setTopbarState();
    scheduleActiveSectionUpdate();
  },
  { passive: true }
);
window.addEventListener("resize", () => {
  setTopbarState();
  updateActiveSectionFromScroll();
});

setTopbarState();
setupHero();
setupTocNavigation();
setupTocOverflowScroll();
setupLazyVideos();
setupSectionHighlighting();
setupCopyButton();
setupInputSwapAnimation();
setupViewerLoader();
