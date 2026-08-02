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

/* ── Map actualVehicle → office row index ────────────────── */
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

/* ── Map audit category → office row index (fallback for status txns) */
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

/* Status vehicle names — these carry event info, not vehicle class */
const STATUS_VEHICLES = new Set([
    "Has Pass",
    "Paid (Cash)",
    "Paid (ETC)",
    "Paid (Digital)",
    "Forcefully",
    "Fake Violation",
    "Fake Exemption",
    "Concessionaire",
]);

/* Paid statuses (normal paid traffic) */
const PAID_STATUSES = new Set([
    "Has Pass",
    "Paid (Cash)",
    "Paid (ETC)",
    "Paid (Digital)",
    "Concessionaire",
]);

/* ── Helper: determine office row index for one transaction ─ */
function _txnOfficeIdx(actualVehicle, category) {
    if (!STATUS_VEHICLES.has(actualVehicle)) {
        /* It's a real vehicle class — map directly */
        const idx = VEHICLE_TO_OFFICE_IDX[actualVehicle];
        return (idx !== undefined) ? idx : null;
    }
    /* Status transaction — use the audit category as vehicle proxy */
    const idx = CATEGORY_TO_OFFICE_IDX[category];
    return (idx !== undefined) ? idx : null;
}

/* ── Build per-row counts from current audit date bucket ─── */
function _buildOfficeCounts(bucket) {
    /*
      Returns array of 6 objects:
      { violation, exemption, paid, vehicleCount }
      where vehicleCount = actual vehicle-type taps (not status taps)
    */
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

            (catData.transactions || []).forEach(txn => {
                const av  = txn.actualVehicle || "";
                const idx = _txnOfficeIdx(av, category);
                if (idx === null) return;

                if (av === "Forcefully" || av === "Fake Violation") {
                    counts[idx].violation++;
                } else if (av === "Fake Exemption") {
                    counts[idx].exemption++;
                } else if (PAID_STATUSES.has(av)) {
                    counts[idx].paid++;
                }
                /* plain vehicle-class taps (Car, LCV, etc.) just counted
                   as paid traffic for the office report */
                else {
                    counts[idx].paid++;
                }
            });
        });
    });

    return counts;
}

/* ── Main export function ────────────────────────────────── */
function generateOfficeReport() {

    /* 1. Resolve today's bucket */
    const dateKey = selectedAuditDate || getTodayKey();
    const bucket  = auditDataStore && auditDataStore[dateKey];

    /* Build counts (all zeros if no data yet — still valid to export) */
    const counts = _buildOfficeCounts(bucket);

    /* 2. Create workbook + worksheet */
    const wb = XLSX.utils.book_new();
    const ws = {};

    /* Helper: set a cell */
    function C(r, c, v, t) {
        /* r, c are 0-based */
        const addr = XLSX.utils.encode_cell({ r, c });
        ws[addr] = { v, t: t || (typeof v === "number" ? "n" : "s") };
    }

    /* Helper: set a formula cell */
    function F(r, c, formula) {
        const addr = XLSX.utils.encode_cell({ r, c });
        ws[addr] = { f: formula, t: "n" };
    }

    /* ── Row 1: Toll name header ──────────────────────────── */
    /*  Leave row 1 blank (index 0) — office will fill toll name */
    C(0, 2, "TOLL PLAZA — AUDIT REPORT");

    /* ── Row 2: "Exemption & Violation" heading (I2:J2) ───── */
    /*  Columns: A=0 B=1 C=2 D=3 E=4 F=5 G=6 H=7 I=8 J=9 K=10 L=11 */
    C(1, 8, "Exemption & Violation");

    /* ── Row 3: "Tariff" heading (D3:E3) ─────────────────── */
    C(2, 3, "Tariff");

    /* ── Row 4: Column headers (C to L = cols 2–11) ─────── */
    const HDR = [
        "Class",                 /* C4 – col 2  */
        "Single",                /* D4 – col 3  */
        "Return",                /* E4 – col 4  */
        "Violation",             /* F4 – col 5  */
        "Revenue Loss",          /* G4 – col 6  */
        "Exemption",             /* H4 – col 7  */
        "Revenue Loss",          /* I4 – col 8  */
        "Total Unpaid Traffic",  /* J4 – col 9  */
        "Total Loss",            /* K4 – col 10 */
        "Total Traffic",         /* L4 – col 11 */
    ];
    HDR.forEach((h, i) => C(3, 2 + i, h));

    /* ── Row 5: Sr.No. sub-header ─────────────────────────── */
    C(4, 1, "Sr.No.");

    /* ── Row 6: blank separator (index 5) ─────────────────── */

    /* ── Rows 7–12 (index 6–11): data rows ─────────────────
       Layout per row (all columns A–L):
         B = Sr.No (1–6)
         C = Class label
         D = Single tariff (value)
         E = Return tariff (value)
         F = Violation count (value)
         G = Revenue Loss Violation = F * D  (formula)
         H = Exemption count (value)
         I = Revenue Loss Exemption = H * D  (formula)
         J = Total Unpaid = F + H            (formula)
         K = Total Loss   = G + I            (formula)
         L = Total Traffic = paid + J        (formula, paid written as value in col M hidden)
             We put paid traffic in col M (index 12) as a plain number so
             the formula is visible and the user can see the paid traffic.
             Col M header is "Paid Traffic (ref)" at row 4.
    ─────────────────────────────────────────────────────── */

    /* Col M header */
    C(3, 12, "Paid Traffic");

    OFFICE_ROWS.forEach((row, i) => {
        const dataRow  = 6 + i;          /* 0-based row index for xlsx */
        const excelRow = dataRow + 1;    /* 1-based row number for formulas */

        const cnt    = counts[i];
        const vCount = cnt.violation;
        const eCount = cnt.exemption;
        const pCount = cnt.paid;

        /* B: Sr.No */
        C(dataRow, 1, i + 1, "n");

        /* C: Class */
        C(dataRow, 2, row.label);

        /* D: Single tariff */
        C(dataRow, 3, row.single, "n");

        /* E: Return tariff */
        C(dataRow, 4, row.returnT, "n");

        /* F: Violation count */
        C(dataRow, 5, vCount, "n");

        /* G: Revenue Loss (Violation) = F * D */
        const colF = `F${excelRow}`;
        const colD = `D${excelRow}`;
        F(dataRow, 6, `${colF}*${colD}`);

        /* H: Exemption count */
        C(dataRow, 7, eCount, "n");

        /* I: Revenue Loss (Exemption) = H * D */
        const colH = `H${excelRow}`;
        F(dataRow, 8, `${colH}*${colD}`);

        /* J: Total Unpaid Traffic = F + H */
        F(dataRow, 9, `${colF}+${colH}`);

        /* K: Total Loss = G + I */
        const colG = `G${excelRow}`;
        const colI = `I${excelRow}`;
        F(dataRow, 10, `${colG}+${colI}`);

        /* M: Paid traffic (reference value) */
        C(dataRow, 12, pCount, "n");

        /* L: Total Traffic = M + J (paid + total unpaid) */
        const colM = `M${excelRow}`;
        const colJ = `J${excelRow}`;
        F(dataRow, 11, `${colM}+${colJ}`);
    });

    /* ── Row 13 (index 12): TOTAL row ───────────────────── */
    C(12, 2, "TOTAL");

    /* D13: sum of single tariffs is meaningless — leave blank */
    /* E13: same */

    /* F13: total violations */
    F(12, 5, `SUM(F7:F12)`);

    /* G13: total revenue loss violation */
    F(12, 6, `SUM(G7:G12)`);

    /* H13: total exemptions */
    F(12, 7, `SUM(H7:H12)`);

    /* I13: total revenue loss exemption */
    F(12, 8, `SUM(I7:I12)`);

    /* J13: total unpaid */
    F(12, 9, `SUM(J7:J12)`);

    /* K13: total loss */
    F(12, 10, `SUM(K7:K12)`);

    /* M13: total paid */
    F(12, 12, `SUM(M7:M12)`);

    /* L13: total traffic */
    F(12, 11, `SUM(L7:L12)`);

    /* ── Row 15: metadata note ──────────────────────────── */
    const [yyyy, mm, dd] = dateKey.split("-");
    const displayDate = `${dd}/${mm}/${yyyy}`;
    C(14, 2, `Audit Date: ${displayDate}`);
    C(14, 5, `Generated: ${new Date().toLocaleString("en-IN")}`);

    /* ── Merges ──────────────────────────────────────────── */
    ws["!merges"] = [
        /* "Exemption & Violation" → I2:J2 (row 1, cols 8-9) */
        { s: { r: 1, c: 8 }, e: { r: 1, c: 9 } },
        /* "Tariff" → D3:E3 (row 2, cols 3-4) */
        { s: { r: 2, c: 3 }, e: { r: 2, c: 4 } },
        /* "Revenue Loss" headers — G4:G4 and I4:I4 no need to merge (single cells) */
        /* Title row C1 span */
        { s: { r: 0, c: 2 }, e: { r: 0, c: 11 } },
    ];

    /* ── Column widths ───────────────────────────────────── */
    ws["!cols"] = [
        { wch: 4  },   /* A */
        { wch: 6  },   /* B  Sr.No */
        { wch: 18 },   /* C  Class */
        { wch: 8  },   /* D  Single */
        { wch: 8  },   /* E  Return */
        { wch: 10 },   /* F  Violation */
        { wch: 13 },   /* G  Revenue Loss */
        { wch: 10 },   /* H  Exemption */
        { wch: 13 },   /* I  Revenue Loss */
        { wch: 21 },   /* J  Total Unpaid Traffic */
        { wch: 12 },   /* K  Total Loss */
        { wch: 14 },   /* L  Total Traffic */
        { wch: 14 },   /* M  Paid Traffic */
    ];

    /* ── Worksheet range ─────────────────────────────────── */
    ws["!ref"] = "A1:M15";

    /* ── Add sheet and save ─────────────────────────────── */
    XLSX.utils.book_append_sheet(wb, ws, "Office Report");

    const filename = `Toll_Audit_Report_${dateKey}.xlsx`;
    XLSX.writeFile(wb, filename);

    if (typeof showToast === "function") {
        showToast(
            "Report Downloaded",
            `${filename} saved successfully.`,
            "success",
            4000
        );
    }
}

/* ── Wire "Generate Office Report" button ─────────────────── */
document.addEventListener("DOMContentLoaded", () => {
    const reportBtn = document.getElementById("generateOfficeReportBtn");
    if (reportBtn) {
        reportBtn.addEventListener("click", generateOfficeReport);
    }
});
