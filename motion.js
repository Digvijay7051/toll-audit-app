/* ==========================================================
   motion.js  —  EXTREME PREMIUM MOTION ENGINE  v2
   Every button, card, tile, sidebar item, topbar, hero,
   stat tile, vehicle button, input gets treated.

   Philosophy:
   • Spring physics via cubic-bezier overshoot (mimics Framer)
   • GPU-only properties: transform + opacity (no layout thrash)
   • IntersectionObserver stagger  =  whileInView
   • Pointer-origin ripple          =  whileTap
   • Magnetic cursor tracking       =  drag-constrained
   • Shimmer on hover               =  layoutId shared element
   • Reduced-motion: all disabled
========================================================== */

(function () {

    'use strict';

    const NO_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ── Inject all required keyframes once ── */
    if (!document.getElementById('pmKF')) {
        const s = document.createElement('style');
        s.id = 'pmKF';
        s.textContent = `
        /* Ripple expand */
        @keyframes pmRipple {
            0%   { transform: scale(0);  opacity: .55; }
            100% { transform: scale(1);  opacity: 0;   }
        }
        /* Stagger entrance */
        @keyframes pmFadeUp {
            from { opacity: 0; transform: translateY(20px) scale(.97); }
            to   { opacity: 1; transform: translateY(0)    scale(1);   }
        }
        @keyframes pmFadeLeft {
            from { opacity: 0; transform: translateX(-20px); }
            to   { opacity: 1; transform: translateX(0);     }
        }
        @keyframes pmFadeRight {
            from { opacity: 0; transform: translateX(20px); }
            to   { opacity: 1; transform: translateX(0);    }
        }
        /* Shimmer sweep */
        @keyframes pmShimmer {
            0%   { left: -80%; }
            100% { left: 160%; }
        }
        /* Glow pulse */
        @keyframes pmGlowPulse {
            0%,100% { box-shadow: 0 0 0   0px rgba(245,158,11,.0); }
            50%      { box-shadow: 0 0 18px 4px rgba(245,158,11,.35); }
        }
        /* Sidebar active item slide-in indicator */
        @keyframes pmBarIn {
            from { transform: scaleY(0); }
            to   { transform: scaleY(1); }
        }
        /* Number pop on change */
        @keyframes pmNumPop {
            0%   { transform: scale(1);    color: inherit; }
            35%  { transform: scale(1.22); color: #fbbf24; }
            100% { transform: scale(1);    color: inherit; }
        }
        /* Topbar entrance */
        @keyframes pmTopbarIn {
            from { opacity: 0; transform: translateY(-16px); }
            to   { opacity: 1; transform: translateY(0);      }
        }
        /* Hero dashboard entrance */
        @keyframes pmHeroIn {
            from { opacity: 0; transform: translateY(28px) scale(.97); }
            to   { opacity: 1; transform: translateY(0)    scale(1);   }
        }
        /* Stat card pop */
        @keyframes pmStatPop {
            from { opacity: 0; transform: translateY(24px) scale(.92); }
            to   { opacity: 1; transform: translateY(0)    scale(1);   }
        }
        /* Vehicle button pop-in */
        @keyframes pmVehIn {
            from { opacity: 0; transform: scale(.72) translateY(14px); }
            to   { opacity: 1; transform: scale(1)   translateY(0);    }
        }
        /* Category item slide-in */
        @keyframes pmCatIn {
            from { opacity: 0; transform: translateX(-16px); }
            to   { opacity: 1; transform: translateX(0);      }
        }
        /* Sidebar button hover glow */
        @keyframes pmSbGlow {
            from { opacity: 0; }
            to   { opacity: 1; }
        }
        /* Toast spring */
        @keyframes pmToastIn {
            0%   { opacity: 0; transform: translateX(60px) scale(.88); }
            60%  { transform: translateX(-6px) scale(1.02); }
            100% { opacity: 1; transform: translateX(0)    scale(1);   }
        }
        /* Mode pill active */
        @keyframes pmPillActive {
            0%   { transform: scale(1); }
            40%  { transform: scale(.93); }
            100% { transform: scale(1); }
        }
        `;
        document.head.appendChild(s);
    }

    /* ════════════════════════════════════════════════════════
       UTILITIES
    ════════════════════════════════════════════════════════ */

    /* Spring cubic-beziers */
    const SPRING = {
        soft:   'cubic-bezier(.34,1.40,.64,1)',
        bouncy: 'cubic-bezier(.34,1.72,.64,1)',
        snappy: 'cubic-bezier(.22,1.10,.36,1)',
        out:    'cubic-bezier(.16,1,.3,1)',
        in:     'cubic-bezier(.7,0,1,1)',
    };

    function setSpring(el, props) {
        const dur  = props.dur  || '.26s';
        const ease = props.ease || SPRING.soft;
        const delay = props.delay || '0s';
        el.style.transition = props.props.map(p => `${p} ${dur} ${ease} ${delay}`).join(', ');
    }

    /* Pointer-origin ripple */
    function spawnRipple(el, e, color = 'rgba(255,255,255,.22)') {
        if (NO_MOTION) return;
        const rect = el.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2.2;
        const x = (e ? e.clientX - rect.left : rect.width  / 2) - size / 2;
        const y = (e ? e.clientY - rect.top  : rect.height / 2) - size / 2;
        const r = document.createElement('span');
        Object.assign(r.style, {
            position: 'absolute', borderRadius: '50%', pointerEvents: 'none',
            width: size + 'px', height: size + 'px', left: x + 'px', top: y + 'px',
            background: color, zIndex: '99',
            animation: `pmRipple .65s ${SPRING.out} forwards`,
        });
        const pos = getComputedStyle(el).position;
        if (pos === 'static') el.style.position = 'relative';
        el.style.overflow = 'hidden';
        el.appendChild(r);
        r.addEventListener('animationend', () => r.remove(), { once: true });
    }

    /* Shimmer overlay on hover */
    function addShimmer(el) {
        if (NO_MOTION) return;
        if (el._pmShimmer) return;
        const sh = document.createElement('span');
        Object.assign(sh.style, {
            position: 'absolute', top: '0', width: '55%', height: '100%',
            background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent)',
            pointerEvents: 'none', zIndex: '10',
            transition: 'none', left: '-80%',
        });
        const pos = getComputedStyle(el).position;
        if (pos === 'static') el.style.position = 'relative';
        el.style.overflow = 'hidden';
        el.appendChild(sh);
        el._pmShimmer = sh;
        el.addEventListener('mouseenter', () => {
            sh.style.animation = `pmShimmer .6s ${SPRING.out} forwards`;
        });
        el.addEventListener('mouseleave', () => {
            sh.style.animation = 'none';
            sh.style.left = '-80%';
        });
    }

    /* Magnetic attraction */
    function addMagnetic(el, strength = 0.30) {
        if (NO_MOTION) return;
        el.addEventListener('mousemove', e => {
            const rect = el.getBoundingClientRect();
            const dx = (e.clientX - (rect.left + rect.width  / 2)) * strength;
            const dy = (e.clientY - (rect.top  + rect.height / 2)) * strength;
            el.style.transform = `translate(${dx}px,${dy}px)`;
        });
        el.addEventListener('mouseleave', () => {
            el.style.transition = `transform .55s ${SPRING.bouncy}`;
            el.style.transform = 'translate(0,0)';
        });
        el.addEventListener('mouseenter', () => {
            el.style.transition = `transform .18s ${SPRING.out}`;
        });
    }

    /* stagger animate a NodeList */
    function stagger(els, keyframe, opts = {}) {
        if (NO_MOTION) { els.forEach(e => { e.style.opacity = '1'; }); return; }
        els.forEach((el, i) => {
            el.style.opacity = '0';
            el.style.animation = 'none';
            requestAnimationFrame(() => {
                el.style.animation = `${keyframe} ${opts.dur || '.48s'} ${opts.ease || SPRING.soft} ${((opts.baseDelay || 0) + i * (opts.step || 55))}ms both`;
            });
        });
    }

    /* IntersectionObserver based reveal */
    function observeReveal(els, keyframe, opts = {}) {
        if (NO_MOTION) return;
        const io = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                const i  = Number(el.dataset.pmI || 0);
                el.style.animation = `${keyframe} ${opts.dur || '.52s'} ${opts.ease || SPRING.soft} ${(opts.baseDelay || 0) + i * (opts.step || 60)}ms both`;
                io.unobserve(el);
            });
        }, { threshold: 0.10, rootMargin: '0px 0px -32px 0px' });
        els.forEach((el, i) => {
            el.dataset.pmI = i;
            el.style.opacity = '0';
            io.observe(el);
        });
    }

    /* ════════════════════════════════════════════════════════
       1.  TOPBAR
    ════════════════════════════════════════════════════════ */
    function initTopbar() {
        const topbar = document.querySelector('.topbar');
        if (!topbar || NO_MOTION) return;
        topbar.style.animation = `pmTopbarIn .50s ${SPRING.out} both`;

        /* Theme toggle */
        const themBtn = topbar.querySelector('.theme-btn');
        if (themBtn) {
            addMagnetic(themBtn, 0.18);
            themBtn.addEventListener('pointerdown', e => spawnRipple(themBtn, e, 'rgba(245,158,11,.20)'));
        }

        /* User menu button */
        const userBtn = topbar.querySelector('.topbar-user-btn');
        if (userBtn) {
            addMagnetic(userBtn, 0.18);
            userBtn.addEventListener('pointerdown', e => spawnRipple(userBtn, e, 'rgba(245,158,11,.18)'));
            setSpring(userBtn, { props: ['transform', 'box-shadow'], dur: '.22s', ease: SPRING.soft });
            userBtn.addEventListener('mouseenter', () => {
                userBtn.style.transform = 'translateY(-2px) scale(1.03)';
                userBtn.style.boxShadow = '0 8px 24px rgba(0,0,0,.18)';
            });
            userBtn.addEventListener('mouseleave', () => {
                userBtn.style.transform = '';
                userBtn.style.boxShadow = '';
            });
        }
    }

    /* ════════════════════════════════════════════════════════
       2.  SIDEBAR
    ════════════════════════════════════════════════════════ */
    function initSidebar() {
        /* Sidebar brand icon — already has CSS wiggle, add magnetic */
        const brandIcon = document.querySelector('.sidebar-brand-icon');
        if (brandIcon && !NO_MOTION) addMagnetic(brandIcon, 0.22);

        /* Sidebar nav buttons */
        document.querySelectorAll('.sb-btn').forEach((btn, i) => {
            if (NO_MOTION) return;
            stagger([btn], 'pmFadeLeft', { dur: '.38s', baseDelay: 60 + i * 40 });
            btn.style.transition = `background .22s ${SPRING.out}, color .18s ease, transform .22s ${SPRING.soft}, box-shadow .22s ${SPRING.out}`;
            btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'translateX(6px)';
                btn.style.boxShadow = '2px 0 16px rgba(245,158,11,.15)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = '';
                btn.style.boxShadow = '';
            });
            btn.addEventListener('pointerdown', e => spawnRipple(btn, e, 'rgba(245,158,11,.18)'));
        });

        /* Category items */
        document.querySelectorAll('.category-item').forEach((item, i) => {
            if (NO_MOTION) return;
            item.style.opacity = '0';
            item.style.animation = `pmCatIn .42s ${SPRING.soft} ${80 + i * 35}ms both`;
            item.style.transition = `background .20s ${SPRING.out}, color .18s ease, transform .22s ${SPRING.soft}`;
            item.addEventListener('mouseenter', () => {
                if (!item.classList.contains('active')) {
                    item.style.transform = 'translateX(6px)';
                }
            });
            item.addEventListener('mouseleave', () => {
                if (!item.classList.contains('active')) item.style.transform = '';
            });
            item.addEventListener('pointerdown', e => spawnRipple(item, e, 'rgba(245,158,11,.16)'));
        });

        /* Mode pills (Violation / Exemption) */
        document.querySelectorAll('.mode-pill').forEach(pill => {
            if (NO_MOTION) return;
            pill.style.transition = `background .22s ${SPRING.soft}, transform .22s ${SPRING.bouncy}, box-shadow .22s ${SPRING.out}, color .18s ease`;
            pill.addEventListener('mouseenter', () => {
                if (!pill.classList.contains('active')) {
                    pill.style.transform = 'scale(1.04)';
                }
            });
            pill.addEventListener('mouseleave', () => {
                pill.style.transform = '';
            });
            pill.addEventListener('pointerdown', e => {
                spawnRipple(pill, e, 'rgba(255,255,255,.25)');
                pill.style.transform = 'scale(.93)';
                setTimeout(() => { pill.style.transform = ''; }, 180);
            });
        });

        /* Sidebar nav section buttons (Save Audit, View History etc) */
        const sbSuccess = document.querySelector('#submitAuditLogBtn');
        if (sbSuccess && !NO_MOTION) {
            addShimmer(sbSuccess);
            sbSuccess.style.transition = `transform .22s ${SPRING.bouncy}, box-shadow .22s ${SPRING.out}`;
            sbSuccess.addEventListener('mouseenter', () => {
                sbSuccess.style.transform = 'translateX(6px) scale(1.03)';
                sbSuccess.style.boxShadow = '0 6px 20px rgba(16,185,129,.22)';
            });
            sbSuccess.addEventListener('mouseleave', () => {
                sbSuccess.style.transform = '';
                sbSuccess.style.boxShadow = '';
            });
            sbSuccess.addEventListener('pointerdown', e => spawnRipple(sbSuccess, e, 'rgba(110,231,183,.22)'));
        }
    }

    /* ════════════════════════════════════════════════════════
       3.  DASHBOARD HERO
    ════════════════════════════════════════════════════════ */
    function initHero() {
        const hero = document.querySelector('.dashboard-hero');
        if (!hero || NO_MOTION) return;
        hero.style.animation = `pmHeroIn .62s ${SPRING.out} .05s both`;

        /* Hero stat tiles */
        document.querySelectorAll('.hero-stat').forEach((tile, i) => {
            tile.style.opacity = '0';
            tile.style.animation = `pmStatPop .50s ${SPRING.bouncy} ${120 + i * 70}ms both`;
            tile.style.cursor = 'default';
            setSpring(tile, { props: ['transform', 'box-shadow', 'border-color', 'background'], dur: '.24s', ease: SPRING.soft });
            tile.addEventListener('mouseenter', () => {
                tile.style.transform    = 'translateY(-6px) scale(1.06)';
                tile.style.boxShadow    = '0 16px 36px rgba(0,0,0,.36)';
                tile.style.borderColor  = 'rgba(245,158,11,.50)';
                tile.style.background   = 'rgba(245,158,11,.12)';
            });
            tile.addEventListener('mouseleave', () => {
                tile.style.transform   = '';
                tile.style.boxShadow   = '';
                tile.style.borderColor = '';
                tile.style.background  = '';
            });
        });
    }

    /* ════════════════════════════════════════════════════════
       4.  STAT CARDS  (Report count / Checked / Remaining / %)
    ════════════════════════════════════════════════════════ */
    function initStatCards() {
        observeReveal(
            document.querySelectorAll('.stat-card'),
            'pmStatPop',
            { dur: '.52s', ease: SPRING.soft, step: 65, baseDelay: 60 }
        );
        document.querySelectorAll('.stat-card').forEach(card => {
            if (NO_MOTION) return;
            setSpring(card, { props: ['transform', 'box-shadow', 'border-color'], dur: '.26s', ease: SPRING.soft });
            card.addEventListener('mouseenter', () => {
                card.style.transform   = 'translateY(-7px) scale(1.025)';
                card.style.boxShadow   = '0 22px 48px rgba(0,0,0,.18)';
                card.style.borderColor = 'rgba(245,158,11,.38)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform   = '';
                card.style.boxShadow   = '';
                card.style.borderColor = '';
            });
            card.addEventListener('pointerdown', e => spawnRipple(card, e, 'rgba(245,158,11,.14)'));
        });
    }

    /* ════════════════════════════════════════════════════════
       5.  VEHICLE BUTTONS  — the main action buttons
    ════════════════════════════════════════════════════════ */
    function initVehicleButtons() {
        const btns = document.querySelectorAll('.vehicle-btn');
        if (!btns.length) return;

        btns.forEach((btn, i) => {
            if (NO_MOTION) return;
            /* Staggered entrance */
            btn.style.opacity = '0';
            btn.style.animation = `pmVehIn .48s ${SPRING.bouncy} ${40 + i * 28}ms both`;

            /* Spring hover */
            btn.style.transition = `transform .22s ${SPRING.bouncy}, box-shadow .22s ${SPRING.out}, filter .14s ease`;
            btn.addEventListener('mouseenter', () => {
                btn.style.transform  = 'translateY(-9px) scale(1.09)';
                btn.style.boxShadow  = '0 22px 44px rgba(0,0,0,.40)';
                btn.style.filter     = 'brightness(1.14) saturate(1.12)';
                btn.style.zIndex     = '2';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = '';
                btn.style.boxShadow = '';
                btn.style.filter    = '';
                btn.style.zIndex    = '';
            });

            /* Tap — instant depth press */
            btn.addEventListener('pointerdown', e => {
                btn.style.transform  = 'scale(.88)';
                btn.style.filter     = 'brightness(.85)';
                btn.style.transition = `transform .08s ${SPRING.in}, filter .08s ease`;
                spawnRipple(btn, e, 'rgba(255,255,255,.28)');
            });
            btn.addEventListener('pointerup', () => {
                btn.style.transition = `transform .30s ${SPRING.bouncy}, box-shadow .26s ${SPRING.out}, filter .18s ease`;
                btn.style.transform = '';
                btn.style.filter    = '';
            });
            btn.addEventListener('pointerleave', () => {
                btn.style.transition = `transform .26s ${SPRING.bouncy}, box-shadow .22s ${SPRING.out}, filter .16s ease`;
                btn.style.transform = '';
                btn.style.filter    = '';
            });
        });
    }

    /* ════════════════════════════════════════════════════════
       6.  NEXT CATEGORY BUTTON
    ════════════════════════════════════════════════════════ */
    function initNextCatBtn() {
        const btn = document.getElementById('nextCategoryBtn');
        if (!btn || NO_MOTION) return;
        addShimmer(btn);
        addMagnetic(btn, 0.20);
        btn.style.transition = `transform .24s ${SPRING.bouncy}, box-shadow .22s ${SPRING.out}, filter .14s ease`;
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'translateY(-4px) scale(1.04)';
            btn.style.boxShadow = '0 14px 36px rgba(217,119,6,.45)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = '';
            btn.style.boxShadow = '';
        });
        btn.addEventListener('pointerdown', e => {
            spawnRipple(btn, e, 'rgba(255,255,255,.25)');
            btn.style.transform = 'scale(.93)';
            setTimeout(() => { btn.style.transform = ''; btn.style.transition = `transform .30s ${SPRING.bouncy}`; }, 100);
        });
    }

    /* ════════════════════════════════════════════════════════
       7.  REPORT SETUP CARD / ACTION BUTTONS
    ════════════════════════════════════════════════════════ */
    function initReportSetup() {
        /* Actions dropdown button */
        const actionsBtn = document.querySelector('#reportActionsBtn, .report-setup-toggle, [data-bs-toggle="dropdown"]');
        if (actionsBtn && !NO_MOTION) {
            setSpring(actionsBtn, { props: ['transform', 'box-shadow'], dur: '.22s', ease: SPRING.soft });
            actionsBtn.addEventListener('mouseenter', () => {
                actionsBtn.style.transform = 'scale(1.03)';
            });
            actionsBtn.addEventListener('mouseleave', () => {
                actionsBtn.style.transform = '';
            });
            actionsBtn.addEventListener('pointerdown', e => spawnRipple(actionsBtn, e, 'rgba(245,158,11,.18)'));
        }

        /* Dropdown items */
        document.querySelectorAll('.dropdown-item').forEach(item => {
            if (NO_MOTION) return;
            item.style.transition = `background .16s ease, transform .18s ${SPRING.soft}, padding-left .18s ${SPRING.soft}`;
            item.addEventListener('mouseenter', () => {
                item.style.transform    = 'translateX(5px)';
                item.style.paddingLeft  = '20px';
            });
            item.addEventListener('mouseleave', () => {
                item.style.transform   = '';
                item.style.paddingLeft = '';
            });
            item.addEventListener('pointerdown', e => spawnRipple(item, e, 'rgba(245,158,11,.14)'));
        });
    }

    /* ════════════════════════════════════════════════════════
       8.  VERIFY PASS SECTION
    ════════════════════════════════════════════════════════ */
    function initVerifyPass() {
        const card = document.querySelector('.verify-pass-card');
        if (card && !NO_MOTION) {
            observeReveal([card], 'pmFadeUp', { dur: '.50s', ease: SPRING.soft, baseDelay: 40 });
        }

        const searchBtn = document.getElementById('passCheckBtn');
        if (searchBtn && !NO_MOTION) {
            addShimmer(searchBtn);
            addMagnetic(searchBtn, 0.16);
            searchBtn.style.transition = `transform .22s ${SPRING.bouncy}, filter .14s ease`;
            searchBtn.addEventListener('mouseenter', () => {
                searchBtn.style.transform = 'scale(1.06) translateY(-2px)';
                searchBtn.style.filter    = 'brightness(1.10)';
            });
            searchBtn.addEventListener('mouseleave', () => {
                searchBtn.style.transform = '';
                searchBtn.style.filter    = '';
            });
            searchBtn.addEventListener('pointerdown', e => {
                spawnRipple(searchBtn, e, 'rgba(255,255,255,.25)');
                searchBtn.style.transform = 'scale(.92)';
                searchBtn.style.transition = `transform .08s ${SPRING.in}`;
                setTimeout(() => { searchBtn.style.transition = `transform .28s ${SPRING.bouncy}`; searchBtn.style.transform = ''; }, 90);
            });
        }

        const input = document.getElementById('passCheckInput');
        if (input && !NO_MOTION) {
            input.style.transition = `transform .22s ${SPRING.soft}, box-shadow .22s ${SPRING.out}, border-color .18s ease`;
            input.addEventListener('focus', () => { input.style.transform = 'scale(1.008)'; });
            input.addEventListener('blur',  () => { input.style.transform = ''; });
        }
    }

    /* ════════════════════════════════════════════════════════
       9.  DASHBOARD CARDS  (main content area)
    ════════════════════════════════════════════════════════ */
    function initDashboardCards() {
        const cards = document.querySelectorAll('.card.shadow-sm, .dashboard-card');
        observeReveal(cards, 'pmFadeUp', { dur: '.52s', ease: SPRING.soft, step: 55, baseDelay: 30 });

        cards.forEach(card => {
            if (NO_MOTION) return;
            card.style.transition = `transform .26s ${SPRING.soft}, box-shadow .26s ${SPRING.out}`;
            card.addEventListener('mouseenter', () => {
                card.style.transform  = 'translateY(-3px)';
                card.style.boxShadow  = '0 14px 36px rgba(0,0,0,.13)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
                card.style.boxShadow = '';
            });
        });
    }

    /* ════════════════════════════════════════════════════════
       10.  ALL .btn ELEMENTS  (Bootstrap buttons)
    ════════════════════════════════════════════════════════ */
    function initAllBtns() {
        document.querySelectorAll('.btn').forEach(btn => {
            if (NO_MOTION) return;
            if (btn._pmDone) return;
            btn._pmDone = true;
            btn.style.transition = `transform .20s ${SPRING.bouncy}, box-shadow .20s ${SPRING.out}, filter .14s ease`;
            btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'translateY(-2px) scale(1.03)';
                btn.style.boxShadow = '0 6px 18px rgba(0,0,0,.16)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = '';
                btn.style.boxShadow = '';
            });
            btn.addEventListener('pointerdown', e => {
                spawnRipple(btn, e, 'rgba(255,255,255,.22)');
                btn.style.transform = 'scale(.93)';
                btn.style.transition = `transform .08s ${SPRING.in}`;
                setTimeout(() => { btn.style.transition = `transform .24s ${SPRING.bouncy}`; btn.style.transform = ''; }, 90);
            });
        });
    }

    /* ════════════════════════════════════════════════════════
       11.  TRANSACTION HISTORY ROWS
    ════════════════════════════════════════════════════════ */
    function initTxnRows() {
        document.querySelectorAll('.txn-card').forEach((row, i) => {
            if (NO_MOTION) return;
            row.style.opacity = '0';
            row.style.animation = `pmFadeUp .38s ${SPRING.soft} ${i * 30}ms both`;
            row.style.transition = `transform .20s ${SPRING.soft}, box-shadow .20s ${SPRING.out}, border-color .18s ease`;
            row.addEventListener('mouseenter', () => {
                row.style.transform   = 'translateX(5px)';
                row.style.boxShadow   = '0 4px 16px rgba(0,0,0,.12)';
            });
            row.addEventListener('mouseleave', () => {
                row.style.transform   = '';
                row.style.boxShadow   = '';
            });
        });

        /* Transaction action buttons (delete, comment) */
        document.querySelectorAll('.txn-action-btn, .txn-delete-btn, .txn-comment-btn').forEach(btn => {
            if (NO_MOTION || btn._pmDone) return;
            btn._pmDone = true;
            btn.style.transition = `transform .18s ${SPRING.bouncy}, background .16s ease`;
            btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.12)'; });
            btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
            btn.addEventListener('pointerdown', e => spawnRipple(btn, e, 'rgba(255,255,255,.30)'));
        });
    }

    /* ════════════════════════════════════════════════════════
       12.  AUDIT LOG DATE BUTTONS
    ════════════════════════════════════════════════════════ */
    function initAuditLogBtns() {
        document.querySelectorAll('.audit-log-date-btn').forEach((btn, i) => {
            if (NO_MOTION || btn._pmDone) return;
            btn._pmDone = true;
            btn.style.opacity = '0';
            btn.style.animation = `pmFadeLeft .36s ${SPRING.soft} ${i * 40}ms both`;
            btn.style.transition = `transform .20s ${SPRING.soft}, box-shadow .20s ${SPRING.out}`;
            btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateX(4px)'; });
            btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
            btn.addEventListener('pointerdown', e => spawnRipple(btn, e, 'rgba(245,158,11,.18)'));
        });
    }

    /* ════════════════════════════════════════════════════════
       13.  MODALS  — spring scale entrance
    ════════════════════════════════════════════════════════ */
    function initModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('show.bs.modal', () => {
                if (NO_MOTION) return;
                const dialog = modal.querySelector('.modal-dialog');
                if (!dialog) return;
                dialog.style.animation = `pmHeroIn .44s ${SPRING.bouncy} both`;
            });
        });
    }

    /* ════════════════════════════════════════════════════════
       14.  TOASTS  — spring slide-in from right
    ════════════════════════════════════════════════════════ */
    const _origShowToast = window.showToast;
    if (typeof _origShowToast === 'function' && !NO_MOTION) {
        window.showToast = function (...args) {
            _origShowToast(...args);
            setTimeout(() => {
                const last = document.querySelector('#toastContainer .ta-toast:last-child, #toastContainer > div:last-child');
                if (last) last.style.animation = `pmToastIn .52s ${SPRING.bouncy} both`;
            }, 10);
        };
    }

    /* ════════════════════════════════════════════════════════
       15.  INPUTS  — focus spring scale
    ════════════════════════════════════════════════════════ */
    function initInputs() {
        document.querySelectorAll('input.form-control, textarea.form-control, select.form-select').forEach(inp => {
            if (NO_MOTION || inp._pmDone) return;
            inp._pmDone = true;
            inp.style.transition = `transform .20s ${SPRING.soft}, box-shadow .20s ${SPRING.out}, border-color .18s ease`;
            inp.addEventListener('focus', () => { inp.style.transform = 'scale(1.008)'; });
            inp.addEventListener('blur',  () => { inp.style.transform = ''; });
        });
    }

    /* ════════════════════════════════════════════════════════
       16.  HISTORY DATE BUTTONS (sidebar)
    ════════════════════════════════════════════════════════ */
    function initHistoryBtns() {
        document.querySelectorAll('.history-date-btn').forEach((btn, i) => {
            if (NO_MOTION || btn._pmDone) return;
            btn._pmDone = true;
            btn.style.opacity = '0';
            btn.style.animation = `pmFadeLeft .34s ${SPRING.soft} ${i * 30}ms both`;
            btn.style.transition = `background .18s ease, transform .20s ${SPRING.soft}`;
            btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateX(3px)'; });
            btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
            btn.addEventListener('pointerdown', e => spawnRipple(btn, e, 'rgba(245,158,11,.18)'));
        });
    }

    /* ════════════════════════════════════════════════════════
       17.  AVATAR CIRCLE  (welcome screen)
    ════════════════════════════════════════════════════════ */
    function initAvatar() {
        const av = document.querySelector('.avatar-circle');
        if (!av || NO_MOTION) return;
        addMagnetic(av, 0.18);
        av.style.transition = `transform .28s ${SPRING.bouncy}, box-shadow .28s ${SPRING.out}`;
        av.addEventListener('mouseenter', () => {
            av.style.transform  = 'scale(1.12) rotate(3deg)';
            av.style.boxShadow  = '0 14px 40px rgba(217,119,6,.55)';
        });
        av.addEventListener('mouseleave', () => {
            av.style.transform = '';
            av.style.boxShadow = '';
        });
        av.addEventListener('pointerdown', e => spawnRipple(av, e, 'rgba(245,158,11,.22)'));
    }

    /* ════════════════════════════════════════════════════════
       18.  START AUDIT / PRIMARY CTA BUTTONS
    ════════════════════════════════════════════════════════ */
    function initCTABtns() {
        document.querySelectorAll('.start-audit-btn, .btn-auth-primary').forEach(btn => {
            if (NO_MOTION || btn._pmDone) return;
            btn._pmDone = true;
            addShimmer(btn);
            addMagnetic(btn, 0.16);
            btn.style.transition = `transform .24s ${SPRING.bouncy}, box-shadow .22s ${SPRING.out}, filter .14s ease`;
            btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'translateY(-4px) scale(1.02)';
                btn.style.boxShadow = '0 18px 44px rgba(217,119,6,.60)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = '';
                btn.style.boxShadow = '';
            });
            btn.addEventListener('pointerdown', e => {
                spawnRipple(btn, e, 'rgba(255,255,255,.28)');
                btn.style.transform = 'scale(.94)';
                btn.style.transition = `transform .08s ${SPRING.in}`;
                setTimeout(() => { btn.style.transition = `transform .30s ${SPRING.bouncy}`; btn.style.transform = ''; }, 100);
            });
        });
    }

    /* ════════════════════════════════════════════════════════
       19.  VEHICLE COUNT ROWS (vc-row)
    ════════════════════════════════════════════════════════ */
    function initVcRows() {
        document.querySelectorAll('.vc-row').forEach((row, i) => {
            if (NO_MOTION || row._pmDone) return;
            row._pmDone = true;
            row.style.opacity = '0';
            row.style.animation = `pmFadeUp .38s ${SPRING.soft} ${i * 25}ms both`;
            row.style.transition = `transform .20s ${SPRING.soft}, background .18s ease, border-color .18s ease`;
            row.addEventListener('mouseenter', () => { row.style.transform = 'translateX(4px)'; });
            row.addEventListener('mouseleave', () => { row.style.transform = ''; });
        });
    }

    /* ════════════════════════════════════════════════════════
       20.  PASS-CHECK RESULT CARD
    ════════════════════════════════════════════════════════ */
    const _passCheckResult = document.getElementById('passCheckResult');
    if (_passCheckResult) {
        const origSetInner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML').set;
        const io = new MutationObserver(() => {
            if (NO_MOTION || !_passCheckResult.children.length) return;
            Array.from(_passCheckResult.children).forEach((child, i) => {
                child.style.animation = `pmFadeUp .42s ${SPRING.bouncy} ${i * 40}ms both`;
            });
        });
        io.observe(_passCheckResult, { childList: true });
    }

    /* ════════════════════════════════════════════════════════
       MASTER INIT + RE-INIT on dynamic renders
    ════════════════════════════════════════════════════════ */
    function initAll() {
        initTopbar();
        initSidebar();
        initHero();
        initStatCards();
        initVehicleButtons();
        initNextCatBtn();
        initReportSetup();
        initVerifyPass();
        initDashboardCards();
        initAllBtns();
        initTxnRows();
        initAuditLogBtns();
        initModals();
        initInputs();
        initHistoryBtns();
        initAvatar();
        initCTABtns();
        initVcRows();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAll);
    } else {
        initAll();
    }

    /* Re-run on dynamic renders (category switch, new transactions, etc.) */
    window.motionRefresh = function () {
        initVehicleButtons();
        initTxnRows();
        initVcRows();
        initAuditLogBtns();
        initHistoryBtns();
        initAllBtns();
        initVerifyPass();
        initStatCards();
    };

})();
