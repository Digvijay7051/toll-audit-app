/* ==========================================================
   Toll Audit Assistant
   ui.js
========================================================== */

/* ===============================
   INITIALIZE UI
=============================== */

function initializeUI() {

    renderCategories();

    renderVehicleCounts();

    renderTransactionHistory();

    updateDashboard();

    setupPendingAuditBanner();

}

/* ===============================
   TOPBAR USER INFO
   (today's date / live clock / login time)
=============================== */

let topbarClockInterval = null;

function formatFriendlyDate(date) {

    return date.toLocaleDateString(undefined, {

        day: "numeric",

        month: "short",

        year: "numeric"

    });

}

function formatFriendlyTime(date) {

    return date.toLocaleTimeString(undefined, {

        hour: "2-digit",

        minute: "2-digit"

    });

}

function renderTopbarClock() {

    const now = new Date();

    const dateEl = document.getElementById("topbarTodayDate");

    if (dateEl) dateEl.textContent = formatFriendlyDate(now);

    const timeEl = document.getElementById("topbarCurrentTime");

    if (timeEl) timeEl.textContent = formatFriendlyTime(now);

}

function renderTopbarLoginTime() {

    const loginEl = document.getElementById("topbarLoginTime");

    if (!loginEl) return;

    const session = getSession();

    if (session && session.loginTime) {

        loginEl.textContent =
            formatFriendlyTime(new Date(session.loginTime));

    } else {

        loginEl.textContent = "--";

    }

}

function startTopbarClock() {

    renderTopbarClock();

    renderTopbarLoginTime();

    if (topbarClockInterval) {

        clearInterval(topbarClockInterval);

    }

    topbarClockInterval = setInterval(renderTopbarClock, 1000 * 30);

}

/* ===============================
   PENDING PAST AUDIT BANNER
=============================== */

function checkPendingAuditBanner() {

    const banner = document.getElementById("pendingAuditBanner");

    if (!banner) return;

    const pendingDateKey = getPendingPastDate();

    if (!pendingDateKey || pendingDateKey === selectedAuditDate) {

        banner.style.display = "none";

        return;

    }

    const friendly = formatFriendlyDate(new Date(pendingDateKey));

    document.getElementById("pendingAuditTitle").textContent =
        `${friendly} audit is pending`;

    document.getElementById("pendingAuditSub").textContent =
        "It looks like this date wasn't finished. Mark it as completed if it already was, or skip it to dismiss this reminder.";

    banner.dataset.pendingDate = pendingDateKey;

    banner.style.display = "flex";

}

function setupPendingAuditBanner() {

    const skipBtn      = document.getElementById("pendingAuditSkipBtn");
    const completedBtn = document.getElementById("pendingAuditCompletedBtn");
    const goToBtn      = document.getElementById("pendingAuditGoToBtn");
    const banner       = document.getElementById("pendingAuditBanner");

    if (goToBtn) {

        goToBtn.addEventListener("click", () => {

            const dateKey = banner.dataset.pendingDate;

            if (!dateKey) return;

            /* Switch the active audit date to the pending date and stay in the main app */
            setActiveAuditDate(dateKey);

            saveSelectedAuditDate(dateKey);

            /* Update sidebar date badge */
            const label = document.getElementById("activeAuditDate");
            if (label) label.textContent = dateKey;

            /* Update topbar date chip */
            const topbarDate = document.getElementById("topbarAuditDate");
            if (topbarDate) {
                const [y, m, d] = dateKey.split("-");
                const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                topbarDate.textContent = d ? `${parseInt(d)} ${months[parseInt(m)-1]} ${y}` : dateKey;
            }

            if (typeof refreshUI === "function") refreshUI();

            banner.style.display = "none";

            showToast("Switched Date", `Now auditing ${formatFriendlyDate(new Date(dateKey))}`, "success");

        });

    }

    if (skipBtn) {

        skipBtn.addEventListener("click", () => {

            const dateKey = banner.dataset.pendingDate;

            if (!dateKey) return;

            if (!confirm(`Skip the pending audit for ${formatFriendlyDate(new Date(dateKey))}?`)) {

                return;

            }

            markDateSkipped(dateKey);

            checkPendingAuditBanner();

        });

    }

    if (completedBtn) {

        completedBtn.addEventListener("click", () => {

            const dateKey = banner.dataset.pendingDate;

            if (!dateKey) return;

            markDateCompleted(dateKey);

            checkPendingAuditBanner();

        });

    }

}

/* ===============================
   CATEGORY LIST
=============================== */

function renderCategories() {

    const container = document.getElementById("categoryList");

    container.innerHTML = "";

    REPORT_CATEGORIES.forEach(category => {

        const div = document.createElement("div");

        div.className = "category-item";

        if (category === currentCategory) {

            div.classList.add("active");

        }

        div.innerHTML = `
            <i class="bi bi-folder2-open"></i>
            ${category}
        `;

        div.onclick = function () {

            currentCategory = category;

            refreshUI();

        };

        container.appendChild(div);

    });

}

/* ===============================
   DASHBOARD
=============================== */

function _pulseStatValue(id, newVal) {

    const el = document.getElementById(id);

    if (!el) return;

    if (el.textContent !== String(newVal)) {

        el.textContent = newVal;

        el.classList.remove("pulse-update");

        void el.offsetWidth; /* force reflow so animation restarts */

        el.classList.add("pulse-update");

        el.addEventListener("animationend", () => el.classList.remove("pulse-update"), { once: true });

    }

}

function updateDashboard() {

    _pulseStatValue("currentCategory", currentCategory);

    _pulseStatValue("reportCount",     getReportCount());

    _pulseStatValue("checkedCount",    getCheckedCount());

    _pulseStatValue("remainingCount",  getRemainingCount());

    const progress =
        getProgressPercentage();

    const bar =
        document.getElementById("progressBar");

    bar.style.width =
        progress + "%";

    bar.innerHTML =
        progress + "%";

    const nextBtn =
        document.getElementById("nextCategoryBtn");

    if (nextBtn) {

        const isComplete =
            getReportCount() > 0 &&
            getRemainingCount() === 0;

        nextBtn.style.display =
            isComplete ? "block" : "none";

    }

}

/* ===============================
   VEHICLE COUNT TABLE
=============================== */

/* Vehicle-class → Bootstrap Icon map */
const VC_ICONS = {
    "Car":               "bi-car-front-fill",
    "LCV":               "bi-truck",
    "Bus 2 Axle":        "bi-bus-front-fill",
    "Minibus":           "bi-bus-front",
    "Truck 2 Axle":      "bi-truck-front-fill",
    "Truck 3 Axle":      "bi-truck-front",
    "MAV":               "bi-boxes",
    "Oversized Vehicle": "bi-arrows-fullscreen",
    "Tractor":           "bi-tractor",
    "JCB":               "bi-cone-striped",
    "Auto":              "bi-tuk-tuk",
    "Bike":              "bi-bicycle",
    "Ambulance":         "bi-heart-pulse-fill",
    "Government Vehicle":"bi-building-fill",
    "Army Vehicle":      "bi-shield-fill",
    "Police":            "bi-shield-fill-check",
    "Has Pass":          "bi-check-circle-fill",
    "Paid":              "bi-currency-rupee",
    "Forcefully":        "bi-x-octagon-fill",
    "Fake Exemption":    "bi-exclamation-diamond-fill",
    "Fake Violation":    "bi-exclamation-triangle-fill"
};

function renderVehicleCounts() {

    const container = document.getElementById("vehicleCountTable");
    container.innerHTML = "";

    const counts  = getVehicleCounts();
    const nonZero = VEHICLE_CLASSES.filter(v => (counts[v] || 0) > 0);

    /* Update total chip */
    const totalChip = document.getElementById("vcTotalChip");
    if (totalChip) {
        const total = nonZero.reduce((s, v) => s + (counts[v] || 0), 0);
        totalChip.textContent = total + " total";
    }

    if (nonZero.length === 0) {
        container.innerHTML = `
            <div class="vc-empty">
                <i class="bi bi-inbox"></i>
                <span>No vehicles recorded yet.</span>
            </div>`;
        return;
    }

    const max = Math.max(...nonZero.map(v => counts[v] || 0));

    nonZero.forEach(vehicle => {

        const count   = counts[vehicle] || 0;
        const icon    = VC_ICONS[vehicle] || "bi-circle-fill";
        const pct     = max > 0 ? Math.round((count / max) * 100) : 0;

        const iconHtml = icon === "bi-tuk-tuk"
            ? `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="width:18px;height:18px;">
                 <path d="M4 8.5C4 7.4 4.9 6.5 6 6.5h8.5l2.8 3H4V8.5Z"/>
                 <rect x="14" y="6.5" width="1.2" height="3" rx="0.4"/>
                 <rect x="4" y="9.5" width="13.5" height="5" rx="1.2"/>
                 <path d="M17.5 11h3c.8 0 1 .6.8 1.2l-.6 2.3H17.5V11Z"/>
                 <circle cx="7" cy="16.5" r="2"/><circle cx="7" cy="16.5" r="0.8" fill="rgba(0,0,0,.35)"/>
                 <circle cx="19.5" cy="16.5" r="2"/><circle cx="19.5" cy="16.5" r="0.8" fill="rgba(0,0,0,.35)"/>
               </svg>`
            : `<i class="bi ${icon}"></i>`;

        const row = document.createElement("div");
        row.className = "vc-row";
        row.innerHTML = `
            <div class="vc-row-icon">${iconHtml}</div>
            <span class="vc-row-name">${vehicle}</span>
            <div class="vc-row-bar-wrap">
                <div class="vc-row-bar" style="width:${pct}%"></div>
            </div>
            <span class="vc-row-count">${count}</span>`;

        container.appendChild(row);

    });

}

/* ===============================
   TRANSACTION HISTORY
=============================== */

let historyFilter = {

    text: "",

    vehicle: ""

};

function renderTransactionHistory() {

    const container =
        document.getElementById("transactionHistory");

    container.innerHTML = "";

    const allTransactions =
        getTransactions();

    const filtered = allTransactions.filter(t => {

        const matchesVehicle =

            !historyFilter.vehicle ||

            t.actualVehicle === historyFilter.vehicle;

        const searchText =

            historyFilter.text.trim().toLowerCase();

        const matchesText =

            !searchText ||

            t.actualVehicle.toLowerCase().includes(searchText) ||

            (t.comment || "").toLowerCase().includes(searchText) ||

            String(t.transactionNo).includes(searchText);

        return matchesVehicle && matchesText;

    });

    if (allTransactions.length === 0) {

        container.innerHTML = `
            <div class="th-empty">
                <i class="bi bi-inbox"></i>
                <span>No Transactions yet.</span>
            </div>`;

        return;

    }

    if (filtered.length === 0) {

        container.innerHTML = `
            <div class="th-empty">
                <i class="bi bi-funnel"></i>
                <span>No transactions match this filter.</span>
            </div>`;

        return;

    }

    /* Accent colour per vehicle class (matches vehicle button palette) */
    const TXN_COLORS = {
        "Car":"#2563eb","LCV":"#059669","Bus 2 Axle":"#d97706",
        "Minibus":"#0284c7","Truck 2 Axle":"#dc2626","Truck 3 Axle":"#475569",
        "MAV":"#1e293b","Oversized Vehicle":"#c2410c","Tractor":"#065f46",
        "JCB":"#92400e","Auto":"#6d28d9","Bike":"#475569",
        "Ambulance":"#be185d","Government Vehicle":"#065f46","Army Vehicle":"#713f12",
        "Police":"#1e3a8a","Has Pass":"#0e7490","Paid":"#064e3b",
        "Forcefully":"#991b1b","Fake Exemption":"#78350f","Fake Violation":"#7f1d1d"
    };

    filtered.slice().reverse().forEach(transaction => {

        const card = document.createElement("div");
        card.className = "txn-card";

        const accent = TXN_COLORS[transaction.actualVehicle] || "#5b5ef6";
        card.style.borderLeftColor = accent;

        const timeLabel = transaction.timestamp
            ? new Date(transaction.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "";

        const commentHtml = transaction.comment
            ? `<div class="txn-comment">
                   <i class="bi bi-chat-left-text"></i>
                   <span class="txn-comment-text">${transaction.comment}</span>
                   <button class="txn-comment-del" data-txn="${transaction.transactionNo}" title="Delete comment">
                       <i class="bi bi-x-circle-fill"></i>
                   </button>
               </div>`
            : "";

        card.innerHTML = `
            <div class="txn-card-body">
                <span class="txn-num">#${transaction.transactionNo}</span>
                <span class="txn-vehicle">${transaction.actualVehicle}</span>
                ${timeLabel ? `<span class="txn-time"><i class="bi bi-clock"></i>${timeLabel}</span>` : ""}
                <div class="txn-actions">
                    <button class="txn-action-btn txn-comment-btn" data-txn="${transaction.transactionNo}" title="Add / edit comment">
                        <i class="bi bi-chat-left-text"></i>
                    </button>
                    <button class="txn-action-btn txn-action-danger txn-delete-btn" data-txn="${transaction.transactionNo}" title="Delete transaction">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
            ${commentHtml}`;

        container.appendChild(card);

    });

    container.querySelectorAll(".txn-comment-btn").forEach(btn => {
        btn.addEventListener("click", function () {
            openCommentPrompt(Number(this.dataset.txn));
        });
    });

    container.querySelectorAll(".txn-comment-del").forEach(btn => {
        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            deleteTransactionComment(Number(this.dataset.txn));
        });
    });

    container.querySelectorAll(".txn-delete-btn").forEach(btn => {
        btn.addEventListener("click", function (e) {

                e.stopPropagation();

                const txnNo = Number(this.dataset.txn);

                const txn = getTransactions().find(t => t.transactionNo === txnNo);

                const label = txn ? txn.actualVehicle : `#${txnNo}`;

                if (!confirm(`Delete transaction #${txnNo} (${label})?\n\nThis will remove it from the count and the history.`)) {

                    return;

                }

                deleteTransaction(txnNo);

                saveAuditData();

                refreshUI();

            });

        });

}

/* ===============================
   DELETE COMMENT
=============================== */

function deleteTransactionComment(transactionNo) {

    if (!confirm(`Delete comment on transaction #${transactionNo}?`)) {

        return;

    }

    updateTransactionComment(transactionNo, "");

    saveAuditData();

    refreshUI();

}

/* ===============================
   SEARCH / FILTER SETUP
=============================== */

function setupHistoryFilter() {

    const searchInput =

        document.getElementById("historySearchInput");

    const vehicleSelect =

        document.getElementById("historyVehicleFilter");

    if (vehicleSelect) {

        vehicleSelect.innerHTML =

            `<option value="">All Vehicles</option>` +

            VEHICLE_CLASSES.map(v =>

                `<option value="${v}">${v}</option>`

            ).join("");

    }

    if (searchInput) {

        searchInput.addEventListener("input", function () {

            historyFilter.text = this.value;

            renderTransactionHistory();

        });

    }

    if (vehicleSelect) {

        vehicleSelect.addEventListener("change", function () {

            historyFilter.vehicle = this.value;

            renderTransactionHistory();

        });

    }

}

/* ===============================
   COMMENT PROMPT
=============================== */

function openCommentPrompt(transactionNo) {

    const data = getCurrentCategoryData();

    const txn = data.transactions.find(

        t => t.transactionNo === transactionNo

    );

    if (!txn) return;

    const existing = txn.comment || "";

    const result = prompt(

        `Comment for transaction #${transactionNo} (${txn.actualVehicle}):`,

        existing

    );

    if (result === null) return;

    updateTransactionComment(transactionNo, result.trim());

    saveAuditData();

    refreshUI();

}

/* ===============================
   REPORT INPUTS
=============================== */

function updateReportInputs() {

    document.getElementById("reportCar").value =
        auditData[currentMode]["Car"].reportCount;

    document.getElementById("reportLCV").value =
        auditData[currentMode]["LCV"].reportCount;

    document.getElementById("reportBus2Axle").value =
        auditData[currentMode]["Bus 2 Axle"].reportCount;

    document.getElementById("reportTruck2").value =
        auditData[currentMode]["Truck 2 Axle"].reportCount;

    document.getElementById("reportTruck3").value =
        auditData[currentMode]["Truck 3 Axle"].reportCount;

    document.getElementById("reportMAV").value =
        auditData[currentMode]["MAV"].reportCount;

    document.getElementById("reportTractor").value =
        auditData[currentMode]["Tractor"].reportCount;

    document.getElementById("reportAuto").value =
        auditData[currentMode]["Auto"].reportCount;

    /* Refresh live total */
    const totalEl = document.getElementById("reportTotalCount");
    if (totalEl) {
        const ids = ["reportCar","reportLCV","reportBus2Axle",
                     "reportTruck2","reportTruck3","reportMAV",
                     "reportTractor","reportAuto"];
        totalEl.textContent = ids.reduce((s, id) => {
            const el = document.getElementById(id);
            return s + (el ? (Number(el.value) || 0) : 0);
        }, 0);
    }

}

/* ===============================
   REFRESH UI
=============================== */

function refreshUI() {

    renderCategories();

    updateDashboard();

    renderVehicleCounts();

    renderTransactionHistory();

    updateReportInputs();

    updateHeroSection();

}

/* ===============================
   HERO SECTION UPDATER
=============================== */

function updateHeroSection() {

    const bucket = auditDataStore[selectedAuditDate];
    if (!bucket) return;

    /* Count totals across all modes and categories */
    let totalTxn  = 0;
    let totalRpt  = 0;
    let totalChk  = 0;

    AUDIT_MODES.forEach(mode => {
        const modeData = bucket[mode];
        if (!modeData) return;
        REPORT_CATEGORIES.forEach(cat => {
            const c = modeData[cat];
            if (!c) return;
            totalTxn += (c.transactions || []).length;
            totalRpt += (c.reportCount  || 0);
        });
    });

    totalChk = totalTxn;
    const remaining = Math.max(0, totalRpt - totalTxn);
    const pct = totalRpt > 0 ? Math.min(100, Math.round((totalTxn / totalRpt) * 100)) : 0;

    const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

    setEl("heroTotalTxn",  totalTxn);
    setEl("heroChecked",   totalChk);
    setEl("heroRemaining", remaining);
    setEl("heroProgress",  pct + "%");
    setEl("topbarAuditDate", selectedAuditDate ? `Audit · ${selectedAuditDate}` : "Toll Audit");

    /* Update subtitle */
    const sub = document.getElementById("heroSubLine");
    if (sub) {
        sub.textContent = pct >= 100
            ? "🎉 All categories complete!"
            : `Auditing ${currentCategory} · ${currentMode} mode`;
    }

}

/* ===============================
   THEME TOGGLE (DAY / NIGHT)
=============================== */

/* ===============================
   PREMIUM TOAST NOTIFICATIONS
=============================== */

function showToast(title, message, type = "info", duration = 3500) {

    const container = document.getElementById("toastContainer");
    if (!container) return;

    const icons = {
        success: "bi-check-circle-fill",
        error:   "bi-x-circle-fill",
        warning: "bi-exclamation-triangle-fill",
        info:    "bi-info-circle-fill"
    };

    const toast = document.createElement("div");
    toast.className = `ta-toast toast-${type}`;

    toast.innerHTML = `
        <div class="ta-toast-icon"><i class="bi ${icons[type] || icons.info}"></i></div>
        <div class="ta-toast-body">
            <div class="ta-toast-title">${title}</div>
            ${message ? `<div class="ta-toast-msg">${message}</div>` : ""}
        </div>
        <button class="ta-toast-close" aria-label="Close">✕</button>
    `;

    container.appendChild(toast);

    const dismiss = () => {
        toast.classList.add("toast-out");
        toast.addEventListener("animationend", () => toast.remove(), { once: true });
    };

    toast.querySelector(".ta-toast-close").addEventListener("click", dismiss);
    toast.addEventListener("click", dismiss);

    setTimeout(dismiss, duration);

}

/* ===============================
   THEME TOGGLE — iPhone style
=============================== */

function applyTheme(theme) {

    const isNight = theme === "night";

    document.body.classList.toggle("dark-theme", isNight);

    /* Update compact mini switch state + label */
    const track = document.querySelector(".theme-mini-track");
    const text  = document.querySelector(".theme-ctrl-text");
    const icon  = document.querySelector(".theme-ctrl-icon");

    if (text)  text.textContent  = isNight ? "Night" : "Day";
    if (icon)  icon.className    = isNight
        ? "bi bi-moon-half theme-ctrl-icon"
        : "bi bi-sun-fill theme-ctrl-icon";

}

function setupThemeToggle() {

    const btn = document.getElementById("themeToggleBtn");

    if (!btn) return;

    let currentTheme = loadThemePreference();

    applyTheme(currentTheme);

    btn.addEventListener("click", function () {

        currentTheme = currentTheme === "night" ? "day" : "night";

        applyTheme(currentTheme);

        saveThemePreference(currentTheme);

    });

}

/* ===============================
   LOCK SCREEN
=============================== */

let inactivityTimer = null;

function showLockOverlay() {

    document.getElementById("lockOverlay").classList.add("active");

    /* Always start on main (enter PIN) section */
    _showLockSection("lockBoxMain");
    _resetUnlockDots();

    appLock.isLocked = true;

}

function hideLockOverlay() {

    document.getElementById("lockOverlay")

        .classList.remove("active");

    appLock.isLocked = false;

    resetInactivityTimer();

}

/* ── Unlock numpad state ── */
let _unlockEntry = "";

function _resetUnlockDots(isError) {
    _unlockEntry = "";
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("upd" + i);
        if (d) d.className = "pin-dot" + (isError ? " error" : "");
    }
    const e = document.getElementById("unlockError");
    if (e && !isError) e.style.display = "none";
}

function _updateUnlockDots() {
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("upd" + i);
        if (d) d.className = "pin-dot" + (i < _unlockEntry.length ? " filled" : "");
    }
}

function attemptUnlock() {
    if (validateLockPin(_unlockEntry)) {
        hideLockOverlay();
    } else {
        document.getElementById("unlockError").style.display = "block";
        _resetUnlockDots(true);
        setTimeout(() => _resetUnlockDots(), 700);
    }
}

/* ── Set PIN modal state ── */
let _mpEntry = "", _mpConfirm = "", _mpPhase = "enter";

function _resetMpDots() {
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("mpd" + i);
        if (d) d.className = "pin-dot";
    }
}
function _updateMpDots() {
    const src = _mpPhase === "confirm" ? _mpConfirm : _mpEntry;
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("mpd" + i);
        if (d) d.className = "pin-dot" + (i < src.length ? " filled" : "");
    }
}
function _openSetPinModal() {
    _mpEntry = ""; _mpConfirm = ""; _mpPhase = "enter";
    _resetMpDots();
    const hasPin = hasLockPin();
    document.getElementById("setPinModalTitle").textContent = hasPin ? "Change Lock PIN" : "Set Lock PIN";
    document.getElementById("setPinModalSub").textContent   = hasPin
        ? "Set a new 4-digit screen lock PIN"
        : "Tap 4 digits · you'll confirm them once";
    document.getElementById("setPinModalStep").textContent  = "STEP 1 — ENTER NEW PIN";
    const errEl = document.getElementById("setPinModalError");
    if (errEl) errEl.style.display = "none";
    document.getElementById("setPinModal").classList.add("active");
}
function _closeSetPinModal() {
    document.getElementById("setPinModal").classList.remove("active");
}

/* ── Forgot flow state ── */
let _forgotEntry = "", _setNewEntry = "", _setNewConfirm = "", _setNewPhase = "enter";

function _showLockSection(id) {
    ["lockBoxMain","lockBoxForgot","lockBoxSetNew"].forEach(sid => {
        document.getElementById(sid).style.display = sid === id ? "" : "none";
    });
}

function _resetForgotDots(isError) {
    _forgotEntry = "";
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("fvd" + i);
        if (d) d.className = "pin-dot" + (isError ? " error" : "");
    }
    const e = document.getElementById("forgotVerifyError");
    if (e && !isError) e.style.display = "none";
}
function _updateForgotDots() {
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("fvd" + i);
        if (d) d.className = "pin-dot" + (i < _forgotEntry.length ? " filled" : "");
    }
}

function _resetSetNewDots(isError) {
    if (_setNewPhase === "enter") _setNewEntry = "";
    else _setNewConfirm = "";
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("snd" + i);
        if (d) d.className = "pin-dot" + (isError ? " error" : "");
    }
}
function _updateSetNewDots() {
    const src = _setNewPhase === "confirm" ? _setNewConfirm : _setNewEntry;
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("snd" + i);
        if (d) d.className = "pin-dot" + (i < src.length ? " filled" : "");
    }
}

function setupLockScreen() {

    /* ── Lock Now ── */
    document.getElementById("lockNowBtn").addEventListener("click", function () {
        if (!hasLockPin()) {
            showToast("No PIN set", "Please set a Lock PIN first.", "warning");
            return;
        }
        showLockOverlay();
    });

    /* ── Set PIN button (sidebar) ── */
    document.getElementById("setPinBtn").addEventListener("click", _openSetPinModal);

    /* Set PIN modal numpad */
    document.querySelectorAll("#setPinModalNumpad [data-mpdigit]").forEach(btn => {
        btn.addEventListener("click", function () {
            const errEl = document.getElementById("setPinModalError");
            if (_mpPhase === "enter") {
                if (_mpEntry.length >= 4) return;
                _mpEntry += this.dataset.mpdigit;
                _updateMpDots();
                if (_mpEntry.length === 4) {
                    setTimeout(() => {
                        _mpPhase = "confirm"; _mpConfirm = "";
                        _updateMpDots();
                        document.getElementById("setPinModalStep").textContent = "STEP 2 — CONFIRM YOUR PIN";
                        if (errEl) errEl.style.display = "none";
                    }, 180);
                }
            } else {
                if (_mpConfirm.length >= 4) return;
                _mpConfirm += this.dataset.mpdigit;
                _updateMpDots();
                if (_mpConfirm.length === 4) {
                    if (_mpConfirm === _mpEntry) {
                        /* Save */
                        appLock.pin = _mpEntry;
                        saveLockState();
                        _closeSetPinModal();
                        showToast("PIN Saved", "Screen lock PIN has been saved to your account.", "success");
                    } else {
                        for (let i = 0; i < 4; i++) {
                            const d = document.getElementById("mpd" + i);
                            if (d) d.className = "pin-dot error";
                        }
                        if (errEl) { errEl.textContent = "PINs don't match. Try again."; errEl.style.display = "block"; }
                        setTimeout(() => { _mpPhase = "enter"; _mpEntry = ""; _mpConfirm = ""; _resetMpDots(); document.getElementById("setPinModalStep").textContent = "STEP 1 — ENTER NEW PIN"; }, 700);
                    }
                }
            }
        });
    });
    document.getElementById("setPinModalDel").addEventListener("click", () => { if (_mpPhase === "enter") _mpEntry = _mpEntry.slice(0,-1); else _mpConfirm = _mpConfirm.slice(0,-1); _updateMpDots(); });
    document.getElementById("setPinModalClear").addEventListener("click", () => { _mpPhase = "enter"; _mpEntry = ""; _mpConfirm = ""; _resetMpDots(); document.getElementById("setPinModalStep").textContent = "STEP 1 — ENTER NEW PIN"; });
    document.getElementById("setPinModalClose").addEventListener("click", _closeSetPinModal);

    /* ── Unlock numpad ── */
    document.querySelectorAll("#unlockNumpad [data-udigit]").forEach(btn => {
        btn.addEventListener("click", function () {
            if (_unlockEntry.length >= 4) return;
            _unlockEntry += this.dataset.udigit;
            _updateUnlockDots();
            if (_unlockEntry.length === 4) attemptUnlock();
        });
    });
    document.getElementById("unlockDelBtn").addEventListener("click", () => { _unlockEntry = _unlockEntry.slice(0,-1); _updateUnlockDots(); });
    document.getElementById("unlockClearBtn").addEventListener("click", () => _resetUnlockDots());

    /* ── Forgot PIN link ── */
    document.getElementById("forgotLockPinBtn").addEventListener("click", function () {
        const qpUser = typeof getQuickPinUsername === "function" ? getQuickPinUsername() : null;
        if (!qpUser) {
            showToast("No Quick PIN", "Set a Quick Login PIN first to use this recovery method.", "warning");
            return;
        }
        _resetForgotDots();
        _showLockSection("lockBoxForgot");
    });

    /* Forgot verify numpad */
    document.querySelectorAll("[data-fdigit]").forEach(btn => {
        btn.addEventListener("click", function () {
            if (_forgotEntry.length >= 4) return;
            _forgotEntry += this.dataset.fdigit;
            _updateForgotDots();
            if (_forgotEntry.length === 4) {
                const qpUser = getQuickPinUsername();
                if (qpUser && validateQuickPin(qpUser, _forgotEntry)) {
                    /* Verified — show set new PIN panel */
                    _setNewEntry = ""; _setNewConfirm = ""; _setNewPhase = "enter";
                    _resetSetNewDots();
                    document.getElementById("setNewPinStep").textContent = "STEP 1 — ENTER NEW PIN";
                    const errEl = document.getElementById("setNewPinError");
                    if (errEl) errEl.style.display = "none";
                    _showLockSection("lockBoxSetNew");
                } else {
                    _resetForgotDots(true);
                    document.getElementById("forgotVerifyError").style.display = "block";
                    setTimeout(() => _resetForgotDots(), 700);
                }
            }
        });
    });
    document.getElementById("forgotDelBtn").addEventListener("click", () => { _forgotEntry = _forgotEntry.slice(0,-1); _updateForgotDots(); });
    document.getElementById("forgotClearBtn").addEventListener("click", () => _resetForgotDots());
    document.getElementById("forgotBackBtn").addEventListener("click", () => { _resetForgotDots(); _showLockSection("lockBoxMain"); _resetUnlockDots(); });

    /* Set New PIN numpad (after forgot verify) */
    document.querySelectorAll("[data-ndigit]").forEach(btn => {
        btn.addEventListener("click", function () {
            const errEl = document.getElementById("setNewPinError");
            if (_setNewPhase === "enter") {
                if (_setNewEntry.length >= 4) return;
                _setNewEntry += this.dataset.ndigit;
                _updateSetNewDots();
                if (_setNewEntry.length === 4) {
                    setTimeout(() => {
                        _setNewPhase = "confirm"; _setNewConfirm = "";
                        _updateSetNewDots();
                        document.getElementById("setNewPinStep").textContent = "STEP 2 — CONFIRM YOUR PIN";
                        if (errEl) errEl.style.display = "none";
                    }, 180);
                }
            } else {
                if (_setNewConfirm.length >= 4) return;
                _setNewConfirm += this.dataset.ndigit;
                _updateSetNewDots();
                if (_setNewConfirm.length === 4) {
                    if (_setNewConfirm === _setNewEntry) {
                        appLock.pin = _setNewEntry;
                        saveLockState();
                        hideLockOverlay();
                        showToast("PIN Reset!", "Your new screen lock PIN has been saved.", "success");
                    } else {
                        for (let i = 0; i < 4; i++) { const d = document.getElementById("snd"+i); if(d) d.className="pin-dot error"; }
                        if (errEl) { errEl.textContent = "PINs don't match. Try again."; errEl.style.display = "block"; }
                        setTimeout(() => { _setNewPhase = "enter"; _setNewEntry = ""; _setNewConfirm = ""; _resetSetNewDots(); document.getElementById("setNewPinStep").textContent = "STEP 1 — ENTER NEW PIN"; }, 700);
                    }
                }
            }
        });
    });
    document.getElementById("setNewDelBtn").addEventListener("click", () => { if (_setNewPhase === "enter") _setNewEntry = _setNewEntry.slice(0,-1); else _setNewConfirm = _setNewConfirm.slice(0,-1); _updateSetNewDots(); });
    document.getElementById("setNewClearBtn").addEventListener("click", () => { _setNewPhase = "enter"; _setNewEntry = ""; _setNewConfirm = ""; _resetSetNewDots(); document.getElementById("setNewPinStep").textContent = "STEP 1 — ENTER NEW PIN"; });

}

function resetInactivityTimer() {

    clearTimeout(inactivityTimer);

    if (!hasLockPin()) return;

    inactivityTimer = setTimeout(function () {

        showLockOverlay();

    }, appLock.autoLockMinutes * 60 * 1000);

}

["click", "keydown", "mousemove", "touchstart"].forEach(evt => {

    document.addEventListener(evt, function () {

        if (!appLock.isLocked) resetInactivityTimer();

    });

});

/* ===============================
   DATE-WISE REPORT HISTORY PANEL
=============================== */

function renderHistoryPanel() {

    const container =

        document.getElementById("historyDateList");

    if (!container) return;

    container.innerHTML = "";

    const dates = getAllHistoryDates();

    if (dates.length === 0) {

        container.innerHTML =

            `<div class="text-muted small">No saved history yet.</div>`;

        return;

    }

    dates.forEach(dateKey => {

        const row = document.createElement("div");

        row.className = "history-date-row";

        const viewBtn = document.createElement("button");

        viewBtn.className = "btn btn-sm btn-outline-secondary history-date-btn";

        viewBtn.textContent = dateKey;

        viewBtn.addEventListener("click", function () {

            viewHistorySnapshot(dateKey);

        });

        const deleteBtn = document.createElement("button");

        deleteBtn.className = "btn btn-sm btn-outline-danger history-delete-btn";

        deleteBtn.innerHTML = `<i class="bi bi-trash"></i>`;

        deleteBtn.title = "Delete this saved report";

        deleteBtn.addEventListener("click", function () {

            if (!confirm(`Delete all saved report data for ${dateKey}? This cannot be undone.`)) {

                return;

            }

            deleteHistoryDate(dateKey);

        });

        row.appendChild(viewBtn);

        row.appendChild(deleteBtn);

        container.appendChild(row);

    });

}

function viewHistorySnapshot(dateKey) {

    const snapshot = getHistorySnapshot(dateKey);

    if (!snapshot) {

        alert("No data found for this date.");

        return;

    }

    const modalBody =

        document.getElementById("historyModalBody");

    let html = `<h5 class="mb-3">Report for ${dateKey}</h5>`;

    AUDIT_MODES.forEach(mode => {

        html += `<h6 class="mt-3">${mode}</h6>`;

        html += `<table class="table table-sm table-bordered">
            <thead><tr><th>Category</th><th>Report</th><th>Checked</th><th>Actual Vehicle Breakdown</th></tr></thead><tbody>`;

        REPORT_CATEGORIES.forEach(cat => {

            const catData = snapshot[mode] && snapshot[mode][cat];

            if (!catData) return;

            const matchingVehicle =
                VEHICLE_CLASSES.includes(cat) ? cat : null;

            const badges = [];

            if (matchingVehicle) {

                const matchCount =

                    (catData.vehicleCounts &&
                    catData.vehicleCounts[matchingVehicle]) || 0;

                badges.push(

                    `<span class="badge ${matchCount > 0 ? "bg-secondary" : "bg-light text-dark border"} me-1 mb-1">${matchingVehicle}: ${matchCount}</span>`

                );

            }

            VEHICLE_CLASSES.forEach(vehicle => {

                if (vehicle === matchingVehicle) return;

                const count =

                    catData.vehicleCounts &&
                    catData.vehicleCounts[vehicle];

                if (count > 0) {

                    badges.push(

                        `<span class="badge bg-secondary me-1 mb-1">${vehicle}: ${count}</span>`

                    );

                }

            });

            const breakdown =

                badges.length ?
                badges.join("") :
                `<span class="text-muted small">—</span>`;

            html += `<tr>
                <td>${cat}</td>
                <td>${catData.reportCount}</td>
                <td>${catData.transactions.length}</td>
                <td>${breakdown}</td>
            </tr>`;

        });

        html += `</tbody></table>`;

    });

    modalBody.innerHTML = html;

    const modal = new bootstrap.Modal(

        document.getElementById("historyModal")

    );

    modal.show();

}

/* ===============================
   CSV EXPORT
=============================== */

function escapeCsvField(value) {

    const str = String(value === undefined || value === null ? "" : value);

    if (/[",\n]/.test(str)) {

        return `"${str.replace(/"/g, '""')}"`;

    }

    return str;

}

function downloadCsv(filename, csvContent) {

    const blob = new Blob(

        ["\uFEFF" + csvContent],

        { type: "text/csv;charset=utf-8;" }

    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download = filename;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);

}

function exportCurrentCategoryCsv() {

    const transactions = getTransactions();

    if (transactions.length === 0) {

        alert("No transactions to export for this category.");

        return;

    }

    const rows = [

        ["Txn No", "Mode", "Category", "Actual Vehicle", "Comment", "Timestamp"]

    ];

    transactions.forEach(t => {

        rows.push([

            t.transactionNo,

            currentMode,

            currentCategory,

            t.actualVehicle,

            t.comment || "",

            t.timestamp || ""

        ]);

    });

    const csv = rows

        .map(row => row.map(escapeCsvField).join(","))

        .join("\n");

    downloadCsv(

        `toll-audit_${currentMode}_${currentCategory}_${getTodayKey()}.csv`,

        csv

    );

}

function exportFullAuditCsv() {

    const rows = [

        ["Mode", "Category", "Txn No", "Actual Vehicle", "Comment", "Timestamp"]

    ];

    let hasAny = false;

    AUDIT_MODES.forEach(mode => {

        REPORT_CATEGORIES.forEach(category => {

            const data = auditData[mode][category];

            data.transactions.forEach(t => {

                hasAny = true;

                rows.push([

                    mode,

                    category,

                    t.transactionNo,

                    t.actualVehicle,

                    t.comment || "",

                    t.timestamp || ""

                ]);

            });

        });

    });

    if (!hasAny) {

        alert("No transactions to export yet.");

        return;

    }

    const csv = rows

        .map(row => row.map(escapeCsvField).join(","))

        .join("\n");

    downloadCsv(

        `toll-audit_full-export_${getTodayKey()}.csv`,

        csv

    );

}

function setupExportButtons() {

    const currentBtn =

        document.getElementById("exportCurrentCsvBtn");

    const fullBtn =

        document.getElementById("exportFullCsvBtn");

    if (currentBtn) {

        currentBtn.addEventListener("click", exportCurrentCategoryCsv);

    }

    if (fullBtn) {

        fullBtn.addEventListener("click", exportFullAuditCsv);

    }

}

/* ===============================
   PAGE LOAD
=============================== */

/* ===============================
   VEHICLE BUTTON — CLICK ANIMATION + SOUND
=============================== */

function setupVehicleAnimations() {

    /* Tiny click sound via Web Audio API — no external files needed */
    function playClickSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(600, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.18, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.1);
        } catch (e) { /* AudioContext not available — silently skip */ }
    }

    document.querySelectorAll(".vehicle-btn").forEach(btn => {

        btn.addEventListener("click", function () {

            /* Remove old animation classes */
            this.classList.remove("btn-pop", "btn-clicked");

            /* Force reflow so animation restarts */
            void this.offsetWidth;

            this.classList.add("btn-pop", "btn-clicked");

            this.addEventListener("animationend", () => {
                this.classList.remove("btn-pop", "btn-clicked");
            }, { once: true });

            playClickSound();

        });

    });

}

/* ═══════════════════════════════════════════════════════════
   AUDIT MATRIX  — renderAuditMatrix / setupAuditMatrix
═══════════════════════════════════════════════════════════ */

/* Friendly display names for column headers */
const AM_COL_LABELS = {
    "Car":          "CAR",
    "LCV":          "LCV / MINIBUS",
    "Truck 2 Axle": "Truck 2 Axle",
    "Truck 3 Axle": "Truck 3 Axle",
    "MAV":          "MAV 4–6 Axle",
    "Auto":         "Auto",
    "Tractor":      "Tractor",
    "Bus 2 Axle":   "Bus 2 Axle",
};

/* Friendly row labels (maps internal key → display name) */
const AM_ROW_LABELS = {
    "Car":               "CAR",
    "LCV":               "LCV / MINIBUS",
    "Truck 2 Axle":      "Truck 2 Axle",
    "Truck 3 Axle":      "Truck 3 Axle",
    "MAV":               "MAV 4 – 6 Axle",
    "Auto":              "Auto",
    "Tractor":           "Tractor",
    "Bus 2 Axle":        "Bus 2 Axle",
    "Minibus":           "Minibus",
    "Oversized Vehicle": "Oversized Vehicle",
    "Forcefully":        "ForceFully",
    "Fake Violation":    "Fake Transaction (Violation)",
    "Fake Exemption":    "Fake Transaction (Exemption)",
    "Bike":              "Bike",
    "Ambulance":         "Ambulance",
    "Police":            "Police",
    "Government Vehicle":"Govt. Vehicle",
    "Army Vehicle":      "Army Vehicle",
    "JCB":               "JCB",
    "Has Pass":          "PASS Monthly / Local",
    "Paid (Cash)":       "Already Paid — Cash",
    "Paid (ETC)":        "Already Paid — ETC",
    "Paid (Digital)":    "Already Paid — Digital",
};

function renderAuditMatrix(mode) {

    if (typeof buildAuditMatrix !== "function") return;

    const m = buildAuditMatrix(mode);

    /* ── Summary chips ── */
    const summaryBar = document.getElementById("amSummaryBar");
    if (summaryBar) {
        const acc = m.grandTotal > 0
            ? ((m.correctTotal / m.grandTotal) * 100).toFixed(1) + "%"
            : "–";
        summaryBar.innerHTML = `
            <span class="am-chip am-chip-total"><i class="bi bi-hash"></i> Total Audited: <strong>${m.grandTotal}</strong></span>
            <span class="am-chip am-chip-correct"><i class="bi bi-check-circle-fill"></i> Correctly Classified: <strong>${m.correctTotal}</strong></span>
            <span class="am-chip am-chip-wrong"><i class="bi bi-exclamation-triangle-fill"></i> Misclassified: <strong>${m.wrongTotal}</strong></span>
            <span class="am-chip am-chip-acc"><i class="bi bi-graph-up"></i> Accuracy: <strong>${acc}</strong></span>
        `;
    }

    /* ── Build <thead> ── */
    const thead = document.getElementById("amThead");
    if (thead) {
        /* Row 1: column names (system report classes) */
        let row1 = `<tr class="am-col-header">`;
        row1 += `<th class="am-corner-cell">Actual Class after<br>Validate ↓</th>`;
        m.cols.forEach(cat => {
            row1 += `<th>${AM_COL_LABELS[cat] || cat}</th>`;
        });
        row1 += `<th>Total</th></tr>`;

        /* Row 2: Yellow — system report counts (one cell per col, no rowspan issues) */
        let row2 = `<tr class="am-count-row">`;
        row2 += `<th class="am-corner-cell">Report Count →</th>`;
        m.cols.forEach(cat => {
            const rc = m.reportCounts[cat] || 0;
            row2 += `<th>${rc > 0 ? rc : "–"}</th>`;
        });
        const totalReport = m.cols.reduce((s, c) => s + (m.reportCounts[c] || 0), 0);
        row2 += `<th>${totalReport > 0 ? totalReport : "–"}</th></tr>`;

        thead.innerHTML = row1 + row2;
    }

    /* ── Build <tbody> ── */
    const tbody = document.getElementById("amTbody");
    if (tbody) {
        let html = "";
        m.rows.forEach(row => {
            const rowTotal = m.rowTotals[row] || 0;
            /* Skip rows that have zero in every cell AND zero row total */
            const hasAny = rowTotal > 0;
            html += `<tr${!hasAny ? ' class="am-row-empty"' : ""}>`;
            html += `<td class="am-row-label">${AM_ROW_LABELS[row] || row}</td>`;
            m.cols.forEach(cat => {
                const val = m.cells[cat][row] || 0;
                const diagRows = (m.diagonalMap[cat] || [cat]);
                const isDiag = diagRows.includes(row);
                let cls = "am-cell-zero";
                if (val > 0 && isDiag)   cls = "am-cell-diagonal";
                else if (val > 0)        cls = "am-cell-mismatch";
                html += `<td class="${cls}">${val > 0 ? val : ""}</td>`;
            });
            html += `<td class="am-row-total">${rowTotal > 0 ? rowTotal : "0"}</td>`;
            html += `</tr>`;
        });
        tbody.innerHTML = html;
    }

    /* ── Build <tfoot> ── */
    const tfoot = document.getElementById("amTfoot");
    if (tfoot) {
        let row = `<tr><td class="am-corner-cell">Total</td>`;
        m.cols.forEach(cat => {
            const ct = m.colTotals[cat] || 0;
            row += `<td>${ct}</td>`;
        });
        row += `<td>${m.grandTotal}</td></tr>`;
        tfoot.innerHTML = row;
    }

}

/* ── Export helpers ── */

function _amBuildRows(m) {
    /* Returns array-of-arrays for the matrix, used by both Excel and PDF */
    const header  = ["Actual Class after Validate", ...m.cols.map(c => AM_COL_LABELS[c] || c), "Total"];
    const rcRow   = ["Report Count (System)", ...m.cols.map(c => m.reportCounts[c] || 0),
                     m.cols.reduce((s, c) => s + (m.reportCounts[c] || 0), 0)];
    const dataRows = m.rows.map(row =>
        [AM_ROW_LABELS[row] || row, ...m.cols.map(cat => m.cells[cat][row] || 0), m.rowTotals[row] || 0]
    );
    const footRow = ["Total", ...m.cols.map(c => m.colTotals[c] || 0), m.grandTotal];
    return [header, rcRow, ...dataRows, footRow];
}

function _amExportExcel(mode) {

    if (typeof XLSX === "undefined") {
        showToast("Error", "XLSX library not loaded.", "danger"); return;
    }

    const m    = buildAuditMatrix(mode);
    const rows = _amBuildRows(m);
    const ws   = XLSX.utils.aoa_to_sheet(rows);

    /* Column widths */
    ws["!cols"] = [{ wch: 30 }, ...m.cols.map(() => ({ wch: 14 })), { wch: 10 }];

    /* Style the header row yellow */
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let C = range.s.c; C <= range.e.c; C++) {
        const hCell = XLSX.utils.encode_cell({ r: 0, c: C });
        if (!ws[hCell]) ws[hCell] = { v: "" };
        ws[hCell].s = { fill: { fgColor: { rgb: "0F172A" } }, font: { bold: true, color: { rgb: "FFFFFF" } } };
        const rcCell = XLSX.utils.encode_cell({ r: 1, c: C });
        if (!ws[rcCell]) ws[rcCell] = { v: "" };
        ws[rcCell].s = { fill: { fgColor: { rgb: "FEF08A" } }, font: { bold: true, color: { rgb: "713F12" } } };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${mode} Matrix`);
    XLSX.writeFile(wb, `audit-matrix-${mode.toLowerCase()}-${selectedAuditDate || "today"}.xlsx`);

}

function _amExportPdf(mode) {

    const m    = buildAuditMatrix(mode);
    const rows = _amBuildRows(m);
    const date = selectedAuditDate || "Today";

    /* Build a self-contained HTML page and print it */
    const colW  = 90;
    const lblW  = 200;

    const thStyle   = `style="background:#0f172a;color:#fff;font-weight:800;padding:7px 10px;border:1px solid #334155;white-space:nowrap;font-size:11px;"`;
    const rcStyle   = `style="background:#fef08a;color:#713f12;font-weight:800;padding:7px 10px;border:1px solid #d1d5db;text-align:center;font-size:12px;"`;
    const rcLblStyle= `style="background:#fef9c3;color:#78350f;font-weight:700;padding:7px 10px;border:1px solid #d1d5db;font-size:11px;"`;
    const ftStyle   = `style="background:#0f172a;color:#fff;font-weight:800;padding:7px 10px;border:1px solid #334155;text-align:center;font-size:12px;"`;
    const lblStyle  = `style="background:#f8fafc;font-weight:700;padding:7px 12px;border:1px solid #e2e8f0;white-space:nowrap;font-size:11px;text-align:left;"`;

    function cellStyle(val, row, cat) {
        const diagRows = (m.diagonalMap[cat] || [cat]);
        const isDiag   = diagRows.includes(row);
        const bg = val > 0 && isDiag   ? "#fef9c3"
                 : val > 0             ? "#fee2e2"
                 :                       "#f8fafc";
        const color = val > 0 && isDiag   ? "#713f12"
                    : val > 0             ? "#991b1b"
                    :                       "#cbd5e1";
        return `style="background:${bg};color:${color};font-weight:700;padding:7px 10px;border:1px solid #e2e8f0;text-align:center;font-size:12px;"`;
    }

    let tHead = `<tr><th ${thStyle} style="background:#1e1b4b;color:#a5b4fc;font-size:11px;padding:7px 10px;border:1px solid #334155;">Actual Class after Validate ↓</th>`;
    m.cols.forEach(cat => { tHead += `<th ${thStyle}>${AM_COL_LABELS[cat] || cat}</th>`; });
    tHead += `<th ${thStyle}>Total</th></tr>`;

    let tRc = `<tr><td ${rcLblStyle}>Report Count →</td>`;
    m.cols.forEach(cat => {
        const rc = m.reportCounts[cat] || 0;
        tRc += `<td ${rcStyle}>${rc > 0 ? rc : "–"}</td>`;
    });
    const totalReport = m.cols.reduce((s, c) => s + (m.reportCounts[c] || 0), 0);
    tRc += `<td ${rcStyle}>${totalReport > 0 ? totalReport : "–"}</td></tr>`;

    let tBody = "";
    m.rows.forEach(row => {
        const rowTotal = m.rowTotals[row] || 0;
        tBody += `<tr><td ${lblStyle}>${AM_ROW_LABELS[row] || row}</td>`;
        m.cols.forEach(cat => {
            const val = m.cells[cat][row] || 0;
            tBody += `<td ${cellStyle(val, row, cat)}>${val > 0 ? val : ""}</td>`;
        });
        tBody += `<td style="background:#f1f5f9;color:#1e1b4b;font-weight:800;padding:7px 10px;border:1px solid #e2e8f0;text-align:center;font-size:12px;">${rowTotal > 0 ? rowTotal : "0"}</td></tr>`;
    });

    let tFoot = `<tr><td ${ftStyle} style="text-align:left;color:#a5b4fc;font-size:11px;">Total</td>`;
    m.cols.forEach(cat => { tFoot += `<td ${ftStyle}>${m.colTotals[cat] || 0}</td>`; });
    tFoot += `<td ${ftStyle}>${m.grandTotal}</td></tr>`;

    const acc = m.grandTotal > 0
        ? ((m.correctTotal / m.grandTotal) * 100).toFixed(1) + "%" : "–";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Audit Matrix — ${mode} — ${date}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; margin: 24px; color: #0f172a; }
  h1   { font-size: 18px; font-weight: 800; margin: 0 0 4px; }
  .sub { font-size: 12px; color: #64748b; margin: 0 0 16px; }
  .chips { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
  .chip  { padding: 4px 12px; border-radius: 50px; font-size: 11px; font-weight: 700; }
  .ct  { background:#ede9fe; color:#6d28d9; }
  .cc  { background:#dcfce7; color:#166534; }
  .cw  { background:#fee2e2; color:#991b1b; }
  .ca  { background:#f0f9ff; color:#0369a1; }
  table { border-collapse: collapse; width: 100%; }
  @media print { body { margin: 10px; } }
</style></head><body>
<h1>Audit Validation Matrix — ${mode}</h1>
<p class="sub">Date: ${date} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</p>
<div class="chips">
  <span class="chip ct">Total Audited: ${m.grandTotal}</span>
  <span class="chip cc">Correctly Classified: ${m.correctTotal}</span>
  <span class="chip cw">Misclassified: ${m.wrongTotal}</span>
  <span class="chip ca">Accuracy: ${acc}</span>
</div>
<table><thead>${tHead}${tRc}</thead><tbody>${tBody}</tbody><tfoot>${tFoot}</tfoot></table>
</body></html>`;

    const win = window.open("", "_blank");
    if (!win) { showToast("Popup Blocked", "Allow popups for PDF export.", "warning"); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);

}

function setupAuditMatrix() {

    let _amMode = "Violation";

    const modal = document.getElementById("auditMatrixModal");
    if (!modal) return;

    /* Re-render whenever modal opens */
    modal.addEventListener("show.bs.modal", function () {
        renderAuditMatrix(_amMode);
    });

    /* Mode tabs */
    modal.querySelectorAll(".am-mode-tab").forEach(tab => {
        tab.addEventListener("click", function () {
            _amMode = this.dataset.amMode;
            modal.querySelectorAll(".am-mode-tab").forEach(t => t.classList.remove("active"));
            this.classList.add("active");
            renderAuditMatrix(_amMode);
        });
    });

    /* Export — Excel */
    const exportXlsBtn = document.getElementById("amExportXlsBtn");
    if (exportXlsBtn) {
        exportXlsBtn.addEventListener("click", () => _amExportExcel(_amMode));
    }

    /* Export — PDF */
    const exportPdfBtn = document.getElementById("amExportPdfBtn");
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener("click", () => _amExportPdf(_amMode));
    }

}

document.addEventListener("DOMContentLoaded", function () {

    applyTheme(loadThemePreference());

    loadAuditData();

    loadLockState();

    initializeUI();

    setupThemeToggle();

    setupLockScreen();

    setupHistoryFilter();

    setupExportButtons();

    renderHistoryPanel();

    resetInactivityTimer();

    setupVehicleAnimations();

    setupAuditMatrix();

});