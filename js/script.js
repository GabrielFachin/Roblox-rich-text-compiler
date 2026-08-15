const lobbyTitle = document.getElementById("editor");
const highlightOverlay = document.getElementById("editor-highlight-overlay");
const displayName = document.getElementById("display-name");
const displayLabel = document.getElementById("display-label");
const copyButton = document.getElementById("copy-button");
const maxLength = 35;
const displayView = document.getElementById("display-view");

let selectedIndices = [];
let selectionLocked = false;
let outlineEditMode = false;
let charStyles = [];

const MAX_HISTORY = 200;
let styleHistory = [];
let historyIndex = -1;
let restoringHistory = false;

function deepCloneStyles(styles) {
    return styles.map(s => (s ? { ...s } : s));
}

function snapshotState() {
    return {
        text: lobbyTitle.value,
        charStyles: deepCloneStyles(charStyles)
    };
}

styleHistory = [snapshotState()];
historyIndex = 0;

function pushHistory() {
    if (restoringHistory) return;

    const snap = snapshotState();
    const last = styleHistory[historyIndex];

    if (
        last &&
        last.text === snap.text &&
        JSON.stringify(last.charStyles) === JSON.stringify(snap.charStyles)
    ) {
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

    selectedIndices = selectedIndices.filter(
        i => i < snap.text.length
    );

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
    applyHistorySnapshot(
        styleHistory[historyIndex]
    );
}

function redoHistory() {
    if (historyIndex >= styleHistory.length - 1) {
        return;
    }

    historyIndex++;
    applyHistorySnapshot(
        styleHistory[historyIndex]
    );
}

function getStyle(i) {
    return charStyles[i] || null;
}

function ensureStyle(i) {
    if (!charStyles[i]) {
        charStyles[i] = {};
    }

    return charStyles[i];
}

let previousValue = "";

function reconcileStylesWithEdit(newValue) {
    const oldValue = previousValue;

    if (newValue === oldValue) {
        return;
    }

    let prefix = 0;

    const maxPrefix = Math.min(
        oldValue.length,
        newValue.length
    );

    while (
        prefix < maxPrefix &&
        oldValue[prefix] === newValue[prefix]
    ) {
        prefix++;
    }

    let oldSuffix = oldValue.length;
    let newSuffix = newValue.length;

    while (
        oldSuffix > prefix &&
        newSuffix > prefix &&
        oldValue[oldSuffix - 1] ===
        newValue[newSuffix - 1]
    ) {
        oldSuffix--;
        newSuffix--;
    }

    const removedCount =
        oldSuffix - prefix;

    const insertedCount =
        newSuffix - prefix;

    const newStyles =
        charStyles.slice(0, prefix);

    for (
        let i = 0;
        i < insertedCount;
        i++
    ) {
        newStyles.push(null);
    }

    newStyles.push(
        ...charStyles.slice(oldSuffix)
    );

    charStyles = newStyles;

    void removedCount;
}

function refreshDisplayView() {
    if (lobbyTitle.value.trim() === "") {
        displayView.classList.remove(
            "visible-display-view"
        );
    } else {
        displayView.classList.add(
            "visible-display-view"
        );
    }
}

function styleClasses(style) {
    if (!style) {
        return "";
    }

    const classes = [
        "styled-char"
    ];

    if (style.outline) {
        classes.push(
            "styled-char--outline"
        );
    }

    if (style.bold) {
        classes.push(
            "styled-char--bold"
        );
    }

    if (style.italic) {
        classes.push(
            "styled-char--italic"
        );
    }

    if (style.underline) {
        classes.push(
            "styled-char--underline"
        );
    }

    return classes.join(" ");
}

function styleInlineCss(style) {
    if (!style) {
        return "";
    }

    const rules = [];

    if (style.color) {
        rules.push(
            `color:${style.color}`
        );
    }

    if (style.font) {
        rules.push(
            `font-family:${style.font.previewFamily}`
        );
    }

    if (style.outline) {
        const oc =
            style.outlineColor ||
            "#000000";

        rules.push(
            `-webkit-text-stroke-color:${oc}`,
            `text-stroke-color:${oc}`
        );
    }

    if (
        typeof style.opacity ===
        "number" &&
        style.opacity < 1
    ) {
        rules.push(
            `opacity:${style.opacity}`
        );
    }

    return rules.join(";");
}

function renderStyledHtml(
    text,
    selectedSet
) {
    let html = "";
    let i = 0;

    while (i < text.length) {
        const style = getStyle(i);

        const selected =
            selectedSet
                ? selectedSet.has(i)
                : false;

        const styleKey =
            JSON.stringify(style) +
            "|" +
            selected;

        let j = i;
        let chunk = "";

        while (j < text.length) {
            const s = getStyle(j);

            const sel =
                selectedSet
                    ? selectedSet.has(j)
                    : false;

            if (
                JSON.stringify(s) +
                "|" +
                sel !==
                styleKey
            ) {
                break;
            }

            chunk += text[j];
            j++;
        }

        const escaped =
            escapeHtml(chunk);

        const classes =
            styleClasses(style);

        const inlineCss =
            styleInlineCss(style);

        const needsSpan =
            classes || inlineCss;

        let piece = escaped;

        if (needsSpan) {
            piece =
                `<span` +
                `${classes
                    ? ` class="${classes}"`
                    : ""
                }` +
                `${inlineCss
                    ? ` style="${inlineCss}"`
                    : ""
                }>` +
                `${escaped}` +
                `</span>`;
        }

        if (selected) {
            piece =
                `<mark>${piece}</mark>`;
        }

        html += piece;
        i = j;
    }

    return html;
}

function showFullText() {
    displayLabel.textContent =
        "Will display as:";

    // For now, "Will display as" shows the plain, unstyled text -- no
    // per-character font/color/bold/italic/outline effects, just the
    // default grey preview color -- and uses the same flat (no glow)
    // look as the "Selecting:" preview below it. This is intentional:
    // there are separate plans for what this preview should show later,
    // so it's deliberately kept plain rather than mirroring the actual
    // per-character styling for now.
    displayLabel.classList.add(
        "preview-text--flat"
    );

    displayName.classList.add(
        "preview-text--flat"
    );

    displayName.textContent =
        lobbyTitle.value;
}

function showSelectionText() {
    displayLabel.textContent =
        "Selecting:";

    displayLabel.classList.add(
        "preview-text--flat"
    );

    displayName.classList.add(
        "preview-text--flat"
    );

    const text =
        selectedIndices
            .map(i => lobbyTitle.value[i])
            .join("");

    const substyles =
        selectedIndices.map(
            i => getStyle(i)
        );

    let html = "";

    for (
        let k = 0;
        k < text.length;
        k++
    ) {
        const style =
            substyles[k];

        const escaped =
            escapeHtml(text[k]);

        const classes =
            styleClasses(style);

        const inlineCss =
            styleInlineCss(style);

        html +=
            classes || inlineCss
                ? `<span` +
                `${classes
                    ? ` class="${classes}"`
                    : ""
                }` +
                `${inlineCss
                    ? ` style="${inlineCss}"`
                    : ""
                }>` +
                `${escaped}</span>`
                : escaped;
    }

    displayName.innerHTML = html;
}

function clearSelection({
    keepLock = false
} = {}) {
    selectedIndices = [];

    if (!keepLock) {
        selectionLocked = false;
    }

    renderHighlights();

    if (!selectionLocked) {
        showFullText();
    }

    syncToolbarWithSelection();
}

function addIndex(i) {
    if (
        i < 0 ||
        i >= lobbyTitle.value.length
    ) {
        return;
    }

    if (!selectedIndices.includes(i)) {
        selectedIndices.push(i);

        selectedIndices.sort(
            (a, b) => a - b
        );
    }
}

function addRange(start, end) {
    for (
        let i = start;
        i < end;
        i++
    ) {
        addIndex(i);
    }
}

function escapeHtml(str) {
    return str
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        );
}

// Renders the invisible textarea's overlay. Unlike renderStyledHtml (kept
// around for later use -- the "Will display as" preview intentionally
// shows plain text for now, see showFullText()), this wraps every
// character in its own fixed-width "cell" sized to exactly 1ch of the
// textarea's own monospace font. That guarantees the overlay's total
// rendered width always matches the real (invisible) textarea's width
// character-for-character, no matter what font/weight/style is applied
// to the glyph inside -- which is what keeps the caret, click hit-testing,
// and selection highlighting aligned with what's visually shown, and keeps
// differently-sized fonts from bleeding into neighboring characters.
function renderOverlayHtml(
    text,
    selectedSet
) {
    let html = "";

    for (
        let i = 0;
        i < text.length;
        i++
    ) {
        const ch = text[i];

        const style =
            getStyle(i);

        const selected =
            selectedSet
                ? selectedSet.has(i)
                : false;

        const escaped =
            escapeHtml(
                ch === "\n"
                    ? " "
                    : ch
            );

        const classes =
            styleClasses(style);

        const inlineCss =
            styleInlineCss(style);

        const inner =
            classes || inlineCss
                ? `<span` +
                `${classes
                    ? ` class="${classes}"`
                    : ""
                }` +
                `${inlineCss
                    ? ` style="${inlineCss}"`
                    : ""
                }>` +
                `${escaped}</span>`
                : escaped;

        const cellClasses =
            "editor-cell" +
            (
                selected
                    ? " editor-cell--selected"
                    : ""
            );

        html +=
            `<span class="${cellClasses}" data-char-index="${i}">` +
            `${inner}</span>`;
    }

    return html;
}

function renderHighlights() {
    const text =
        lobbyTitle.value;

    const selectedSet =
        new Set(selectedIndices);

    highlightOverlay.innerHTML =
        renderOverlayHtml(
            text,
            selectedSet
        );

    syncOverlayScroll();
}

function syncOverlayScroll() {
    highlightOverlay.scrollLeft =
        lobbyTitle.scrollLeft;
}

function applyStyleToSelection(
    patch,
    commit = true
) {
    if (
        selectedIndices.length === 0
    ) {
        return false;
    }

    selectedIndices.forEach(i => {
        const style =
            ensureStyle(i);

        Object.assign(
            style,
            patch
        );
    });

    if (commit) {
        pushHistory();
    }

    renderHighlights();

    if (selectionLocked) {
        showSelectionText();
    } else {
        showFullText();
    }

    return true;
}

function commitPendingStyleChange() {
    pushHistory();
}

function selectionStyleState(prop) {
    if (
        selectedIndices.length === 0
    ) {
        return "off";
    }

    let sawOn = false;
    let sawOff = false;

    for (
        const i of selectedIndices
    ) {
        const style =
            getStyle(i);

        const isOn =
            !!(
                style &&
                style[prop]
            );

        if (isOn) {
            sawOn = true;
        } else {
            sawOff = true;
        }

        if (
            sawOn &&
            sawOff
        ) {
            return "mixed";
        }
    }

    return sawOn
        ? "on"
        : "off";
}

function setButtonTriState(
    btn,
    state
) {
    if (!btn) {
        return;
    }

    btn.setAttribute(
        "aria-pressed",
        state === "on"
            ? "true"
            : state === "mixed"
                ? "mixed"
                : "false"
    );

    btn.classList.toggle(
        "is-mixed",
        state === "mixed"
    );
}

const selectionSyncCallbacks =
    [];

function onSelectionSync(fn) {
    selectionSyncCallbacks.push(
        fn
    );
}

function syncToolbarWithSelection() {
    const boldBtn =
        document.getElementById(
            "style-bold"
        );

    const italicBtn =
        document.getElementById(
            "style-italic"
        );

    const underlineBtn =
        document.getElementById(
            "style-underline"
        );

    const outlineToggle =
        document.getElementById(
            "outline-toggle"
        );

    setButtonTriState(
        boldBtn,
        selectionStyleState(
            "bold"
        )
    );

    setButtonTriState(
        italicBtn,
        selectionStyleState(
            "italic"
        )
    );

    setButtonTriState(
        underlineBtn,
        selectionStyleState(
            "underline"
        )
    );

    if (outlineToggle) {
        outlineToggle.setAttribute(
            "aria-pressed",
            outlineEditMode
                ? "true"
                : "false"
        );

        outlineToggle.classList.remove(
            "is-mixed"
        );
    }

    selectionSyncCallbacks.forEach(
        fn => fn()
    );
}

lobbyTitle.addEventListener(
    "input",
    () => {
        if (restoringHistory) {
            return;
        }

        reconcileStylesWithEdit(
            lobbyTitle.value
        );

        previousValue =
            lobbyTitle.value;

        refreshDisplayView();
        pushHistory();

        clearSelection();
    }
);

lobbyTitle.addEventListener(
    "scroll",
    syncOverlayScroll
);

lobbyTitle.addEventListener(
    "beforeinput",
    e => {
        if (
            e.inputType ===
            "historyUndo" ||
            e.inputType ===
            "historyRedo"
        ) {
            e.preventDefault();
        }
    }
);

let ctrlHeld = false;

lobbyTitle.addEventListener(
    "select",
    () => {
        if (ctrlHeld) {
            return;
        }

        const start =
            lobbyTitle.selectionStart;

        const end =
            lobbyTitle.selectionEnd;

        if (start !== end) {
            selectedIndices = [];

            addRange(
                start,
                end
            );

            selectionLocked = true;

            renderHighlights();
            showSelectionText();
            syncToolbarWithSelection();
        }
    }
);

lobbyTitle.addEventListener(
    "keyup",
    e => {
        if (
            e.key === "z" ||
            e.key === "Z" ||
            e.key === "y" ||
            e.key === "Y"
        ) {
            return;
        }

        const start =
            lobbyTitle.selectionStart;

        const end =
            lobbyTitle.selectionEnd;

        if (start !== end) {
            selectedIndices = [];

            addRange(
                start,
                end
            );

            selectionLocked = true;

            renderHighlights();
            showSelectionText();
            syncToolbarWithSelection();
        }
    }
);

document.addEventListener(
    "keydown",
    e => {
        if (
            e.key === "Control" ||
            e.key === "Meta"
        ) {
            ctrlHeld = true;
        }

        // Ctrl+Q clears the current selection. Deliberately checked via
        // e.ctrlKey (not metaKey), so on Mac this is the physical Control
        // key rather than Cmd -- Cmd+Q quits the browser there, so binding
        // to Ctrl instead avoids fighting that. It's not bound to anything
        // in Chrome/Firefox/Edge on any platform, and works no matter
        // whether the textarea is focused or not.
        if (
            e.ctrlKey &&
            (e.key === "q" ||
                e.key === "Q")
        ) {
            e.preventDefault();
            clearSelection();
        }

        const ctrlOrCmd =
            e.ctrlKey ||
            e.metaKey;

        if (
            ctrlOrCmd &&
            (
                e.key === "z" ||
                e.key === "Z"
            )
        ) {
            e.preventDefault();

            if (e.shiftKey) {
                redoHistory();
            } else {
                undoHistory();
            }
        } else if (
            ctrlOrCmd &&
            (
                e.key === "y" ||
                e.key === "Y"
            )
        ) {
            e.preventDefault();
            redoHistory();
        }
    }
);

document.addEventListener(
    "keyup",
    e => {
        if (
            e.key === "Control" ||
            e.key === "Meta"
        ) {
            ctrlHeld = false;
        }
    }
);

window.addEventListener(
    "blur",
    () => {
        ctrlHeld = false;
    }
);

function charIndexFromVisualPoint(
    clientX,
    clientY
) {
    const text =
        lobbyTitle.value;

    if (!text.length) {
        return 0;
    }

    // Each character now renders inside its own fixed-width
    // "editor-cell" (see renderOverlayHtml), so hit-testing can use
    // that cell's own box directly instead of walking text nodes --
    // this is what the click position actually lines up with visually,
    // and it doesn't get thrown off by a character's font/weight
    // rendering wider or narrower than its cell.
    const cells =
        highlightOverlay.querySelectorAll(
            "[data-char-index]"
        );

    if (!cells.length) {
        return text.length;
    }

    for (const cell of cells) {
        const rect =
            cell.getBoundingClientRect();

        if (
            clientY < rect.top ||
            clientY > rect.bottom
        ) {
            continue;
        }

        const index = Number(
            cell.getAttribute(
                "data-char-index"
            )
        );

        const midpoint =
            rect.left +
            rect.width / 2;

        if (clientX <= midpoint) {
            return index;
        }

        if (clientX <= rect.right) {
            return index + 1;
        }
    }

    const firstRect =
        cells[0].getBoundingClientRect();

    if (clientX <= firstRect.left) {
        return 0;
    }

    return text.length;
}

lobbyTitle.addEventListener(
    "mousedown",
    e => {
        if (
            !(
                e.ctrlKey ||
                e.metaKey
            )
        ) {
            return;
        }

        e.preventDefault();

        const index =
            charIndexFromVisualPoint(
                e.clientX,
                e.clientY
            );

        const clickedChar =
            lobbyTitle.value[index];

        if (
            !clickedChar ||
            clickedChar === "\n"
        ) {
            return;
        }

        lobbyTitle.focus();

        lobbyTitle.setSelectionRange(
            index,
            index
        );

        if (
            selectedIndices.includes(
                index
            )
        ) {
            selectedIndices =
                selectedIndices.filter(
                    i => i !== index
                );
        } else {
            addIndex(index);
        }

        selectionLocked =
            selectedIndices.length > 0;

        renderHighlights();

        if (selectionLocked) {
            showSelectionText();
        } else {
            showFullText();
        }

        syncToolbarWithSelection();
    }
);

lobbyTitle.addEventListener(
    "click",
    e => {
        if (
            e.ctrlKey ||
            e.metaKey
        ) {
            return;
        }

        const start =
            lobbyTitle.selectionStart;

        const end =
            lobbyTitle.selectionEnd;

        if (start !== end) {
            return;
        }

        const index =
            charIndexFromVisualPoint(
                e.clientX,
                e.clientY
            );

        const clickedChar =
            lobbyTitle.value[index];

        if (
            clickedChar &&
            clickedChar !== "\n"
        ) {
            lobbyTitle.focus();

            lobbyTitle.setSelectionRange(
                index,
                index
            );

            selectedIndices = [];

            addIndex(index);

            selectionLocked = true;

            renderHighlights();
            showSelectionText();
            syncToolbarWithSelection();
        } else {
            clearSelection();
        }
    }
);

lobbyTitle.addEventListener(
    "blur",
    () => {
        if (!selectionLocked) {
            showFullText();
        }

        if (
            lobbyTitle.value === ""
        ) {
            styleHistory = [
                snapshotState()
            ];

            historyIndex = 0;
        }
    }
);

renderHighlights();
showFullText();
syncToolbarWithSelection();

copyButton.addEventListener(
    "click",
    () => {
        const textToCopy =
            lobbyTitle.value;

        if (textToCopy) {
            navigator.clipboard
                .writeText(textToCopy)
                .then(() => {
                    alert(
                        "Copied to clipboard: " +
                        textToCopy
                    );
                })
                .catch(err => {
                    console.error(
                        "Failed to copy text: ",
                        err
                    );
                });
        } else {
            alert(
                "Nothing to copy!"
            );
        }
    }
);

const FONT_LIST = [
    {
        name: "Accanthis ADF Std",
        asset:
            "rbxasset://fonts/families/AccanthisADFStd.json",
        previewFamily:
            "'Times New Roman', Times, serif"
    },
    {
        name: "Amatic SC",
        asset:
            "rbxasset://fonts/families/AmaticSC.json",
        previewFamily:
            "'Amatic SC', cursive"
    },
    {
        name: "Arimo",
        asset:
            "rbxasset://fonts/families/Arimo.json",
        previewFamily:
            "'Arimo', sans-serif"
    },
    {
        name: "Balthazar",
        asset:
            "rbxasset://fonts/families/Balthazar.json",
        previewFamily:
            "'Balthazar', serif"
    },
    {
        name: "Bangers",
        asset:
            "rbxasset://fonts/families/Bangers.json",
        previewFamily:
            "'Bangers', cursive"
    },
    {
        name: "Builder Extended",
        asset:
            "rbxasset://fonts/families/BuilderExtended.json",
        previewFamily:
            "'Oswald', sans-serif"
    },
    {
        name: "Builder Mono",
        asset:
            "rbxasset://fonts/families/BuilderMono.json",
        previewFamily:
            "'Roboto Mono', monospace"
    },
    {
        name: "Builder Sans",
        asset:
            "rbxasset://fonts/families/BuilderSans.json",
        previewFamily:
            "'Arimo', sans-serif"
    },
    {
        name: "Comic Neue Angular",
        asset:
            "rbxasset://fonts/families/ComicNeueAngular.json",
        previewFamily:
            "'Comic Neue', cursive"
    },
    {
        name: "Creepster",
        asset:
            "rbxasset://fonts/families/Creepster.json",
        previewFamily:
            "'Creepster', cursive"
    },
    {
        name: "Denk One",
        asset:
            "rbxasset://fonts/families/DenkOne.json",
        previewFamily:
            "'Oswald', sans-serif"
    },
    {
        name: "Fondamento",
        asset:
            "rbxasset://fonts/families/Fondamento.json",
        previewFamily:
            "'Fondamento', cursive"
    },
    {
        name: "Fredoka One",
        asset:
            "rbxasset://fonts/families/FredokaOne.json",
        previewFamily:
            "'Fredoka', sans-serif"
    },
    {
        name: "Grenze Gotisch",
        asset:
            "rbxasset://fonts/families/GrenzeGotisch.json",
        previewFamily:
            "'Grenze Gotisch', serif"
    },
    {
        name: "Guru",
        asset:
            "rbxasset://fonts/families/Guru.json",
        previewFamily:
            "'Nunito', sans-serif"
    },
    {
        name: "Highway Gothic",
        asset:
            "rbxasset://fonts/families/HighwayGothic.json",
        previewFamily:
            "'Roboto Condensed', sans-serif"
    },
    {
        name: "Inconsolata",
        asset:
            "rbxasset://fonts/families/Inconsolata.json",
        previewFamily:
            "'Inconsolata', monospace"
    },
    {
        name: "Indie Flower",
        asset:
            "rbxasset://fonts/families/IndieFlower.json",
        previewFamily:
            "'Indie Flower', cursive"
    },
    {
        name: "Josefin Sans",
        asset:
            "rbxasset://fonts/families/JosefinSans.json",
        previewFamily:
            "'Josefin Sans', sans-serif"
    },
    {
        name: "Jura",
        asset:
            "rbxasset://fonts/families/Jura.json",
        previewFamily:
            "'Jura', sans-serif"
    },
    {
        name: "Kalam",
        asset:
            "rbxasset://fonts/families/Kalam.json",
        previewFamily:
            "'Kalam', cursive"
    },
    {
        name: "Luckiest Guy",
        asset:
            "rbxasset://fonts/families/LuckiestGuy.json",
        previewFamily:
            "'Luckiest Guy', cursive"
    },
    {
        name: "Merriweather",
        asset:
            "rbxasset://fonts/families/Merriweather.json",
        previewFamily:
            "'Merriweather', serif"
    },
    {
        name: "Michroma",
        asset:
            "rbxasset://fonts/families/Michroma.json",
        previewFamily:
            "'Michroma', sans-serif"
    },
    {
        name: "Montserrat",
        asset:
            "rbxasset://fonts/families/Montserrat.json",
        previewFamily:
            "'Montserrat', sans-serif"
    },
    {
        name: "Nunito",
        asset:
            "rbxasset://fonts/families/Nunito.json",
        previewFamily:
            "'Nunito', sans-serif"
    },
    {
        name: "Oswald",
        asset:
            "rbxasset://fonts/families/Oswald.json",
        previewFamily:
            "'Oswald', sans-serif"
    },
    {
        name: "Patrick Hand",
        asset:
            "rbxasset://fonts/families/PatrickHand.json",
        previewFamily:
            "'Patrick Hand', cursive"
    },
    {
        name: "Permanent Marker",
        asset:
            "rbxasset://fonts/families/PermanentMarker.json",
        previewFamily:
            "'Permanent Marker', cursive"
    },
    {
        name: "Press Start 2P",
        asset:
            "rbxasset://fonts/families/PressStart2P.json",
        previewFamily:
            "'Press Start 2P', monospace"
    },
    {
        name: "Roboto",
        asset:
            "rbxasset://fonts/families/Roboto.json",
        previewFamily:
            "'Roboto', sans-serif"
    },
    {
        name: "Roboto Condensed",
        asset:
            "rbxasset://fonts/families/RobotoCondensed.json",
        previewFamily:
            "'Roboto Condensed', sans-serif"
    },
    {
        name: "Roboto Mono",
        asset:
            "rbxasset://fonts/families/RobotoMono.json",
        previewFamily:
            "'Roboto Mono', monospace"
    },
    {
        name: "Roman Antique",
        asset:
            "rbxasset://fonts/families/RomanAntique.json",
        previewFamily:
            "'Times New Roman', Times, serif"
    },
    {
        name: "Sarpanch",
        asset:
            "rbxasset://fonts/families/Sarpanch.json",
        previewFamily:
            "'Sarpanch', sans-serif"
    },
    {
        name: "Source Sans Pro",
        asset:
            "rbxasset://fonts/families/SourceSansPro.json",
        previewFamily:
            "'Source Sans 3', sans-serif"
    },
    {
        name: "Special Elite",
        asset:
            "rbxasset://fonts/families/SpecialElite.json",
        previewFamily:
            "'Special Elite', cursive"
    },
    {
        name: "Titillium Web",
        asset:
            "rbxasset://fonts/families/TitilliumWeb.json",
        previewFamily:
            "'Titillium Web', sans-serif"
    },
    {
        name: "Ubuntu",
        asset:
            "rbxasset://fonts/families/Ubuntu.json",
        previewFamily:
            "'Ubuntu', sans-serif"
    },
    {
        name: "Zekton",
        asset:
            "rbxasset://fonts/families/Zekton.json",
        previewFamily:
            "'Michroma', sans-serif"
    }
];

(function initFontList() {
    const fontList =
        document.getElementById(
            "font-list"
        );

    if (!fontList) {
        return;
    }

    const buttonsByAsset =
        new Map();

    FONT_LIST.forEach(font => {
        const btn =
            document.createElement(
                "button"
            );

        btn.type = "button";
        btn.className =
            "font-option";

        btn.setAttribute(
            "aria-pressed",
            "false"
        );

        btn.setAttribute(
            "data-font-name",
            font.name
        );

        btn.setAttribute(
            "data-font-asset",
            font.asset
        );

        btn.title =
            font.name;

        const label =
            document.createElement(
                "span"
            );

        label.className =
            "font-option-name";

        label.textContent =
            font.name;

        const preview =
            document.createElement(
                "span"
            );

        preview.className =
            "font-option-preview";

        preview.style.fontFamily =
            font.previewFamily;

        preview.textContent =
            "AaBbCc 123";

        btn.appendChild(label);
        btn.appendChild(preview);

        btn.addEventListener(
            "click",
            () => {
                const isOn =
                    selectedIndices.length >
                    0 &&
                    selectedIndices.every(
                        i => {
                            const s =
                                getStyle(i);

                            return (
                                s &&
                                s.font &&
                                s.font.asset ===
                                font.asset
                            );
                        }
                    );

                applyStyleToSelection({
                    font: isOn
                        ? null
                        : font
                });

                syncToolbarWithSelection();
            }
        );

        buttonsByAsset.set(
            font.asset,
            btn
        );

        fontList.appendChild(btn);
    });

    function syncFontListWithSelection() {
        if (
            selectedIndices.length ===
            0
        ) {
            buttonsByAsset.forEach(
                btn =>
                    setButtonTriState(
                        btn,
                        "off"
                    )
            );

            return;
        }

        const assetsInSelection =
            new Set(
                selectedIndices.map(
                    i => {
                        const s =
                            getStyle(i);

                        return (
                            (
                                s &&
                                s.font &&
                                s.font.asset
                            ) ||
                            null
                        );
                    }
                )
            );

        if (
            assetsInSelection.size >
            1
        ) {
            buttonsByAsset.forEach(
                btn =>
                    setButtonTriState(
                        btn,
                        "mixed"
                    )
            );

            return;
        }

        const uniformAsset =
            assetsInSelection
                .values()
                .next()
                .value;

        buttonsByAsset.forEach(
            (btn, asset) => {
                setButtonTriState(
                    btn,
                    asset ===
                        uniformAsset
                        ? "on"
                        : "off"
                );
            }
        );
    }

    onSelectionSync(
        syncFontListWithSelection
    );
})();

document.addEventListener(
    "DOMContentLoaded",
    () => {
        const mapping = [
            {
                buttonId:
                    "font-button",
                panelSelector:
                    ".aside-left-full"
            },
            {
                buttonId:
                    "color-button",
                panelSelector:
                    ".color-panel-wrap"
            },
            {
                buttonId:
                    "style-button",
                panelSelector:
                    ".aside-bottom-right"
            }
        ];

        const panels =
            mapping
                .map(m =>
                    document.querySelector(
                        m.panelSelector
                    )
                )
                .filter(Boolean);

        const pendingClose =
            new WeakMap();

        function cancelPendingClose(
            panel
        ) {
            const pending =
                pendingClose.get(
                    panel
                );

            if (!pending) {
                return;
            }

            panel.removeEventListener(
                "transitionend",
                pending.onEnd
            );

            clearTimeout(
                pending.fallback
            );

            pendingClose.delete(
                panel
            );
        }

        function closePanel(
            panel
        ) {
            if (!panel) {
                return;
            }

            if (
                panel.classList.contains(
                    "menu-closed"
                ) &&
                panel.style.display ===
                "none"
            ) {
                return;
            }

            cancelPendingClose(
                panel
            );

            panel.classList.add(
                "menu-closed"
            );

            panel.setAttribute(
                "aria-hidden",
                "true"
            );

            const tidy = () => {
                if (
                    panel.classList.contains(
                        "menu-closed"
                    )
                ) {
                    if (
                        !panel.classList.contains(
                            "color-panel-wrap"
                        )
                    ) {
                        panel.style.display =
                            "none";
                    } else {
                        panel.style.display =
                            "";
                    }
                }

                pendingClose.delete(
                    panel
                );
            };

            const onEnd = e => {
                if (
                    e.target === panel &&
                    e.propertyName ===
                    "transform"
                ) {
                    tidy();
                }
            };

            const fallback =
                setTimeout(
                    tidy,
                    420
                );

            panel.addEventListener(
                "transitionend",
                onEnd
            );

            pendingClose.set(
                panel,
                {
                    onEnd,
                    fallback
                }
            );
        }

        function openPanel(
            panel
        ) {
            if (!panel) {
                return;
            }

            cancelPendingClose(
                panel
            );

            panel.style.display =
                "";

            panel.offsetHeight;

            panel.classList.remove(
                "menu-closed"
            );

            panel.setAttribute(
                "aria-hidden",
                "false"
            );
        }

        panels.forEach(panel => {
            panel.classList.add(
                "menu-closed"
            );

            panel.setAttribute(
                "aria-hidden",
                "true"
            );

            if (
                panel.classList &&
                panel.classList.contains(
                    "color-panel-wrap"
                )
            ) {
                panel.style.display =
                    "";
            } else {
                panel.style.display =
                    "none";
            }
        });

        mapping.forEach(
            mappingItem => {
                const btn =
                    document.getElementById(
                        mappingItem.buttonId
                    );

                const panel =
                    document.querySelector(
                        mappingItem.panelSelector
                    );

                if (!btn || !panel) {
                    return;
                }

                btn.addEventListener(
                    "click",
                    () => {
                        const isClosed =
                            panel.classList.contains(
                                "menu-closed"
                            );

                        if (isClosed) {
                            openPanel(
                                panel
                            );
                        } else {
                            closePanel(
                                panel
                            );
                        }
                    }
                );
            }
        );

        (function initPicker() {
            const sv =
                document.getElementById(
                    "sv"
                );

            const svCursor =
                document.getElementById(
                    "sv-cursor"
                );

            const hue =
                document.getElementById(
                    "hue"
                );

            const hueCursor =
                document.getElementById(
                    "hue-cursor"
                );

            const swatches =
                document.getElementById(
                    "swatches"
                );

            const colorHexInput =
                document.getElementById(
                    "color-hex-input"
                );

            const colorCircle =
                document.getElementById(
                    "color-circle"
                );

            const colorOpacityInput =
                document.getElementById(
                    "color-opacity-input"
                );

            const colorOpacityValue =
                document.getElementById(
                    "color-opacity-value"
                );

            const topBox =
                document.querySelector(
                    ".aside-top-right"
                );

            if (
                !sv ||
                !hue ||
                !svCursor ||
                !hueCursor ||
                !colorHexInput
            ) {
                return;
            }

            let H = 320;
            let S = 0.6;
            let V = 1;

            let syncingFromSelection =
                false;

            function hsvToRgb(
                h,
                s,
                v
            ) {
                let c =
                    v * s;

                let x =
                    c *
                    (
                        1 -
                        Math.abs(
                            (h / 60) %
                            2 -
                            1
                        )
                    );

                let m =
                    v - c;

                let r = 0;
                let g = 0;
                let b = 0;

                if (
                    h >= 0 &&
                    h < 60
                ) {
                    r = c;
                    g = x;
                    b = 0;
                } else if (
                    h < 120
                ) {
                    r = x;
                    g = c;
                    b = 0;
                } else if (
                    h < 180
                ) {
                    r = 0;
                    g = c;
                    b = x;
                } else if (
                    h < 240
                ) {
                    r = 0;
                    g = x;
                    b = c;
                } else if (
                    h < 300
                ) {
                    r = x;
                    g = 0;
                    b = c;
                } else {
                    r = c;
                    g = 0;
                    b = x;
                }

                return [
                    Math.round(
                        (r + m) *
                        255
                    ),
                    Math.round(
                        (g + m) *
                        255
                    ),
                    Math.round(
                        (b + m) *
                        255
                    )
                ];
            }

            function rgbToHex(
                r,
                g,
                b
            ) {
                return (
                    "#" +
                    [r, g, b]
                        .map(
                            x =>
                                x
                                    .toString(
                                        16
                                    )
                                    .padStart(
                                        2,
                                        "0"
                                    )
                        )
                        .join("")
                );
            }

            function rgbToHsv(
                r,
                g,
                b
            ) {
                r /= 255;
                g /= 255;
                b /= 255;

                const max =
                    Math.max(
                        r,
                        g,
                        b
                    );

                const min =
                    Math.min(
                        r,
                        g,
                        b
                    );

                const d =
                    max - min;

                let h = 0;

                if (d === 0) {
                    h = 0;
                } else if (
                    max === r
                ) {
                    h =
                        (
                            60 *
                            (
                                (g - b) /
                                d
                            ) +
                            360
                        ) % 360;
                } else if (
                    max === g
                ) {
                    h =
                        60 *
                        (
                            (b - r) /
                            d
                        ) +
                        120;
                } else {
                    h =
                        60 *
                        (
                            (r - g) /
                            d
                        ) +
                        240;
                }

                const s =
                    max === 0
                        ? 0
                        : d / max;

                const v = max;

                return [
                    h,
                    s,
                    v
                ];
            }

            function setFromHSV(
                commit = true
            ) {
                const [
                    r,
                    g,
                    b
                ] = hsvToRgb(
                    H,
                    S,
                    V
                );

                const hex =
                    rgbToHex(
                        r,
                        g,
                        b
                    );

                if (
                    colorHexInput
                ) {
                    colorHexInput.value =
                        hex;
                }

                if (
                    colorCircle
                ) {
                    colorCircle.style.backgroundColor =
                        hex;
                }

                if (topBox) {
                    topBox.style.setProperty(
                        "--picked-color",
                        hex
                    );
                }

                if (
                    !syncingFromSelection &&
                    colorCircle
                ) {
                    colorCircle.classList.remove(
                        "is-mixed"
                    );
                }

                sv.style.setProperty(
                    "--h",
                    H
                );

                svCursor.style.left =
                    S * 100 +
                    "%";

                svCursor.style.top =
                    (1 - V) *
                    100 +
                    "%";

                hueCursor.style.top =
                    (
                        1 -
                        H / 360
                    ) *
                    100 +
                    "%";

                if (
                    syncingFromSelection
                ) {
                    return;
                }

                const outlineMode =
                    outlineEditMode;

                if (outlineMode) {
                    applyStyleToSelection(
                        {
                            outline: true,
                            outlineColor:
                                hex
                        },
                        commit
                    );
                } else {
                    applyStyleToSelection(
                        {
                            color: hex
                        },
                        commit
                    );
                }
            }

            function setFromHex(
                hex,
                commit = true
            ) {
                if (!hex) {
                    return;
                }

                const v =
                    hex.replace(
                        "#",
                        ""
                    );

                if (
                    v.length !== 6
                ) {
                    return;
                }

                const r =
                    parseInt(
                        v.slice(
                            0,
                            2
                        ),
                        16
                    );

                const g =
                    parseInt(
                        v.slice(
                            2,
                            4
                        ),
                        16
                    );

                const b =
                    parseInt(
                        v.slice(
                            4,
                            6
                        ),
                        16
                    );

                const [
                    h,
                    s,
                    vi
                ] = rgbToHsv(
                    r,
                    g,
                    b
                );

                H = h;
                S = s;
                V = vi;

                setFromHSV(
                    commit
                );
            }

            function syncColorPickerFromSelection() {
                if (
                    selectedIndices.length ===
                    0
                ) {
                    setMixedIndicator(
                        false
                    );

                    setOpacityUI(1);

                    return;
                }

                // Opacity is synced independently of color/outline mode
                // and doesn't share the "mixed" early-return below, so a
                // selection with mixed colors still shows an accurate
                // opacity reading (falling back to 100% when the
                // selection itself has mixed opacity values).
                const opacities =
                    selectedIndices.map(
                        i => {
                            const s =
                                getStyle(
                                    i
                                );

                            return (
                                s &&
                                    typeof s.opacity ===
                                    "number"
                                    ? s.opacity
                                    : 1
                            );
                        }
                    );

                const opacityAllSame =
                    opacities.every(
                        o =>
                            o ===
                            opacities[0]
                    );

                setOpacityUI(
                    opacityAllSame
                        ? opacities[0]
                        : 1
                );

                const outlineMode =
                    outlineEditMode;

                const prop =
                    outlineMode
                        ? "outlineColor"
                        : "color";

                const colors =
                    selectedIndices.map(
                        i => {
                            const s =
                                getStyle(
                                    i
                                );

                            return (
                                (
                                    s &&
                                    s[prop]
                                ) ||
                                null
                            );
                        }
                    );

                const allSame =
                    colors.every(
                        c =>
                            c ===
                            colors[0]
                    );

                if (!allSame) {
                    setMixedIndicator(
                        true
                    );

                    return;
                }

                setMixedIndicator(
                    false
                );

                const color =
                    colors[0];

                if (!color) {
                    return;
                }

                syncingFromSelection =
                    true;

                setFromHex(
                    color
                );

                syncingFromSelection =
                    false;
            }

            function setMixedIndicator(
                isMixed
            ) {
                if (
                    colorCircle
                ) {
                    colorCircle.classList.toggle(
                        "is-mixed",
                        isMixed
                    );
                }
            }

            onSelectionSync(
                syncColorPickerFromSelection
            );

            setFromHSV();

            let svDragging =
                false;

            function updateSVFromEvent(
                e
            ) {
                const rect =
                    sv.getBoundingClientRect();

                const clientX =
                    e.touches
                        ? e.touches[0]
                            .clientX
                        : e.clientX;

                const clientY =
                    e.touches
                        ? e.touches[0]
                            .clientY
                        : e.clientY;

                let x =
                    (
                        clientX -
                        rect.left
                    ) /
                    rect.width;

                let y =
                    (
                        clientY -
                        rect.top
                    ) /
                    rect.height;

                x = Math.max(
                    0,
                    Math.min(
                        1,
                        x
                    )
                );

                y = Math.max(
                    0,
                    Math.min(
                        1,
                        y
                    )
                );

                S = x;
                V = 1 - y;

                setFromHSV(
                    false
                );
            }

            sv.addEventListener(
                "mousedown",
                e => {
                    svDragging =
                        true;

                    updateSVFromEvent(
                        e
                    );
                }
            );

            window.addEventListener(
                "mousemove",
                e => {
                    if (
                        svDragging
                    ) {
                        updateSVFromEvent(
                            e
                        );
                    }
                }
            );

            window.addEventListener(
                "mouseup",
                () => {
                    if (
                        svDragging
                    ) {
                        svDragging =
                            false;

                        commitPendingStyleChange();
                    }
                }
            );

            sv.addEventListener(
                "touchstart",
                e => {
                    svDragging =
                        true;

                    updateSVFromEvent(
                        e
                    );

                    e.preventDefault();
                }
            );

            window.addEventListener(
                "touchmove",
                e => {
                    if (
                        svDragging
                    ) {
                        updateSVFromEvent(
                            e
                        );
                    }
                }
            );

            window.addEventListener(
                "touchend",
                () => {
                    if (
                        svDragging
                    ) {
                        svDragging =
                            false;

                        commitPendingStyleChange();
                    }
                }
            );

            let hueDragging =
                false;

            function updateHueFromEvent(
                e
            ) {
                const rect =
                    hue.getBoundingClientRect();

                const clientY =
                    e.touches
                        ? e.touches[0]
                            .clientY
                        : e.clientY;

                let y =
                    (
                        clientY -
                        rect.top
                    ) /
                    rect.height;

                y = Math.max(
                    0,
                    Math.min(
                        1,
                        y
                    )
                );

                H =
                    (1 - y) *
                    360;

                setFromHSV(
                    false
                );
            }

            hue.addEventListener(
                "mousedown",
                e => {
                    hueDragging =
                        true;

                    updateHueFromEvent(
                        e
                    );
                }
            );

            window.addEventListener(
                "mousemove",
                e => {
                    if (
                        hueDragging
                    ) {
                        updateHueFromEvent(
                            e
                        );
                    }
                }
            );

            window.addEventListener(
                "mouseup",
                () => {
                    if (
                        hueDragging
                    ) {
                        hueDragging =
                            false;

                        commitPendingStyleChange();
                    }
                }
            );

            hue.addEventListener(
                "touchstart",
                e => {
                    hueDragging =
                        true;

                    updateHueFromEvent(
                        e
                    );

                    e.preventDefault();
                }
            );

            window.addEventListener(
                "touchmove",
                e => {
                    if (
                        hueDragging
                    ) {
                        updateHueFromEvent(
                            e
                        );
                    }
                }
            );

            window.addEventListener(
                "touchend",
                () => {
                    if (
                        hueDragging
                    ) {
                        hueDragging =
                            false;

                        commitPendingStyleChange();
                    }
                }
            );

            if (swatches) {
                swatches.addEventListener(
                    "click",
                    e => {
                        const btn =
                            e.target.closest(
                                ".swatch"
                            );

                        if (!btn) {
                            return;
                        }

                        const c =
                            btn.getAttribute(
                                "data-color"
                            );

                        setFromHex(c);
                    }
                );
            }

            function normalizeHex(
                raw
            ) {
                let v =
                    (
                        raw ||
                        ""
                    ).trim();

                if (
                    v &&
                    !v.startsWith(
                        "#"
                    )
                ) {
                    v =
                        "#" +
                        v;
                }

                return v;
            }

            function isValidHex(
                v
            ) {
                return /^#[0-9a-fA-F]{6}$/.test(
                    v
                );
            }

            function applyHex(
                raw,
                commit = true
            ) {
                const v =
                    normalizeHex(
                        raw
                    );

                if (
                    !isValidHex(v)
                ) {
                    return false;
                }

                setFromHex(
                    v,
                    commit
                );

                return true;
            }

            function setOpacityUI(
                o
            ) {
                const pct =
                    Math.round(
                        o * 100
                    );

                if (
                    colorOpacityInput
                ) {
                    colorOpacityInput.value =
                        pct;
                }

                if (
                    colorOpacityValue
                ) {
                    colorOpacityValue.textContent =
                        pct + "%";
                }
            }

            function applyOpacity(
                o,
                commit = true
            ) {
                const clamped =
                    Math.max(
                        0,
                        Math.min(
                            1,
                            o
                        )
                    );

                setOpacityUI(
                    clamped
                );

                applyStyleToSelection(
                    {
                        opacity:
                            clamped
                    },
                    commit
                );
            }

            if (colorOpacityInput) {
                colorOpacityInput.addEventListener(
                    "input",
                    () => {
                        applyOpacity(
                            Number(
                                colorOpacityInput.value
                            ) / 100,
                            false
                        );
                    }
                );

                colorOpacityInput.addEventListener(
                    "change",
                    () => {
                        applyOpacity(
                            Number(
                                colorOpacityInput.value
                            ) / 100,
                            true
                        );
                    }
                );
            }

            if (colorHexInput) {
                colorHexInput.addEventListener(
                    "input",
                    () => {
                        applyHex(
                            colorHexInput.value,
                            false
                        );
                    }
                );

                colorHexInput.addEventListener(
                    "keydown",
                    e => {
                        if (
                            e.key ===
                            "Enter"
                        ) {
                            const v =
                                normalizeHex(
                                    colorHexInput.value
                                );

                            if (
                                applyHex(
                                    v,
                                    true
                                )
                            ) {
                                colorHexInput.value =
                                    v;
                            }
                        }
                    }
                );

                colorHexInput.addEventListener(
                    "blur",
                    () => {
                        commitPendingStyleChange();
                    }
                );

                colorHexInput.addEventListener(
                    "paste",
                    e => {
                        const text =
                            (
                                e.clipboardData ||
                                window.clipboardData
                            ).getData(
                                "text"
                            );

                        if (!text) {
                            return;
                        }

                        e.preventDefault();

                        const v =
                            normalizeHex(
                                text
                            );

                        colorHexInput.value =
                            v;

                        applyHex(
                            v,
                            true
                        );
                    }
                );
            }

            if (colorCircle) {
                colorCircle.addEventListener(
                    "click",
                    () => {
                        if (
                            colorHexInput
                        ) {
                            colorHexInput.focus();
                            colorHexInput.select();
                        }
                    }
                );
            }

            const initial =
                colorHexInput &&
                    colorHexInput.value
                    ? colorHexInput.value.trim()
                    : "";

            if (
                initial.startsWith(
                    "#"
                )
            ) {
                setFromHex(
                    initial
                );
            }
        })();

        (function initOutlineToggle() {
            const toggle =
                document.getElementById(
                    "outline-toggle"
                );

            if (!toggle) {
                return;
            }

            toggle.setAttribute(
                "aria-pressed",
                outlineEditMode
                    ? "true"
                    : "false"
            );

            toggle.addEventListener(
                "click",
                () => {
                    outlineEditMode =
                        !outlineEditMode;

                    toggle.setAttribute(
                        "aria-pressed",
                        outlineEditMode
                            ? "true"
                            : "false"
                    );

                    toggle.classList.remove(
                        "is-mixed"
                    );

                    syncToolbarWithSelection();
                }
            );
        })();

        (function initStyleButtons() {
            const boldBtn =
                document.getElementById(
                    "style-bold"
                );

            const italicBtn =
                document.getElementById(
                    "style-italic"
                );

            const underlineBtn =
                document.getElementById(
                    "style-underline"
                );

            const map = [
                [
                    boldBtn,
                    "bold"
                ],
                [
                    italicBtn,
                    "italic"
                ],
                [
                    underlineBtn,
                    "underline"
                ]
            ];

            map.forEach(
                ([btn, prop]) => {
                    if (!btn) {
                        return;
                    }

                    btn.addEventListener(
                        "click",
                        () => {
                            const currentState =
                                selectionStyleState(
                                    prop
                                );

                            const nowOn =
                                currentState !==
                                "on";

                            applyStyleToSelection(
                                {
                                    [prop]:
                                        nowOn
                                }
                            );

                            syncToolbarWithSelection();
                        }
                    );
                }
            );
        })();
    }
);