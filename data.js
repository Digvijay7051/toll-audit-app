/* ==========================================================
   Toll Audit Assistant
   data.js
========================================================== */

/* ===============================
   APPLICATION CONSTANTS
=============================== */

const AUDIT_MODES = [
    "Violation",
    "Exemption"
];

const REPORT_CATEGORIES = [
    "Car",
    "LCV",
    "Truck 2 Axle",
    "Truck 3 Axle",
    "MAV",
    "Auto",
    "Tractor",
    "Bus 2 Axle"
];

const VEHICLE_CLASSES = [
    "Car",
    "LCV",
    "Bus 2 Axle",
    "Minibus",
    "Truck 2 Axle",
    "Truck 3 Axle",
    "MAV",
    "Oversized Vehicle",
    "JCB",
    "Tractor",
    "Auto",
    "Bike",
    "Ambulance",
    "Government Vehicle",
    "Army Vehicle",
    "Police",
    "Has Pass",
    "Paid (Cash)",
    "Paid (ETC)",
    "Paid (Digital)",
    "Forcefully",
    "Fake Violation",
    "Fake Exemption",
    "Concessionaire"
];

/* ===============================
   CURRENT SELECTION
=============================== */

let currentMode = "Violation";

let currentCategory = "Car";

/* ===============================
   SELECTED AUDIT DATE
=============================== */

let selectedAuditDate = "";

function saveSelectedAuditDate(dateStr) {

    selectedAuditDate = dateStr;

    localStorage.setItem("tollAuditSelectedDate", dateStr);

}

function loadSelectedAuditDate() {

    const stored = localStorage.getItem("tollAuditSelectedDate");

    if (stored) {

        selectedAuditDate = stored;

    }

    return selectedAuditDate;

}

/* ===============================
   THEME (DAY / NIGHT)
=============================== */

function saveThemePreference(theme) {

    localStorage.setItem("tollAuditTheme", theme);

}

function loadThemePreference() {

    return localStorage.getItem("tollAuditTheme") || "day";

}

/* ===============================
   APP LOCK STATE
=============================== */

let appLock = {

    pin:             "",   /* raw PIN in memory only — never persisted as-is */
    pinHash:         "",   /* hashed PIN stored locally + in Firestore */
    isLocked:        false,
    autoLockMinutes: 5

};

/* ===============================
   AUDIT DATA
   (stored per audit date, so each
   date's counts/transactions are
   independent and never overwritten
   by another date)
=============================== */

/* ===============================
   CURRENT LOGGED-IN USER
   Audit history/counts are kept
   completely separate per account
   — switching accounts must never
   show another account's work.
=============================== */

let currentUsername = "";

function normalizeUsernameKey(username) {

    return String(username || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_");

}

function getAuditStorageKey() {

    const suffix = currentUsername ?
        normalizeUsernameKey(currentUsername) : "guest";

    return `tollAuditAssistant_${suffix}`;

}

/* ===============================
   PER-USER STICKER / AVATAR
=============================== */

function getAvatarStorageKey() {

    const suffix = currentUsername ?
        normalizeUsernameKey(currentUsername) : "guest";

    return `tollAuditAvatar_${suffix}`;

}

function saveUserAvatar(sticker) {

    localStorage.setItem(getAvatarStorageKey(), sticker);

}

function loadUserAvatar() {

    return localStorage.getItem(getAvatarStorageKey()) || "";

}

/* Called right after a user logs in / signs up, or when an
   existing session is restored on page load. Switches all
   in-memory audit data over to that account's own storage. */

function setActiveUser(username) {

    currentUsername = username || "";

    loadAuditData();

    auditData = getOrCreateAuditBucket(selectedAuditDate);

    if (typeof refreshAvatarDisplays === "function") {

        refreshAvatarDisplays();

    }

}

let auditDataStore = {};

let auditData = {};

/* ===============================
   INITIALIZE DATA
=============================== */

function createEmptyAuditBucket() {

    const bucket = {};

    bucket._meta = {

        resolved: false,

        resolution: null,   /* "completed" | "skipped" | null */

        resolvedAt: null

    };

    AUDIT_MODES.forEach(mode => {

        bucket[mode] = {};

        REPORT_CATEGORIES.forEach(category => {

            bucket[mode][category] = {

                reportCount: 0,

                transactions: [],

                vehicleCounts: {}

            };

            VEHICLE_CLASSES.forEach(vehicle => {

                bucket[mode][category]
                    .vehicleCounts[vehicle] = 0;

            });

        });

    });

    return bucket;

}

function getOrCreateAuditBucket(dateKey) {

    if (!auditDataStore[dateKey]) {

        auditDataStore[dateKey] = createEmptyAuditBucket();

    }

    return auditDataStore[dateKey];

}

/* ===============================
   MIGRATE OLDER SAVED DATA
   Backfills any categories or
   vehicle classes added later
   (e.g. Bus 2 Axle, Has Pass,
   Forcefully) into buckets that
   were saved before they existed.
=============================== */

function migrateAuditDataStore() {

    Object.keys(auditDataStore).forEach(dateKey => {

        const bucket = auditDataStore[dateKey];

        if (!bucket._meta) {

            bucket._meta = {

                resolved: false,

                resolution: null,

                resolvedAt: null

            };

        }

        AUDIT_MODES.forEach(mode => {

            if (!bucket[mode]) {

                bucket[mode] = {};

            }

            REPORT_CATEGORIES.forEach(category => {

                if (!bucket[mode][category]) {

                    bucket[mode][category] = {

                        reportCount: 0,

                        transactions: [],

                        vehicleCounts: {}

                    };

                }

                VEHICLE_CLASSES.forEach(vehicle => {

                    const cur = bucket[mode][category]
                        .vehicleCounts[vehicle];

                    /* Heal missing OR corrupted (NaN) counts by recomputing
                       from the transactions array — the true source of truth. */
                    if (cur === undefined || cur === null ||
                            typeof cur !== "number" || isNaN(cur)) {

                        bucket[mode][category]
                            .vehicleCounts[vehicle] =
                                (bucket[mode][category].transactions || [])
                                    .filter(t => t.actualVehicle === vehicle)
                                    .length;

                    }

                });

                /* Old data used "Bus" — fold it into "Bus 2 Axle" */

                if (

                    bucket[mode][category]
                        .vehicleCounts["Bus"] !== undefined

                ) {

                    bucket[mode][category]
                        .vehicleCounts["Bus 2 Axle"] =

                        (bucket[mode][category]
                            .vehicleCounts["Bus 2 Axle"] || 0) +

                        bucket[mode][category]
                            .vehicleCounts["Bus"];

                    delete bucket[mode][category]
                        .vehicleCounts["Bus"];

                }

            });

        });

    });

}

/* ===============================
   SET ACTIVE AUDIT DATE
   Switches which date's bucket
   "auditData" points to.
=============================== */

function setActiveAuditDate(dateKey) {

    selectedAuditDate = dateKey;

    auditData = getOrCreateAuditBucket(dateKey);

}

/* Sensible default so nothing breaks before a date is chosen */

selectedAuditDate = getTodayKey();

auditData = getOrCreateAuditBucket(selectedAuditDate);

/* ===============================
   GET CURRENT CATEGORY OBJECT
=============================== */

function getCurrentCategoryData() {

    return auditData[currentMode][currentCategory];

}

/* ===============================
   REPORT COUNT
=============================== */

function getReportCount() {

    return getCurrentCategoryData().reportCount;

}

function setReportCount(value) {

    getCurrentCategoryData().reportCount = Number(value);

}

/* ===============================
   CHECKED
=============================== */

function getCheckedCount() {

    return getCurrentCategoryData()
        .transactions.length;

}

/* ===============================
   REMAINING
=============================== */

function getRemainingCount() {

    return Math.max(

        getReportCount() -

        getCheckedCount(),

        0

    );

}

/* ===============================
   PROGRESS
=============================== */

function getProgressPercentage() {

    if (getReportCount() === 0)

        return 0;

    return Math.round(

        (

            getCheckedCount()

            /

            getReportCount()

        ) * 100

    );

}

/* ===============================
   ADD TRANSACTION
=============================== */

function addTransaction(vehicleName) {

    const data = getCurrentCategoryData();

    if (

        data.transactions.length >=

        data.reportCount

    ) {

        return false;

    }

    const transaction = {

        transactionNo:

            data.transactions.length + 1,

        actualVehicle:

            vehicleName,

        comment:

            "",

        timestamp:

            new Date().toISOString()

    };

    data.transactions.push(transaction);

    /* Guard: if key is missing or was previously corrupted to NaN, reset to 0 first */
    if (typeof data.vehicleCounts[vehicleName] !== "number" || isNaN(data.vehicleCounts[vehicleName])) {
        data.vehicleCounts[vehicleName] = 0;
    }
    data.vehicleCounts[vehicleName]++;

    return true;

}

/* ===============================
   DELETE A SINGLE TRANSACTION
   Removes the transaction by number,
   decrements the vehicle count, and
   renumbers remaining transactions
   so there are no gaps.
=============================== */

function deleteTransaction(transactionNo) {

    const data = getCurrentCategoryData();

    const idx = data.transactions.findIndex(
        t => t.transactionNo === transactionNo
    );

    if (idx === -1) return false;

    const txn = data.transactions[idx];

    /* Decrement the vehicle count */

    if (data.vehicleCounts[txn.actualVehicle] !== undefined) {

        data.vehicleCounts[txn.actualVehicle] =
            Math.max(0, data.vehicleCounts[txn.actualVehicle] - 1);

    }

    /* Remove the transaction */

    data.transactions.splice(idx, 1);

    /* Renumber remaining transactions so #s stay sequential */

    data.transactions.forEach((t, i) => {

        t.transactionNo = i + 1;

    });

    return true;

}

/* ===============================
   UPDATE TRANSACTION COMMENT
=============================== */

function updateTransactionComment(transactionNo, commentText) {

    const data = getCurrentCategoryData();

    const txn = data.transactions.find(

        t => t.transactionNo === transactionNo

    );

    if (txn) {

        txn.comment = commentText;

    }

}

/* ===============================
   RESET REPORT COUNT
=============================== */

function resetReportCount() {

    getCurrentCategoryData()

        .reportCount = 0;

}

/* ===============================
   RESET TRANSACTIONS
=============================== */

function resetTransactions() {

    const data =

        getCurrentCategoryData();

    data.transactions = [];

    VEHICLE_CLASSES.forEach(vehicle => {

        data.vehicleCounts[vehicle] = 0;

    });

}

/* ===============================
   RESET CURRENT MODE
=============================== */

function resetCurrentMode() {

    REPORT_CATEGORIES.forEach(category => {

        auditData[currentMode][category]

            .reportCount = 0;

        auditData[currentMode][category]

            .transactions = [];

        VEHICLE_CLASSES.forEach(vehicle => {

            auditData[currentMode][category]

                .vehicleCounts[vehicle] = 0;

        });

    });

}

/* ===============================
   GET VEHICLE COUNTS
=============================== */

function getVehicleCounts() {

    return getCurrentCategoryData()

        .vehicleCounts;

}

/* ===============================
   GET TRANSACTIONS
=============================== */

function getTransactions() {

    return getCurrentCategoryData()

        .transactions;

}

/* ===============================
   AUDIT MATRIX
   Returns a matrix object:
   {
     mode,
     cols: [reportCategory, …],       // system-report column names
     rows: [actualVehicle, …],        // actual-class row names
     reportCounts: {cat: n},          // yellow row — system report counts
     cells: {cat: {vehicle: count}},  // main data
     colTotals: {cat: n},             // footer — sum of each col
     rowTotals: {vehicle: n},         // last col — sum of each row
     grandTotal: n,
     correctTotal: n,                  // cells on or near diagonal
     wrongTotal: n
   }
=============================== */

function buildAuditMatrix(mode) {

    /* Columns are REPORT_CATEGORIES (the system-report classes).
       Rows are the set of actual vehicle classes that appear in
       VEHICLE_CLASSES, plus any special rows (ForceFully, Fake,
       paid variants, pass, ambulance, etc.) that map to the rows
       shown in the Excel format. */

    const cols = REPORT_CATEGORIES; /* 8 cols */

    /* Row order matches the Excel: system categories first
       (diagonal band), then special/exempt classes below */
    /* Row order: match REPORT_CATEGORIES column order so the diagonal
       falls naturally top-left → bottom-right, then special rows below */
    const rows = [
        "Car",           /* col 0 — Car */
        "LCV",           /* col 1 — LCV */
        "Minibus",       /* col 1 — LCV (second diagonal match) */
        "Bus 2 Axle",    /* col 2 — Bus 2 Axle */
        "Truck 2 Axle",  /* col 3 — Truck 2 Axle */
        "Truck 3 Axle",  /* col 4 — Truck 3 Axle */
        "MAV",           /* col 5 — MAV */
        "Oversized Vehicle", /* col 5 — MAV (second diagonal match) */
        "Tractor",       /* col 6 — Tractor */
        "Auto",          /* col 7 — Auto */
        /* ── Special / Exempt classes (no diagonal) ── */
        "Forcefully",
        "Fake Violation",
        "Fake Exemption",
        "Bike",
        "Ambulance",
        "Police",
        "Government Vehicle",
        "Army Vehicle",
        "JCB",
        "Has Pass",
        "Paid (Cash)",
        "Paid (ETC)",
        "Paid (Digital)",
        "Concessionaire",
    ];

    /* "Already paid / found in another txn" — maps to Paid variants */
    const paidRows = ["Paid (Cash)", "Paid (ETC)", "Paid (Digital)"];

    const bucket = auditData[mode];

    /* reportCounts — what the system said */
    const reportCounts = {};
    cols.forEach(cat => {
        reportCounts[cat] = (bucket[cat] && bucket[cat].reportCount) || 0;
    });

    /* Build cell matrix: cells[col][row] = count
       Always count from the transactions array — it is the only field
       that is never corrupted by NaN/null/stale-save race conditions.
       vehicleCounts is a derived cache and cannot be trusted here. */
    const cells = {};
    cols.forEach(cat => {
        cells[cat] = {};
        rows.forEach(r => { cells[cat][r] = 0; });
        const txns = (bucket[cat] && bucket[cat].transactions) || [];
        txns.forEach(t => {
            const v = t.actualVehicle;
            if (v && cells[cat][v] !== undefined) {
                cells[cat][v]++;
            }
        });
    });

    /* Column totals (actual transactions audited per system category) */
    const colTotals = {};
    cols.forEach(cat => {
        colTotals[cat] = rows.reduce((s, r) => s + (cells[cat][r] || 0), 0);
    });

    /* Row totals */
    const rowTotals = {};
    rows.forEach(r => {
        rowTotals[r] = cols.reduce((s, cat) => s + (cells[cat][r] || 0), 0);
    });

    const grandTotal = cols.reduce((s, cat) => s + colTotals[cat], 0);

    /* Diagonal mapping: which row is "correct" for each col?
       If system said "Car" and actual was "Car" → diagonal.
       Also, col "LCV" can correctly match row "LCV" or "Minibus"
       (since LCV/Minibus is one system class). */
    const diagonalMap = {
        "Car":          ["Car"],
        "LCV":          ["LCV", "Minibus"],
        "Truck 2 Axle": ["Truck 2 Axle"],
        "Truck 3 Axle": ["Truck 3 Axle"],
        "MAV":          ["MAV", "Oversized Vehicle"],
        "Auto":         ["Auto"],
        "Tractor":      ["Tractor"],
        "Bus 2 Axle":   ["Bus 2 Axle"],
    };

    let correctTotal = 0;
    cols.forEach(cat => {
        const diagRows = diagonalMap[cat] || [cat];
        diagRows.forEach(r => {
            correctTotal += cells[cat][r] || 0;
        });
    });

    const wrongTotal = grandTotal - correctTotal;

    return {
        mode,
        cols,
        rows,
        reportCounts,
        cells,
        colTotals,
        rowTotals,
        grandTotal,
        correctTotal,
        wrongTotal,
        diagonalMap,
    };

}

/* ===============================
   SAVE
   Architecture (scalable to 1 lakh+ txns):
   • localStorage  — always, instant, offline-first
   • Firestore     — per-date document in userAuditLogs
                     only the active date is synced on each save
                     (NOT the whole store as a JSON blob — that
                     hits the 1MB doc limit quickly)
   • Debounced Firestore write — max once per 2 s so rapid
     tapping never floods the network
=============================== */

let _fsyncTimer    = null;
let _chipHideTimer = null;

/* ── Auto-save status chip helpers ── */
function _showSaveChip(state, text) {
    const chip = document.getElementById("saveStatusChip");
    const dot  = document.getElementById("saveStatusDot");
    const txt  = document.getElementById("saveStatusText");
    if (!chip) return;
    clearTimeout(_chipHideTimer);
    chip.className = "save-status-chip " + state;
    chip.style.display = "flex";
    if (txt) txt.textContent = text;
    /* Auto-hide after 4 s for non-saving states */
    if (state !== "ss-saving") {
        _chipHideTimer = setTimeout(() => {
            chip.style.opacity = "0";
            setTimeout(() => { chip.style.display = "none"; chip.style.opacity = "1"; }, 400);
        }, 4000);
    }
}

function saveAuditData() {

    /* Show "Saving…" immediately */
    _showSaveChip("ss-saving", "Saving…");

    /* 1. localStorage — always synchronous, instant */
    localStorage.setItem(
        getAuditStorageKey(),
        JSON.stringify(auditDataStore)
    );

    /* Show "Saved locally" as soon as localStorage write completes */
    _showSaveChip("ss-local", "Saved locally ✓");

    /* 2. Firestore — debounced, only current date's bucket */
    clearTimeout(_fsyncTimer);
    _fsyncTimer = setTimeout(() => {
        _syncCurrentDateToFirestore();
    }, 2000);

    /* 3. Sidebar history panel — only if sidebar is open to avoid invisible re-renders */
    const historyPanel = document.getElementById("historyDateList");
    if (historyPanel && historyPanel.offsetParent !== null && typeof renderHistoryPanel === "function") {
        renderHistoryPanel();
    }

}

/* Syncs only the active date's bucket to Firestore as a
   userAuditLogs document. This is safe for 1 lakh+ txns because
   each date is its own document — no single-blob 1MB limit. */
async function _syncCurrentDateToFirestore() {

    if (typeof fbDb === "undefined" || !fbDb) return;
    if (typeof fbAuth === "undefined" || !fbAuth || !fbAuth.currentUser) return;

    const dateKey = selectedAuditDate || getTodayKey();
    const bucket  = auditDataStore[dateKey];
    if (!bucket) return;

    const uid = fbAuth.currentUser.uid;

    try {
        await fbDb.collection("userAuditLogs")
            .doc(`${uid}_${dateKey}`)
            .set({
                uid,
                dateKey,
                autoSavedAt: new Date().toISOString(),
                auditBucket: JSON.stringify(bucket)  /* compressed bucket */
            }, { merge: true });
        _showSaveChip("ss-cloud", "Synced to cloud ✓");
    } catch (e) {
        /* Silent — offline / permission errors should not interrupt work */
        console.warn("[AutoSync] Firestore sync failed:", e.code || e.message);
        _showSaveChip("ss-offline", "Offline — saved locally");
    }

}

/* ===============================
   LOAD
   1. Reads localStorage first (instant)
   2. Then fetches ALL userAuditLogs docs for this user
      from Firestore and merges them in — so data from
      any previous device/session appears immediately.
=============================== */

function loadAuditData() {

    /* Always read from localStorage first (instant, offline-safe) */
    const data = localStorage.getItem(getAuditStorageKey());
    auditDataStore = data ? JSON.parse(data) : {};
    migrateAuditDataStore();

    const lastDate = loadSelectedAuditDate() || getTodayKey();
    setActiveAuditDate(lastDate);

    /* Background: fetch all dates from Firestore userAuditLogs collection */
    _mergeAllDatesFromFirestore();

}

async function _mergeAllDatesFromFirestore() {

    if (typeof fbDb === "undefined" || !fbDb) return;

    /* Wait until auth state is known */
    if (typeof fbAuthReady !== "undefined") await fbAuthReady;

    if (typeof fbAuth === "undefined" || !fbAuth || !fbAuth.currentUser) return;

    const uid    = fbAuth.currentUser.uid;
    const prefix = uid + "_";   // retained for the doc.id fallback below

    try {
        /* Query by uid field — the security rule enforces uid == caller.
           Replaces the old document-ID prefix range scan. */
        const snap = await fbDb.collection("userAuditLogs")
            .where("uid", "==", uid)
            .get();

        /* NOTE: Do NOT return early when snap.empty — still persist + refresh
           so that any stale placeholder buckets get cleared from localStorage. */

        let merged = false;

        snap.docs.forEach(doc => {
            const d = doc.data();
            const dateKey = d.dateKey || doc.id.replace(prefix, "");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;

            /* Path A — full auto-saved bucket is present (most common) */
            if (d.auditBucket) {
                try {
                    const cloudBucket = JSON.parse(d.auditBucket);
                    /* Cloud wins if local has no data for this date OR
                       cloud has more transactions (most recent device wins) */
                    const localTxnCount = _countTransactions(auditDataStore[dateKey]);
                    const cloudTxnCount = _countTransactions(cloudBucket);
                    if (!auditDataStore[dateKey] || cloudTxnCount >= localTxnCount) {
                        auditDataStore[dateKey] = cloudBucket;
                        merged = true;
                    }
                } catch (_) { /* corrupted JSON — skip */ }

            /* Path B — older doc saved via fbSaveAuditLog without auditBucket:
               reconstruct a bucket from the flat `rows` + `reportCounts` arrays
               so transaction data is never lost when opening on a new device.   */
            } else if (d.rows && Array.isArray(d.rows) && d.rows.length > 0) {
                const localTxnCount = _countTransactions(auditDataStore[dateKey]);
                if (!auditDataStore[dateKey] || d.rows.length >= localTxnCount) {
                    const rebuilt = _rebuildBucketFromRows(d.rows, d.reportCounts || {});
                    auditDataStore[dateKey] = rebuilt;
                    merged = true;
                }

            /* Path C — doc exists but has no usable data; ensure the date
               at least appears in the sidebar history panel.                    */
            } else if (!auditDataStore[dateKey]) {
                auditDataStore[dateKey] = createEmptyAuditBucket();
                merged = true;
            }
        });

        /* Always persist + re-point auditData after the cloud fetch, even when
           nothing changed — this flushes any placeholder buckets that were written
           before the cloud response arrived (fixes new-device empty-state bug). */
        localStorage.setItem(getAuditStorageKey(), JSON.stringify(auditDataStore));
        migrateAuditDataStore();
        setActiveAuditDate(selectedAuditDate || getTodayKey());

        /* Always refresh the UI so data that arrived after the initial render
           is immediately visible — not just when the merged flag is true.       */
        if (typeof renderHistoryPanel === "function") renderHistoryPanel();
        if (merged) {
            if (typeof refreshUI          === "function") refreshUI();
            if (typeof tlRefreshAuditFill === "function") tlRefreshAuditFill();
        }

    } catch (e) {
        console.warn("[LoadDates] Firestore fetch failed:", e.code || e.message);
    }

}

/* Rebuilds a full auditDataStore bucket from the flat `rows` array that
   fbSaveAuditLog writes to Firestore — used when auditBucket is absent.
   Each row: { mode, category, vehicle, txnNo, time, reportCount, comment } */
function _rebuildBucketFromRows(rows, reportCounts) {

    const bucket = createEmptyAuditBucket();

    rows.forEach(row => {
        const { mode, category, vehicle, txnNo, time, reportCount, comment } = row;
        if (!mode || !category) return;
        if (!bucket[mode]) return;
        if (!bucket[mode][category]) return;

        /* Set reportCount from the row (all rows for same mode+cat share the same value) */
        if (reportCount) bucket[mode][category].reportCount = reportCount;

        /* Reconstruct a minimal transaction object */
        const txn = {
            transactionNo: txnNo || "",
            actualVehicle: vehicle || "",
            comment:       comment || ""
        };

        /* Convert "HH:MM:SS AM/PM" back to a timestamp (best-effort) */
        if (time) {
            try {
                const today = new Date().toISOString().slice(0, 10);
                const ts    = new Date(`${today} ${time}`);
                if (!isNaN(ts.getTime())) txn.timestamp = ts.getTime();
            } catch (_) { /* ignore */ }
        }

        bucket[mode][category].transactions.push(txn);

        /* Keep vehicleCounts in sync */
        if (vehicle) {
            bucket[mode][category].vehicleCounts[vehicle] =
                (bucket[mode][category].vehicleCounts[vehicle] || 0) + 1;
        }
    });

    /* Apply reportCounts snapshot if available (more accurate than per-row value) */
    if (reportCounts && typeof reportCounts === "object") {
        AUDIT_MODES.forEach(mode => {
            if (!reportCounts[mode]) return;
            REPORT_CATEGORIES.forEach(cat => {
                const snap = reportCounts[mode][cat];
                if (snap && typeof snap.reportCount === "number") {
                    bucket[mode][cat].reportCount = snap.reportCount;
                }
            });
        });
    }

    return bucket;

}

/* Counts total transactions across all modes/categories in a bucket */
function _countTransactions(bucket) {
    if (!bucket) return 0;
    let n = 0;
    AUDIT_MODES.forEach(mode => {
        const md = bucket[mode]; if (!md) return;
        REPORT_CATEGORIES.forEach(cat => {
            const c = md[cat]; if (!c) return;
            n += (c.transactions || []).length;
        });
    });
    return n;
}

/* ===============================
   DATE-WISE REPORT HISTORY
   Every audit date already lives as
   its own bucket in auditDataStore,
   so history simply reads it back.
=============================== */

function getTodayKey() {

    const d = new Date();

    const yyyy = d.getFullYear();

    const mm = String(d.getMonth() + 1).padStart(2, "0");

    const dd = String(d.getDate()).padStart(2, "0");

    return `${yyyy}-${mm}-${dd}`;

}

function getAllHistoryDates() {

    /* Filter out internal keys like "_meta" — only return YYYY-MM-DD date keys */

    return Object.keys(auditDataStore)
        .filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k))
        .sort()
        .reverse();

}

function deleteHistoryDate(dateKey) {

    delete auditDataStore[dateKey];

    /* If the active date was deleted, re-point auditData to a fresh empty
       bucket WITHOUT re-inserting it into the store immediately — the bucket
       will be created on demand the next time the user saves or switches dates. */
    if (dateKey === selectedAuditDate) {

        auditData = createEmptyAuditBucket();

    }

    /* Use per-user key so we don't accidentally clobber another account */

    localStorage.setItem(

        getAuditStorageKey(),

        JSON.stringify(auditDataStore)

    );

    if (typeof renderHistoryPanel === "function") {

        renderHistoryPanel();

    }

    /* Refresh UI so stat cards / progress / vehicle counts reflect the cleared state */
    if (typeof refreshUI === "function") {

        refreshUI();

    }

}

function getHistorySnapshot(dateKey) {

    return auditDataStore[dateKey] || null;

}

/* ===============================
   PENDING AUDIT DETECTION
   A date is considered "started"
   if any category (either mode)
   has a report count set or has
   at least one transaction logged.
=============================== */

function isBucketStarted(bucket) {

    if (!bucket) return false;

    return AUDIT_MODES.some(mode =>

        REPORT_CATEGORIES.some(category => {

            const data = bucket[mode][category];

            return (

                data.reportCount > 0 ||

                data.transactions.length > 0

            );

        })

    );

}

/* Finds the most recent past date (before today)
   that was started but never marked completed
   or skipped by the user. Returns null if none. */

function getPendingPastDate() {

    const todayKey = getTodayKey();

    const pastDates =
        Object.keys(auditDataStore)
            .filter(dateKey => dateKey < todayKey)
            .sort()
            .reverse();

    for (const dateKey of pastDates) {

        const bucket = auditDataStore[dateKey];

        const meta = bucket._meta || {};

        /* Auto-resolve if every started category is fully audited */
        if (isBucketStarted(bucket) && !meta.resolved) {

            const isComplete = AUDIT_MODES.every(mode =>
                REPORT_CATEGORIES.every(cat => {
                    const d = bucket[mode] && bucket[mode][cat];
                    if (!d || d.reportCount === 0) return true;
                    return d.transactions.length >= d.reportCount;
                })
            );

            if (isComplete) {
                bucket._meta        = bucket._meta || {};
                bucket._meta.resolved   = true;
                bucket._meta.resolution = "completed";
                bucket._meta.resolvedAt = new Date().toISOString();
                saveAuditData();
                continue; /* not pending */
            }

            return dateKey;

        }

    }

    return null;

}

function markDateSkipped(dateKey) {

    const bucket = getOrCreateAuditBucket(dateKey);

    bucket._meta.resolved = true;

    bucket._meta.resolution = "skipped";

    bucket._meta.resolvedAt = new Date().toISOString();

    saveAuditData();

}

function markDateCompleted(dateKey) {

    const bucket = getOrCreateAuditBucket(dateKey);

    bucket._meta.resolved = true;

    bucket._meta.resolution = "completed";

    bucket._meta.resolvedAt = new Date().toISOString();

    saveAuditData();

}

/* ===============================
   LOCK SAVE / LOAD
=============================== */

function saveLockState() {

    /* Store hashed PIN locally */
    const hashed = appLock.pin ? _hashPin(appLock.pin) : "";

    localStorage.setItem(

        "tollAuditLock",

        JSON.stringify({

            pinHash:         hashed,
            autoLockMinutes: appLock.autoLockMinutes

        })

    );

    /* Sync to Firestore so it works on every device */
    if (typeof fbSaveLockPin === "function") {

        fbSaveLockPin(hashed);

    }

}

function loadLockState() {

    const data = localStorage.getItem("tollAuditLock");

    if (data) {

        const parsed = JSON.parse(data);

        /* Support both old plain-text "pin" and new "pinHash" */
        appLock.pinHash = parsed.pinHash || (parsed.pin ? _hashPin(parsed.pin) : "");

        appLock.autoLockMinutes = parsed.autoLockMinutes || 5;

    }

}

async function loadLockStateFromCloud() {

    if (typeof fbLoadLockPin !== "function") return;

    const cloudHash = await fbLoadLockPin();

    if (cloudHash) {

        appLock.pinHash = cloudHash;

        /* Persist locally too */
        localStorage.setItem(
            "tollAuditLock",
            JSON.stringify({
                pinHash: cloudHash,
                autoLockMinutes: appLock.autoLockMinutes
            })
        );

    }

}

function validateLockPin(entered) {

    if (!appLock.pinHash) return false;

    return _hashPin(String(entered)) === appLock.pinHash;

}

function hasLockPin() {

    return !!appLock.pinHash;

}

/* ===============================
   USER ACCOUNTS (LOGIN / SIGNUP)
=============================== */

function getUsers() {

    const raw = localStorage.getItem("tollAuditUsers");

    return raw ? JSON.parse(raw) : {};

}

function saveUsers(users) {

    localStorage.setItem(

        "tollAuditUsers",

        JSON.stringify(users)

    );

}

function _randomSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function _hashPassword(password, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(salt + ":" + password);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function registerUser(username, password) {
    const users = getUsers();
    const key = username.toLowerCase();
    if (users[key]) {
        return { success: false, message: "This username is already taken." };
    }
    const salt = _randomSalt();
    const passwordHash = await _hashPassword(password, salt);
    users[key] = { displayName: username, passwordHash, salt };
    saveUsers(users);
    return { success: true };
}

async function validateUser(username, password) {
    const users = getUsers();
    const key = username.toLowerCase();
    const record = users[key];
    if (!record) return null;

    /* Legacy plaintext account → verify once, then silently migrate to hash */
    if (record.password !== undefined) {
        if (record.password !== password) return null;
        const salt = _randomSalt();
        record.passwordHash = await _hashPassword(password, salt);
        record.salt = salt;
        delete record.password;
        users[key] = record;
        saveUsers(users);
        return record.displayName;
    }

    const hash = await _hashPassword(password, record.salt);
    if (hash !== record.passwordHash) return null;
    return record.displayName;
}

/* ===============================
   CHANGE USERNAME
   Renames the account record and
   migrates this account's audit
   data + avatar to the new
   username's storage keys (both
   are namespaced per-account).
=============================== */

function renameCurrentUser(newUsernameRaw) {

    const newUsername = String(newUsernameRaw || "").trim();

    if (!newUsername) {

        return { success: false, message: "Please enter a username." };

    }

    const oldUsername = currentUsername;

    if (!oldUsername) {

        return { success: false, message: "Could not find your account." };

    }

    if (newUsername.toLowerCase() === oldUsername.toLowerCase()) {

        return { success: false, message: "That's already your username." };

    }

    const users = getUsers();

    const oldKey = oldUsername.toLowerCase();

    const newKey = newUsername.toLowerCase();

    if (users[newKey]) {

        return { success: false, message: "This username is already taken." };

    }

    const record = users[oldKey];

    if (!record) {

        return { success: false, message: "Could not find your account." };

    }

    delete users[oldKey];

    record.displayName = newUsername;

    users[newKey] = record;

    saveUsers(users);

    const oldStorageSuffix = normalizeUsernameKey(oldUsername);

    const newStorageSuffix = normalizeUsernameKey(newUsername);

    if (oldStorageSuffix !== newStorageSuffix) {

        [

            ["tollAuditAssistant_", oldStorageSuffix, newStorageSuffix],
            ["tollAuditAvatar_", oldStorageSuffix, newStorageSuffix]

        ].forEach(([prefix, oldSuffix, newSuffix]) => {

            const oldStorageKey = `${prefix}${oldSuffix}`;

            const newStorageKey = `${prefix}${newSuffix}`;

            const existingValue = localStorage.getItem(oldStorageKey);

            if (existingValue !== null) {

                localStorage.setItem(newStorageKey, existingValue);

                localStorage.removeItem(oldStorageKey);

            }

        });

    }

    currentUsername = newUsername;

    saveSession(newUsername);

    return { success: true, username: newUsername };

}

/* ===============================
   SESSION (CURRENT LOGIN)
=============================== */

function saveSession(displayName) {

    localStorage.setItem(

        "tollAuditSession",

        JSON.stringify({

            username: displayName,

            loginTime: new Date().toISOString()

        })

    );

}

function getSession() {

    const raw = localStorage.getItem("tollAuditSession");

    return raw ? JSON.parse(raw) : null;

}

function clearSession() {

    localStorage.removeItem("tollAuditSession");

}

/* ===============================
   QUICK PIN  (device-local login)
   PIN is stored as a simple hash so
   the raw digits never sit in storage.
   Tied to the specific username so
   two accounts can have different PINs.
=============================== */

function _pinKey(username) {
    return "tollAuditPIN_" + normalizeUsernameKey(username);
}

function _hashPin(pin) {
    /* djb2 hash — simple, no crypto dependency needed */
    let h = 5381;
    for (let i = 0; i < pin.length; i++) {
        h = ((h << 5) + h) + pin.charCodeAt(i);
        h = h & 0xffffffff;
    }
    return "pin_" + (h >>> 0).toString(16);
}

function saveQuickPin(username, pin) {
    const hashed = _hashPin(pin);
    localStorage.setItem(_pinKey(username), hashed);
    /* Sync to Firestore so it works on every device */
    if (typeof fbSaveQuickPin === "function") {
        fbSaveQuickPin(hashed);
    }
}

function validateQuickPin(username, pin) {
    const stored = localStorage.getItem(_pinKey(username));
    if (!stored) return false;
    return stored === _hashPin(pin);
}

function hasQuickPin(username) {
    return !!localStorage.getItem(_pinKey(username));
}

function clearQuickPin(username) {
    localStorage.removeItem(_pinKey(username));
    /* Clear from Firestore too */
    if (typeof fbSaveQuickPin === "function") {
        fbSaveQuickPin("");
    }
}

function getQuickPinUsername() {
    /* Return the username that has a PIN set on this device */
    const session = getSession();
    if (session && hasQuickPin(session.username)) return session.username;
    /* Scan all known users */
    const users = getUsers();
    for (const key of Object.keys(users)) {
        const name = users[key].displayName;
        if (hasQuickPin(name)) return name;
    }
    return null;
}

/* ===============================
   I-CODE  (Firebase-UID-tied login code)
   Unlike Quick PIN (username-based),
   I-CODE is keyed to the Firebase UID
   so it only works for verified accounts.
   Storage key: tollAuditICode_{uid}
=============================== */

function _icodeKey(uid) {
    return "tollAuditICode_" + uid;
}

function saveICode(uid, code) {
    const hashed = _hashPin(code);   /* reuse same djb2 hash as PINs */
    localStorage.setItem(_icodeKey(uid), hashed);
    /* Sync to Firestore only for Firebase users (uid doesn't start with "user_") */
    if (!uid.startsWith("user_") && typeof fbSaveICode === "function") {
        fbSaveICode(hashed);
    }
}

function validateICode(uid, code) {
    const stored = localStorage.getItem(_icodeKey(uid));
    if (!stored) return false;
    return stored === _hashPin(code);
}

function hasICode(uid) {
    return !!localStorage.getItem(_icodeKey(uid));
}

function clearICode(uid) {
    localStorage.removeItem(_icodeKey(uid));
    /* Only clear Firestore for Firebase users */
    if (!uid.startsWith("user_") && typeof fbSaveICode === "function") {
        fbSaveICode("");
    }
}

/* Returns the stored Firebase UID that has an I-CODE set on this device.
   We persist the UID→username mapping in a small localStorage entry so
   we can show "Hello <name>" on the I-CODE tab without re-authenticating. */
function getICodeEntry() {
    const raw = localStorage.getItem("tollAuditICodeEntry");
    return raw ? JSON.parse(raw) : null;
}

function saveICodeEntry(uid, username) {
    localStorage.setItem("tollAuditICodeEntry", JSON.stringify({ uid, username }));
}

function clearICodeEntry() {
    localStorage.removeItem("tollAuditICodeEntry");
}

/* ===============================
   LOAD ALL CLOUD DATA
   Single entry-point called after
   every login. Waits for Firebase
   auth to confirm the UID, then
   pulls audit data + lock PIN +
   quick PIN + I-CODE from Firestore
   and merges into local state.
=============================== */

async function loadAllCloudData(username) {

    /* 1. Wait for Firebase auth to confirm who the user is */
    if (typeof fbAuthReady !== "undefined") {
        await fbAuthReady;
    }

    /* 2. Load PINs + I-CODE from Firestore in parallel */
    const [cloudLockPin, cloudQuickPin, cloudICode] = await Promise.all([
        typeof fbLoadLockPin  === "function" ? fbLoadLockPin()  : Promise.resolve(null),
        typeof fbLoadQuickPin === "function" ? fbLoadQuickPin() : Promise.resolve(null),
        typeof fbLoadICode    === "function" ? fbLoadICode()    : Promise.resolve(null)
    ]);

    /* 3. Merge all Firestore audit dates — reuses the same loader as loadAuditData() */
    await _mergeAllDatesFromFirestore();

    /* 4. Restore lock PIN */
    if (cloudLockPin) {
        appLock.pinHash = cloudLockPin;
        localStorage.setItem("tollAuditLock", JSON.stringify({
            pinHash: cloudLockPin,
            autoLockMinutes: appLock.autoLockMinutes
        }));
    }

    /* 5. Restore Quick PIN */
    if (cloudQuickPin && username) {
        const localHash = localStorage.getItem(_pinKey(username));
        if (localHash !== cloudQuickPin) {
            localStorage.setItem(_pinKey(username), cloudQuickPin);
            if (window._refreshAuthTabs) window._refreshAuthTabs();
        }
    }

    /* 6. Restore I-CODE — keyed to Firebase UID */
    const uid = (typeof fbAuth !== "undefined" && fbAuth && fbAuth.currentUser)
        ? fbAuth.currentUser.uid : null;
    if (cloudICode && uid) {
        const localHash = localStorage.getItem(_icodeKey(uid));
        if (localHash !== cloudICode) {
            localStorage.setItem(_icodeKey(uid), cloudICode);
        }
        /* Always keep the ICodeEntry fresh after cloud sync */
        saveICodeEntry(uid, username);
        if (window._refreshICodeTab) window._refreshICodeTab();
    }

}

/* ===============================
   MONTHLY PASS LIST
   Lets the auditor upload/paste their
   monthly pass sheet, or sync it live
   from a published Google Sheet, so a
   vehicle number can be checked against
   it while auditing (e.g. to tell
   "Bus (Exempted)" apart from "Bus Pass",
   and see the pass's full details).

   Each record carries every column from
   the pass register:
   SL NO, VEHICLE REG NO, VEHICLE CLASS,
   MODE OF PAYMENT, PASS ISSUED DATE,
   PASS VALID DATE, AMOUNT, MOBILE NO, UTR
=============================== */

let monthlyPassList = [];

const PASS_RECORD_FIELDS = [
    "slNo", "vehicleClass", "modeOfPayment",
    "issuedDate", "validTill", "amount",
    "mobileNo", "utr"
];

function normalizeVehicleNo(value) {

    return String(value || "")

        .trim()

        .toUpperCase()

        .replace(/[\s\-]+/g, "");

}

function loadPassList() {

    const raw = localStorage.getItem("tollAuditPassListV2");

    const parsed = raw ? JSON.parse(raw) : [];

    /* Backward compatibility: older saved lists carried fewer
       fields (or were just plain strings). Upgrade those into
       the current full record shape. */

    monthlyPassList = parsed.map(entry => {

        if (typeof entry === "string") {

            entry = { number: entry };

        }

        const record = {

            number: normalizeVehicleNo(entry.number)

        };

        PASS_RECORD_FIELDS.forEach(field => {

            record[field] = entry[field] || "";

        });

        return record;

    });

    return monthlyPassList;

}

function savePassList() {

    localStorage.setItem(

        "tollAuditPassListV2",

        JSON.stringify(monthlyPassList)

    );

}

/* records: array of objects with `number` plus any of
   PASS_RECORD_FIELDS. A record whose number already exists
   gets its fields updated (only fields that were actually
   provided); a new number is appended.
   Returns { added, updated } counts. */

function addToPassList(records) {

    const byNumber = new Map(

        monthlyPassList.map(entry => [entry.number, entry])

    );

    let added = 0;

    let updated = 0;

    records.forEach(record => {

        const normalized = normalizeVehicleNo(record.number);

        if (!normalized) return;

        if (byNumber.has(normalized)) {

            const existing = byNumber.get(normalized);

            PASS_RECORD_FIELDS.forEach(field => {

                const value = (record[field] || "").toString().trim();

                if (value) existing[field] = value;

            });

            updated++;

        } else {

            const fresh = { number: normalized };

            PASS_RECORD_FIELDS.forEach(field => {

                fresh[field] = (record[field] || "").toString().trim();

            });

            byNumber.set(normalized, fresh);

            added++;

        }

    });

    monthlyPassList = Array.from(byNumber.values());

    savePassList();

    return { added, updated };

}

/* Fully replaces the list with a fresh set of records — used
   for Google Sheet sync, so deletions/edits made in the sheet
   are reflected here too, not just additions. */

function replacePassList(records) {

    const byNumber = new Map();

    records.forEach(record => {

        const normalized = normalizeVehicleNo(record.number);

        if (!normalized) return;

        const fresh = { number: normalized };

        PASS_RECORD_FIELDS.forEach(field => {

            fresh[field] = (record[field] || "").toString().trim();

        });

        byNumber.set(normalized, fresh);

    });

    monthlyPassList = Array.from(byNumber.values());

    savePassList();

    return monthlyPassList.length;

}

function clearPassList() {

    monthlyPassList = [];

    savePassList();

}

function getPassListCount() {

    return monthlyPassList.length;

}

function getPassRecord(vehicleNo) {

    const normalized = normalizeVehicleNo(vehicleNo);

    return monthlyPassList.find(entry => entry.number === normalized) || null;

}

function isVehicleInPassList(vehicleNo) {

    return !!getPassRecord(vehicleNo);

}

/* Vehicle-class-wise counts across the pass list. Since the list
   is always de-duplicated by vehicle number (see addToPassList /
   replacePassList above), this total is already the "real" count
   with any duplicate rows from the source sheet merged away. */

function getPassListClassBreakdown() {

    const counts = {};

    monthlyPassList.forEach(entry => {

        const label = entry.vehicleClass && entry.vehicleClass.trim() ?
            entry.vehicleClass.trim() : "Unspecified";

        counts[label] = (counts[label] || 0) + 1;

    });

    return counts;

}

/* Updates one existing pass record's fields (e.g. extending the
   Valid Date after a renewal) without touching the rest of the
   list — no re-upload of the sheet needed.
   Only fields present as keys on `fields` are changed.
   Returns true if the vehicle number was found and updated. */

function updatePassRecordFields(vehicleNo, fields) {

    const normalized = normalizeVehicleNo(vehicleNo);

    const existing = monthlyPassList.find(entry => entry.number === normalized);

    if (!existing) return false;

    PASS_RECORD_FIELDS.forEach(field => {

        if (Object.prototype.hasOwnProperty.call(fields, field)) {

            existing[field] = (fields[field] || "").toString().trim();

        }

    });

    savePassList();

    return true;

}

/* Removes a single record from the pass list by vehicle number.
   Returns true if it existed and was removed. */

function deletePassRecord(vehicleNo) {

    const normalized = normalizeVehicleNo(vehicleNo);

    const before = monthlyPassList.length;

    monthlyPassList = monthlyPassList.filter(entry => entry.number !== normalized);

    if (monthlyPassList.length === before) return false;

    savePassList();

    return true;

}

