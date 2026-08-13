/* ==========================================================
   Toll Audit Assistant
   backup.js

   Full-app backup / restore.

   Everything this app knows (pass list, audit history/counts,
   login accounts, settings) lives only in this browser's
   localStorage, tied to the exact file location it's opened
   from. Moving the app files to a new folder, a new computer,
   or even a re-downloaded copy starts with empty data.

   Export bundles every piece of that data into one .json file.
   Import reads that file back in, so the auditor is never
   locked to one browser + one exact folder path.
========================================================== */

/* Static keys shared across the whole app (not per-account),
   plus every "tollAuditAssistant_<username>" key — one per
   account — is picked up dynamically at export/import time via
   collectBackupKeys(), since accounts are created freely and a
   fixed list can't know them in advance. */

const BACKUP_STATIC_KEYS = [
    "tollAuditPassListV2",
    "tollAuditPassSheetUrlV2",
    "tollAuditPassSheetLastSyncV2",
    "tollAuditSelectedDate",
    "tollAuditTheme",
    "tollAuditLock",
    "tollAuditUsers",
    "tollAuditSession"
];

function collectBackupKeys() {

    const keys = BACKUP_STATIC_KEYS.slice();

    for (let i = 0; i < localStorage.length; i++) {

        const key = localStorage.key(i);

        if (key && key.indexOf("tollAuditAssistant_") === 0 && keys.indexOf(key) === -1) {

            keys.push(key);

        }

        if (key && key.indexOf("tollAuditAvatar_") === 0 && keys.indexOf(key) === -1) {

            keys.push(key);

        }

    }

    return keys;

}

document.addEventListener("DOMContentLoaded", () => {

    setupBackupExport();

    setupBackupImport();

    setupCloudBackupExport();

});

function setBackupStatus(message, isError) {

    const statusEl = document.getElementById("backupStatus");

    if (!statusEl) return;

    statusEl.className = isError ?
        "small mt-3 text-danger" : "small mt-3 text-success";

    statusEl.textContent = message || "";

}

/* ===============================
   CLOUD BACKUP EXPORT
   Downloads ALL Firestore audit data
   (every date's full bucket) for the
   signed-in user into a single JSON.
   Useful when switching devices and
   cloud sync hasn't run yet.
=============================== */

function setupCloudBackupExport() {

    const btn = document.getElementById("cloudBackupExportBtn");

    if (!btn) return;

    btn.addEventListener("click", async function () {

        if (typeof fbDb === "undefined" || !fbDb) {
            setBackupStatus("Firebase not loaded. Please refresh the page.", true);
            return;
        }

        if (typeof fbAuth === "undefined" || !fbAuth || !fbAuth.currentUser) {
            setBackupStatus("You must be signed in to download a cloud backup.", true);
            return;
        }

        btn.disabled    = true;
        btn.textContent = "Fetching from cloud…";

        try {

            const uid    = fbAuth.currentUser.uid;
            const prefix = uid + "_";   // retained for the doc.id fallback below

            /* Query by uid field — the security rule enforces uid == caller.
               Replaces the old document-ID prefix range scan. */
            const snap = await fbDb.collection("userAuditLogs")
                .where("uid", "==", uid)
                .get();

            /* Merge cloud docs into a fresh auditDataStore clone */
            const cloudStore = {};

            snap.docs.forEach(doc => {
                const d       = doc.data();
                const dateKey = d.dateKey || doc.id.replace(prefix, "");
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;

                if (d.auditBucket) {
                    try { cloudStore[dateKey] = JSON.parse(d.auditBucket); } catch (_) {}
                } else if (d.rows && Array.isArray(d.rows) && d.rows.length > 0) {
                    /* Reconstruct bucket from flat rows (older saves) */
                    if (typeof _rebuildBucketFromRows === "function") {
                        cloudStore[dateKey] = _rebuildBucketFromRows(d.rows, d.reportCounts || {});
                    }
                }
            });

            if (Object.keys(cloudStore).length === 0) {
                setBackupStatus("No audit data found in cloud for your account.", true);
                btn.disabled    = false;
                btn.innerHTML   = '<i class="bi bi-cloud-download"></i> Download Cloud Backup';
                return;
            }

            /* Build backup envelope — same format as regular local backup so
               it can be imported back via the normal Import button.             */
            const storageKey = typeof getAuditStorageKey === "function"
                ? getAuditStorageKey()
                : `tollAuditAssistant_${(typeof currentUsername !== "undefined" ? currentUsername : "guest")}`;

            const localSnapshot = {};
            collectBackupKeys().forEach(key => {
                const val = localStorage.getItem(key);
                if (val !== null) localSnapshot[key] = val;
            });

            /* Overwrite the audit key with the cloud version (richer) */
            localSnapshot[storageKey] = JSON.stringify(cloudStore);

            const backup = {
                app:           "Toll Audit Assistant",
                backupVersion: 1,
                source:        "cloud",
                exportedAt:    new Date().toISOString(),
                cloudDates:    Object.keys(cloudStore).sort(),
                data:          localSnapshot
            };

            const json      = JSON.stringify(backup, null, 2);
            const blob      = new Blob([json], { type: "application/json" });
            const url       = URL.createObjectURL(blob);
            const dateStamp = new Date().toISOString().slice(0, 10);

            const link      = document.createElement("a");
            link.href       = url;
            link.download   = `toll-audit-CLOUD-backup-${dateStamp}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            setBackupStatus(
                `✅ Cloud backup downloaded! Contains ${Object.keys(cloudStore).length} audit date(s): ${backup.cloudDates.join(", ")}`,
                false
            );

        } catch (err) {
            setBackupStatus("Cloud backup failed: " + (err.message || err), true);
            console.error("[CloudBackup] Error:", err);
        }

        btn.disabled  = false;
        btn.innerHTML = '<i class="bi bi-cloud-download"></i> Download Cloud Backup';

    });

}

/* ===============================
   EXPORT
=============================== */

function setupBackupExport() {

    const btn = document.getElementById("backupExportBtn");

    if (!btn) return;

    btn.addEventListener("click", function () {

        const backup = {

            app: "Toll Audit Assistant",

            backupVersion: 1,

            exportedAt: new Date().toISOString(),

            data: {}

        };

        collectBackupKeys().forEach(key => {

            const value = localStorage.getItem(key);

            if (value !== null) backup.data[key] = value;

        });

        const json = JSON.stringify(backup, null, 2);

        const blob = new Blob([json], { type: "application/json" });

        const url = URL.createObjectURL(blob);

        const dateStamp = new Date().toISOString().slice(0, 10);

        const link = document.createElement("a");

        link.href = url;

        link.download = `toll-audit-backup-${dateStamp}.json`;

        document.body.appendChild(link);

        link.click();

        document.body.removeChild(link);

        URL.revokeObjectURL(url);

        setBackupStatus("Backup file downloaded.", false);

    });

}

/* ===============================
   IMPORT
=============================== */

function setupBackupImport() {

    const fileInput = document.getElementById("backupImportFile");

    const btn = document.getElementById("backupImportBtn");

    if (!fileInput || !btn) return;

    btn.addEventListener("click", function () {

        const file = fileInput.files && fileInput.files[0];

        if (!file) {

            setBackupStatus("Please choose a backup file first.", true);

            return;

        }

        const confirmed = confirm(

            "This will replace everything currently in the app — pass list, " +
            "audit history, and accounts — with what's in this backup file.\n\n" +
            "Continue?"

        );

        if (!confirmed) return;

        const reader = new FileReader();

        reader.onload = function (e) {

            let parsed;

            try {

                parsed = JSON.parse(e.target.result);

            } catch (err) {

                setBackupStatus("That doesn't look like a valid backup file.", true);

                return;

            }

            if (!parsed || !parsed.data || typeof parsed.data !== "object") {

                setBackupStatus("That doesn't look like a Toll Audit Assistant backup file.", true);

                return;

            }

            const keysToClear = new Set(collectBackupKeys());

            Object.keys(parsed.data).forEach(key => keysToClear.add(key));

            keysToClear.forEach(key => {

                if (Object.prototype.hasOwnProperty.call(parsed.data, key)) {

                    localStorage.setItem(key, parsed.data[key]);

                } else {

                    localStorage.removeItem(key);

                }

            });

            setBackupStatus("Restored successfully. Reloading…", false);

            setTimeout(() => {

                window.location.reload();

            }, 900);

        };

        reader.onerror = function () {

            setBackupStatus("Could not read that file.", true);

        };

        reader.readAsText(file);

    });

}
