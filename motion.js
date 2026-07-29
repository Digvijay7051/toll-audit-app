/* ==========================================================
   motion.js — Premium Motion Engine
   Framer-Motion-quality animations for vanilla JS.

   Runs after DOMContentLoaded. Safe to load last.
   All effects respect prefers-reduced-motion.
========================================================== */

(function () {

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ── 1. STAGGER ENTRANCE — IntersectionObserver whileInView ──
       Adds class "in-view" to any .motion-item / .motion-item-left /
       .motion-item-right when the element enters the viewport.
       --i CSS var is set per-child to create the cascade delay.     */
    function initStaggerObserver() {

        const SELECTORS = ".motion-item, .motion-item-left, .motion-item-right";

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("in-view");
                    observer.unobserve(entry.target); /* fire once */
                }
            });
        }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

        /* Assign stagger index per sibling group */
        document.querySelectorAll(SELECTORS).forEach(el => {
            const siblings = Array.from(
                el.parentElement.querySelectorAll(SELECTORS)
            );
            const idx = siblings.indexOf(el);
            el.style.setProperty("--i", idx);
            observer.observe(el);
        });

    }

    /* ── 2. AUTO-TAG key UI groups with motion classes ──
       Avoids touching every HTML element manually.            */
    function tagMotionElements() {

        /* Stat cards — stagger entrance + lift */
        document.querySelectorAll(".stat-card").forEach((el, i) => {
            el.classList.add("motion-item", "motion-lift");
            el.style.setProperty("--i", i);
        });

        /* Hero stat tiles */
        document.querySelectorAll(".hero-stat").forEach((el, i) => {
            el.classList.add("motion-item");
            el.style.setProperty("--i", i);
        });

        /* Dashboard cards */
        document.querySelectorAll(".dashboard-card").forEach((el, i) => {
            el.classList.add("motion-item");
            el.style.setProperty("--i", i);
        });

        /* Sidebar nav buttons */
        document.querySelectorAll(".sb-btn").forEach((el, i) => {
            el.classList.add("motion-press");
            el.style.setProperty("--i", i);
        });

        /* Category list items */
        document.querySelectorAll(".category-item").forEach((el, i) => {
            el.classList.add("motion-item-left");
            el.style.setProperty("--i", i);
        });

        /* Vehicle buttons — press feedback */
        document.querySelectorAll(".vehicle-btn").forEach(el => {
            el.classList.add("motion-press");
        });

        /* Auth card — entrance */
        document.querySelectorAll(".auth-card, .welcome-card").forEach(el => {
            el.classList.add("motion-item");
            el.style.setProperty("--i", 0);
        });

        /* Verify pass card + transaction history card */
        document.querySelectorAll(
            ".verify-pass-card, .counts-history-grid > *, .card.shadow-sm"
        ).forEach((el, i) => {
            if (!el.classList.contains("motion-item")) {
                el.classList.add("motion-item");
                el.style.setProperty("--i", Math.min(i, 6));
            }
        });

    }

    /* ── 3. MAGNETIC EFFECT ──
       Elements with class "magnetic" follow the cursor slightly.
       Auth primary button + Google button get this.              */
    function initMagnetic() {

        const MAG_STRENGTH = 0.28; /* 0 = no movement, 1 = full follow */

        document.querySelectorAll(".btn-auth-primary, .btn-google-signin, .magnetic")
            .forEach(el => {

                el.classList.add("magnetic");

                el.addEventListener("mousemove", e => {
                    if (reducedMotion) return;
                    const rect = el.getBoundingClientRect();
                    const cx = rect.left + rect.width  / 2;
                    const cy = rect.top  + rect.height / 2;
                    const dx = (e.clientX - cx) * MAG_STRENGTH;
                    const dy = (e.clientY - cy) * MAG_STRENGTH;
                    el.style.transform = `translate(${dx}px, ${dy}px)`;
                });

                el.addEventListener("mouseleave", () => {
                    el.style.transform = "";
                });

            });

    }

    /* ── 4. PANEL TRANSITION ──
       Called by refreshUI / category/mode switches.
       Wraps the main content area in an enter animation.         */
    window.motionPanelEnter = function (el) {
        if (reducedMotion || !el) return;
        el.classList.remove("panel-enter", "panel-exit");
        void el.offsetWidth; /* reflow */
        el.classList.add("panel-enter");
        el.addEventListener("animationend", () => {
            el.classList.remove("panel-enter");
        }, { once: true });
    };

    window.motionPanelExit = function (el, cb) {
        if (reducedMotion || !el) { if (cb) cb(); return; }
        el.classList.remove("panel-enter", "panel-exit");
        void el.offsetWidth;
        el.classList.add("panel-exit");
        el.addEventListener("animationend", () => {
            el.classList.remove("panel-exit");
            if (cb) cb();
        }, { once: true });
    };

    /* ── 5. FLOATING LABEL INPUTS ──
       Wraps auth form inputs with float-label structure.         */
    function initFloatingLabels() {

        const pairs = [
            { inputId: "loginUsername",       labelText: "Email address"    },
            { inputId: "loginPassword",       labelText: "Password"         },
            { inputId: "signupEmail",         labelText: "Email address"    },
            { inputId: "signupUsername",      labelText: "Username"         },
            { inputId: "signupPassword",      labelText: "Password"         },
            { inputId: "signupConfirmPassword", labelText: "Confirm password" },
        ];

        pairs.forEach(({ inputId, labelText }) => {

            const input = document.getElementById(inputId);
            if (!input) return;

            /* Remove existing Bootstrap label sibling */
            const existingLabel = input.closest(".mb-3, .mb-2")
                ?.querySelector("label.form-label");
            if (existingLabel) existingLabel.remove();

            /* Wrap in float-label-wrap if not already done */
            if (input.closest(".float-label-wrap")) return;

            const wrap = document.createElement("div");
            wrap.className = "float-label-wrap";
            input.parentNode.insertBefore(wrap, input);
            wrap.appendChild(input);

            /* Add placeholder (invisible — needed for :not(:placeholder-shown)) */
            if (!input.placeholder) input.placeholder = " ";

            const label = document.createElement("span");
            label.className = "float-label";
            label.textContent = labelText;
            wrap.appendChild(label);

        });

    }

    /* ── 6. RIPPLE ON CLICK ──
       Adds a water-ripple emanating from the exact click point
       on any .motion-press element.                             */
    function initClickRipple() {

        document.addEventListener("pointerdown", e => {
            if (reducedMotion) return;
            const btn = e.target.closest(".motion-press, .vehicle-btn, .btn-auth-primary");
            if (!btn) return;

            const rect = btn.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height) * 1.6;
            const x    = e.clientX - rect.left - size / 2;
            const y    = e.clientY - rect.top  - size / 2;

            const ripple = document.createElement("span");
            ripple.style.cssText = `
                position:absolute; border-radius:50%; pointer-events:none;
                width:${size}px; height:${size}px;
                left:${x}px; top:${y}px;
                background: rgba(255,255,255,.22);
                transform: scale(0); opacity: 1;
                animation: rippleExpand .55s cubic-bezier(.22,1,.36,1) forwards;
                z-index: 9;
            `;

            /* Inject keyframe once */
            if (!document.getElementById("rippleKF")) {
                const s = document.createElement("style");
                s.id = "rippleKF";
                s.textContent = `@keyframes rippleExpand {
                    to { transform: scale(1); opacity: 0; }
                }`;
                document.head.appendChild(s);
            }

            /* btn needs position:relative — ensure it */
            const pos = getComputedStyle(btn).position;
            if (pos === "static") btn.style.position = "relative";
            btn.style.overflow = "hidden";

            btn.appendChild(ripple);
            ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
        });

    }

    /* ── INIT ── */
    function init() {
        tagMotionElements();
        initStaggerObserver();
        initMagnetic();
        /* initFloatingLabels — disabled, using visible labels instead */
        initClickRipple();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        /* Already loaded (script at bottom of body) */
        init();
    }

    /* Re-run stagger on dynamic content changes (e.g. category switch) */
    window.motionRefresh = function () {
        tagMotionElements();
        initStaggerObserver();
    };

})();
