/* ==========================================================
   Toll Audit Assistant
   emailnotify.js

   EmailJS — Audit Saved Notification
   Sends a confirmation email to the admin whenever an audit
   log is successfully saved to Firestore.

   SETUP (one-time — see guide below):
   1. Create a free account at https://www.emailjs.com
   2. Add an Email Service (Gmail) and note the Service ID
   3. Create an Email Template and note the Template ID
   4. Copy your Public Key from Account → API Keys
   5. Replace the three placeholder values below with your real IDs
========================================================== */

/* ===============================
   EMAILJS CONFIG
   Replace these three values after
   setting up your EmailJS account.
   =============================== */

const EMAILJS_PUBLIC_KEY   = "YOUR_PUBLIC_KEY";      // ← from EmailJS → Account → API Keys
const EMAILJS_SERVICE_ID   = "YOUR_SERVICE_ID";      // ← e.g. "service_abc123"
const EMAILJS_TEMPLATE_ID  = "YOUR_TEMPLATE_ID";     // ← e.g. "template_xyz789"

/* ===============================
   INIT
   Initializes EmailJS with your
   public key once the SDK is ready.
   =============================== */

(function _initEmailJS() {

    if (typeof emailjs === "undefined") {
        console.warn("[EmailNotify] EmailJS SDK not loaded — notifications disabled.");
        return;
    }

    emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    console.log("[EmailNotify] EmailJS initialized ✓");

})();

/* ===============================
   SEND AUDIT SAVED EMAIL
   Call this after a successful
   fbSaveAuditLog. Silently no-ops
   if keys are still placeholders.
   =============================== */

async function sendAuditSavedEmail({ dateKey, auditor, rowCount, notes }) {

    /* Skip if SDK not loaded */
    if (typeof emailjs === "undefined") return;

    /* Skip if keys are still placeholder — don't throw */
    if (
        EMAILJS_PUBLIC_KEY  === "YOUR_PUBLIC_KEY"  ||
        EMAILJS_SERVICE_ID  === "YOUR_SERVICE_ID"  ||
        EMAILJS_TEMPLATE_ID === "YOUR_TEMPLATE_ID"
    ) {
        console.warn("[EmailNotify] EmailJS keys not configured — skipping email.");
        return;
    }

    /* Format date nicely: "2026-07-21" → "21 July 2026" */
    const [year, month, day] = (dateKey || "").split("-");
    const months = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
    ];
    const formattedDate = (day && month && year)
        ? `${parseInt(day, 10)} ${months[parseInt(month, 10) - 1]} ${year}`
        : (dateKey || "Unknown date");

    const savedAt = new Date().toLocaleString("en-IN", {
        timeZone:    "Asia/Kolkata",
        day:         "2-digit",
        month:       "short",
        year:        "numeric",
        hour:        "2-digit",
        minute:      "2-digit",
        hour12:      true
    });

    const templateParams = {
        to_email:       "digvijaysingh705123@gmail.com",
        audit_date:     formattedDate,
        auditor_name:   auditor  || "Unknown",
        transaction_count: rowCount || 0,
        notes:          notes    || "—",
        saved_at:       savedAt
    };

    try {

        const response = await emailjs.send(
            EMAILJS_SERVICE_ID,
            EMAILJS_TEMPLATE_ID,
            templateParams
        );

        console.log("[EmailNotify] Email sent ✓", response.status, response.text);

    } catch (err) {

        /* Silently log — never interrupt the user's save flow */
        console.warn("[EmailNotify] Email send failed:", err);

    }

}
