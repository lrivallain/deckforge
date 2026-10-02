// deckforge viewer runtime: navigation, hash links, static mode, speaker
// notes, presenter window and fullscreen. Without this script every slide is
// shown in its final state (readable without JavaScript and printable).

(function () {
  "use strict";
  const root = document.documentElement;
  const slides = Array.from(document.querySelectorAll(".stage > .slide"));
  const controls = document.querySelector(".controls");
  if (!slides.length || !controls) return;

  const $ = (id) => document.getElementById(id);
  const previous = $("df-previous");
  const next = $("df-next");
  const select = $("df-slide-select");
  const staticButton = $("df-static");
  const notesButton = $("df-notes");
  const presenterButton = $("df-presenter");
  const fullscreenButton = $("df-fullscreen");
  const announcement = $("df-announcement");
  let current = 0;
  let presenter = null;
  let startedAt = null;
  let notesPanel = null;

  // Stagger entrance delays in reading order unless the author set --delay.
  // Overlays come after the template elements, or at their explicit step
  // (data-df-order: 0 = with the first template element).
  const stagger = parseFloat(getComputedStyle(root).getPropertyValue("--df-motion-stagger")) || 0.15;
  for (const slide of slides) {
    let step = 0;
    for (const el of slide.querySelectorAll(".reveal")) {
      const order = el.getAttribute("data-df-order");
      const at = order !== null && /^\d+$/.test(order) ? Number(order) : step++;
      if (!el.style.getPropertyValue("--delay")) el.style.setProperty("--delay", `${(at * stagger).toFixed(2)}s`);
    }
  }

  slides.forEach((slide, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${index + 1} / ${slides.length} - ${slide.dataset.title || "Slide"}`;
    select.append(option);
  });

  function readHash() {
    const match = /^#([1-9]\d*)$/.exec(location.hash);
    if (match) {
      const number = Number(match[1]);
      return Number.isSafeInteger(number) && number <= slides.length ? number - 1 : 0;
    }
    const byId = /^#slide-([\w-]+)$/.exec(location.hash);
    if (byId) {
      const index = slides.findIndex((s) => s.dataset.slideId === byId[1]);
      if (index >= 0) return index;
    }
    return 0;
  }

  function notesHtml(index) {
    const aside = slides[index] && slides[index].querySelector(".slide-notes");
    return aside ? aside.innerHTML : "";
  }

  function renderNotesPanel() {
    if (!notesPanel) return;
    const html = notesHtml(current);
    notesPanel.innerHTML = html || '<p class="empty">No speaker notes for this slide.</p>';
  }

  function show(index) {
    current = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide, position) => {
      slide.hidden = position !== current;
      slide.classList.remove("entered");
    });
    // Restart the entrance only when its slide is displayed.
    void slides[current].offsetWidth;
    slides[current].classList.add("entered");
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    select.value = String(current);
    announcement.textContent = `Slide ${current + 1} of ${slides.length}: ${slides[current].dataset.title || ""}`;
    if (location.hash !== `#${current + 1}`) history.replaceState(null, "", `#${current + 1}`);
    renderNotesPanel();
    updatePresenter();
  }

  function toggleStatic() {
    const enabled = root.classList.toggle("static");
    staticButton.setAttribute("aria-pressed", String(enabled));
  }

  function toggleNotes() {
    const enabled = root.classList.toggle("show-notes");
    notesButton.setAttribute("aria-pressed", String(enabled));
    if (enabled) {
      notesPanel = document.createElement("section");
      notesPanel.className = "notes-panel";
      notesPanel.setAttribute("aria-label", "Speaker notes");
      controls.before(notesPanel);
      renderNotesPanel();
    } else if (notesPanel) {
      notesPanel.remove();
      notesPanel = null;
    }
  }

  const PRESENTER_CSS = `
    body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#16202F;background:#F7F9FC;display:grid;grid-template-rows:auto 1fr auto;height:100vh}
    header,footer{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 20px;background:#fff;border-bottom:1px solid #E2E8F2}
    footer{border-top:1px solid #E2E8F2;border-bottom:0}
    h1{font-size:20px;margin:0}
    .meta{color:#53617A;font-variant-numeric:tabular-nums}
    main{overflow:auto;padding:20px 24px;font-size:22px;line-height:1.5}
    main p{margin:0 0 .7em}
    .empty{color:#53617A;font-style:italic}
    button{font:inherit;min-height:40px;padding:6px 14px;border:1px solid #53617A;border-radius:7px;background:#fff;cursor:pointer}
    button:disabled{color:#53617A;border-color:#E2E8F2;cursor:default}
    :focus-visible{outline:3px solid #0F6CBD;outline-offset:3px}`;

  function updatePresenter() {
    if (!presenter || presenter.closed) return;
    const doc = presenter.document;
    const title = doc.getElementById("p-title");
    if (!title) return;
    title.textContent = `${current + 1} / ${slides.length} — ${slides[current].dataset.title || ""}`;
    doc.getElementById("p-notes").innerHTML = notesHtml(current) || '<p class="empty">No speaker notes for this slide.</p>';
    doc.getElementById("p-next").textContent = current < slides.length - 1 ? `Next: ${slides[current + 1].dataset.title || ""}` : "End of deck";
    doc.getElementById("p-prev-btn").disabled = current === 0;
    doc.getElementById("p-next-btn").disabled = current === slides.length - 1;
  }

  function openPresenter() {
    if (presenter && !presenter.closed) {
      presenter.focus();
      return;
    }
    presenter = window.open("", "deckforge-presenter", "popup,width=960,height=640");
    if (!presenter) {
      announcement.textContent = "The presenter window was blocked. Allow pop-ups for this page, or use Notes.";
      return;
    }
    startedAt = startedAt || Date.now();
    const doc = presenter.document;
    doc.open();
    doc.write(`<!doctype html><html lang="${root.lang || "en"}"><head><meta charset="utf-8"><title>Presenter — ${document.title.replace(/</g, "&lt;")}</title><style>${PRESENTER_CSS}</style></head><body>
      <header><h1 id="p-title" aria-live="polite"></h1><span class="meta" id="p-clock"></span></header>
      <main id="p-notes" aria-label="Speaker notes"></main>
      <footer><span class="meta" id="p-next"></span><span><button id="p-prev-btn" type="button">Previous</button> <button id="p-next-btn" type="button">Next</button></span></footer>
    </body></html>`);
    doc.close();
    doc.getElementById("p-prev-btn").addEventListener("click", () => show(current - 1));
    doc.getElementById("p-next-btn").addEventListener("click", () => show(current + 1));
    doc.addEventListener("keydown", onKey);
    const tick = () => {
      if (!presenter || presenter.closed) return;
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      const clock = doc.getElementById("p-clock");
      if (clock) clock.textContent = `Elapsed ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      presenter.setTimeout(tick, 1000);
    };
    tick();
    updatePresenter();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else throw new Error("unsupported");
    } catch (err) {
      announcement.textContent = "Fullscreen is not available in this browser or was denied.";
    }
  }
  document.addEventListener("fullscreenchange", () => {
    fullscreenButton.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
  });

  function onKey(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target0 = event.target;
    if (target0 && typeof target0.closest === "function") {
      // Inside the presenter window, buttons should not swallow arrow keys.
      const interactive = target0.ownerDocument !== document
        ? "input, select, textarea, [contenteditable]"
        : "a, button, input, select, textarea, [contenteditable]";
      if (target0.closest(interactive)) return;
    }
    let target;
    switch (event.key) {
      case "ArrowRight": case "PageDown": case " ": target = current + 1; break;
      case "ArrowLeft": case "PageUp": target = current - 1; break;
      case "Home": target = 0; break;
      case "End": target = slides.length - 1; break;
      case "s": case "S": event.preventDefault(); toggleStatic(); return;
      case "n": case "N": event.preventDefault(); toggleNotes(); return;
      case "p": case "P": event.preventDefault(); openPresenter(); return;
      case "f": case "F": event.preventDefault(); toggleFullscreen(); return;
      default: return;
    }
    event.preventDefault();
    show(target);
  }

  previous.addEventListener("click", () => show(current - 1));
  next.addEventListener("click", () => show(current + 1));
  select.addEventListener("change", () => show(Number(select.value)));
  staticButton.addEventListener("click", toggleStatic);
  notesButton.addEventListener("click", toggleNotes);
  presenterButton.addEventListener("click", openPresenter);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  if (!document.documentElement.requestFullscreen) fullscreenButton.hidden = true;
  addEventListener("hashchange", () => show(readHash()));
  addEventListener("keydown", onKey);
  addEventListener("beforeprint", () => slides.forEach((s) => s.classList.add("entered")));
  addEventListener("pagehide", () => { if (presenter && !presenter.closed) presenter.close(); });

  window.deckforge = {
    go: (index) => show(index),
    next: () => show(current + 1),
    previous: () => show(current - 1),
    get current() { return current; },
    get count() { return slides.length; },
  };

  root.classList.add("presenting");
  controls.hidden = false;
  show(readHash());
})();
