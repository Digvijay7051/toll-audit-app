/* ==========================================================
   Toll Audit Assistant
   passlist.js

   Monthly Pass List: upload/paste the pass register, then
   quickly check any vehicle number against it while auditing.
========================================================== */

document.addEventListener("DOMContentLoaded", async () => {

    /* Always load from localStorage first so the UI isn't blank */

    loadPassList();

    renderPassListCount();

    /* Then try to pull the shared list from Firestore (if online) */

    await syncPassListFromFirestore();

    /* Apply admin / read-only mode before attaching listeners */

    applyPassListAdminMode();

    setupPassListManager();

    setupPassCheckWidget();

    setupPassSheetSync();

    setupPassEditWidget();

});

/* ===============================
   FIRESTORE SYNC — PULL SHARED LIST
   Loads the admin-uploaded pass list
   from Firestore and merges it into
   the local list. Called on page load
   and whenever the modal is opened.
=============================== */

async function syncPassListFromFirestore() {

    if (typeof fbLoadSharedPassList !== "function") return;

    const records = await fbLoadSharedPassList();

    if (!Array.isArray(records) || records.length === 0) return;

    /* Replace local list with the Firestore version */

    replacePassList(records);

    renderPassListCount();

    console.log("[PassList] Loaded", records.length, "records from Firestore shared list.");

}

/* ===============================
   ADMIN MODE — SHOW/HIDE CONTROLS
   Admin sees all controls.
   Regular users see read-only view:
   no upload, no clear, no edit, no sync.
=============================== */

function applyPassListAdminMode() {

    const isAdmin = (typeof fbIsAdmin === "function") && fbIsAdmin();

    /* Sections that only admin should see */

    const adminOnlySections = document.querySelectorAll(".pass-admin-only");

    adminOnlySections.forEach(el => {

        el.style.display = isAdmin ? "" : "none";

    });

    /* Show the read-only notice for non-admins */

    const readonlyNotice = document.getElementById("passListReadonlyNotice");

    if (readonlyNotice) {

        readonlyNotice.style.display = isAdmin ? "none" : "block";

    }

}

/* ===============================
   COUNT DISPLAY
=============================== */

function renderPassListCount() {

    const count = getPassListCount();

    const sidebarBadge = document.getElementById("passListCountBadge");

    if (sidebarBadge) sidebarBadge.textContent = count;

    const modalCount = document.getElementById("passListModalCount");

    if (modalCount) modalCount.textContent = count;

    renderPassListBreakdown();

}

/* ===============================
   CLASS-WISE BREAKDOWN
   Shows how many passes fall under
   each Vehicle Class. Since the list
   is always de-duplicated by vehicle
   number, this is the real, duplicate-
   free count per category.
=============================== */

function renderPassListBreakdown() {

    const bodyEl = document.getElementById("passListBreakdownBody");

    if (!bodyEl) return;

    const counts = getPassListClassBreakdown();

    const labels = Object.keys(counts)
        .sort((a, b) => counts[b] - counts[a]);

    if (labels.length === 0) {

        bodyEl.innerHTML =
            `<tr><td class="text-muted">No passes loaded yet.</td></tr>`;

        return;

    }

    const rows = labels.map(label =>

        `<tr><td class="pass-detail-label">${label}</td><td>${counts[label]}</td></tr>`

    ).join("");

    const totalRow =
        `<tr><td class="pass-detail-label"><strong>Total (unique vehicle numbers)</strong></td>` +
        `<td><strong>${getPassListCount()}</strong></td></tr>`;

    bodyEl.innerHTML = rows + totalRow;

}

/* ===============================
   COLUMN DETECTION
   Matches the sheet's header row
   against likely column names so
   columns can be in any order.
=============================== */

const PASS_HEADER_PATTERNS = {

    slNo: [/^sl\.?\s*no/i, /serial/i],

    number: [/veh.*reg.*no/i, /veh.*no/i, /vehicle.*number/i, /reg.*no/i, /registration/i, /plate/i, /^number$/i, /^no\.?$/i],

    vehicleClass: [/veh.*class/i, /class/i, /category/i, /^type$/i, /vehicle.*type/i],

    modeOfPayment: [/mode.*payment/i, /payment.*mode/i, /^payment$/i],

    issuedDate: [/issue/i],

    validTill: [/valid/i, /expiry/i, /expire/i, /till/i, /upto/i, /up to/i],

    amount: [/amount/i, /^amt$/i],

    mobileNo: [/mobile/i, /phone/i, /contact/i],

    utr: [/utr/i, /transaction.*id/i, /txn/i]

};

function findHeaderKey(keys, patterns) {

    return keys.find(k => patterns.some(p => p.test(k))) || null;

}

function formatCellValue(value) {

    if (value === undefined || value === null) return "";

    if (value instanceof Date) {

        return formatFriendlyDate(value);

    }

    return String(value).trim();

}

/* Turns an array of plain row-objects (headers as keys) —
   from Excel, pasted rows, or a parsed Google Sheet CSV —
   into full pass records. */

function extractRecordsFromRows(rows) {

    if (!rows.length) return [];

    const keys = Object.keys(rows[0]);

    const columnKeys = {};

    Object.keys(PASS_HEADER_PATTERNS).forEach(field => {

        columnKeys[field] = findHeaderKey(keys, PASS_HEADER_PATTERNS[field]);

    });

    if (!columnKeys.number) columnKeys.number = keys[0];

    return rows

        .map(row => {

            const record = {};

            Object.keys(columnKeys).forEach(field => {

                const key = columnKeys[field];

                record[field] = key ? formatCellValue(row[key]) : "";

            });

            return record;

        })

        .filter(record => record.number);

}

/* Scans the first several raw rows to find the actual header
   row — the one containing column names like "VEHICLE REG NO.",
   "VEHICLE CLASS", etc. Needed because some sheets have a title
   row (e.g. "MONTHLY PASS DETAILS {01/07/2026}") above the real
   headers, which would otherwise be mistaken for the header row
   and break every column match. Falls back to row 0 if nothing
   more confident is found. */

function findHeaderRowIndex(rawRows) {

    const scanLimit = Math.min(rawRows.length, 15);

    for (let i = 0; i < scanLimit; i++) {

        const row = rawRows[i] || [];

        const cells = row.map(cell =>
            (cell === null || cell === undefined) ? "" : String(cell).trim()
        );

        if (cells.filter(c => c).length < 2) continue;

        let matches = 0;

        Object.keys(PASS_HEADER_PATTERNS).forEach(field => {

            if (cells.some(c => PASS_HEADER_PATTERNS[field].some(p => p.test(c)))) {

                matches++;

            }

        });

        if (matches >= 3) return i;

    }

    return 0;

}

function extractRecordsFromWorkbook(workbook) {

    let records = [];

    workbook.SheetNames.forEach(sheetName => {

        const sheet = workbook.Sheets[sheetName];

        const rawRows = XLSX.utils.sheet_to_json(sheet, {

            header: 1,

            defval: "",

            raw: false,

            dateNF: "dd mmm yyyy"

        });

        const headerIdx = findHeaderRowIndex(rawRows);

        const headers = (rawRows[headerIdx] || []).map(h =>
            (h === null || h === undefined) ? "" : String(h).trim()
        );

        const rowObjects = rawRows

            .slice(headerIdx + 1)

            .filter(row => row.some(cell => cell !== "" && cell !== null && cell !== undefined))

            .map(row => {

                const obj = {};

                headers.forEach((header, idx) => {

                    if (header) obj[header] = row[idx];

                });

                return obj;

            });

        records = records.concat(extractRecordsFromRows(rowObjects));

    });

    return records;

}

/* Pasted rows: comma separated, matching the modal's hint
   order (Reg No, Class, Payment Mode, Issued Date, Valid
   Date, Amount, Mobile No, UTR). Extra/missing trailing
   fields are simply left blank. */

function extractRecordsFromText(text) {

    const pastedFieldOrder = [
        "number", "vehicleClass", "modeOfPayment",
        "issuedDate", "validTill", "amount", "mobileNo", "utr"
    ];

    return text

        .split(/\n+/)

        .map(line => line.trim())

        .filter(line => line.length > 0)

        .map(line => {

            const parts = line.split(",").map(p => p.trim());

            const record = {};

            pastedFieldOrder.forEach((field, i) => {

                record[field] = parts[i] || "";

            });

            return record;

        })

        .filter(record => record.number.length > 0);

}

/* ===============================
   MANAGE MODAL (file / paste)
=============================== */

function setupPassListManager() {

    const addBtn = document.getElementById("passListAddBtn");

    const clearBtn = document.getElementById("passListClearBtn");

    const fileInput = document.getElementById("passListFileInput");

    const textarea = document.getElementById("passListTextarea");

    const statusEl = document.getElementById("passListStatus");

    if (addBtn) {

        addBtn.addEventListener("click", async function () {

            const file = fileInput && fileInput.files && fileInput.files[0];

            const pastedText = textarea ? textarea.value : "";

            if (!file && !pastedText.trim()) {

                if (statusEl) {

                    statusEl.className = "small mb-2 text-danger";

                    statusEl.textContent =
                        "Please choose a file or paste at least one row.";

                }

                return;

            }

            const finish = async (records) => {

                const result = addToPassList(records);

                renderPassListCount();

                /* Push to Firestore so all users see the update */

                if (typeof fbSaveSharedPassList === "function") {

                    if (statusEl) {
                        statusEl.className = "small mb-2 text-muted";
                        statusEl.textContent = "Saving to cloud…";
                    }

                    await fbSaveSharedPassList(monthlyPassList);

                }

                if (statusEl) {

                    statusEl.className = "small mb-2 text-success";

                    statusEl.textContent =
                        `✅ Added ${result.added} new, updated ${result.updated} existing. Total: ${getPassListCount()}. Saved to cloud — all users will see this list.`;

                }

                if (textarea) textarea.value = "";

                if (fileInput) fileInput.value = "";

            };

            if (pastedText.trim()) {

                finish(extractRecordsFromText(pastedText));

            }

            if (file) {

                const reader = new FileReader();

                reader.onload = function (e) {

                    try {

                        const data = new Uint8Array(e.target.result);

                        const workbook = XLSX.read(data, {

                            type: "array",

                            cellDates: true

                        });

                        finish(extractRecordsFromWorkbook(workbook));

                    } catch (err) {

                        if (statusEl) {

                            statusEl.className = "small mb-2 text-danger";

                            statusEl.textContent =
                                "Could not read that file. Please upload a valid Excel or CSV file.";

                        }

                    }

                };

                reader.readAsArrayBuffer(file);

            }

        });

    }

    if (clearBtn) {

        clearBtn.addEventListener("click", async function () {

            if (!confirm(`Clear all ${getPassListCount()} vehicle numbers from the monthly pass list?\n\nThis will also clear the list for ALL other users.`)) {

                return;

            }

            clearPassList();

            renderPassListCount();

            /* Clear from Firestore too */

            if (typeof fbClearSharedPassList === "function") {

                await fbClearSharedPassList();

            }

            if (statusEl) {

                statusEl.className = "small mb-2 text-success";

                statusEl.textContent = "Pass list cleared for all users.";

            }

        });

    }

}

/* ===============================
   QUICK CHECK WIDGET
=============================== */

function isPassExpired(validTill) {

    if (!validTill) return null;

    const parsed = parseValidTillDate(validTill);

    if (!parsed || isNaN(parsed.getTime())) return null;

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    return parsed < today;

}

/* ===============================
   PARSE "Pass Valid Date" STRINGS

   These come from the pass list as
   DD/MM/YYYY (e.g. "05/08/2026" =
   5th August 2026). new Date(str)
   would instead read that as the
   US MM/DD/YYYY format (May 8th),
   silently misjudging expiry for
   any day-of-month <= 12. Parse the
   parts explicitly to avoid that.
=============================== */

function parseValidTillDate(validTill) {

    const match =
        /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(String(validTill).trim());

    if (!match) {

        const fallback = new Date(validTill);

        return isNaN(fallback.getTime()) ? null : fallback;

    }

    const day = Number(match[1]);

    const month = Number(match[2]);

    const year = Number(match[3]);

    const parsed = new Date(year, month - 1, day);

    return isNaN(parsed.getTime()) ? null : parsed;

}

/* ===============================
   PASS RESULT — FORMAT HELPERS
=============================== */

function passDetailRow(label, value) {
    return `<tr><td class="pass-detail-label">${label}</td><td>${value || '<span class="text-muted">—</span>'}</td></tr>`;
}

/* Pretty date: "01 Jul 2026" or "01/07/2026" → "1 July 2026" */
function fmtPassDate(raw) {
    if (!raw) return "—";
    /* try DD/MM/YYYY or DD-MM-YYYY */
    const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(String(raw).trim());
    if (m) {
        const months = ["January","February","March","April","May","June",
                        "July","August","September","October","November","December"];
        return `${parseInt(m[1],10)} ${months[parseInt(m[2],10)-1]} ${m[3]}`;
    }
    /* try "01 Jul 2026" style already */
    return raw;
}

/* Currency: never scientific notation; adds ₹ and commas */
function fmtPassAmount(raw) {
    if (!raw && raw !== 0) return "—";
    const num = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
    if (isNaN(num)) return String(raw);
    return "₹" + num.toLocaleString("en-IN");
}

/* Phone: +91 XXXXX XXXXX */
function fmtPassPhone(raw) {
    if (!raw) return "—";
    const digits = String(raw).replace(/\D/g, "");
    if (digits.length === 10) return `+91 ${digits.slice(0,5)} ${digits.slice(5)}`;
    if (digits.length === 12 && digits.startsWith("91")) return `+${digits.slice(0,2)} ${digits.slice(2,7)} ${digits.slice(7)}`;
    return raw;
}

/* Remaining days from today */
function remainingDays(validTill) {
    const d = parseValidTillDate(validTill);
    if (!d || isNaN(d.getTime())) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.ceil((d - today) / 86400000);
    return diff;
}

/* ===============================
   PREMIUM PASS RESULT CARD
   Replaces old flat table with
   modern enterprise-style cards.
=============================== */

function buildPassResultCard(record, expired) {

    const days    = remainingDays(record.validTill);
    const isValid = expired !== true;

    /* ── Status badge ── */
    const statusBadge = isValid
        ? `<div class="prc-status-card prc-status-active">
                <div class="prc-status-left">
                    <div class="prc-status-dot prc-dot-active"></div>
                    <div>
                        <div class="prc-status-title">PASS ACTIVE</div>
                        <div class="prc-status-sub">Vehicle has a valid monthly pass.</div>
                    </div>
                </div>
                <div class="prc-status-right">
                    <div class="prc-valid-until-label">Valid Until</div>
                    <div class="prc-valid-until-val">${fmtPassDate(record.validTill)}</div>
                    ${days !== null ? `<div class="prc-days-chip">${days} days left</div>` : ""}
                </div>
           </div>`
        : `<div class="prc-status-card prc-status-expired">
                <div class="prc-status-left">
                    <div class="prc-status-dot prc-dot-expired"></div>
                    <div>
                        <div class="prc-status-title">PASS EXPIRED</div>
                        <div class="prc-status-sub">Treat as no pass — log under actual vehicle class.</div>
                    </div>
                </div>
                <div class="prc-status-right">
                    <div class="prc-valid-until-label">Expired On</div>
                    <div class="prc-valid-until-val prc-expired-date">${fmtPassDate(record.validTill)}</div>
                </div>
           </div>`;

    /* ── Info sections ── */
    const sections = `
        <div class="prc-grid">

            <!-- Vehicle Information -->
            <div class="prc-section-card">
                <div class="prc-section-header">
                    <svg class="prc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-4"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                    Vehicle Information
                </div>
                <div class="prc-field-grid">
                    <div class="prc-field prc-field-highlight">
                        <div class="prc-field-label">Vehicle Number</div>
                        <div class="prc-field-value prc-veh-number">${record.number}</div>
                    </div>
                    <div class="prc-field prc-field-highlight">
                        <div class="prc-field-label">Vehicle Class</div>
                        <div class="prc-field-value">${record.vehicleClass || "—"}</div>
                    </div>
                    <div class="prc-field">
                        <div class="prc-field-label">Pass Status</div>
                        <div class="prc-field-value">
                            <span class="prc-badge ${isValid ? "prc-badge-green" : "prc-badge-red"}">
                                ${isValid ? "Active" : "Expired"}
                            </span>
                        </div>
                    </div>
                    ${record.slNo ? `<div class="prc-field"><div class="prc-field-label">SL No.</div><div class="prc-field-value">${record.slNo}</div></div>` : ""}
                </div>
            </div>

            <!-- Validity -->
            <div class="prc-section-card">
                <div class="prc-section-header">
                    <svg class="prc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    Validity
                </div>
                <div class="prc-field-grid">
                    <div class="prc-field">
                        <div class="prc-field-label">Issue Date</div>
                        <div class="prc-field-value">${fmtPassDate(record.issuedDate)}</div>
                    </div>
                    <div class="prc-field prc-field-highlight">
                        <div class="prc-field-label">Expiry Date</div>
                        <div class="prc-field-value ${!isValid ? "prc-text-danger" : ""}">${fmtPassDate(record.validTill)}</div>
                    </div>
                    ${days !== null ? `<div class="prc-field">
                        <div class="prc-field-label">Remaining Days</div>
                        <div class="prc-field-value ${days < 0 ? "prc-text-danger" : days <= 5 ? "prc-text-warning" : "prc-text-success"}">${days < 0 ? Math.abs(days) + " days ago" : days + " days"}</div>
                    </div>` : ""}
                </div>
            </div>

            <!-- Payment -->
            <div class="prc-section-card">
                <div class="prc-section-header">
                    <svg class="prc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                    Payment
                </div>
                <div class="prc-field-grid">
                    <div class="prc-field">
                        <div class="prc-field-label">Payment Mode</div>
                        <div class="prc-field-value">${record.modeOfPayment || "—"}</div>
                    </div>
                    <div class="prc-field prc-field-highlight">
                        <div class="prc-field-label">Amount</div>
                        <div class="prc-field-value prc-amount">${fmtPassAmount(record.amount)}</div>
                    </div>
                    ${record.utr ? `<div class="prc-field" style="grid-column:1/-1;">
                        <div class="prc-field-label">UTR Number</div>
                        <div class="prc-field-value prc-utr">${record.utr}</div>
                    </div>` : ""}
                </div>
            </div>

            <!-- Contact -->
            <div class="prc-section-card">
                <div class="prc-section-header">
                    <svg class="prc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.27-.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    Contact
                </div>
                <div class="prc-field-grid">
                    <div class="prc-field prc-field-highlight">
                        <div class="prc-field-label">Mobile Number</div>
                        <div class="prc-field-value">${fmtPassPhone(record.mobileNo)}</div>
                    </div>
                </div>
            </div>

        </div>
    `;

    return `
        <div class="prc-wrapper">
            <div class="prc-header-row">
                <span class="prc-header-title">Vehicle Pass Details</span>
                <button type="button" id="passCheckClearBtn" class="prc-close-btn" title="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            ${statusBadge}
            ${sections}
        </div>
    `;

}

function setupPassCheckWidget() {

    const input = document.getElementById("passCheckInput");

    const btn = document.getElementById("passCheckBtn");

    if (!input || !btn) return;

    const runCheck = () => {

        const value = input.value;

        const resultEl = document.getElementById("passCheckResult");

        if (!resultEl) return;

        if (!value || !value.trim()) {

            resultEl.className = "pass-check-result";

            resultEl.innerHTML = "";

            return;

        }

        if (getPassListCount() === 0) {

            resultEl.className = "pass-check-result pass-warning";

            resultEl.innerHTML =
                `<i class="bi bi-exclamation-circle"></i> No pass list loaded yet — use "Monthly Pass List" in the sidebar first.`;

            return;

        }

        const record = getPassRecord(value);

        if (record) {

            const expired = isPassExpired(record.validTill);

            /* Use premium card layout */
            resultEl.className = "pass-check-result";
            resultEl.innerHTML  = buildPassResultCard(record, expired);

            /* Animate in */
            const wrapper = resultEl.querySelector(".prc-wrapper");
            if (wrapper) {
                wrapper.style.opacity = "0";
                wrapper.style.transform = "translateY(8px)";
                requestAnimationFrame(() => {
                    wrapper.style.transition = "opacity .28s ease, transform .28s ease";
                    wrapper.style.opacity    = "1";
                    wrapper.style.transform  = "translateY(0)";
                });
            }

            /* Wire close button */
            const clearBtn = document.getElementById("passCheckClearBtn");
            if (clearBtn) {
                clearBtn.addEventListener("click", () => {
                    resultEl.className = "pass-check-result";
                    resultEl.innerHTML = "";
                    input.value = "";
                });
            }

            if (expired !== true) highlightVehicleButton("Has Pass");

        } else {

            resultEl.className = "pass-check-result";
            resultEl.innerHTML = `
                <div class="prc-not-found">
                    <div class="prc-not-found-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                    </div>
                    <div class="prc-not-found-text">
                        <strong>No pass found</strong>
                        <span>This vehicle is not on the monthly pass list — log it under its actual vehicle class.</span>
                    </div>
                    <button type="button" id="passCheckClearBtn" class="prc-close-btn" title="Close">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>`;

            const clearBtn2 = document.getElementById("passCheckClearBtn");
            if (clearBtn2) {
                clearBtn2.addEventListener("click", () => {
                    resultEl.className = "pass-check-result";
                    resultEl.innerHTML = "";
                    input.value = "";
                });
            }

        }

    };

    btn.addEventListener("click", runCheck);

    input.addEventListener("keyup", function (e) {

        if (e.key === "Enter") runCheck();

    });

}

/* ===============================
   FIND & UPDATE A SINGLE PASS
   Lets the auditor pull up one
   vehicle already on the list (e.g.
   after its pass is renewed) and
   edit its fields directly — no
   re-upload of the whole sheet.
=============================== */

const PASS_EDIT_FIELD_MAP = {

    slNo: "passEditSlNo",
    vehicleClass: "passEditVehicleClass",
    modeOfPayment: "passEditModeOfPayment",
    issuedDate: "passEditIssuedDate",
    validTill: "passEditValidTill",
    amount: "passEditAmount",
    mobileNo: "passEditMobileNo",
    utr: "passEditUtr"

};

let passEditActiveNumber = null;

function setupPassEditWidget() {

    const searchInput = document.getElementById("passEditSearchInput");
    const searchBtn = document.getElementById("passEditSearchBtn");
    const formWrap = document.getElementById("passEditFormWrap");
    const saveBtn = document.getElementById("passEditSaveBtn");
    const deleteBtn = document.getElementById("passEditDeleteBtn");
    const statusEl = document.getElementById("passEditStatus");

    if (!searchInput || !searchBtn) return;

    const setStatus = (message, isError) => {

        if (!statusEl) return;

        statusEl.className = isError ?
            "small mt-2 text-danger" : "small mt-2 text-success";

        statusEl.textContent = message || "";

    };

    const runSearch = () => {

        const value = searchInput.value;

        if (!value || !value.trim()) return;

        const record = getPassRecord(value);

        if (!record) {

            passEditActiveNumber = null;

            if (formWrap) formWrap.style.display = "none";

            setStatus(`No pass found for "${value.trim()}" on the current list.`, true);

            return;

        }

        passEditActiveNumber = record.number;

        Object.keys(PASS_EDIT_FIELD_MAP).forEach(field => {

            const el = document.getElementById(PASS_EDIT_FIELD_MAP[field]);

            if (el) el.value = record[field] || "";

        });

        if (formWrap) formWrap.style.display = "block";

        setStatus(`Loaded pass for ${record.number}. Edit the fields below and save.`, false);

    };

    searchBtn.addEventListener("click", runSearch);

    searchInput.addEventListener("keyup", function (e) {

        if (e.key === "Enter") runSearch();

    });

    if (saveBtn) {

        saveBtn.addEventListener("click", async function () {

            if (!passEditActiveNumber) return;

            const fields = {};

            Object.keys(PASS_EDIT_FIELD_MAP).forEach(field => {

                const el = document.getElementById(PASS_EDIT_FIELD_MAP[field]);

                fields[field] = el ? el.value : "";

            });

            const success = updatePassRecordFields(passEditActiveNumber, fields);

            if (success) {

                renderPassListCount();

                if (typeof fbSaveSharedPassList === "function") {

                    await fbSaveSharedPassList(monthlyPassList);

                }

                setStatus(`✅ Saved — ${passEditActiveNumber} updated for all users.`, false);

            } else {

                setStatus("Could not save — that pass no longer exists on the list.", true);

            }

        });

    }

    if (deleteBtn) {

        deleteBtn.addEventListener("click", async function () {

            if (!passEditActiveNumber) return;

            if (!confirm(`Remove ${passEditActiveNumber} from the pass list?\n\nThis will remove it for ALL users.`)) return;

            const success = deletePassRecord(passEditActiveNumber);

            if (success) {

                passEditActiveNumber = null;

                if (formWrap) formWrap.style.display = "none";

                searchInput.value = "";

                renderPassListCount();

                if (typeof fbSaveSharedPassList === "function") {

                    await fbSaveSharedPassList(monthlyPassList);

                }

                setStatus("✅ Pass removed for all users.", false);

            }

        });

    }

}

function highlightVehicleButton(vehicleName) {

    const btn = document.querySelector(

        `.vehicle-btn[data-vehicle="${vehicleName}"]`

    );

    if (!btn) return;

    btn.classList.add("pass-highlight");

    setTimeout(() => {

        btn.classList.remove("pass-highlight");

    }, 2500);

}
