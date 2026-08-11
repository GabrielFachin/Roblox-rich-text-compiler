const lobbyTitle = document.getElementById("editor");
const displayName = document.getElementById("display-name");
const copyButton = document.getElementById("copy-button");
const maxLength = 35;
const displayView = document.getElementById("display-view");

lobbyTitle.addEventListener("input", () => {
    if (lobbyTitle.value.trim() === "") {
        displayView.classList.remove("visible-display-view");
    } else {
        displayView.classList.add("visible-display-view");
    }
    const inputText = lobbyTitle.value;
    displayName.textContent = inputText;
});



copyButton.addEventListener("click", () => {
    const textToCopy = displayName.textContent;
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

// ===== Panel toggle behavior with animations =====
document.addEventListener('DOMContentLoaded', () => {
    const mapping = [
        { buttonId: 'font-button', panelSelector: '.aside-left-full' },
        { buttonId: 'color-button', panelSelector: '.aside-top-right' },
        { buttonId: 'style-button', panelSelector: '.aside-bottom-right' }
    ];

    const panels = mapping.map(m => document.querySelector(m.panelSelector)).filter(Boolean);

    // Helper to close a panel (adds closed class, then hides after transition)
    function closePanel(panel) {
        if (!panel) return;
        // if already hidden, ensure display none
        if (panel.classList.contains('menu-closed') && panel.style.display === 'none') return;

        panel.classList.add('menu-closed');
        panel.setAttribute('aria-hidden', 'true');

        const tidy = () => {
                // For the top-right panel we keep it in the layout (collapse to ~1px via CSS)
                if (panel.classList.contains('menu-closed')) {
                    if (!panel.classList.contains('aside-top-right')) {
                        panel.style.display = 'none';
                    } else {
                        // keep displayed so flex layout preserves bottom anchoring
                        panel.style.display = '';
                    }
                }
            panel.removeEventListener('transitionend', onEnd);
        };

        const onEnd = (e) => {
            // only act when opacity or transform finished
            if (e.propertyName === 'opacity' || e.propertyName === 'transform') tidy();
        };

        // Fallback timeout in case transitionend doesn't fire
        const fallback = setTimeout(() => {
            tidy();
            clearTimeout(fallback);
        }, 420);

        panel.addEventListener('transitionend', onEnd);
    }

    function openPanel(panel) {
        if (!panel) return;
        // make visible first so transitions run
        panel.style.display = '';
        // force a reflow so the browser applies display before removing class
        // eslint-disable-next-line no-unused-expressions
        panel.offsetHeight;
        panel.classList.remove('menu-closed');
        panel.setAttribute('aria-hidden', 'false');
    }

    // Initialize: collapse all panels; keep the top-right present in layout
    panels.forEach(p => {
        p.classList.add('menu-closed');
        p.setAttribute('aria-hidden', 'true');
        // keep the top-right collapsed but present so the bottom panel remains anchored
        if (p.classList && p.classList.contains('aside-top-right')) {
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

            // Independent toggle: do not auto-close other panels
            if (isClosed) {
                openPanel(panel);
            } else {
                closePanel(panel);
            }
        });
    });
});


