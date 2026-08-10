/* ==========================================================
   Toll Audit Assistant
   email-notify.js

   EmailJS-based audit save notification.
   Free plan: 200 emails/month — no backend needed.

   Setup (one-time):
     1. Go to https://www.emailjs.com and create a free account.
     2. Add an Email Service (Gmail recommended) → copy Service ID.
     3. Create an Email Template with these variables:
           {{to_email}}   — recipient address
           {{user_name}}  — display name of the logged-in user
           {{audit_date}} — the date key of the saved audit
           {{saved_at}}   — timestamp when the save happened
        → copy Template ID.
     4. Go to Account → API Keys → copy your Public Key.
     5. Open the app, click "📧 Email Notifications" in the sidebar,
        paste the three IDs, enter your email, and save.
   ========================================================== */

/* ──────────────────────────────────────────
   STORAGE KEY
────────────────────────────────────────── */
const _EN_KEY = "auditEmailNotifySettings";

/* ──────────────────────────────────────────
   LOAD / SAVE SETTINGS (localStorage)
────────────────────────────────────────── */
function enLoadSettings() {
    try {
        return JSON.parse(localStorage.getItem(_EN_KEY)) || {};
    } catch (_) {
        return {};
    }
}

function enSaveSettings(obj) {
    localStorage.setItem(_EN_KEY, JSON.stringify(obj));
}

/* ──────────────────────────────────────────
   INIT EmailJS PUBLIC KEY
   Called once when settings are loaded /
   saved, so EmailJS is always initialised.
────────────────────────────────────────── */
function _enInitEmailJs(publicKey) {
    if (!publicKey) return;
    if (typeof emailjs === "undefined") return;
    try {
        emailjs.init(publicKey);
    } catch (_) { /* ignore double-init */ }
}

/* ──────────────────────────────────────────
   SEND NOTIFICATION
   Called by data.js after a successful
   Firestore cloud sync.
────────────────────────────────────────── */
async function sendAuditSavedEmail(dateKey) {

    const cfg = enLoadSettings();

    /* All four fields must be filled in */
    if (!cfg.enabled)       return;
    if (!cfg.publicKey)     return;
    if (!cfg.serviceId)     return;
    if (!cfg.templateId)    return;
    if (!cfg.recipientEmail) return;

    if (typeof emailjs === "undefined") {
        console.warn("[EmailNotify] EmailJS SDK not loaded.");
        return;
    }

    _enInitEmailJs(cfg.publicKey);

    /* Build a friendly display date from the dateKey (YYYY-MM-DD) */
    let friendlyDate = dateKey;
    try {
        const [y, m, d] = dateKey.split("-");
        friendlyDate = `${d}-${m}-${y}`;
    } catch (_) {}

    const userName = (typeof fbAuth !== "undefined" && fbAuth.currentUser)
        ? (fbAuth.currentUser.displayName || fbAuth.currentUser.email || "User")
        : "User";

    const savedAt = new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: true,
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit"
    });

    try {
        await emailjs.send(cfg.serviceId, cfg.templateId, {
            to_email:   cfg.recipientEmail,
            user_name:  userName,
            audit_date: friendlyDate,
            saved_at:   savedAt
        });
        console.log("[EmailNotify] Notification sent for", dateKey);
    } catch (err) {
        console.warn("[EmailNotify] Send failed:", err.text || err.message || err);
    }
}

/* ──────────────────────────────────────────
   SETTINGS MODAL — OPEN / WIRE
────────────────────────────────────────── */
function enOpenSettings() {

    const cfg = enLoadSettings();

    const el = id => document.getElementById(id);

    el("enEnabled").checked          = !!cfg.enabled;
    el("enPublicKey").value          = cfg.publicKey     || "";
    el("enServiceId").value          = cfg.serviceId     || "";
    el("enTemplateId").value         = cfg.templateId    || "";
    el("enRecipientEmail").value     = cfg.recipientEmail|| "";

    const modal = new bootstrap.Modal(document.getElementById("emailNotifyModal"));
    modal.show();
}

function enSaveAndClose() {

    const el = id => document.getElementById(id);

    const cfg = {
        enabled:        el("enEnabled").checked,
        publicKey:      el("enPublicKey").value.trim(),
        serviceId:      el("enServiceId").value.trim(),
        templateId:     el("enTemplateId").value.trim(),
        recipientEmail: el("enRecipientEmail").value.trim()
    };

    /* Basic validation when enabled */
    if (cfg.enabled) {
        if (!cfg.publicKey || !cfg.serviceId || !cfg.templateId || !cfg.recipientEmail) {
            alert("Please fill in all four EmailJS fields before enabling notifications.");
            return;
        }
    }

    enSaveSettings(cfg);
    _enInitEmailJs(cfg.publicKey);

    bootstrap.Modal.getInstance(document.getElementById("emailNotifyModal"))?.hide();

    /* Toast */
    _showSaveChip("ss-local", cfg.enabled ? "Email notifications enabled ✓" : "Email notifications off");
}

/* ──────────────────────────────────────────
   TEST SEND
────────────────────────────────────────── */
async function enTestSend() {
    const btn = document.getElementById("enTestBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

    const today = (typeof getTodayKey === "function") ? getTodayKey() : new Date().toISOString().slice(0, 10);
    await sendAuditSavedEmail(today);

    if (btn) { btn.disabled = false; btn.textContent = "Send Test Email"; }
    alert("Test email sent! Check your inbox (and spam folder).");
}

/* ──────────────────────────────────────────
   BOOT — wire sidebar button + init SDK
────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {

    /* Sidebar button */
    const openBtn = document.getElementById("emailNotifySettingsBtn");
    if (openBtn) openBtn.addEventListener("click", enOpenSettings);

    /* Modal save / test buttons */
    const saveBtn = document.getElementById("enSaveBtn");
    if (saveBtn) saveBtn.addEventListener("click", enSaveAndClose);

    const testBtn = document.getElementById("enTestBtn");
    if (testBtn) testBtn.addEventListener("click", enTestSend);

    /* Init SDK if already configured */
    const cfg = enLoadSettings();
    _enInitEmailJs(cfg.publicKey);
});
