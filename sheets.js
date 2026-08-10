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

    /* Fire email notification (non-blocking — won't affect save flow) */
    if (typeof sendAuditSavedEmail === "function") {
        const auditorName = (typeof currentUsername !== "undefined" && currentUsername)
            ? currentUsername
            : ((typeof fbAuth !== "undefined" && fbAuth && fbAuth.currentUser && fbAuth.currentUser.displayName) || "Unknown");
        sendAuditSavedEmail({
            dateKey:   date,
            auditor:   auditorName,
            rowCount:  rows.length,
            notes:     notes || ""
        });
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

/* ==========================================================
   GENERATE OFFICE REPORT
   Builds a .xlsx file matching the standard office format:

   Row 1  : Toll name / blank title row
   Row 2  : "Exemption & Violation" merged I2:J2
   Row 3  : "Tariff" merged D3:E3
   Row 4  : Column headers C–L
   Row 5  : Sr. No. sub-header
   Row 6  : Blank separator
   Rows 7–12 : 6 office category rows
   Row 13 : TOTAL row
   Row 15 : Audit date + generated-by note
========================================================== */

/* ── Office category definitions ─────────────────────────── */

const OFFICE_ROWS = [
    { label: "Car",              single: 85,  returnT: 130 },
    { label: "LCV/Mini Bus",     single: 130, returnT: 195 },
    { label: "Truck/Bus 2 Axle", single: 255, returnT: 385 },
    { label: "MAV 3-6 Axle",     single: 415, returnT: 625 },
    { label: "OSV",              single: 510, returnT: 770 },
    { label: "Non-Tollable",     single: 0,   returnT: 0   },
];

/* ── Map actual vehicle class → office row index ─────────── */
/*    Used for both violation/exemption (by vehicle class found)
      and paid traffic (by vehicle class found).
      Non-tollable vehicles all map to index 5.               */
const VEHICLE_TO_OFFICE_IDX = {
    "Car":                0,
    "LCV":                1,
    "Minibus":            1,
    "Bus 2 Axle":         2,
    "Truck 2 Axle":       2,
    "Truck 3 Axle":       3,
    "MAV":                3,
    "Oversized Vehicle":  4,
    "Tractor":            5,
    "JCB":                5,
    "Auto":               5,
    "Bike":               5,
    "Ambulance":          5,
    "Government Vehicle": 5,
    "Army Vehicle":       5,
    "Police":             5,
};

/* Paid-status vehicle names (no vehicle class info — use category) */
const PAID_STATUSES = new Set([
    "Has Pass",
    "Paid (Cash)",
    "Paid (ETC)",
    "Paid (Digital)",
    "Concessionaire",
]);

/* Map audit category → office row index (for paid-status txns) */
const CATEGORY_TO_OFFICE_IDX = {
    "Car":          0,
    "LCV":          1,
    "Bus 2 Axle":   2,
    "Truck 2 Axle": 2,
    "Truck 3 Axle": 3,
    "MAV":          3,
    "Auto":         5,
    "Tractor":      5,
};

/* ── Build per-row counts — uses vehicleCounts (same as Audit Matrix) ─
   Violation count  = sum of vehicleCounts per actual vehicle class
                      across ALL categories in Violation mode.
   Exemption count  = same in Exemption mode.
   Paid traffic     = vehicleCounts of real vehicle classes + paid-status
                      taps across BOTH modes.

   This mirrors exactly what the Audit Matrix rows show:
     matrix row "Car" total in Violation mode → Car's violation count
     matrix row "Car" total in Exemption mode → Car's exemption count  */
function _buildOfficeCounts(bucket) {

    const counts = OFFICE_ROWS.map(() => ({
        violation: 0,
        exemption: 0,
        paid:      0,
    }));

    if (!bucket) return counts;

    AUDIT_MODES.forEach(mode => {
        const modeData = bucket[mode];
        if (!modeData) return;

        REPORT_CATEGORIES.forEach(category => {
            const catData = modeData[category];
            if (!catData) return;

            const vc = catData.vehicleCounts || {};

            Object.keys(vc).forEach(vehicle => {
                const count = vc[vehicle];
                if (!count) return;                  /* skip zeros */

                /* Paid-status taps (Has Pass, Paid Cash/ETC/Digital,
                   Concessionaire) — no vehicle class info, use category */
                if (PAID_STATUSES.has(vehicle)) {
                    const idx = CATEGORY_TO_OFFICE_IDX[category];
                    if (idx !== undefined) counts[idx].paid += count;
                    return;
                }

                /* Status-only taps that carry no vehicle class —
                   skip them; they are not real vehicle counts */
                if (vehicle === "Forcefully"    ||
                    vehicle === "Fake Violation" ||
                    vehicle === "Fake Exemption") {
                    return;
                }

                /* Real vehicle class tap — map to office row.
                   Violation mode  → violation count for that class.
                   Exemption mode  → exemption count for that class.
                   This is the same data the Audit Matrix row-totals show. */
                const idx = VEHICLE_TO_OFFICE_IDX[vehicle];
                if (idx === undefined) return;

                if (mode === "Violation") {
                    counts[idx].violation += count;
                } else if (mode === "Exemption") {
                    counts[idx].exemption += count;
                }
            });
        });
    });

    return counts;
}

/* ── Build xlsx workbook from counts ─────────────────────── */
function _buildOfficeWorkbook(counts, dateKey) {

    const wb = XLSX.utils.book_new();
    const ws = {};

    /* Helper: value cell */
    function C(r, c, v, t) {
        const addr = XLSX.utils.encode_cell({ r, c });
        ws[addr] = { v, t: t || (typeof v === "number" ? "n" : "s") };
    }

    /* Helper: formula cell */
    function F(r, c, formula) {
        const addr = XLSX.utils.encode_cell({ r, c });
        ws[addr] = { f: formula, t: "n" };
    }

    /* Row 1: title */
    C(0, 2, "TOLL PLAZA — AUDIT REPORT");

    /* Row 2: "Exemption & Violation" (I2:J2) */
    C(1, 8, "Exemption & Violation");

    /* Row 3: "Tariff" (D3:E3) */
    C(2, 3, "Tariff");

    /* Row 4: column headers C–L + M */
    ["Class","Single","Return","Violation","Revenue Loss",
     "Exemption","Revenue Loss","Total Unpaid Traffic","Total Loss","Total Traffic"]
        .forEach((h, i) => C(3, 2 + i, h));
    C(3, 12, "Paid Traffic");

    /* Row 5: Sr.No. sub-header */
    C(4, 1, "Sr.No.");

    /* Rows 7–12: data */
    OFFICE_ROWS.forEach((row, i) => {
        const dr  = 6 + i;          /* 0-based */
        const er  = dr + 1;         /* 1-based excel row */

        const { violation: vCount, exemption: eCount, paid: pCount } = counts[i];

        C(dr, 1, i + 1, "n");                   /* B: Sr.No */
        C(dr, 2, row.label);                     /* C: Class */
        C(dr, 3, row.single,  "n");              /* D: Single */
        C(dr, 4, row.returnT, "n");              /* E: Return */
        C(dr, 5, vCount,      "n");              /* F: Violation count */
        F(dr, 6, `F${er}*D${er}`);              /* G: Rev Loss Violation */
        C(dr, 7, eCount,      "n");              /* H: Exemption count */
        F(dr, 8, `H${er}*D${er}`);              /* I: Rev Loss Exemption */
        F(dr, 9, `F${er}+H${er}`);              /* J: Total Unpaid */
        F(dr, 10, `G${er}+I${er}`);             /* K: Total Loss */
        C(dr, 12, pCount,     "n");              /* M: Paid traffic */
        F(dr, 11, `M${er}+J${er}`);             /* L: Total Traffic */
    });

    /* Row 13: TOTAL */
    C(12, 2, "TOTAL");
    F(12, 5,  "SUM(F7:F12)");
    F(12, 6,  "SUM(G7:G12)");
    F(12, 7,  "SUM(H7:H12)");
    F(12, 8,  "SUM(I7:I12)");
    F(12, 9,  "SUM(J7:J12)");
    F(12, 10, "SUM(K7:K12)");
    F(12, 11, "SUM(L7:L12)");
    F(12, 12, "SUM(M7:M12)");

    /* Row 15: metadata */
    const [yyyy, mm, dd] = dateKey.split("-");
    C(14, 2, `Audit Date: ${dd}/${mm}/${yyyy}`);
    C(14, 5, `Generated: ${new Date().toLocaleString("en-IN")}`);

    ws["!merges"] = [
        { s: { r: 1, c: 8 }, e: { r: 1, c: 9 } },   /* I2:J2 */
        { s: { r: 2, c: 3 }, e: { r: 2, c: 4 } },   /* D3:E3 */
        { s: { r: 0, c: 2 }, e: { r: 0, c: 11 } },  /* title row */
    ];

    ws["!cols"] = [
        { wch: 4  }, { wch: 6  }, { wch: 18 }, { wch: 8  }, { wch: 8  },
        { wch: 10 }, { wch: 13 }, { wch: 10 }, { wch: 13 }, { wch: 21 },
        { wch: 12 }, { wch: 14 }, { wch: 14 },
    ];

    ws["!ref"] = "A1:M15";
    XLSX.utils.book_append_sheet(wb, ws, "Office Report");
    return wb;
}

/* ── Download the xlsx directly ──────────────────────────── */
function generateOfficeReport() {
    const dateKey = selectedAuditDate || getTodayKey();
    const bucket  = auditDataStore && auditDataStore[dateKey];
    const counts  = _buildOfficeCounts(bucket);
    const wb      = _buildOfficeWorkbook(counts, dateKey);
    const filename = `Toll_Audit_Report_${dateKey}.xlsx`;
    XLSX.writeFile(wb, filename);
    if (typeof showToast === "function") {
        showToast("Report Downloaded", `${filename} saved.`, "success", 4000);
    }
}

/* ── Render the in-app preview modal ─────────────────────── */
function renderOfficeReportModal() {

    const dateKey = selectedAuditDate || getTodayKey();
    const bucket  = auditDataStore && auditDataStore[dateKey];
    const counts  = _buildOfficeCounts(bucket);

    /* Subtitle */
    const [yyyy, mm, dd] = dateKey.split("-");
    const sub = document.getElementById("orModalSubtitle");
    if (sub) sub.textContent = `Audit Date: ${dd}/${mm}/${yyyy}`;

    /* ── Summary chips ─────────────────────────────────── */
    const bar = document.getElementById("orSummaryBar");
    if (bar) {
        const totV = counts.reduce((s, c) => s + c.violation, 0);
        const totE = counts.reduce((s, c) => s + c.exemption, 0);
        const totP = counts.reduce((s, c) => s + c.paid, 0);
        const totRevLoss = counts.reduce((s, c, i) =>
            s + (c.violation + c.exemption) * OFFICE_ROWS[i].single, 0);

        bar.innerHTML = `
            <span class="am-chip am-chip-wrong">
                <i class="bi bi-x-circle-fill"></i> ${totV} Violations
            </span>
            <span class="am-chip am-chip-acc">
                <i class="bi bi-exclamation-circle-fill"></i> ${totE} Exemptions
            </span>
            <span class="am-chip am-chip-total">
                <i class="bi bi-currency-rupee"></i> ${totRevLoss.toLocaleString("en-IN")} Revenue Loss
            </span>
            <span class="am-chip am-chip-correct">
                <i class="bi bi-car-front-fill"></i> ${totP} Paid Traffic
            </span>`;
    }

    /* ── Helper: render number or dash ─────────────────── */
    function num(v, cls) {
        const zeroClass = (v === 0) ? " or-td-zero" : "";
        return `<td class="${cls}${zeroClass}">${v === 0 ? "—" : v.toLocaleString("en-IN")}</td>`;
    }

    /* ── tbody ─────────────────────────────────────────── */
    const tbody = document.getElementById("orTbody");
    if (tbody) {
        tbody.innerHTML = OFFICE_ROWS.map((row, i) => {
            const { violation: v, exemption: e, paid: p } = counts[i];
            const revLossV = v * row.single;
            const revLossE = e * row.single;
            const unpaid   = v + e;
            const loss     = revLossV + revLossE;
            const traffic  = p + unpaid;

            return `<tr>
                <td class="or-td-sr">${i + 1}</td>
                <td class="or-td-class">${row.label}</td>
                <td class="or-td-tariff">${row.single}</td>
                <td class="or-td-tariff">${row.returnT}</td>
                ${num(v, "or-td-viol")}
                ${num(revLossV, "or-td-viol-loss")}
                ${num(e, "or-td-exem")}
                ${num(revLossE, "or-td-exem-loss")}
                ${num(unpaid, "or-td-unpaid")}
                ${num(loss, "or-td-loss")}
                ${num(traffic, "or-td-traffic")}
                ${num(p, "or-td-paid")}
            </tr>`;
        }).join("");
    }

    /* ── tfoot: TOTAL row ──────────────────────────────── */
    const tfoot = document.getElementById("orTfoot");
    if (tfoot) {
        const tV  = counts.reduce((s, c) => s + c.violation, 0);
        const tE  = counts.reduce((s, c) => s + c.exemption, 0);
        const tP  = counts.reduce((s, c) => s + c.paid, 0);
        const tRV = counts.reduce((s, c, i) => s + c.violation * OFFICE_ROWS[i].single, 0);
        const tRE = counts.reduce((s, c, i) => s + c.exemption * OFFICE_ROWS[i].single, 0);
        const tU  = tV + tE;
        const tL  = tRV + tRE;
        const tT  = tP + tU;

        tfoot.innerHTML = `<tr class="or-tfoot-row">
            <td colspan="2" style="text-align:left;font-weight:800;">TOTAL</td>
            <td>—</td><td>—</td>
            <td>${tV.toLocaleString("en-IN")}</td>
            <td>${tRV.toLocaleString("en-IN")}</td>
            <td>${tE.toLocaleString("en-IN")}</td>
            <td>${tRE.toLocaleString("en-IN")}</td>
            <td>${tU.toLocaleString("en-IN")}</td>
            <td>${tL.toLocaleString("en-IN")}</td>
            <td>${tT.toLocaleString("en-IN")}</td>
            <td>${tP.toLocaleString("en-IN")}</td>
        </tr>`;
    }
}

/* ── Wire modal + download button ───────────────────────── */
document.addEventListener("DOMContentLoaded", () => {

    /* Populate table every time the modal opens */
    const modalEl = document.getElementById("officeReportModal");
    if (modalEl) {
        modalEl.addEventListener("show.bs.modal", renderOfficeReportModal);
    }

    /* Download button inside the modal */
    const dlBtn = document.getElementById("orDownloadBtn");
    if (dlBtn) {
        dlBtn.addEventListener("click", generateOfficeReport);
    }
});
