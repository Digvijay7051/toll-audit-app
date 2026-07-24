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

});

function setBackupStatus(message, isError) {

    const statusEl = document.getElementById("backupStatus");

    if (!statusEl) return;

    statusEl.className = isError ?
        "small mt-3 text-danger" : "small mt-3 text-success";

    statusEl.textContent = message || "";

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
