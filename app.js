/* ==========================================================
   Toll Audit Assistant
   app.js
   PART 1
========================================================== */

/* ===============================
   START APPLICATION
=============================== */

document.addEventListener("DOMContentLoaded", () => {

    /* loadAuditData() and initializeUI() are called by ui.js's
       own DOMContentLoaded handler — calling them again here
       would double-initialize all counts and event listeners.
       app.js only needs to wire up button events. */

    initializeEvents();

});

/* ===============================
   EVENT REGISTRATION
=============================== */

function initializeEvents() {

    /* Save Report */

    const dropdownSaveBtn =
        document.getElementById("saveReportBtn");

    if (dropdownSaveBtn) {

        dropdownSaveBtn.addEventListener("click", saveAllReportCounts);

    }

    const visibleSaveBtn =
        document.getElementById("saveReportBtnVisible");

    if (visibleSaveBtn) {

        visibleSaveBtn.addEventListener("click", saveAllReportCounts);

    }

    /* Live Report Total */
    setupReportTotalListener();

    /* Reset Buttons */

    document
        .getElementById("resetReportBtn")
        .addEventListener("click", resetCurrentCategoryReport);

    document
        .getElementById("resetTransactionBtn")
        .addEventListener("click", resetCurrentCategoryTransactions);

    document
        .getElementById("resetModeBtn")
        .addEventListener("click", resetModeData);

    /* Next Category */

    const nextCategoryBtn =
        document.getElementById("nextCategoryBtn");

    if (nextCategoryBtn) {

        nextCategoryBtn.addEventListener("click", goToNextCategory);

    }

    /* Audit Mode */

    document
        .querySelectorAll("input[name='auditMode']")
        .forEach(radio => {

            radio.addEventListener("change", changeAuditMode);

        });

    /* Vehicle Buttons */

    document
        .querySelectorAll(".vehicle-btn")
        .forEach(button => {

            button.addEventListener("click", function () {

                const vehicle = this.dataset.vehicle;

                /* Skip if no data-vehicle — e.g. the Paid button
                   which has its own separate handler */

                if (!vehicle) return;

                vehicleButtonClicked(vehicle);

            });

        });

    /* Paid Button — opens payment method modal */

    const paidBtn = document.getElementById("paidBtn");

    if (paidBtn) {

        paidBtn.addEventListener("click", function () {

            if (typeof bootstrap === "undefined") return;

            bootstrap.Modal.getOrCreateInstance(
                document.getElementById("paidModal")
            ).show();

        });

    }

    /* Paid Modal — payment method buttons */

    document
        .querySelectorAll(".vehicle-btn-paid")
        .forEach(btn => {

            btn.addEventListener("click", function () {

                const method = this.dataset.payment;  /* Cash | ETC | Digital */

                /* Close the modal first */

                const modalEl = document.getElementById("paidModal");

                if (typeof bootstrap !== "undefined" && modalEl) {

                    bootstrap.Modal.getOrCreateInstance(modalEl).hide();

                }

                /* Record as "Paid (Cash)" / "Paid (ETC)" / "Paid (Digital)" */

                vehicleButtonClicked("Paid (" + method + ")");

            });

        });

}

/* ===============================
   CHANGE AUDIT MODE
=============================== */

function changeAuditMode(event) {

    currentMode = event.target.value;

    /* Update active pill highlight */

    document.querySelectorAll(".mode-pill").forEach(pill => {

        const radio = pill.querySelector("input[type='radio']");

        pill.classList.toggle("active", radio && radio.checked);

    });

    refreshUI();

}

/* ===============================
   LIVE REPORT TOTAL
=============================== */

function setupReportTotalListener() {

    const REPORT_IDS = [
        "reportCar", "reportLCV", "reportBus2Axle",
        "reportTruck2", "reportTruck3", "reportMAV",
        "reportTractor", "reportAuto"
    ];

    function updateReportTotal() {
        const total = REPORT_IDS.reduce((sum, id) => {
            const el = document.getElementById(id);
            return sum + (el ? (Number(el.value) || 0) : 0);
        }, 0);
        const totalEl = document.getElementById("reportTotalCount");
        if (totalEl) totalEl.textContent = total;
    }

    REPORT_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", updateReportTotal);
    });

    /* Run once on init so it reflects pre-filled values */
    updateReportTotal();

}

/* ===============================
   SAVE REPORT COUNTS
=============================== */

function saveAllReportCounts() {

    auditData[currentMode]["Car"].reportCount =
        Number(document.getElementById("reportCar").value);

    auditData[currentMode]["LCV"].reportCount =
        Number(document.getElementById("reportLCV").value);

    auditData[currentMode]["Bus 2 Axle"].reportCount =
        Number(document.getElementById("reportBus2Axle").value);

    auditData[currentMode]["Truck 2 Axle"].reportCount =
        Number(document.getElementById("reportTruck2").value);

    auditData[currentMode]["Truck 3 Axle"].reportCount =
        Number(document.getElementById("reportTruck3").value);

    auditData[currentMode]["MAV"].reportCount =
        Number(document.getElementById("reportMAV").value);

    auditData[currentMode]["Tractor"].reportCount =
        Number(document.getElementById("reportTractor").value);

    auditData[currentMode]["Auto"].reportCount =
        Number(document.getElementById("reportAuto").value);

    saveAuditData();

    refreshUI();

    if (typeof showToast === "function") {
        showToast("Report Saved", "All report counts saved successfully.", "success");
    } else {
        alert("Report counts saved successfully.");
    }

    currentCategory = REPORT_CATEGORIES[0];

    collapseReportSetupPanel();

    refreshUI();

}

/* ===============================
   COLLAPSE REPORT SETUP PANEL
=============================== */

function collapseReportSetupPanel() {

    const panel =
        document.getElementById("reportSetupBody");

    if (!panel) return;

    if (typeof bootstrap === "undefined") return;

    const collapseInstance =
        bootstrap.Collapse.getOrCreateInstance(panel, {

            toggle: false

        });

    collapseInstance.hide();

}

/* ===============================
   VEHICLE BUTTON
=============================== */

function vehicleButtonClicked(vehicle) {

    /* If no report count has been set yet, prompt the user to do so */

    if (getReportCount() === 0) {

        alert(
            "No report count set for this category yet.\n\n" +
            "Please open Report Setup (▸ Report Setup at the top) and enter the count for "  +
            currentCategory + ", then click Save."
        );

        return;

    }

    const success =
        addTransaction(vehicle);

    if (!success) {

        if (typeof showToast === "function") {
            showToast("Category Complete", `"${currentCategory}" is done. Move to next category.`, "warning");
        } else {
            alert("Report count completed for this category.");
        }

        return;

    }

    saveAuditData();

    refreshUI();

    handleCategoryCompletion();

}

/* ===============================
   AUTO-ADVANCE ON COMPLETION
   Skips categories whose reportCount
   is 0, shows one toast listing them.
=============================== */

function handleCategoryCompletion() {

    const isComplete =
        getReportCount() > 0 &&
        getRemainingCount() === 0;

    if (!isComplete) return;

    const currentIndex = REPORT_CATEGORIES.indexOf(currentCategory);

    /* Gather all upcoming categories that have reportCount === 0 */
    const skipped = [];
    let nextNonZeroIndex = -1;

    for (let i = currentIndex + 1; i < REPORT_CATEGORIES.length; i++) {

        const cat = REPORT_CATEGORIES[i];
        const rc  = auditData[currentMode]
                    && auditData[currentMode][cat]
                    ? (auditData[currentMode][cat].reportCount || 0)
                    : 0;

        if (rc === 0) {
            skipped.push(cat);
        } else {
            nextNonZeroIndex = i;
            break;
        }

    }

    /* Show skipped toast if any were skipped */
    if (skipped.length > 0 && typeof showToast === "function") {
        showToast(
            "Categories Skipped",
            `${skipped.join(", ")} — report count 0 tha, system ne skip kar diya.`,
            "warning",
            6000
        );
    }

    if (nextNonZeroIndex !== -1) {

        /* Advance to next non-zero category */
        const nextCategory = REPORT_CATEGORIES[nextNonZeroIndex];

        const lbl = document.getElementById("nextCatNameLabel");
        if (lbl) lbl.textContent = "→ " + nextCategory;

        if (typeof showToast === "function") {
            showToast(`${currentCategory} ✓`, `Moving to: ${nextCategory}`, "success");
        }

        currentCategory = nextCategory;

        refreshUI();

    } else {

        /* No more non-zero categories — all done */
        showAuditCompleteOverlay(currentMode);

    }

}

/* ===============================
   AUDIT COMPLETE OVERLAY
   Full-screen celebration shown when
   all categories in a mode are done.
=============================== */

/* Returns true when every category in the given mode has been
   fully audited (reportCount > 0 and all transactions recorded). */
function isModeDone(mode) {

    const bucket = auditData[mode];

    return REPORT_CATEGORIES.every(cat => {

        const data = bucket && bucket[cat];

        if (!data || data.reportCount === 0) return true; /* 0 = not applicable, skip */

        return data.transactions.length >= data.reportCount;

    });

}

/* Returns true only when at least one mode has reportCount data
   AND both Violation and Exemption are fully audited. */
function isBothModesDone() {

    const hasData = AUDIT_MODES.some(mode =>
        REPORT_CATEGORIES.some(cat => {
            const data = auditData[mode] && auditData[mode][cat];
            return data && data.reportCount > 0;
        })
    );

    return hasData && AUDIT_MODES.every(m => isModeDone(m));

}

function showAuditCompleteOverlay(mode) {

    /* Remove any existing overlay */
    const old = document.getElementById("auditCompleteOverlay");
    if (old) old.remove();

    const bothDone = isBothModesDone();

    const overlay = document.createElement("div");
    overlay.id = "auditCompleteOverlay";
    overlay.className = "audit-complete-overlay";

    overlay.innerHTML = `
        <div class="audit-complete-card">
            <div class="audit-complete-icon">${bothDone ? "🏆" : "🎉"}</div>
            <h2 class="audit-complete-title">${bothDone ? "Full Audit Complete!" : mode + " Audit Complete!"}</h2>
            <p class="audit-complete-sub">${
                bothDone
                    ? "Violation <strong>aur</strong> Exemption dono complete ho gaye!<br>Abhi report save karo."
                    : "Saari categories check ho gayi hain.<br>Badiya kaam kiya!"
            }</p>
            <div class="audit-complete-actions">
                <button class="audit-complete-btn-primary" id="auditCompleteSaveBtn">
                    <i class="bi bi-cloud-upload-fill"></i> Save Audit Log
                </button>
                <button class="audit-complete-btn-secondary" id="auditCompleteDismissBtn">
                    <i class="bi bi-x"></i> Dismiss
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    /* Animate in */
    requestAnimationFrame(() => overlay.classList.add("active"));

    document.getElementById("auditCompleteDismissBtn").addEventListener("click", () => {
        overlay.classList.remove("active");
        setTimeout(() => overlay.remove(), 350);
        /* If both modes done, show a persistent save reminder toast */
        if (bothDone && typeof showToast === "function") {
            showToast(
                "⚠️ Don't forget to save!",
                "Dono modes done hain — Save Audit Log click karo.",
                "warning",
                8000
            );
        }
    });

    document.getElementById("auditCompleteSaveBtn").addEventListener("click", () => {
        overlay.classList.remove("active");
        setTimeout(() => overlay.remove(), 350);
        /* Trigger the Save Audit Log button */
        const saveBtn = document.getElementById("submitAuditLogBtn");
        if (saveBtn) saveBtn.click();
    });

}
/* ==========================================================
   Toll Audit Assistant
   app.js
   PART 2
========================================================== */

/* ===============================
   NEXT CATEGORY
=============================== */

function goToNextCategory() {

    const currentIndex =
        REPORT_CATEGORIES.indexOf(currentCategory);

    const nextIndex =
        currentIndex + 1;

    if (nextIndex >= REPORT_CATEGORIES.length) {

        alert("All categories for this mode are complete.");

        return;

    }

    currentCategory =
        REPORT_CATEGORIES[nextIndex];

    refreshUI();

}

/* ===============================
   RESET REPORT COUNT
=============================== */

function resetCurrentCategoryReport() {

    if (!confirm(`Reset report count for "${currentCategory}"?`)) {
        return;
    }

    resetReportCount();

    saveAuditData();

    refreshUI();

}

/* ===============================
   RESET TRANSACTIONS
=============================== */

function resetCurrentCategoryTransactions() {

    if (!confirm(`Delete all transactions for "${currentCategory}"?`)) {
        return;
    }

    resetTransactions();

    saveAuditData();

    refreshUI();

}

/* ===============================
   RESET CURRENT MODE
=============================== */

function resetModeData() {

    if (!confirm(`Reset all data for "${currentMode}" mode?`)) {
        return;
    }

    resetCurrentMode();

    saveAuditData();

    refreshUI();

}

/* ===============================
   AUTO SAVE
=============================== */

function autoSave() {

    saveAuditData();

}

/* ===============================
   REFRESH APPLICATION
=============================== */

function updateApplication() {

    refreshUI();

    autoSave();

}

/* ===============================
   OPTIONAL HELPERS
=============================== */

function getSelectedMode() {

    return currentMode;

}

function getSelectedCategory() {

    return currentCategory;

}

/* ===============================
   EXPORT FOR FUTURE
=============================== */

window.TollAudit = {

    refresh: refreshUI,

    save: saveAuditData,

    load: loadAuditData,

    update: updateApplication

};