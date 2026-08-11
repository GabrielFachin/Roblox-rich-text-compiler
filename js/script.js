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

    // === Custom color picker logic ===
    (function initPicker(){
        const sv = document.getElementById('sv');
        const svCursor = document.getElementById('sv-cursor');
        const hue = document.getElementById('hue');
        const hueCursor = document.getElementById('hue-cursor');
        const swatches = document.getElementById('swatches');
        const colorHexInput = document.getElementById('color-hex-input');
        const colorCircle = document.getElementById('color-circle');
        const colorCopyBtn = document.getElementById('color-copy-btn');
        const topBox = document.querySelector('.aside-top-right');

        if (!sv || !hue || !svCursor || !hueCursor || !hexDisplay) return;

        // color state (h in [0,360), s,v in [0,1])
        let H = 320, S = 0.6, V = 1;

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

        function setFromHSV(){
            const [r,g,b] = hsvToRgb(H,S,V);
            const hex = rgbToHex(r,g,b);
            if (colorHexInput) colorHexInput.value = hex;
            if (colorCircle) colorCircle.style.background = hex;
            if (topBox) topBox.style.setProperty('--picked-color', hex);
            // update sv background to current hue via CSS variable
            sv.style.setProperty('--h', H);
            // update cursors
            svCursor.style.left = (S*100)+'%';
            svCursor.style.top = ((1-V)*100)+'%';
            hueCursor.style.top = ((1 - (H/360))*100)+'%';
            // update footer controls
        }

        function setFromHex(hex){
            if (!hex) return;
            const v = hex.replace('#','');
            if (v.length !== 6) return;
            const r = parseInt(v.slice(0,2),16);
            const g = parseInt(v.slice(2,4),16);
            const b = parseInt(v.slice(4,6),16);
            const [h,s,vi] = rgbToHsv(r,g,b);
            H = h; S = s; V = vi;
            setFromHSV();
        }

        setFromHSV();

        // SV interaction
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
            setFromHSV();
        }
        sv.addEventListener('mousedown', (e)=>{ svDragging=true; updateSVFromEvent(e); });
        window.addEventListener('mousemove', (e)=>{ if(svDragging) updateSVFromEvent(e); });
        window.addEventListener('mouseup', ()=>{ svDragging=false; });
        // touch
        sv.addEventListener('touchstart', (e)=>{ svDragging=true; updateSVFromEvent(e); e.preventDefault(); });
        window.addEventListener('touchmove', (e)=>{ if(svDragging) updateSVFromEvent(e); });
        window.addEventListener('touchend', ()=>{ svDragging=false; });

        // Hue interaction
        let hueDragging = false;
        function updateHueFromEvent(e){
            const rect = hue.getBoundingClientRect();
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            let y = (clientY - rect.top) / rect.height;
            y = Math.max(0, Math.min(1, y));
            H = (1 - y) * 360;
            setFromHSV();
        }
        hue.addEventListener('mousedown', (e)=>{ hueDragging=true; updateHueFromEvent(e); });
        window.addEventListener('mousemove', (e)=>{ if(hueDragging) updateHueFromEvent(e); });
        window.addEventListener('mouseup', ()=>{ hueDragging=false; });
        // touch
        hue.addEventListener('touchstart', (e)=>{ hueDragging=true; updateHueFromEvent(e); e.preventDefault(); });
        window.addEventListener('touchmove', (e)=>{ if(hueDragging) updateHueFromEvent(e); });
        window.addEventListener('touchend', ()=>{ hueDragging=false; });

        // swatches (removed in markup) - keep handler safe if present
        if (swatches) swatches.addEventListener('click', (e)=>{
            const btn = e.target.closest('.swatch');
            if(!btn) return;
            const c = btn.getAttribute('data-color');
            setFromHex(c);
        });

        // wire footer controls
        // wire footer controls (hex input, paste, copy, circle)
        if (colorHexInput) {
            colorHexInput.addEventListener('keydown', (e)=>{
                if (e.key === 'Enter') {
                    let v = colorHexInput.value.trim();
                    if (!v.startsWith('#')) v = '#'+v;
                    setFromHex(v);
                }
            });
            colorHexInput.addEventListener('paste', (e)=>{
                const text = (e.clipboardData || window.clipboardData).getData('text');
                if (text) {
                    let v = text.trim(); if (!v.startsWith('#')) v = '#'+v;
                    setFromHex(v);
                    e.preventDefault();
                    colorHexInput.value = v;
                }
            });
        }

        if (colorCopyBtn) {
            colorCopyBtn.addEventListener('click', ()=>{
                const v = (colorHexInput && colorHexInput.value) ? colorHexInput.value.trim() : '';
                if (navigator.clipboard && v) navigator.clipboard.writeText(v).catch(()=>{});
            });
        }

        if (colorCircle) {
            colorCircle.addEventListener('click', ()=>{
                if (colorHexInput) { colorHexInput.focus(); colorHexInput.select(); }
                colorCircle.classList.toggle('color-circle-active');
            });
        }

        // initialize from hex input value if present
        const initial = (colorHexInput && colorHexInput.value) ? colorHexInput.value.trim() : '';
        if (initial.startsWith('#')) setFromHex(initial);
    })();
});


