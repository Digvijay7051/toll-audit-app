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
   SUBMIT AUDIT LOG
   Saves audit to Firestore under the
   user's own account. Replaces old
   Google Sheets approach entirely.
   Returns { success, message }
=============================== */

async function submitAuditToSheet(notes) {

    const date   = selectedAuditDate || getTodayKey();
    const bucket = auditDataStore[date];

    if (!bucket) {
        return { success: false, message: "Is date ka koi audit data nahi mila." };
    }

    const rows = buildAuditRows(bucket);

    if (rows.length === 0) {
        return { success: false, message: "Koi transaction nahi mila. Pehle kuch vehicles add karo." };
    }

    /* Ensure Firebase is ready before attempting to save */
    if (typeof waitForFirebase === "function") {
        const ready = await waitForFirebase(6000);
        if (!ready) {
            return { success: false, message: "Firebase connect nahi hua. Internet check karo aur dobara try karo." };
        }
    }

    if (typeof fbSaveAuditLog !== "function") {
        return { success: false, message: "Firebase function load nahi hua. Page reload karke try karo." };
    }

    /* Check user is logged in */
    if (typeof fbAuth !== "undefined" && fbAuth && !fbAuth.currentUser) {
        return { success: false, message: "Aap logged in nahi hain. Please sign in karke dobara try karo." };
    }

    /* NOTE: bucket intentionally excluded — it duplicates rows data
       and can push the document over Firestore's 1 MB limit. */
    const logData = {
        notes: notes || "",
        rows:  rows
    };

    const ok = await fbSaveAuditLog(date, logData);

    if (!ok) {
        return {
            success: false,
            message: "Firestore mein save nahi hua. Internet connection check karo aur dobara try karo."
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

            const notes = prompt(
                "Optional: Is audit ke liye koi note add karo\n(e.g. 'Night shift', 'Entry lane only')\n\nKhali rehne do aur OK dabao agar nahi chahiye.",
                ""
            );

            if (notes === null) return;   /* user cancelled */

            submitBtn.disabled    = true;
            submitBtn.textContent = "Saving…";

            const result = await submitAuditToSheet(notes);

            submitBtn.disabled  = false;
            submitBtn.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Save Audit Log';

            if (typeof showToast === "function") {
                showToast(
                    result.success ? "Audit Saved ✓" : "Save Failed",
                    result.success ? result.message.split("\n")[0] : result.message,
                    result.success ? "success" : "error",
                    result.success ? 5000 : 4000
                );
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
