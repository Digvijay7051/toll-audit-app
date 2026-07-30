/* ==========================================================
   Toll Audit Assistant
   sheets.js

   Audit Log — Save & Load from Firebase Firestore.

   Ab Google Sheets ki zaroorat nahi. Audit data seedha
   aapke Firebase account ke under save hoga:
     users/{uid}/auditLogs/{dateKey}

   Kisi bhi PC se login karo aur apna poora audit history
   dekho — "View Audit History" button se.
========================================================== */

/* ===============================
   BUILD ROWS
   Flat list of all transactions for
   a given date bucket.
=============================== */

function buildAuditRows(bucket) {

    const rows = [];

    AUDIT_MODES.forEach((mode) => {

        const modeData = bucket[mode];

        if (!modeData) return;

        REPORT_CATEGORIES.forEach((cat) => {

            const catData = modeData[cat];

            if (!catData) return;

            const reportCount  = catData.reportCount  || 0;
            const transactions = catData.transactions || [];

            transactions.forEach((txn) => {

                let timeStr = "";

                if (txn.timestamp) {

                    const d = new Date(txn.timestamp);

                    timeStr = d.toLocaleTimeString("en-IN", {
                        hour:   "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        hour12: true
                    });

                }

                rows.push({
                    txnNo:       txn.transactionNo || "",
                    time:        timeStr,
                    mode:        mode,
                    category:    cat,
                    vehicle:     txn.actualVehicle || txn.vehicle || "",
                    reportCount: reportCount,
                    comment:     txn.comment || ""
                });

            });

        });

    });

    return rows;

}

/* ===============================
   BUILD REPORT COUNTS SNAPSHOT
   Returns { mode: { cat: { reportCount, checkedCount } } }
   so saved history always carries the full count data.
=============================== */

function buildReportCountsSnapshot(bucket) {

    const snapshot = {};

    AUDIT_MODES.forEach((mode) => {

        snapshot[mode] = {};

        const modeData = bucket[mode];

        REPORT_CATEGORIES.forEach((cat) => {

            const catData = (modeData && modeData[cat]) || {};

            snapshot[mode][cat] = {
                reportCount:  catData.reportCount           || 0,
                checkedCount: (catData.transactions || []).length,
                vehicleCounts: catData.vehicleCounts        || {}
            };

        });

    });

    return snapshot;

}

/* ===============================
   VALIDATE ALL COUNTS MATCH
   Returns array of mismatch objects:
   { mode, category, reportCount, checkedCount }
   Empty array = all OK to save.
=============================== */

function validateCountsMatch(bucket) {

    const mismatches = [];

    AUDIT_MODES.forEach((mode) => {

        const modeData = bucket[mode];

        REPORT_CATEGORIES.forEach((cat) => {

            const catData = (modeData && modeData[cat]) || {};

            const reportCount  = catData.reportCount           || 0;
            const checkedCount = (catData.transactions || []).length;

            /* If reportCount is 0, this category was not applicable — skip */
            if (reportCount === 0) return;

            if (checkedCount !== reportCount) {

                mismatches.push({ mode, category: cat, reportCount, checkedCount });

            }

        });

    });

    return mismatches;

}

/* ===============================
   SUBMIT AUDIT LOG
   Saves audit to Firestore under the
   user's own account. Replaces old
   Google Sheets approach entirely.
   Returns { success, message }
=============================== */

/* prebuilt: optional { rows, snapshot } passed from the button handler
   when data was already built during the notes prompt — skips rebuild. */
async function submitAuditToSheet(notes, prebuilt) {

    const date   = selectedAuditDate || getTodayKey();
    const bucket = auditDataStore[date];

    if (!bucket) {
        return { success: false, message: "Is date ka koi audit data nahi mila." };
    }

    /* Validation (fast — synchronous) */
    const mismatches = validateCountsMatch(bucket);
    if (mismatches.length > 0) {
        const lines = mismatches.map(m =>
            `  • ${m.mode} › ${m.category}: Report=${m.reportCount}, Checked=${m.checkedCount} (${m.reportCount - m.checkedCount} baki)`
        );
        return {
            success: false,
            message:
                "⚠️ Save nahi ho sakta — kuch categories abhi bhi incomplete hain:\n\n" +
                lines.join("\n") +
                "\n\nPehle in sabhi categories ka audit pura karo, phir save karo."
        };
    }

    /* Use pre-built data if caller already computed it, otherwise build now */
    const rows     = (prebuilt && prebuilt.rows)     || buildAuditRows(bucket);
    const snapshot = (prebuilt && prebuilt.snapshot) || buildReportCountsSnapshot(bucket);

    if (rows.length === 0) {
        return { success: false, message: "Koi transaction nahi mila. Pehle kuch vehicles add karo." };
    }

    if (typeof fbSaveAuditLog !== "function") {
        return { success: false, message: "Firebase function load nahi hua. Page reload karke try karo." };
    }

    if (typeof fbAuth !== "undefined" && fbAuth && !fbAuth.currentUser) {
        return { success: false, message: "Aap logged in nahi hain. Please sign in karke dobara try karo." };
    }

    const result = await fbSaveAuditLog(date, {
        notes:         notes    || "",
        rows:          rows,
        reportCounts:  snapshot
    });

    if (!result.ok) {
        let hint = "Internet connection check karo aur dobara try karo.";
        if (result.code === "not-signed-in")     hint = "Aap logged out ho gaye hain. Page reload karke dobara sign in karo.";
        if (result.code === "sdk-not-ready")     hint = "Firebase load nahi hua. Page reload karke try karo.";
        if (result.code === "permission-denied") hint = "Permission denied — Firestore rules check karo ya admin se contact karo.";
        return {
            success: false,
            message: `Firestore mein save nahi hua. ${hint}${result.message ? `\n\nError: ${result.message}` : ""}`
        };
    }

    return {
        success: true,
        message: `✅ ${rows.length} transaction${rows.length !== 1 ? "s" : ""} save ho gaya!\n\nAb tum kisi bhi PC se login karke "View Audit History" se is date ka audit dekh sakte ho.`
    };

}

/* ===============================
   RENDER AUDIT LOG DETAIL
   Shows one date's transactions inside
   the #auditLogDetailBody element.
=============================== */

/* ===============================
   FORMAT DATE KEY → "21 July 2026"
=============================== */

function formatAuditDateKey(dateKey) {

    /* dateKey is "YYYY-MM-DD" */
    const parts = dateKey.split("-");

    if (parts.length !== 3) return dateKey;

    const months = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
    ];

    const day   = parseInt(parts[2], 10);
    const month = months[parseInt(parts[1], 10) - 1] || parts[1];
    const year  = parts[0];

    return `${day} ${month} ${year}`;

}

/* ===============================
   RENDER AUDIT LOG DETAIL
=============================== */

function renderAuditLogDetail(dateKey, logData) {

    const body = document.getElementById("auditLogDetailBody");

    if (!body) return;

    if (!logData || !logData.rows || logData.rows.length === 0) {
        body.innerHTML = "<p class='text-muted'>Is date ka koi data nahi mila.</p>";
        return;
    }

    const rows = logData.rows;
    const prettyDate = formatAuditDateKey(dateKey);

    let html = `
        <p class="text-muted small mb-3">
            <strong>${prettyDate}</strong> — ${rows.length} transactions
            ${logData.notes ? `<br>Notes: <em>${logData.notes}</em>` : ""}
        </p>
    `;

    /* ── Report Count Summary (from saved snapshot) ── */
    if (logData.reportCounts) {

        html += `<h6 class="mt-2 mb-1" style="font-size:13px;font-weight:600;">📋 Report Count Summary</h6>`;

        const modesWithData = Object.keys(logData.reportCounts);

        modesWithData.forEach(mode => {

            const modeCounts = logData.reportCounts[mode];

            html += `
                <p class="mb-1" style="font-size:12px;font-weight:600;color:var(--text-dim);">${mode}</p>
                <div class="table-responsive mb-2">
                <table class="table table-sm table-bordered mb-0" style="font-size:12px;">
                    <thead class="table-secondary">
                        <tr>
                            <th>Category</th>
                            <th>Report Count</th>
                            <th>Checked</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            Object.keys(modeCounts).forEach(cat => {

                const rc = modeCounts[cat];
                const rpt     = rc.reportCount  || 0;
                const chk     = rc.checkedCount  || 0;

                if (rpt === 0) return; /* skip non-applicable categories */

                const match   = chk === rpt;
                const badge   = match
                    ? `<span style="color:var(--green);font-weight:600;">✓ Match</span>`
                    : `<span style="color:var(--red);font-weight:600;">✗ ${chk}/${rpt}</span>`;

                html += `<tr>
                    <td>${cat}</td>
                    <td>${rpt}</td>
                    <td>${chk}</td>
                    <td>${badge}</td>
                </tr>`;

            });

            html += `</tbody></table></div>`;

        });

    }

    /* ── Transactions Table ── */
    html += `
        <h6 class="mt-3 mb-1" style="font-size:13px;font-weight:600;">🚗 Transaction Log</h6>
        <div class="table-responsive">
        <table class="table table-sm table-striped table-bordered mb-0" style="font-size:13px;">
            <thead class="table-dark">
                <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Mode</th>
                    <th>Category</th>
                    <th>Vehicle</th>
                    <th>Rpt Count</th>
                    <th>Comment</th>
                </tr>
            </thead>
            <tbody>
    `;

    rows.forEach((r, i) => {
        html += `<tr>
            <td>${r.txnNo || (i + 1)}</td>
            <td>${r.time}</td>
            <td>${r.mode}</td>
            <td>${r.category}</td>
            <td>${r.vehicle}</td>
            <td>${r.reportCount}</td>
            <td>${r.comment || ""}</td>
        </tr>`;
    });

    html += `</tbody></table></div>`;

    body.innerHTML = html;

}

/* ===============================
   SETUP — "SUBMIT AUDIT LOG" BUTTON
   + "VIEW AUDIT HISTORY" BUTTON
=============================== */

document.addEventListener("DOMContentLoaded", () => {

    /* ── Submit Button ── */

    const submitBtn = document.getElementById("submitAuditLogBtn");

    if (submitBtn) {

        submitBtn.addEventListener("click", async function () {

            const date   = selectedAuditDate || getTodayKey();
            const bucket = auditDataStore && auditDataStore[date];

            /* ── Step 1: validate BEFORE prompt (instant, no async) ── */
            if (bucket) {
                const mismatches = validateCountsMatch(bucket);
                if (mismatches.length > 0) {
                    const lines = mismatches.map(m =>
                        `• ${m.mode} › ${m.category}: Report=${m.reportCount}, Checked=${m.checkedCount} (${m.reportCount - m.checkedCount} baki)`
                    );
                    alert(
                        "⚠️ Audit Save Nahi Ho Sakta\n\n" +
                        "Pehle in sabhi categories ka audit pura karo:\n\n" +
                        lines.join("\n") +
                        "\n\nSabhi categories complete hone ke baad hi Save hoga."
                    );
                    return;
                }
            }

            /* ── Step 2: kick off Firebase warm-up + data build IN PARALLEL
               with the notes prompt — by the time user clicks OK, both are done ── */
            const warmupPromise = (typeof waitForFirebase === "function")
                ? waitForFirebase(6000)
                : Promise.resolve(true);

            /* Pre-build rows & snapshot synchronously (no await needed) */
            const rows     = bucket ? buildAuditRows(bucket)              : [];
            const snapshot = bucket ? buildReportCountsSnapshot(bucket)   : {};

            /* ── Step 3: show prompt (blocks UI, but warmup runs behind it) ── */
            const notes = prompt(
                "Optional: Is audit ke liye koi note add karo\n(e.g. 'Night shift', 'Entry lane only')\n\nKhali rehne do aur OK dabao agar nahi chahiye.",
                ""
            );
            if (notes === null) return;   /* user cancelled */

            /* ── Step 4: button disabled, check warmup result ── */
            submitBtn.disabled    = true;
            submitBtn.textContent = "Saving…";

            const ready = await warmupPromise;
            if (!ready) {
                submitBtn.disabled  = false;
                submitBtn.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Save Audit Log';
                alert("Firebase connect nahi hua. Internet check karo aur dobara try karo.");
                return;
            }

            /* ── Step 5: fire Firestore write immediately ── */
            const result = await submitAuditToSheet(notes, { rows, snapshot });

            submitBtn.disabled  = false;
            submitBtn.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Save Audit Log';

            if (result.success) {
                if (typeof showToast === "function") {
                    showToast("Audit Saved ✓", result.message.split("\n")[0], "success", 5000);
                } else {
                    alert(result.message);
                }
            } else {
                alert(result.message);
            }

        });

    }

    /* ── View History Button ── */

    const viewBtn = document.getElementById("viewAuditHistoryBtn");

    if (viewBtn) {

        viewBtn.addEventListener("click", async function () {

            const listEl = document.getElementById("auditLogDateList");
            const detailEl = document.getElementById("auditLogDetailBody");

            if (listEl)   listEl.innerHTML   = "<p class='text-muted small'>Loading…</p>";
            if (detailEl) detailEl.innerHTML  = "";

            if (typeof bootstrap !== "undefined") {
                bootstrap.Modal.getOrCreateInstance(
                    document.getElementById("auditLogModal")
                ).show();
            }

            const dates = await fbLoadAuditLogDates();

            if (!listEl) return;

            if (dates.length === 0) {
                listEl.innerHTML = "<p class='text-muted small'>Abhi tak koi audit save nahi hua.</p>";
                return;
            }

            /* Helper — rebuild date list after a delete */
            function buildDateList(dateArr) {

                listEl.innerHTML = dateArr.map(d => `
                    <div class="audit-log-date-row" data-date="${d.dateKey}">
                        <button class="audit-log-date-btn" data-date="${d.dateKey}">
                            <span class="audit-log-date-label">
                                <strong>${formatAuditDateKey(d.dateKey)}</strong>
                            </span>
                            <span class="audit-log-date-time">${d.savedAt}</span>
                        </button>
                        <button class="audit-log-delete-btn" data-date="${d.dateKey}" title="Delete this audit log">
                            <i class="bi bi-trash3-fill"></i>
                        </button>
                    </div>
                `).join("");

                /* Select (view) a date */
                listEl.querySelectorAll(".audit-log-date-btn").forEach(btn => {

                    btn.addEventListener("click", async function () {

                        listEl.querySelectorAll(".audit-log-date-btn")
                            .forEach(b => b.classList.remove("active"));

                        this.classList.add("active");

                        if (detailEl) detailEl.innerHTML = "<p class='text-muted small'>Loading…</p>";

                        const data = await fbLoadAuditLogByDate(this.dataset.date);

                        renderAuditLogDetail(this.dataset.date, data);

                    });

                });

                /* Delete a date */
                listEl.querySelectorAll(".audit-log-delete-btn").forEach(btn => {

                    btn.addEventListener("click", async function (e) {

                        e.stopPropagation();

                        const dk = this.dataset.date;
                        const pretty = formatAuditDateKey(dk);

                        if (!confirm(`"${pretty}" ka audit log delete karna chahte ho?`)) return;

                        this.disabled = true;
                        this.innerHTML = '<i class="bi bi-hourglass-split"></i>';

                        const ok = await fbDeleteAuditLog(dk);

                        if (ok) {

                            /* Remove from local array and re-render */
                            const idx = dateArr.findIndex(d => d.dateKey === dk);
                            if (idx !== -1) dateArr.splice(idx, 1);

                            buildDateList(dateArr);

                            if (detailEl) detailEl.innerHTML = "<p class='text-muted small'>Select a date to view.</p>";

                            if (typeof showToast === "function") {
                                showToast("Deleted", `${pretty} ka audit log delete ho gaya.`, "success");
                            }

                        } else {

                            this.disabled = false;
                            this.innerHTML = '<i class="bi bi-trash3-fill"></i>';

                            if (typeof showToast === "function") {
                                showToast("Delete Failed", "Try again.", "error");
                            }

                        }

                    });

                });

            }

            buildDateList(dates);

        });

    }

});
