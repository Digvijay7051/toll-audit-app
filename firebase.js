/* ==========================================================
   Toll Audit Assistant
   firebase.js

   Firebase Firestore + Auth — using Firebase Compat SDK
   (v8-style API loaded via <script> tags in index.html).
   This approach works reliably on GitHub Pages without
   any ES module / dynamic import issues.
========================================================== */

/* ===============================
   ADMIN CONFIG
   Only this email can upload / edit /
   clear the shared monthly pass list.
   All other accounts can read it.
=============================== */

const ADMIN_EMAIL = "digvijaysingh705123@gmail.com";   // ← your admin email here

/* ===============================
   FIREBASE CONFIG
=============================== */

const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyBkY9Kl03FC9sEDqPm__7A6G5aRy0rtL0U",
    authDomain:        "toll-auditor.firebaseapp.com",
    projectId:         "toll-auditor",
    storageBucket:     "toll-auditor.firebasestorage.app",
    messagingSenderId: "378621296782",
    appId:             "1:378621296782:web:7f8e6c68dbb0cdbbe789df"
};

/* ===============================
   STATE
=============================== */

let fbAuth       = null;
let fbDb         = null;
let fbCurrentUid = null;
let fbReady      = false;

/* Resolves when onAuthStateChanged fires for the first time
   (user logged in or confirmed logged out).
   Everything that needs fbCurrentUid should await this.       */
let _authReadyResolve = null;
const fbAuthReady = new Promise(res => { _authReadyResolve = res; });

/* ===============================
   INITIALIZE
   Called from auth.js after
   DOMContentLoaded. Uses the compat
   SDK already loaded via script tags.
=============================== */

function initFirebase() {

    try {

        /* firebase is the global from compat CDN scripts */

        if (typeof firebase === "undefined") {

            console.warn("[Firebase] SDK not loaded yet.");
            _authReadyResolve(null);
            return;

        }

        firebase.initializeApp(FIREBASE_CONFIG);

        fbAuth = firebase.auth();
        fbDb   = firebase.firestore();
        fbReady = true;

        console.log("[Firebase] Initialized ✓");

        /* Track signed-in user — resolve the authReady promise on first fire */
        let _firstAuthFire = true;
        fbAuth.onAuthStateChanged((user) => {
            fbCurrentUid = user ? user.uid : null;
            if (_firstAuthFire) {
                _firstAuthFire = false;
                _authReadyResolve(user);
            }
        });

    } catch (err) {

        console.error("[Firebase] Init error:", err);
        _authReadyResolve(null);

    }

}

/* ===============================
   AUTH — REGISTER
   Accepts real email + display username.
   Returns { success, message?, verificationSent? } or null
=============================== */

async function fbRegisterUser(email, password, username) {

    if (!fbReady || !fbAuth) {
        console.warn("[Firebase] Not ready — localStorage fallback");
        return null;
    }

    console.log("[Firebase] Registering:", email);

    try {

        const cred = await fbAuth.createUserWithEmailAndPassword(email, password);

        await cred.user.updateProfile({ displayName: username });

        await cred.user.sendEmailVerification();

        fbCurrentUid = cred.user.uid;

        console.log("[Firebase] Register OK uid:", fbCurrentUid);

        return { success: true, verificationSent: true };

    } catch (err) {

        console.error("[Firebase] Register error:", err.code, err.message);

        if (err.code === "auth/email-already-in-use") {
            return { success: false, message: "This email is already registered." };
        }

        if (err.code === "auth/invalid-email") {
            return { success: false, message: "Please enter a valid email address." };
        }

        if (err.code === "auth/weak-password") {
            return { success: false, message: "Password should be at least 6 characters." };
        }

        return null;

    }

}

/* ===============================
   AUTH — LOGIN
   Returns displayName, undefined
   (wrong creds), or null (fallback)
=============================== */

async function fbLoginUser(email, password) {

    if (!fbReady || !fbAuth) {
        console.warn("[Firebase] Not ready — localStorage fallback");
        return null;
    }

    console.log("[Firebase] Logging in:", email);

    try {

        const cred = await fbAuth.signInWithEmailAndPassword(email, password);

        fbCurrentUid = cred.user.uid;

        console.log("[Firebase] Login OK uid:", fbCurrentUid);

        return cred.user.displayName || email;

    } catch (err) {

        console.error("[Firebase] Login error:", err.code, err.message);

        if (
            err.code === "auth/user-not-found"     ||
            err.code === "auth/wrong-password"      ||
            err.code === "auth/invalid-credential"  ||
            err.code === "auth/invalid-login-credentials"
        ) {
            return undefined;   /* wrong credentials */
        }

        console.error("[Firebase] Login error:", err);
        return null;   /* network / other error — fallback */

    }

}

/* ===============================
   AUTH — LOGOUT
=============================== */

async function fbLogoutUser() {

    if (!fbReady || !fbAuth) return;

    try {
        await fbAuth.signOut();
        fbCurrentUid = null;
    } catch (err) {
        console.error("[Firebase] Logout error:", err);
    }

}

/* ===============================
   AUTH — RESET PASSWORD
   Sends Firebase password-reset email.
   Returns { success, message }
=============================== */

async function fbResetPassword(email) {

    if (!fbReady || !fbAuth) {
        return { success: false, message: "Firebase not ready. Try again in a moment." };
    }

    try {

        await fbAuth.sendPasswordResetEmail(email);

        return { success: true, message: "Password reset email sent! Check your inbox." };

    } catch (err) {

        console.error("[Firebase] Reset password error:", err.code, err.message);

        if (err.code === "auth/user-not-found") {
            return { success: false, message: "No account found with that email address." };
        }

        if (err.code === "auth/invalid-email") {
            return { success: false, message: "Please enter a valid email address." };
        }

        return { success: false, message: "Could not send reset email. Please try again." };

    }

}

/* ===============================
   AUTH — RENAME USER
=============================== */

async function fbRenameUser(newUsername) {

    if (!fbReady || !fbAuth || !fbAuth.currentUser) return false;

    try {
        await fbAuth.currentUser.updateProfile({ displayName: newUsername });
        return true;
    } catch (err) {
        console.error("[Firebase] Rename error:", err);
        return false;
    }

}

/* ===============================
   FIRESTORE — SAVE AUDIT LOG
   Stores audit logs INSIDE the existing
   users/{uid} document as a nested field
   "auditLogs.{dateKey}" — same document
   that already works, no new rules needed.
=============================== */

async function fbSaveAuditLog(dateKey, logData) {

    if (!fbReady || !fbDb) {
        console.warn("[Firebase] fbSaveAuditLog: SDK not ready");
        return false;
    }

    /* Read UID from live Auth first, fall back to cached */
    const uid = (fbAuth && fbAuth.currentUser)
        ? fbAuth.currentUser.uid
        : fbCurrentUid;

    if (!uid) {
        console.warn("[Firebase] fbSaveAuditLog: no UID");
        return false;
    }

    try {

        const auditor = (typeof currentUsername !== "undefined" && currentUsername)
            ? currentUsername
            : ((fbAuth && fbAuth.currentUser && fbAuth.currentUser.displayName) || "unknown");

        /* Use merge:true so we never overwrite the rest of the user doc.
           Field path  "auditLogs.2026-07-21"  stores each date as a key. */
        await fbDb.collection("users").doc(uid).set({
            [`auditLogs.${dateKey}`]: JSON.stringify({
                dateKey,
                savedAt:  new Date().toISOString(),
                auditor,
                rows:     logData.rows  || [],
                notes:    logData.notes || ""
            })
        }, { merge: true });

        console.log("[Firebase] Audit log saved ✓", dateKey, uid);
        return true;

    } catch (err) {

        console.error("[Firebase] Save audit log error:", err.code, err.message);
        return false;

    }

}

/* ===============================
   FIRESTORE — LOAD ALL AUDIT LOG DATES
   Reads from existing users/{uid} doc.
   Returns array sorted newest first.
=============================== */

async function fbLoadAuditLogDates() {

    if (!fbReady || !fbDb) return [];

    const uid = (fbAuth && fbAuth.currentUser) ? fbAuth.currentUser.uid : fbCurrentUid;

    if (!uid) return [];

    try {

        const snap = await fbDb.collection("users").doc(uid).get();

        if (!snap.exists) return [];

        const data = snap.data();

        /* Collect all keys that start with "auditLogs." */
        const entries = [];

        Object.keys(data).forEach(key => {
            if (!key.startsWith("auditLogs.")) return;
            try {
                const parsed = JSON.parse(data[key]);
                entries.push({
                    dateKey: parsed.dateKey || key.replace("auditLogs.", ""),
                    savedAt: parsed.savedAt
                        ? new Date(parsed.savedAt).toLocaleString("en-IN")
                        : "—",
                    auditor: parsed.auditor || "—"
                });
            } catch (e) { /* skip malformed */ }
        });

        /* Sort newest first */
        entries.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

        return entries;

    } catch (err) {

        console.error("[Firebase] Load audit log dates error:", err);
        return [];

    }

}

/* ===============================
   FIRESTORE — DELETE ONE AUDIT LOG
   Removes the auditLogs.{dateKey} field
   from the users/{uid} document.
=============================== */

async function fbDeleteAuditLog(dateKey) {

    if (!fbReady || !fbDb) return false;

    const uid = (fbAuth && fbAuth.currentUser) ? fbAuth.currentUser.uid : fbCurrentUid;

    if (!uid) return false;

    try {

        await fbDb.collection("users").doc(uid).update({
            [`auditLogs.${dateKey}`]: firebase.firestore.FieldValue.delete()
        });

        console.log("[Firebase] Audit log deleted ✓", dateKey);
        return true;

    } catch (err) {

        console.error("[Firebase] Delete audit log error:", err.code, err.message);
        return false;

    }

}

/* ===============================
   FIRESTORE — LOAD ONE AUDIT LOG
   Returns parsed logData or null.
=============================== */

async function fbLoadAuditLogByDate(dateKey) {

    if (!fbReady || !fbDb) return null;

    const uid = (fbAuth && fbAuth.currentUser) ? fbAuth.currentUser.uid : fbCurrentUid;

    if (!uid) return null;

    try {

        const snap = await fbDb.collection("users").doc(uid).get();

        if (!snap.exists) return null;

        const raw = snap.data()[`auditLogs.${dateKey}`];

        return raw ? JSON.parse(raw) : null;

    } catch (err) {

        console.error("[Firebase] Load audit log error:", err);
        return null;

    }

}

/* ===============================
   FIRESTORE — SAVE AUDIT DATA
=============================== */

async function fbSaveAuditData(dataStore) {

    if (!fbReady || !fbDb || !fbCurrentUid) return;

    try {

        await fbDb.collection("users").doc(fbCurrentUid).set(
            { auditData: JSON.stringify(dataStore) },
            { merge: true }
        );

    } catch (err) {

        console.error("[Firebase] Save audit error:", err);

    }

}

/* ===============================
   FIRESTORE — LOAD AUDIT DATA
=============================== */

async function fbLoadAuditData() {

    if (!fbReady || !fbDb || !fbCurrentUid) return null;

    try {

        const snap = await fbDb.collection("users").doc(fbCurrentUid).get();

        if (!snap.exists) return null;

        const raw = snap.data().auditData;

        return raw ? JSON.parse(raw) : null;

    } catch (err) {

        console.error("[Firebase] Load audit error:", err);
        return null;

    }

}

/* ===============================
   FIRESTORE — SUBMIT AUDIT LOG
=============================== */

async function fbSubmitAuditLog(logEntry) {

    if (!fbReady || !fbDb || !fbCurrentUid) return false;

    try {

        await fbDb.collection("audit_log").add({
            uid:         fbCurrentUid,
            username:    currentUsername || "unknown",
            submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
            ...logEntry
        });

        return true;

    } catch (err) {

        console.error("[Firebase] Submit log error:", err);
        return false;

    }

}

/* ===============================
   WAIT FOR FIREBASE READY
=============================== */

function waitForFirebase(timeoutMs = 5000) {

    return new Promise((resolve) => {

        if (fbReady) { resolve(true); return; }

        const start = Date.now();

        const check = setInterval(() => {

            if (fbReady) {
                clearInterval(check);
                resolve(true);
            } else if (Date.now() - start > timeoutMs) {
                clearInterval(check);
                resolve(false);
            }

        }, 100);

    });

}

/* ===============================
   ADMIN CHECK
   Returns true only if the currently
   signed-in Firebase user's email
   matches ADMIN_EMAIL.
=============================== */

function fbIsAdmin() {

    if (!fbReady || !fbAuth || !fbAuth.currentUser) return false;

    return (fbAuth.currentUser.email || "").toLowerCase() ===
           ADMIN_EMAIL.toLowerCase();

}

/* ===============================
   FIRESTORE — SHARED PASS LIST
   Stored under admin/passlist so
   every user reads the same data.
   Only admin can write.
=============================== */

async function fbSaveSharedPassList(records) {

    if (!fbReady || !fbDb) return false;

    if (!fbIsAdmin()) {
        console.warn("[Firebase] Non-admin tried to save pass list.");
        return false;
    }

    try {

        await fbDb.collection("admin").doc("passlist").set({
            records:     JSON.stringify(records),
            updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy:   fbAuth.currentUser.email
        });

        console.log("[Firebase] Shared pass list saved ✓", records.length, "records");

        return true;

    } catch (err) {

        console.error("[Firebase] Save shared pass list error:", err);
        return false;

    }

}

async function fbLoadSharedPassList() {

    if (!fbReady || !fbDb) return null;

    try {

        const snap = await fbDb.collection("admin").doc("passlist").get();

        if (!snap.exists) return null;

        const raw = snap.data().records;

        return raw ? JSON.parse(raw) : [];

    } catch (err) {

        console.error("[Firebase] Load shared pass list error:", err);
        return null;

    }

}

async function fbClearSharedPassList() {

    if (!fbReady || !fbDb) return false;

    if (!fbIsAdmin()) return false;

    try {

        await fbDb.collection("admin").doc("passlist").set({
            records:   JSON.stringify([]),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: fbAuth.currentUser.email
        });

        return true;

    } catch (err) {

        console.error("[Firebase] Clear shared pass list error:", err);
        return false;

    }

}

/* ===============================
   FIRESTORE — LOCK PIN (cloud sync)
   Saves/loads the screen-lock PIN
   to the user's own Firestore doc
   so it works on every device.
=============================== */

/* ===============================
   FIRESTORE — QUICK LOGIN PIN (cloud sync)
=============================== */

async function fbSaveQuickPin(hashedPin) {

    if (!fbReady || !fbDb || !fbCurrentUid) return false;

    try {

        await fbDb.collection("users").doc(fbCurrentUid).set(
            { quickPin: hashedPin },
            { merge: true }
        );
        return true;

    } catch (err) {

        console.error("[Firebase] Save quick PIN error:", err);
        return false;

    }

}

async function fbLoadQuickPin() {

    if (!fbReady || !fbDb || !fbCurrentUid) return null;

    try {

        const snap = await fbDb.collection("users").doc(fbCurrentUid).get();
        if (!snap.exists) return null;
        return snap.data().quickPin || null;

    } catch (err) {

        console.error("[Firebase] Load quick PIN error:", err);
        return null;

    }

}

/* ===============================
   FIRESTORE — LOCK PIN (cloud sync)
=============================== */

async function fbSaveLockPin(hashedPin) {

    if (!fbReady || !fbDb || !fbCurrentUid) return false;

    try {

        await fbDb.collection("users").doc(fbCurrentUid).set(
            { lockPin: hashedPin },
            { merge: true }
        );

        return true;

    } catch (err) {

        console.error("[Firebase] Save lock PIN error:", err);
        return false;

    }

}

async function fbLoadLockPin() {

    if (!fbReady || !fbDb || !fbCurrentUid) return null;

    try {

        const snap = await fbDb.collection("users").doc(fbCurrentUid).get();

        if (!snap.exists) return null;

        return snap.data().lockPin || null;

    } catch (err) {

        console.error("[Firebase] Load lock PIN error:", err);
        return null;

    }

}
