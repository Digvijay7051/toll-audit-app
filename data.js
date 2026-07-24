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
    "Bus 2 Axle",
    "Truck 2 Axle",
    "Truck 3 Axle",
    "MAV",
    "Tractor",
    "Auto"
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
    "Fake Exemption"
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

                    if (

                        bucket[mode][category]
                            .vehicleCounts[vehicle] === undefined

                    ) {

                        bucket[mode][category]
                            .vehicleCounts[vehicle] = 0;

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
    ];

    /* "Already paid / found in another txn" — maps to Paid variants */
    const paidRows = ["Paid (Cash)", "Paid (ETC)", "Paid (Digital)"];

    const bucket = auditData[mode];

    /* reportCounts — what the system said */
    const reportCounts = {};
    cols.forEach(cat => {
        reportCounts[cat] = (bucket[cat] && bucket[cat].reportCount) || 0;
    });

    /* Build cell matrix: cells[col][row] = count */
    const cells = {};
    cols.forEach(cat => {
        cells[cat] = {};
        rows.forEach(r => { cells[cat][r] = 0; });
        /* Pull vehicle counts from this category bucket */
        const vc = (bucket[cat] && bucket[cat].vehicleCounts) || {};
        Object.keys(vc).forEach(vehicle => {
            if (rows.includes(vehicle)) {
                cells[cat][vehicle] = vc[vehicle] || 0;
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
=============================== */

function saveAuditData() {

    /* Always save to localStorage (works offline) */

    localStorage.setItem(

        getAuditStorageKey(),

        JSON.stringify(auditDataStore)

    );

    /* Also sync to Firestore in the background (non-blocking) */

    if (typeof fbSaveAuditData === "function") {

        fbSaveAuditData(auditDataStore);

    }

    if (typeof renderHistoryPanel === "function") {

        renderHistoryPanel();

    }

}

/* ===============================
   LOAD
=============================== */

function loadAuditData() {

    const data =

        localStorage.getItem(

            getAuditStorageKey()

        );

    auditDataStore = data ? JSON.parse(data) : {};

    migrateAuditDataStore();

    /* Restore whichever date the user was last working on */

    const lastDate =
        loadSelectedAuditDate() || getTodayKey();

    setActiveAuditDate(lastDate);

    /* In parallel: try to load from Firestore (cloud sync) */
    /* If Firestore has newer/more data, merge it in         */

    if (typeof fbLoadAuditData === "function") {

        fbLoadAuditData().then((cloudStore) => {

            if (!cloudStore) return;

            /* Merge: cloud dates take precedence over local */

            let merged = false;

            Object.keys(cloudStore).forEach((dateKey) => {

                if (!auditDataStore[dateKey]) {

                    auditDataStore[dateKey] = cloudStore[dateKey];

                    merged = true;

                }

            });

            if (merged) {

                /* Persist merged data back to localStorage */

                localStorage.setItem(

                    getAuditStorageKey(),

                    JSON.stringify(auditDataStore)

                );

                migrateAuditDataStore();

                setActiveAuditDate(selectedAuditDate || getTodayKey());

                if (typeof renderHistoryPanel === "function") {

                    renderHistoryPanel();

                }

                if (typeof refreshUI === "function") {

                    refreshUI();

                }

            }

        });

    }

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

    if (dateKey === selectedAuditDate) {

        auditData = getOrCreateAuditBucket(dateKey);

    }

    /* Use per-user key so we don't accidentally clobber another account */

    localStorage.setItem(

        getAuditStorageKey(),

        JSON.stringify(auditDataStore)

    );

    if (typeof renderHistoryPanel === "function") {

        renderHistoryPanel();

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

        if (isBucketStarted(bucket) && !meta.resolved) {

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

function registerUser(username, password) {

    const users = getUsers();

    const key = username.toLowerCase();

    if (users[key]) {

        return {

            success: false,

            message: "This username is already taken."

        };

    }

    users[key] = {

        displayName: username,

        password: password

    };

    saveUsers(users);

    return { success: true };

}

function validateUser(username, password) {

    const users = getUsers();

    const key = username.toLowerCase();

    const record = users[key];

    if (!record) return null;

    if (record.password !== password) return null;

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
   LOAD ALL CLOUD DATA
   Single entry-point called after
   every login. Waits for Firebase
   auth to confirm the UID, then
   pulls audit data + lock PIN +
   quick PIN all from Firestore and
   merges into local state.
=============================== */

async function loadAllCloudData(username) {

    /* 1. Wait for Firebase auth to confirm who the user is */
    if (typeof fbAuthReady !== "undefined") {
        await fbAuthReady;
    }

    /* If Firebase isn't available, nothing to do */
    if (typeof fbLoadAuditData !== "function") return;

    /* 2. Load all three in parallel */
    const [cloudStore, cloudLockPin, cloudQuickPin] = await Promise.all([
        fbLoadAuditData(),
        typeof fbLoadLockPin  === "function" ? fbLoadLockPin()  : Promise.resolve(null),
        typeof fbLoadQuickPin === "function" ? fbLoadQuickPin() : Promise.resolve(null)
    ]);

    /* 3. Merge audit data — cloud always wins for any date */
    if (cloudStore && typeof cloudStore === "object") {

        let merged = false;

        Object.keys(cloudStore).forEach((dateKey) => {
            /* Cloud always replaces local for existing dates too —
               the cloud is the source of truth */
            if (JSON.stringify(auditDataStore[dateKey]) !==
                JSON.stringify(cloudStore[dateKey])) {
                auditDataStore[dateKey] = cloudStore[dateKey];
                merged = true;
            }
        });

        if (merged) {
            localStorage.setItem(getAuditStorageKey(), JSON.stringify(auditDataStore));
            migrateAuditDataStore();
            setActiveAuditDate(selectedAuditDate || getTodayKey());
            if (typeof renderHistoryPanel === "function") renderHistoryPanel();
            if (typeof refreshUI          === "function") refreshUI();
        }

    }

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
        /* Only store if not already matching */
        const localHash = localStorage.getItem(_pinKey(username));
        if (localHash !== cloudQuickPin) {
            localStorage.setItem(_pinKey(username), cloudQuickPin);
            /* Refresh the login tab visibility */
            if (window._refreshAuthTabs) window._refreshAuthTabs();
        }
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

