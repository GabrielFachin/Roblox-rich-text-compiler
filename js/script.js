const lobbyTitle = document.getElementById("editor");
const highlightOverlay = document.getElementById("editor-highlight-overlay");
const displayName = document.getElementById("display-name");
const displayLabel = document.getElementById("display-label");
const copyButton = document.getElementById("copy-button");
const maxLength = 35;
const displayView = document.getElementById("display-view");

// Multi-selection state: a list of individual selected character indices
// (not ranges — every selected char, including ones picked one-by-one
// while holding Ctrl, lives here as its own index). Kept sorted+unique.
let selectedIndices = [];
// Whether the "Selecting: ..." preview should stay locked on, per the
// requested behaviour (persists until a click lands on empty space, or
// the user presses R to reset).
let selectionLocked = false;

// Per-character formatting. Index i here describes lobbyTitle.value[i].
// Any property left undefined/false means "use the default look".
// Shape: { color: '#rrggbb'|null, outline: bool, outlineColor: '#rrggbb'|null,
//          font: {name, asset, previewFamily}|null (the FONT_LIST entry,
//          not just a CSS string — asset is the rbxasset:// path needed
//          later for the actual Roblox rich text output, and keeping the
//          whole entry is what lets two fonts that share a browser
//          preview font, e.g. Michroma/Zekton, still be told apart),
//          bold, italic, underline }
let charStyles = [];

// --- Unified undo/redo history ------------------------------------------
// A single linear stack of { text, charStyles } snapshots, covering BOTH
// text edits (typing/pasting/deleting) and style changes (bold, color,
// outline, font...), recorded in the exact chronological order they
// happened. This is deliberately NOT split into two separate undo stacks
// (one for text, one for styles): if it were split, Ctrl+Z would have to
// arbitrarily decide which stack "goes first", and the two could drift
// out of sync with what the user actually did. A single interleaved
// stack means Ctrl+Z always undoes literally the last thing that
// happened — style change or keystroke — which is also what stops a
// careless "select all + delete" from silently discarding every style
// applied before it: that delete is just one more entry to step back
// through, same as any other.
const MAX_HISTORY = 200;
let styleHistory = [];
let historyIndex = -1;
// Guards against applyHistorySnapshot's own programmatic write to
// lobbyTitle.value re-triggering the "input" handler and pushHistory(),
// which would otherwise push a *new* entry for what is actually just a
// replay of an existing one.
let restoringHistory = false;

function deepCloneStyles(styles) {
    return styles.map(s => (s ? { ...s } : s));
}

function snapshotState() {
    return { text: lobbyTitle.value, charStyles: deepCloneStyles(charStyles) };
}

// Seed the stack immediately with the starting state (normally empty
// text, no styles) so historyIndex is never left at the invalid -1 and
// the very first edit always has something valid to undo back to.
styleHistory = [snapshotState()];
historyIndex = 0;

// Records the CURRENT state (text + styles together) as a new history
// entry. Called after every committed change: text input, and every
// applyStyleToSelection. Redundant no-op snapshots (nothing actually
// changed since the last entry) are skipped so holding a key or clicking
// a button repeatedly without effect doesn't bloat the stack.
function pushHistory() {
    if (restoringHistory) return;
    const snap = snapshotState();
    const last = styleHistory[historyIndex];
    if (last && last.text === snap.text && JSON.stringify(last.charStyles) === JSON.stringify(snap.charStyles)) {
        return;
    }
    styleHistory = styleHistory.slice(0, historyIndex + 1);
    styleHistory.push(snap);
    if (styleHistory.length > MAX_HISTORY) {
        styleHistory.shift();
    } else {
        historyIndex++;
    }
    historyIndex = styleHistory.length - 1;
}

function applyHistorySnapshot(snap) {
    restoringHistory = true;
    lobbyTitle.value = snap.text;
    charStyles = deepCloneStyles(snap.charStyles);
    previousValue = snap.text;
    restoringHistory = false;

    // A restored snapshot may no longer contain every previously-selected
    // index (e.g. undoing back past a delete that removed those chars),
    // so re-validate the selection against the restored text length
    // rather than trusting the stale selectedIndices as-is.
    selectedIndices = selectedIndices.filter(i => i < snap.text.length);

    refreshDisplayView();
    renderHighlights();
    if (selectionLocked && selectedIndices.length > 0) {
        showSelectionText();
    } else {
        selectionLocked = false;
        showFullText();
    }
    syncToolbarWithSelection();
}

function undoHistory() {
    if (historyIndex <= 0) return;
    historyIndex--;
    applyHistorySnapshot(styleHistory[historyIndex]);
}

function redoHistory() {
    if (historyIndex >= styleHistory.length - 1) return;
    historyIndex++;
    applyHistorySnapshot(styleHistory[historyIndex]);
}

function getStyle(i) {
    return charStyles[i] || null;
}

function ensureStyle(i) {
    if (!charStyles[i]) charStyles[i] = {};
    return charStyles[i];
}

// Keeps charStyles aligned with the text whenever it's edited directly
// (typing, pasting, deleting). Called from the "input" handler with the
// text as it was immediately before this input event, so we can diff
// lengths and figure out where the change happened relative to the
// caret, then shift/insert/remove style entries to match.
let previousValue = "";
function reconcileStylesWithEdit(newValue) {
    const oldValue = previousValue;
    if (newValue === oldValue) return;

    // Find the shared prefix/suffix between old and new text to localize
    // exactly what changed, so styles on untouched characters survive.
    let prefix = 0;
    const maxPrefix = Math.min(oldValue.length, newValue.length);
    while (prefix < maxPrefix && oldValue[prefix] === newValue[prefix]) prefix++;

    let oldSuffix = oldValue.length;
    let newSuffix = newValue.length;
    while (
        oldSuffix > prefix &&
        newSuffix > prefix &&
        oldValue[oldSuffix - 1] === newValue[newSuffix - 1]
    ) {
        oldSuffix--;
        newSuffix--;
    }

    const removedCount = oldSuffix - prefix;
    const insertedCount = newSuffix - prefix;

    const newStyles = charStyles.slice(0, prefix);
    for (let i = 0; i < insertedCount; i++) newStyles.push(null);
    newStyles.push(...charStyles.slice(oldSuffix));
    charStyles = newStyles;

    void removedCount;
}

function refreshDisplayView() {
    if (lobbyTitle.value.trim() === "") {
        displayView.classList.remove("visible-display-view");
    } else {
        displayView.classList.add("visible-display-view");
    }
}

function styleClasses(style) {
    if (!style) return "";
    const classes = ["styled-char"];
    if (style.outline) classes.push("styled-char--outline");
    if (style.bold) classes.push("styled-char--bold");
    if (style.italic) classes.push("styled-char--italic");
    if (style.underline) classes.push("styled-char--underline");
    return classes.join(" ");
}

function styleInlineCss(style) {
    if (!style) return "";
    const rules = [];
    if (style.color) rules.push(`color:${style.color}`);
    if (style.font) rules.push(`font-family:${style.font.previewFamily}`);
    if (style.outline) {
        const oc = style.outlineColor || "#000000";
        rules.push(`-webkit-text-stroke-color:${oc}`, `text-stroke-color:${oc}`);
    }
    return rules.join(";");
}

// Renders `text` as a string of HTML, wrapping any character that has a
// non-default style (or is currently selected, via selectedSet) in its
// own <span>/<mark> so per-character color/font/outline/bold/italic/
// underline all show up. Shared by both the textarea overlay and the
// "Will display as" preview so they always stay visually identical.
function renderStyledHtml(text, selectedSet) {
    let html = "";
    let i = 0;
    while (i < text.length) {
        const style = getStyle(i);
        const selected = selectedSet ? selectedSet.has(i) : false;
        const styleKey = JSON.stringify(style) + "|" + selected;

        let j = i;
        let chunk = "";
        while (j < text.length) {
            const s = getStyle(j);
            const sel = selectedSet ? selectedSet.has(j) : false;
            if (JSON.stringify(s) + "|" + sel !== styleKey) break;
            chunk += text[j];
            j++;
        }

        const escaped = escapeHtml(chunk);
        const classes = styleClasses(style);
        const inlineCss = styleInlineCss(style);
        const needsSpan = classes || inlineCss;

        let piece = escaped;
        if (needsSpan) {
            piece = `<span${classes ? ` class="${classes}"` : ""}${inlineCss ? ` style="${inlineCss}"` : ""}>${escaped}</span>`;
        }
        if (selected) {
            piece = `<mark>${piece}</mark>`;
        }

        html += piece;
        i = j;
    }
    return html;
}

function showFullText() {
    displayLabel.textContent = "Will display as:";
    displayName.innerHTML = renderStyledHtml(lobbyTitle.value, null);
}

function showSelectionText() {
    displayLabel.textContent = "Selecting:";
    const text = selectedIndices.map(i => lobbyTitle.value[i]).join("");
    // Re-map styles onto the extracted substring positionally so the
    // "Selecting: ..." preview also reflects each picked letter's look.
    const substyles = selectedIndices.map(i => getStyle(i));
    let html = "";
    for (let k = 0; k < text.length; k++) {
        const style = substyles[k];
        const escaped = escapeHtml(text[k]);
        const classes = styleClasses(style);
        const inlineCss = styleInlineCss(style);
        html += (classes || inlineCss)
            ? `<span${classes ? ` class="${classes}"` : ""}${inlineCss ? ` style="${inlineCss}"` : ""}>${escaped}</span>`
            : escaped;
    }
    displayName.innerHTML = html;
}

function clearSelection({ keepLock = false } = {}) {
    selectedIndices = [];
    if (!keepLock) selectionLocked = false;
    renderHighlights();
    if (!selectionLocked) showFullText();
    syncToolbarWithSelection();
}

function addIndex(i) {
    if (i < 0 || i >= lobbyTitle.value.length) return;
    if (!selectedIndices.includes(i)) {
        selectedIndices.push(i);
        selectedIndices.sort((a, b) => a - b);
    }
}

function addRange(start, end) {
    for (let i = start; i < end; i++) addIndex(i);
}

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Rebuilds the overlay's markup so every selected index is wrapped in a
// <mark>, mirroring the textarea's text so highlights line up visually
// even though a <textarea> can't natively show multiple selected ranges.
// Also mirrors any per-character color/font/outline/bold/italic/underline
// styling so the editor itself previews formatting live, not just the
// "Will display as" box.
function renderHighlights() {
    const text = lobbyTitle.value;
    const selectedSet = new Set(selectedIndices);
    highlightOverlay.innerHTML = renderStyledHtml(text, selectedSet);
}

function syncOverlayScroll() {
    highlightOverlay.scrollLeft = lobbyTitle.scrollLeft;
}

// Applies a partial style patch (e.g. { color: '#ff00ff' }) to every
// currently-selected character, then re-renders both previews live. No-op
// if nothing is selected, since there'd be nothing to apply the effect to.
//
// `commit` controls whether this change becomes its own undo/redo entry
// right away. Continuous-drag inputs (the SV/hue color picker, dragging
// while mousedown is held) pass commit=false on every intermediate frame
// — otherwise a single drag gesture floods the history with one entry
// per mousemove, and Ctrl+Z has to be pressed dozens of times to undo
// what visually felt like "one" color pick. Callers that do this MUST
// call commitPendingStyleChange() once the gesture ends (mouseup/blur/
// Enter) so the final state still gets recorded exactly once.
function applyStyleToSelection(patch, commit = true) {
    if (selectedIndices.length === 0) return false;
    selectedIndices.forEach((i) => {
        const style = ensureStyle(i);
        Object.assign(style, patch);
    });
    if (commit) pushHistory();
    renderHighlights();
    if (selectionLocked) {
        showSelectionText();
    } else {
        showFullText();
    }
    return true;
}

// Records the current state as a single history entry after one or more
// commit=false applyStyleToSelection calls (e.g. at the end of a color
// picker drag). No-op if nothing actually changed since the last commit
// (pushHistory already dedupes), so calling this defensively/redundantly
// is harmless.
function commitPendingStyleChange() {
    pushHistory();
}

// Three-state toolbar sync: for a given style property, look at every
// selected character and report whether they're all "on" ('on'), all
// "off" ('off'), or split ('mixed'). This is what makes the toolbar a
// *read* of the real per-character data instead of its own separate
// on/off memory (which is what caused clicking bold on one letter to
// leave the button lit for an unrelated letter afterwards).
function selectionStyleState(prop) {
    if (selectedIndices.length === 0) return 'off';
    let sawOn = false;
    let sawOff = false;
    for (const i of selectedIndices) {
        const style = getStyle(i);
        const isOn = !!(style && style[prop]);
        if (isOn) sawOn = true; else sawOff = true;
        if (sawOn && sawOff) return 'mixed';
    }
    return sawOn ? 'on' : 'off';
}

function setButtonTriState(btn, state) {
    if (!btn) return;
    // aria-pressed only has true/false/mixed as valid ARIA values, which
    // conveniently maps 1:1 onto our three states.
    btn.setAttribute('aria-pressed', state === 'on' ? 'true' : state === 'mixed' ? 'mixed' : 'false');
    btn.classList.toggle('is-mixed', state === 'mixed');
}

// Re-reads charStyles for the current selection and updates every
// toolbar control (bold/italic/underline/outline) to match. Must be
// called any time selectedIndices changes, or after an undo/redo swaps
// charStyles out from under an unchanged selection.
//
// The color picker and font list live inside their own IIFEs (closures
// over their own DOM refs/state) further down the file and can't be
// called by name from here, so they register themselves into this list
// instead of this function reaching into `window` to find them — keeps
// the coupling explicit and in one direction (they know about the
// registry; this function doesn't need to know they exist).
const selectionSyncCallbacks = [];
function onSelectionSync(fn) {
    selectionSyncCallbacks.push(fn);
}

function syncToolbarWithSelection() {
    const boldBtn = document.getElementById('style-bold');
    const italicBtn = document.getElementById('style-italic');
    const underlineBtn = document.getElementById('style-underline');
    const outlineToggle = document.getElementById('outline-toggle');

    setButtonTriState(boldBtn, selectionStyleState('bold'));
    setButtonTriState(italicBtn, selectionStyleState('italic'));
    setButtonTriState(underlineBtn, selectionStyleState('underline'));
    setButtonTriState(outlineToggle, selectionStyleState('outline'));

    selectionSyncCallbacks.forEach(fn => fn());
}

lobbyTitle.addEventListener("input", () => {
    // Ignore synthetic input events caused by undo/redo writing to
    // lobbyTitle.value directly — those are history *replays*, not new
    // edits, and must not push another (duplicate/wrong) entry.
    if (restoringHistory) return;

    reconcileStylesWithEdit(lobbyTitle.value);
    previousValue = lobbyTitle.value;
    refreshDisplayView();
    pushHistory();
    // Typing invalidates any previous selection.
    clearSelection();
});

lobbyTitle.addEventListener("scroll", syncOverlayScroll);

// Extra safety net: some browsers can still fire a native undo/redo via
// beforeinput (inputType "historyUndo"/"historyRedo") even when the
// keydown was preventDefault()-ed, depending on how the shortcut was
// triggered (e.g. from a browser/OS-level menu). Block it here too so
// the textarea's own undo stack — which knows nothing about charStyles —
// can never silently desync text from styles.
lobbyTitle.addEventListener("beforeinput", (e) => {
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
        e.preventDefault();
    }
});

let ctrlHeld = false;

// Native browser drag-selection (mouse drag without Ctrl, or Shift+Arrow
// keyboard selection) still uses the textarea's real selectionStart/End.
// We fold that range into our own selectedIndices model so it renders
// through the same highlight overlay as Ctrl-picked characters.
lobbyTitle.addEventListener("select", (e) => {
    if (ctrlHeld) return; // let mouseup/click handle Ctrl-click picking
    const start = lobbyTitle.selectionStart;
    const end = lobbyTitle.selectionEnd;
    if (start !== end) {
        selectedIndices = [];
        addRange(start, end);
        selectionLocked = true;
        renderHighlights();
        showSelectionText();
        syncToolbarWithSelection();
    }
});

lobbyTitle.addEventListener("keyup", (e) => {
    // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y are handled by the dedicated keydown
    // listener below; ignore them here so they don't also get treated as
    // a (no-op) selection change.
    if (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y") return;

    const start = lobbyTitle.selectionStart;
    const end = lobbyTitle.selectionEnd;
    if (start !== end) {
        selectedIndices = [];
        addRange(start, end);
        selectionLocked = true;
        renderHighlights();
        showSelectionText();
        syncToolbarWithSelection();
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Control" || e.key === "Meta") ctrlHeld = true;

    // Press R to reset the current selection back to the full-text view.
    // Ignored while typing inside the textarea itself so the letter "r"
    // can still be typed normally.
    if ((e.key === "r" || e.key === "R") && document.activeElement !== lobbyTitle) {
        clearSelection();
    }

    // Ctrl+Z / Cmd+Z: step back through the unified history (text edits
    // AND style changes, interleaved in the order they actually
    // happened). Ctrl+Shift+Z or Ctrl+Y redoes. We always preventDefault
    // here and never fall through to the textarea's own native undo:
    // since our history already captures every text edit too, letting
    // both undo systems run at once would desync lobbyTitle.value from
    // charStyles (native undo has no idea styles exist).
    const ctrlOrCmd = e.ctrlKey || e.metaKey;
    if (ctrlOrCmd && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) {
            redoHistory();
        } else {
            undoHistory();
        }
    } else if (ctrlOrCmd && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redoHistory();
    }
});
document.addEventListener("keyup", (e) => {
    if (e.key === "Control" || e.key === "Meta") ctrlHeld = false;
});
window.addEventListener("blur", () => { ctrlHeld = false; });

// Computes which character index in the textarea's text sits under a
// given mouse event, using a hidden mirror <span> to measure text width
// (needed because we preventDefault() on Ctrl+mousedown, so the browser
// never gets the chance to move the caret/selectionStart for us).
const measureMirror = document.createElement("span");
measureMirror.style.position = "absolute";
measureMirror.style.visibility = "hidden";
measureMirror.style.whiteSpace = "pre";
const editorStyles = getComputedStyle(lobbyTitle);
measureMirror.style.font = editorStyles.font;
measureMirror.style.fontFamily = editorStyles.fontFamily;
measureMirror.style.fontSize = editorStyles.fontSize;
measureMirror.style.letterSpacing = editorStyles.letterSpacing;
document.body.appendChild(measureMirror);

function charIndexFromEvent(e) {
    const rect = lobbyTitle.getBoundingClientRect();
    const paddingLeft = parseFloat(editorStyles.paddingLeft) || 0;
    const clickX = e.clientX - rect.left - paddingLeft + lobbyTitle.scrollLeft;

    const text = lobbyTitle.value;
    if (text.length === 0) return 0;

    // Find which character's own [left, right) box actually contains the
    // click point, rather than snapping to the nearest boundary (which
    // biases hits toward one side of every letter).
    let left = 0;
    for (let i = 0; i < text.length; i++) {
        measureMirror.textContent = text.slice(0, i + 1);
        const right = measureMirror.getBoundingClientRect().width;
        if (clickX < right) return i;
        left = right;
    }

    return text.length - 1;
}

// Plain click / Ctrl-click handling:
// - Click on a letter with no Ctrl held -> selects just that one character
//   (replacing any previous selection).
// - Ctrl+click on a letter -> adds that character to the current selection
//   (or removes it, if it was already selected), letting multiple
//   separate letters be selected at once.
// - Click on empty space (no character there) -> clears the selection and
//   goes back to showing the full text.
lobbyTitle.addEventListener("mousedown", (e) => {
    // Let native drag-selection do its thing when Ctrl isn't held; we only
    // need to special-case Ctrl-click picking here.
    if (!(e.ctrlKey || e.metaKey)) return;

    e.preventDefault();
    lobbyTitle.focus();
    const index = charIndexFromEvent(e);
    const clickedChar = lobbyTitle.value[index];
    if (!clickedChar || clickedChar === "\n") return;

    if (selectedIndices.includes(index)) {
        selectedIndices = selectedIndices.filter(i => i !== index);
    } else {
        addIndex(index);
    }
    selectionLocked = selectedIndices.length > 0;
    renderHighlights();
    if (selectionLocked) {
        showSelectionText();
    } else {
        showFullText();
    }
    syncToolbarWithSelection();
});

lobbyTitle.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey) return; // handled by mousedown above

    const start = lobbyTitle.selectionStart;
    const end = lobbyTitle.selectionEnd;

    // A real drag-selection was just made; it was already folded into
    // selectedIndices by the "select" listener above.
    if (start !== end) return;

    const clickedChar = lobbyTitle.value[start];
    if (clickedChar && clickedChar !== "\n") {
        selectedIndices = [];
        addIndex(start);
        selectionLocked = true;
        renderHighlights();
        showSelectionText();
        syncToolbarWithSelection();
    } else {
        clearSelection();
    }
});

lobbyTitle.addEventListener("blur", () => {
    if (!selectionLocked) {
        showFullText();
    }
});

renderHighlights();
showFullText();
syncToolbarWithSelection();



copyButton.addEventListener("click", () => {
    const textToCopy = lobbyTitle.value;
    if (textToCopy) {
        navigator.clipboard.writeText(textToCopy)
            .then(() => {
                alert("Copied to clipboard: " + textToCopy);
            })
            .catch(err => {
                console.error("Failed to copy text: ", err);
            });
    } else {
        alert("Nothing to copy!");
    }
});

// Roblox font families available for the rich-text compiler. `asset` is the
// rbxasset:// path used when generating the actual Roblox rich text tags.
// `previewFamily` is the closest web font used purely so the button shows
// what the font looks like in the browser (Roblox fonts aren't loadable
// on the web, so a handful fall back to a similar system/Google font).
const FONT_LIST = [
    { name: 'Accanthis ADF Std', asset: 'rbxasset://fonts/families/AccanthisADFStd.json', previewFamily: "'Times New Roman', Times, serif" },
    { name: 'Amatic SC', asset: 'rbxasset://fonts/families/AmaticSC.json', previewFamily: "'Amatic SC', cursive" },
    { name: 'Arimo', asset: 'rbxasset://fonts/families/Arimo.json', previewFamily: "'Arimo', sans-serif" },
    { name: 'Balthazar', asset: 'rbxasset://fonts/families/Balthazar.json', previewFamily: "'Balthazar', serif" },
    { name: 'Bangers', asset: 'rbxasset://fonts/families/Bangers.json', previewFamily: "'Bangers', cursive" },
    { name: 'Builder Extended', asset: 'rbxasset://fonts/families/BuilderExtended.json', previewFamily: "'Oswald', sans-serif" },
    { name: 'Builder Mono', asset: 'rbxasset://fonts/families/BuilderMono.json', previewFamily: "'Roboto Mono', monospace" },
    { name: 'Builder Sans', asset: 'rbxasset://fonts/families/BuilderSans.json', previewFamily: "'Arimo', sans-serif" },
    { name: 'Comic Neue Angular', asset: 'rbxasset://fonts/families/ComicNeueAngular.json', previewFamily: "'Comic Neue', cursive" },
    { name: 'Creepster', asset: 'rbxasset://fonts/families/Creepster.json', previewFamily: "'Creepster', cursive" },
    { name: 'Denk One', asset: 'rbxasset://fonts/families/DenkOne.json', previewFamily: "'Oswald', sans-serif" },
    { name: 'Fondamento', asset: 'rbxasset://fonts/families/Fondamento.json', previewFamily: "'Fondamento', cursive" },
    { name: 'Fredoka One', asset: 'rbxasset://fonts/families/FredokaOne.json', previewFamily: "'Fredoka', sans-serif" },
    { name: 'Grenze Gotisch', asset: 'rbxasset://fonts/families/GrenzeGotisch.json', previewFamily: "'Grenze Gotisch', serif" },
    { name: 'Guru', asset: 'rbxasset://fonts/families/Guru.json', previewFamily: "'Nunito', sans-serif" },
    { name: 'Highway Gothic', asset: 'rbxasset://fonts/families/HighwayGothic.json', previewFamily: "'Roboto Condensed', sans-serif" },
    { name: 'Inconsolata', asset: 'rbxasset://fonts/families/Inconsolata.json', previewFamily: "'Inconsolata', monospace" },
    { name: 'Indie Flower', asset: 'rbxasset://fonts/families/IndieFlower.json', previewFamily: "'Indie Flower', cursive" },
    { name: 'Josefin Sans', asset: 'rbxasset://fonts/families/JosefinSans.json', previewFamily: "'Josefin Sans', sans-serif" },
    { name: 'Jura', asset: 'rbxasset://fonts/families/Jura.json', previewFamily: "'Jura', sans-serif" },
    { name: 'Kalam', asset: 'rbxasset://fonts/families/Kalam.json', previewFamily: "'Kalam', cursive" },
    { name: 'Luckiest Guy', asset: 'rbxasset://fonts/families/LuckiestGuy.json', previewFamily: "'Luckiest Guy', cursive" },
    { name: 'Merriweather', asset: 'rbxasset://fonts/families/Merriweather.json', previewFamily: "'Merriweather', serif" },
    { name: 'Michroma', asset: 'rbxasset://fonts/families/Michroma.json', previewFamily: "'Michroma', sans-serif" },
    { name: 'Montserrat', asset: 'rbxasset://fonts/families/Montserrat.json', previewFamily: "'Montserrat', sans-serif" },
    { name: 'Nunito', asset: 'rbxasset://fonts/families/Nunito.json', previewFamily: "'Nunito', sans-serif" },
    { name: 'Oswald', asset: 'rbxasset://fonts/families/Oswald.json', previewFamily: "'Oswald', sans-serif" },
    { name: 'Patrick Hand', asset: 'rbxasset://fonts/families/PatrickHand.json', previewFamily: "'Patrick Hand', cursive" },
    { name: 'Permanent Marker', asset: 'rbxasset://fonts/families/PermanentMarker.json', previewFamily: "'Permanent Marker', cursive" },
    { name: 'Press Start 2P', asset: 'rbxasset://fonts/families/PressStart2P.json', previewFamily: "'Press Start 2P', monospace" },
    { name: 'Roboto', asset: 'rbxasset://fonts/families/Roboto.json', previewFamily: "'Roboto', sans-serif" },
    { name: 'Roboto Condensed', asset: 'rbxasset://fonts/families/RobotoCondensed.json', previewFamily: "'Roboto Condensed', sans-serif" },
    { name: 'Roboto Mono', asset: 'rbxasset://fonts/families/RobotoMono.json', previewFamily: "'Roboto Mono', monospace" },
    { name: 'Roman Antique', asset: 'rbxasset://fonts/families/RomanAntique.json', previewFamily: "'Times New Roman', Times, serif" },
    { name: 'Sarpanch', asset: 'rbxasset://fonts/families/Sarpanch.json', previewFamily: "'Sarpanch', sans-serif" },
    { name: 'Source Sans Pro', asset: 'rbxasset://fonts/families/SourceSansPro.json', previewFamily: "'Source Sans 3', sans-serif" },
    { name: 'Special Elite', asset: 'rbxasset://fonts/families/SpecialElite.json', previewFamily: "'Special Elite', cursive" },
    { name: 'Titillium Web', asset: 'rbxasset://fonts/families/TitilliumWeb.json', previewFamily: "'Titillium Web', sans-serif" },
    { name: 'Ubuntu', asset: 'rbxasset://fonts/families/Ubuntu.json', previewFamily: "'Ubuntu', sans-serif" },
    { name: 'Zekton', asset: 'rbxasset://fonts/families/Zekton.json', previewFamily: "'Michroma', sans-serif" }
];

// Builds the scrollable font list inside the "Fonts" side box. Each button
// applies its font live to the current selection, and — same fix as
// bold/italic/underline/outline/color — the highlighted button is driven
// by re-reading charStyles for the current selection, not by remembering
// its own last-clicked state, so switching selection shows the right font
// (or none highlighted, for "mixed"/no-font) instead of whatever button
// happened to be clicked last.
(function initFontList() {
    const fontList = document.getElementById('font-list');
    if (!fontList) return;

    // asset (the rbxasset:// path) is unique per font even where two
    // entries share a previewFamily fallback, so it's what we key equality
    // checks on rather than name or previewFamily.
    const buttonsByAsset = new Map();

    FONT_LIST.forEach((font) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'font-option';
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('data-font-name', font.name);
        btn.setAttribute('data-font-asset', font.asset);
        btn.title = font.name;

        const label = document.createElement('span');
        label.className = 'font-option-name';
        label.textContent = font.name;

        const preview = document.createElement('span');
        preview.className = 'font-option-preview';
        preview.style.fontFamily = font.previewFamily;
        preview.textContent = 'AaBbCc 123';

        btn.appendChild(label);
        btn.appendChild(preview);

        btn.addEventListener('click', () => {
            // Same tri-state read as the other toolbar controls: a
            // selection where every char already has THIS font counts as
            // "on" (click clears it); anything else — no font, a different
            // font, or a mix — counts as "off" (click sets this font for
            // every selected char, unifying a mixed selection).
            const isOn = selectedIndices.length > 0 && selectedIndices.every(i => {
                const s = getStyle(i);
                return s && s.font && s.font.asset === font.asset;
            });
            applyStyleToSelection({ font: isOn ? null : font });
            syncToolbarWithSelection();
        });

        buttonsByAsset.set(font.asset, btn);
        fontList.appendChild(btn);
    });

    function syncFontListWithSelection() {
        if (selectedIndices.length === 0) {
            buttonsByAsset.forEach(btn => setButtonTriState(btn, 'off'));
            return;
        }
        // Tri-state per font, exactly like selectionStyleState() does for
        // bold/italic/etc — mixed only really applies to "the" active font
        // as a concept (at most one font can be 'on' for a uniform
        // selection), so this resolves to: the one font every selected
        // char shares -> 'on'; every other button -> 'off' UNLESS the
        // selection itself has mixed fonts, in which case ALL buttons show
        // 'mixed' since none of them is unambiguously "the" current font.
        const assetsInSelection = new Set(selectedIndices.map(i => {
            const s = getStyle(i);
            return (s && s.font && s.font.asset) || null;
        }));

        if (assetsInSelection.size > 1) {
            buttonsByAsset.forEach(btn => setButtonTriState(btn, 'mixed'));
            return;
        }

        const uniformAsset = assetsInSelection.values().next().value; // null if no font set
        buttonsByAsset.forEach((btn, asset) => {
            setButtonTriState(btn, asset === uniformAsset ? 'on' : 'off');
        });
    }

    onSelectionSync(syncFontListWithSelection);
})();

document.addEventListener('DOMContentLoaded', () => {
    const mapping = [
        { buttonId: 'font-button', panelSelector: '.aside-left-full' },
        { buttonId: 'color-button', panelSelector: '.color-panel-wrap' },
        { buttonId: 'style-button', panelSelector: '.aside-bottom-right' }
    ];

    const panels = mapping.map(m => document.querySelector(m.panelSelector)).filter(Boolean);

    // Tracks the pending transitionend listener + fallback timer per panel so
    // that toggling quickly (close, then reopen before the close animation
    // settles — i.e. "voltar") always cancels the *previous* close's cleanup
    // instead of letting it fire later and fight with the new state. That
    // stale cleanup racing the reopen transition is what made the color
    // picker's return animation look like it wasn't running.
    const pendingClose = new WeakMap();

    function cancelPendingClose(panel) {
        const pending = pendingClose.get(panel);
        if (!pending) return;
        panel.removeEventListener('transitionend', pending.onEnd);
        clearTimeout(pending.fallback);
        pendingClose.delete(panel);
    }

    function closePanel(panel) {
        if (!panel) return;
        if (panel.classList.contains('menu-closed') && panel.style.display === 'none') return;

        cancelPendingClose(panel);

        panel.classList.add('menu-closed');
        panel.setAttribute('aria-hidden', 'true');

        const tidy = () => {
            if (panel.classList.contains('menu-closed')) {
                if (!panel.classList.contains('color-panel-wrap')) {
                    panel.style.display = 'none';
                } else {
                    panel.style.display = '';
                }
            }
            pendingClose.delete(panel);
        };

        const onEnd = (e) => {
            // Only the longest-running property (transform, 320ms) should
            // trigger cleanup. Opacity finishes sooner (220ms); reacting to
            // it too meant `display:none` could land ~100ms before the
            // transform transition actually finished, cutting the animation
            // short. Also ignore events bubbling up from child elements.
            if (e.target === panel && e.propertyName === 'transform') tidy();
        };

        const fallback = setTimeout(tidy, 420);

        panel.addEventListener('transitionend', onEnd);
        pendingClose.set(panel, { onEnd, fallback });
    }

    function openPanel(panel) {
        if (!panel) return;
        cancelPendingClose(panel);
        panel.style.display = '';
        panel.offsetHeight;
        panel.classList.remove('menu-closed');
        panel.setAttribute('aria-hidden', 'false');
    }

    panels.forEach(p => {
        p.classList.add('menu-closed');
        p.setAttribute('aria-hidden', 'true');
        if (p.classList && p.classList.contains('color-panel-wrap')) {
            p.style.display = '';
        } else {
            p.style.display = 'none';
        }
    });

    mapping.forEach(m => {
        const btn = document.getElementById(m.buttonId);
        const panel = document.querySelector(m.panelSelector);
        if (!btn || !panel) return;

        btn.addEventListener('click', () => {
            const isClosed = panel.classList.contains('menu-closed');

            if (isClosed) {
                openPanel(panel);
            } else {
                closePanel(panel);
            }
        });
    });

    (function initPicker(){
        const sv = document.getElementById('sv');
        const svCursor = document.getElementById('sv-cursor');
        const hue = document.getElementById('hue');
        const hueCursor = document.getElementById('hue-cursor');
        const swatches = document.getElementById('swatches');
        const colorHexInput = document.getElementById('color-hex-input');
        const colorCircle = document.getElementById('color-circle');
        const topBox = document.querySelector('.aside-top-right');


        if (!sv || !hue || !svCursor || !hueCursor || !colorHexInput) return;

        let H = 320, S = 0.6, V = 1;
        // True while setFromHSV() is only updating the picker's own visuals
        // to MATCH the current selection (see syncColorPickerFromSelection),
        // as opposed to the user actively dragging/typing a new color. Needed
        // so that reflecting the selection back onto the picker doesn't
        // itself get read as "the user picked a new color" and write it
        // straight back onto charStyles — that would silently overwrite a
        // mixed-color selection with whatever the first character's color was.
        let syncingFromSelection = false;

        function hsvToRgb(h, s, v) {
            let c = v * s;
            let x = c * (1 - Math.abs((h / 60) % 2 - 1));
            let m = v - c;
            let r = 0, g = 0, b = 0;
            if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
            else if (h < 120) { r = x; g = c; b = 0; }
            else if (h < 180) { r = 0; g = c; b = x; }
            else if (h < 240) { r = 0; g = x; b = c; }
            else if (h < 300) { r = x; g = 0; b = c; }
            else { r = c; g = 0; b = x; }
            return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
        }

        function rgbToHex(r,g,b){
            return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
        }

        function rgbToHsv(r,g,b){
            r/=255; g/=255; b/=255;
            let max=Math.max(r,g,b), min=Math.min(r,g,b);
            let d=max-min;
            let h=0;
            if(d===0) h=0;
            else if(max===r) h = (60 * ((g-b)/d) + 360) % 360;
            else if(max===g) h = 60 * ((b-r)/d) + 120;
            else h = 60 * ((r-g)/d) + 240;
            let s = max===0?0:d/max;
            let v = max;
            return [h,s,v];
        }

        // `commit` is forwarded straight to applyStyleToSelection: false
        // while a drag/keystroke is still in progress (so intermediate
        // frames don't each become their own undo step), true for the
        // gesture's final value. See applyStyleToSelection's doc comment.
        function setFromHSV(commit = true){
            const [r,g,b] = hsvToRgb(H,S,V);
            const hex = rgbToHex(r,g,b);
            if (colorHexInput) colorHexInput.value = hex;
            if (colorCircle) colorCircle.style.background = hex;
            if (topBox) topBox.style.setProperty('--picked-color', hex);
            sv.style.setProperty('--h', H);
            svCursor.style.left = (S*100)+'%';
            svCursor.style.top = ((1-V)*100)+'%';
            hueCursor.style.top = ((1 - (H/360))*100)+'%';

            // A pure "reflect the current selection onto the picker" call
            // must never write back into charStyles — see syncingFromSelection
            // above.
            if (syncingFromSelection) return;

            // Live-apply this color to whatever's currently selected in the
            // lobby name editor. When "Text outline" is toggled on, the
            // picker controls the outline color (and turns the outline on)
            // instead of the fill color.
            const outlineToggle = document.getElementById('outline-toggle');
            const outlineMode = outlineToggle && outlineToggle.getAttribute('aria-pressed') === 'true';
            if (outlineMode) {
                applyStyleToSelection({ outline: true, outlineColor: hex }, commit);
            } else {
                applyStyleToSelection({ color: hex }, commit);
            }
        }

        function setFromHex(hex, commit = true){
            if (!hex) return;
            const v = hex.replace('#','');
            if (v.length !== 6) return;
            const r = parseInt(v.slice(0,2),16);
            const g = parseInt(v.slice(2,4),16);
            const b = parseInt(v.slice(4,6),16);
            const [h,s,vi] = rgbToHsv(r,g,b);
            H = h; S = s; V = vi;
            setFromHSV(commit);
        }

        // Reflects whatever's currently selected in the lobby name editor
        // back onto the picker, so opening/switching selection shows that
        // character's actual color instead of whatever was last manually
        // dragged (the same toolbar-desync bug that affected bold/italic/
        // underline/outline, applied to color). Reads outlineColor when
        // outline mode is on, fill color otherwise, matching whichever the
        // picker currently controls.
        //
        // Three cases, same tri-state idea as the style buttons:
        //  - every selected char shares the same color (explicit, or all
        //    unset) -> move the SV/hue cursor to it, normal look.
        //  - colors differ across the selection (including "has a color"
        //    vs "unset") -> leave the SV/hue cursor where it is and show
        //    the mixed indicator instead of guessing which one "wins".
        function syncColorPickerFromSelection() {
            if (selectedIndices.length === 0) {
                setMixedIndicator(false);
                return;
            }
            const outlineToggle = document.getElementById('outline-toggle');
            const outlineMode = outlineToggle && outlineToggle.getAttribute('aria-pressed') === 'true';
            const prop = outlineMode ? 'outlineColor' : 'color';

            const colors = selectedIndices.map(i => {
                const s = getStyle(i);
                return (s && s[prop]) || null; // null = "unset / default look"
            });
            const allSame = colors.every(c => c === colors[0]);

            if (!allSame) {
                setMixedIndicator(true);
                return;
            }

            setMixedIndicator(false);
            const color = colors[0];
            if (!color) return; // uniformly unset: nothing to move the cursor to

            syncingFromSelection = true;
            setFromHex(color);
            syncingFromSelection = false;
        }

        function setMixedIndicator(isMixed) {
            if (colorCircle) colorCircle.classList.toggle('is-mixed', isMixed);
        }

        onSelectionSync(syncColorPickerFromSelection);

        setFromHSV();

        let svDragging = false;
        function updateSVFromEvent(e){
            const rect = sv.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            let x = (clientX - rect.left) / rect.width;
            let y = (clientY - rect.top) / rect.height;
            x = Math.max(0, Math.min(1, x));
            y = Math.max(0, Math.min(1, y));
            S = x;
            V = 1 - y;
            setFromHSV(false);
        }
        sv.addEventListener('mousedown', (e)=>{ svDragging=true; updateSVFromEvent(e); });
        window.addEventListener('mousemove', (e)=>{ if(svDragging) updateSVFromEvent(e); });
        window.addEventListener('mouseup', ()=>{ if (svDragging) { svDragging=false; commitPendingStyleChange(); } });
        sv.addEventListener('touchstart', (e)=>{ svDragging=true; updateSVFromEvent(e); e.preventDefault(); });
        window.addEventListener('touchmove', (e)=>{ if(svDragging) updateSVFromEvent(e); });
        window.addEventListener('touchend', ()=>{ if (svDragging) { svDragging=false; commitPendingStyleChange(); } });

        let hueDragging = false;
        function updateHueFromEvent(e){
            const rect = hue.getBoundingClientRect();
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            let y = (clientY - rect.top) / rect.height;
            y = Math.max(0, Math.min(1, y));
            H = (1 - y) * 360;
            setFromHSV(false);
        }
        hue.addEventListener('mousedown', (e)=>{ hueDragging=true; updateHueFromEvent(e); });
        window.addEventListener('mousemove', (e)=>{ if(hueDragging) updateHueFromEvent(e); });
        window.addEventListener('mouseup', ()=>{ if (hueDragging) { hueDragging=false; commitPendingStyleChange(); } });
        hue.addEventListener('touchstart', (e)=>{ hueDragging=true; updateHueFromEvent(e); e.preventDefault(); });
        window.addEventListener('touchmove', (e)=>{ if(hueDragging) updateHueFromEvent(e); });
        window.addEventListener('touchend', ()=>{ if (hueDragging) { hueDragging=false; commitPendingStyleChange(); } });

        if (swatches) swatches.addEventListener('click', (e)=>{
            const btn = e.target.closest('.swatch');
            if(!btn) return;
            const c = btn.getAttribute('data-color');
            setFromHex(c); // single click = one commit, default commit=true is correct
        });


        function normalizeHex(raw) {
            let v = (raw || '').trim();
            if (v && !v.startsWith('#')) v = '#' + v;
            return v;
        }

        function isValidHex(v) {
            return /^#[0-9a-fA-F]{6}$/.test(v);
        }

        function applyHex(raw, commit = true) {
            const v = normalizeHex(raw);
            if (!isValidHex(v)) return false;
            setFromHex(v, commit);
            return true;
        }

        if (colorHexInput) {
            // Every keystroke updates the live preview (commit=false), but
            // isn't recorded as its own undo step — only the eventual
            // Enter/blur is. Otherwise typing a 6-digit hex value one
            // character at a time (which is briefly invalid mid-typing
            // anyway, per isValidHex) would need up to 6 Ctrl+Z presses to
            // undo, same underlying issue as the drag-spam case.
            colorHexInput.addEventListener('input', () => {
                applyHex(colorHexInput.value, false);
            });

            colorHexInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const v = normalizeHex(colorHexInput.value);
                    if (applyHex(v, true)) colorHexInput.value = v;
                }
            });

            colorHexInput.addEventListener('blur', () => {
                commitPendingStyleChange();
            });

            colorHexInput.addEventListener('paste', (e) => {
                const text = (e.clipboardData || window.clipboardData).getData('text');
                if (!text) return;
                e.preventDefault();
                const v = normalizeHex(text);
                colorHexInput.value = v;
                applyHex(v, true);
            });
        }

        if (colorCircle) {

            colorCircle.addEventListener('click', () => {
                if (colorHexInput) { colorHexInput.focus(); colorHexInput.select(); }
            });
        }

        // initialize from hex input value if present
        const initial = (colorHexInput && colorHexInput.value) ? colorHexInput.value.trim() : '';
        if (initial.startsWith('#')) setFromHex(initial);
    })();

    // "Text outline" checkmark next to the color picker title. Switches
    // whether the picker above controls the fill color or the outline
    // color, and toggling it directly turns the outline effect on/off for
    // whatever's currently selected in the lobby name editor.
    (function initOutlineToggle() {
        const toggle = document.getElementById('outline-toggle');
        const colorHexInput = document.getElementById('color-hex-input');
        if (!toggle) return;
        toggle.addEventListener('click', () => {
            // Read the REAL current state from the selection, not from the
            // button's own last-set attribute. A 'mixed' selection (some
            // chars outlined, some not) resolves to "turn it on for all",
            // matching the same first-click-unifies rule as bold/italic/
            // underline below.
            const currentState = selectionStyleState('outline');
            const nowOn = currentState !== 'on';

            if (nowOn) {
                // Turning outline ON must NOT clobber an outlineColor the
                // selected character(s) already had from a previous time
                // outline was used — that was the bug: this used to always
                // grab colorHexInput.value, which at the moment of the
                // click still holds the FILL color (the picker was still in
                // fill mode right up until this click switches it), so
                // enabling outline silently overwrote any real outline
                // color with whatever the fill happened to be.
                //
                // Only characters with no outlineColor yet need a starting
                // value, and for those the current fill hex is a reasonable
                // default (better than defaulting every char to black).
                // Characters that already have one keep it untouched.
                selectedIndices.forEach((i) => {
                    const style = ensureStyle(i);
                    style.outline = true;
                    if (!style.outlineColor) {
                        style.outlineColor = colorHexInput ? colorHexInput.value : '#000000';
                    }
                });
                pushHistory();
                renderHighlights();
                if (selectionLocked) { showSelectionText(); } else { showFullText(); }
            } else {
                applyStyleToSelection({ outline: false });
            }
            syncToolbarWithSelection();
        });
    })();

    // Style buttons (bold / italic / underline). Each one toggles its
    // effect live on whatever's currently selected in the lobby name
    // editor, mirrored in both the editor itself and the preview.
    (function initStyleButtons() {
        const boldBtn = document.getElementById('style-bold');
        const italicBtn = document.getElementById('style-italic');
        const underlineBtn = document.getElementById('style-underline');
        const map = [
            [boldBtn, 'bold'],
            [italicBtn, 'italic'],
            [underlineBtn, 'underline']
        ];
        map.forEach(([btn, prop]) => {
            if (!btn) return;
            btn.addEventListener('click', () => {
                // Same rule as the outline toggle: read the real state of
                // the selection, and a 'mixed' state turns everything ON
                // on first click rather than toggling off.
                const currentState = selectionStyleState(prop);
                const nowOn = currentState !== 'on';
                applyStyleToSelection({ [prop]: nowOn });
                syncToolbarWithSelection();
            });
        });
    })();
});