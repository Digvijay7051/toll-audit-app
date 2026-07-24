/* ==========================================================
   Toll Audit Assistant
   auth.js

   Handles the pre-dashboard flow:
   1. Login / Sign up
   2. Greeting + "Start Auditing"
   3. Audit date selection
   4. Reveals the main dashboard
========================================================== */

document.addEventListener("DOMContentLoaded", async () => {

    /* Initialize Firebase (no-op if config not set) */

    if (typeof initFirebase === "function") initFirebase();

    setupAuthForms();

    setupWelcomeScreen();

    setupDateScreen();

    setupUsernameChange();

    setupProfileQuickPin();

    setupPinKeyboardSupport();

    const session = getSession();

    if (session) {

        let displayName = session.username;

        /* Wait for Firebase auth state to settle, then get fresh displayName
           and pull ALL cloud data (audit + lock PIN + quick PIN) */
        if (typeof fbAuthReady !== "undefined") {

            const fbUser = await fbAuthReady;

            if (fbUser && fbUser.displayName) displayName = fbUser.displayName;

        }

        currentUsername = displayName;
        saveSession(displayName);
        setActiveUser(displayName);

        /* Load all cloud data before showing the welcome screen */
        await loadAllCloudData(displayName);

        showWelcomeScreen(displayName);

    } else {

        showAuthScreen();

    }

});

/* ===============================
   SCREEN SWITCHING
=============================== */

function hideAllScreens() {

    ["authScreen", "welcomeScreen", "dateScreen", "mainApp"]
        .forEach(id => {

            const el = document.getElementById(id);

            if (el) el.style.display = "none";

        });

}

function showAuthScreen() {

    hideAllScreens();

    document.getElementById("authScreen").style.display = "flex";

}

function showWelcomeScreen(username) {

    hideAllScreens();

    document.getElementById("welcomeScreen").style.display = "flex";

    const hour = new Date().getHours();

    let greeting = "Good Evening";

    if (hour < 12) {

        greeting = "Good Morning";

    } else if (hour < 17) {

        greeting = "Good Afternoon";

    }

    document.getElementById("greetingText").textContent =
        `${greeting}, ${username}`;

}

function showDateScreen() {

    hideAllScreens();

    document.getElementById("dateScreen").style.display = "flex";

    const dateInput = document.getElementById("auditDateInput");

    /* Always default to the real, current date. The user can
       still pick an older date manually if they need to, but
       never a future date — today's audit is only available
       today, tomorrow's only becomes available tomorrow. */

    const todayKey = getTodayKey();

    dateInput.max = todayKey;

    dateInput.value = todayKey;

}

function showMainApp() {

    hideAllScreens();

    document.getElementById("mainApp").style.display = "block";

    const label = document.getElementById("activeAuditDate");

    if (label) label.textContent = selectedAuditDate;

    const session = getSession();

    const username = session ? session.username : "";

    const nameLabel = document.getElementById("topbarUsername");
    if (nameLabel) nameLabel.textContent = username;

    const nameLabel2 = document.getElementById("topbarUsername2");
    if (nameLabel2) nameLabel2.textContent = username;

    /* Update topbar audit date chip */
    const topbarDate = document.getElementById("topbarAuditDate");
    if (topbarDate) {
        const [y, m, d] = selectedAuditDate.split("-");
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        topbarDate.textContent = d ? `${parseInt(d)} ${months[parseInt(m)-1]} ${y}` : selectedAuditDate;
    }

    if (typeof refreshUI === "function") {

        refreshUI();

    }

    if (typeof renderHistoryPanel === "function") {

        renderHistoryPanel();

    }

    if (typeof startTopbarClock === "function") {

        startTopbarClock();

    }

    if (typeof checkPendingAuditBanner === "function") {

        checkPendingAuditBanner();

    }

}

/* ===============================
   LOGIN / SIGN UP FORMS
=============================== */

function setupAuthForms() {

    /* ── LOGIN ── */

    document
        .getElementById("loginForm")
        .addEventListener("submit", async function (e) {

            e.preventDefault();

            const email     = document.getElementById("loginUsername").value.trim();
            const password  = document.getElementById("loginPassword").value;
            const errorEl   = document.getElementById("loginError");
            const submitBtn = e.target.querySelector("button[type='submit']");

            errorEl.style.display = "none";

            if (!email || !password) return;

            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Signing in…"; }

            let displayName = null;

            if (typeof fbLoginUser === "function") {

                const fbResult = await fbLoginUser(email, password);

                if (fbResult === undefined) {

                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Login'; }

                    errorEl.textContent = "Incorrect email or password.";

                    errorEl.style.display = "block";

                    return;

                }

                if (fbResult !== null) displayName = fbResult;

            }

            /* Fallback localStorage */

            if (displayName === null) displayName = validateUser(email, password);

            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Login'; }

            if (displayName) {

                saveSession(displayName);

                setActiveUser(displayName);

                /* Load ALL cloud data (audit + lock PIN + quick PIN) */
                await loadAllCloudData(displayName);

                showWelcomeScreen(displayName);

                /* Offer Quick-login PIN setup after a short delay */
                setTimeout(() => offerPinSetup(displayName), 900);

            } else {

                errorEl.textContent = "Incorrect email or password.";

                errorEl.style.display = "block";

            }

        });

    /* ── SIGNUP ── */

    document
        .getElementById("signupForm")
        .addEventListener("submit", async function (e) {

            e.preventDefault();

            const email           = document.getElementById("signupEmail").value.trim();
            const username        = document.getElementById("signupUsername").value.trim();
            const password        = document.getElementById("signupPassword").value;
            const confirmPassword = document.getElementById("signupConfirmPassword").value;
            const errorEl         = document.getElementById("signupError");
            const successEl       = document.getElementById("signupSuccess");
            const submitBtn       = e.target.querySelector("button[type='submit']");

            errorEl.style.display   = "none";
            successEl.style.display = "none";

            if (!email || !username || !password) return;

            if (!email.includes("@") || !email.includes(".")) {

                errorEl.textContent    = "Please enter a valid email address.";
                errorEl.style.display  = "block";
                return;

            }

            if (password.length < 6) {

                errorEl.textContent   = "Password should be at least 6 characters.";
                errorEl.style.display = "block";
                return;

            }

            if (password !== confirmPassword) {

                errorEl.textContent   = "Passwords do not match.";
                errorEl.style.display = "block";
                return;

            }

            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Creating account…"; }

            /* Firebase register with real email + username as displayName */

            let fbResult = null;

            if (typeof fbRegisterUser === "function") {

                fbResult = await fbRegisterUser(email, password, username);

            }

            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="bi bi-person-plus"></i> Create Account'; }

            if (fbResult && !fbResult.success) {

                errorEl.textContent   = fbResult.message;
                errorEl.style.display = "block";
                return;

            }

            if (fbResult && fbResult.verificationSent) {

                /* Email verification sent — show message, stay on signup */

                successEl.textContent   = `✅ Verification email sent to ${email}. Please verify and then login.`;
                successEl.style.display = "block";

                /* Switch to login box after 3 seconds */

                setTimeout(() => {

                    document.getElementById("signupBox").style.display = "none";
                    document.getElementById("loginBox").style.display  = "block";
                    document.getElementById("loginUsername").value     = email;

                }, 3000);

                return;

            }

            /* Fallback: localStorage only */

            const result = registerUser(email, password);

            if (!result.success && !fbResult) {

                errorEl.textContent   = result.message;
                errorEl.style.display = "block";
                return;

            }

            saveSession(username);
            setActiveUser(username);
            showWelcomeScreen(username);

        });

    document
        .getElementById("showSignupBtn")
        .addEventListener("click", function () {

            document.getElementById("loginBox").style.display = "none";

            document.getElementById("signupBox").style.display = "block";

        });

    document
        .getElementById("showLoginBtn")
        .addEventListener("click", function () {

            document.getElementById("signupBox").style.display = "none";

            document.getElementById("loginBox").style.display = "block";

        });

    /* ── FORGOT PASSWORD ── */

    const forgotBtn = document.getElementById("forgotPasswordBtn");

    if (forgotBtn) {

        forgotBtn.addEventListener("click", async function () {

            const emailEl   = document.getElementById("loginUsername");
            const errorEl   = document.getElementById("loginError");
            const successEl = document.getElementById("loginSuccess");

            errorEl.style.display   = "none";
            successEl.style.display = "none";

            const email = emailEl ? emailEl.value.trim() : "";

            if (!email) {

                errorEl.textContent   = "Enter your email above, then click Forgot Password.";
                errorEl.style.display = "block";
                return;

            }

            forgotBtn.disabled   = true;
            forgotBtn.textContent = "Sending…";

            const result = await fbResetPassword(email);

            forgotBtn.disabled  = false;
            forgotBtn.innerHTML = '<i class="bi bi-key"></i> Forgot Password?';

            if (result.success) {

                successEl.textContent   = result.message;
                successEl.style.display = "block";

            } else {

                errorEl.textContent   = result.message;
                errorEl.style.display = "block";

            }

        });

    }

    ["logoutBtn", "signOutBtn"].forEach(id => {

        const btn = document.getElementById(id);

        if (btn) {

            btn.addEventListener("click", performSignOut);

        }

    });

    /* ── Tab switching (Email ↔ Quick PIN) ── */
    setupAuthTabs();

    /* ── PIN Login numpad ── */
    setupPinLoginNumpad();

}

/* ===============================
   CHANGE USERNAME
=============================== */

function setupUsernameChange() {

    const trigger = document.getElementById("changeUsernameBtn");
    const input   = document.getElementById("newUsernameInput");
    const errorEl = document.getElementById("usernameChangeError");
    const saveBtn = document.getElementById("saveUsernameBtn");

    if (trigger) {

        trigger.addEventListener("click", function () {

            if (input) input.value = currentUsername || "";

            if (errorEl) errorEl.style.display = "none";

            if (typeof bootstrap === "undefined") return;

            const modalEl = document.getElementById("usernameModal");

            if (!modalEl) return;

            bootstrap.Modal.getOrCreateInstance(modalEl).show();

        });

    }

    if (saveBtn) {

        saveBtn.addEventListener("click", async function () {

            const newName = (input ? input.value : "").trim();

            if (!newName) {

                if (errorEl) {
                    errorEl.textContent   = "Please enter a name.";
                    errorEl.style.display = "block";
                }
                return;

            }

            saveBtn.disabled   = true;
            saveBtn.textContent = "Saving…";

            /* 1. Update Firebase displayName if Firebase is active */

            let fbOk = false;

            if (typeof fbRenameUser === "function") {

                fbOk = await fbRenameUser(newName);

            }

            /* 2. Update localStorage session + currentUsername */

            currentUsername = newName;

            saveSession(newName);

            /* 3. Also try localStorage account rename (fallback users) */

            if (!fbOk) renameCurrentUser(newName);

            saveBtn.disabled  = false;
            saveBtn.textContent = "Save";

            /* 4. Update all UI name spots */

            const topbarName = document.getElementById("topbarUsername");

            if (topbarName) topbarName.textContent = newName;

            const greetingEl = document.getElementById("greetingText");

            if (greetingEl && greetingEl.textContent.indexOf(",") !== -1) {

                greetingEl.textContent =
                    greetingEl.textContent.split(",")[0] + ", " + newName;

            }

            if (errorEl) errorEl.style.display = "none";

            if (typeof bootstrap !== "undefined") {

                const modalEl = document.getElementById("usernameModal");

                if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

            }

        });

    }

}

/* ===============================
   SIGN OUT
   Confirms with the user, saves
   any unsaved audit data, then
   returns to the login screen.
=============================== */

function performSignOut() {

    const confirmed = confirm(
        "Are you sure you want to sign out?\n\nYour audit data will be saved before signing out."
    );

    if (!confirmed) return;

    if (typeof saveAuditData === "function") {

        saveAuditData();

    }

    /* Firebase sign out (non-blocking) */

    if (typeof fbLogoutUser === "function") {

        fbLogoutUser();

    }

    currentUsername = "";

    auditDataStore = {};

    clearSession();

    document.getElementById("loginForm").reset();

    document.getElementById("signupBox").style.display = "none";

    document.getElementById("loginBox").style.display = "block";

    showAuthScreen();

}

/* ===============================
   WELCOME SCREEN
=============================== */

function setupWelcomeScreen() {

    document
        .getElementById("startAuditingBtn")
        .addEventListener("click", function () {

            showDateScreen();

        });

}

/* ===============================
   DATE SELECTION SCREEN
=============================== */

function setupDateScreen() {

    document
        .getElementById("continueToAuditBtn")
        .addEventListener("click", function () {

            const dateInput =
                document.getElementById("auditDateInput");

            if (!dateInput.value) {

                alert("Please select a date to continue.");

                return;

            }

            if (dateInput.value > getTodayKey()) {

                alert(

                    "You can't start a future date's audit yet.\n\n" +
                    `That date's audit will be available on ${dateInput.value} itself.`

                );

                return;

            }

            setActiveAuditDate(dateInput.value);

            saveSelectedAuditDate(dateInput.value);

            showMainApp();

        });

    document
        .getElementById("backToWelcomeBtn")
        .addEventListener("click", function () {

            const session = getSession();

            showWelcomeScreen(session ? session.username : "");

        });

    const changeDateBtn =
        document.getElementById("changeDateBtn");

    if (changeDateBtn) {

        changeDateBtn.addEventListener("click", function () {

            showDateScreen();

            const dateInput =
                document.getElementById("auditDateInput");

            if (dateInput && selectedAuditDate) {

                dateInput.value = selectedAuditDate;

            }

        });

    }

}

/* ===============================
   AUTH TABS  (Email / Quick PIN)
=============================== */

function setupAuthTabs() {

    const tabEmail = document.getElementById("tabEmailBtn");
    const tabPin   = document.getElementById("tabPinBtn");
    const tabBar   = document.getElementById("authTabBar");

    if (!tabEmail || !tabPin) return;

    /* Show PIN tab only if a PIN is set on this device */
    function refreshTabVisibility() {
        const hasPinUser = getQuickPinUsername();
        tabBar.style.display = hasPinUser ? "flex" : "none";
    }

    refreshTabVisibility();

    tabEmail.addEventListener("click", function () {
        tabEmail.classList.add("active");
        tabPin.classList.remove("active");
        document.getElementById("loginBox").style.display    = "block";
        document.getElementById("pinLoginBox").style.display = "none";
        document.getElementById("signupBox").style.display   = "none";
    });

    tabPin.addEventListener("click", function () {
        tabPin.classList.add("active");
        tabEmail.classList.remove("active");
        document.getElementById("loginBox").style.display    = "none";
        document.getElementById("pinLoginBox").style.display = "block";
        document.getElementById("signupBox").style.display   = "none";
        /* Show the saved username */
        const u = getQuickPinUsername();
        const lbl = document.getElementById("pinLoginUserLabel");
        if (lbl && u) lbl.textContent = `Hello ${u} 👋  Enter your PIN`;
        resetPinDots();
    });

    /* "Use email instead" link inside PIN box */
    const useEmailBtn = document.getElementById("pinUseEmailBtn");
    if (useEmailBtn) {
        useEmailBtn.addEventListener("click", function () {
            tabEmail.click();
        });
    }

    /* Expose so post-login setup can refresh */
    window._refreshAuthTabs = refreshTabVisibility;

}

/* ===============================
   PIN LOGIN NUMPAD
=============================== */

let _pinEntry = "";

function resetPinDots(isError) {
    _pinEntry = "";
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("pd" + i);
        if (!d) continue;
        d.className = "pin-dot" + (isError ? " error" : "");
    }
    const errEl = document.getElementById("pinLoginError");
    if (errEl && !isError) errEl.style.display = "none";
}

function updatePinDots() {
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("pd" + i);
        if (!d) continue;
        d.className = "pin-dot" + (i < _pinEntry.length ? " filled" : "");
    }
}

function setupPinLoginNumpad() {

    document.querySelectorAll(".pin-key[data-digit]").forEach(btn => {
        btn.addEventListener("click", function () {
            if (_pinEntry.length >= 4) return;
            _pinEntry += this.dataset.digit;
            updatePinDots();
            if (_pinEntry.length === 4) attemptPinLogin();
        });
    });

    const delBtn = document.getElementById("pinDelBtn");
    if (delBtn) {
        delBtn.addEventListener("click", function () {
            _pinEntry = _pinEntry.slice(0, -1);
            updatePinDots();
        });
    }

    const clearBtn = document.getElementById("pinClearBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", function () {
            resetPinDots();
        });
    }

}

function attemptPinLogin() {

    const username = getQuickPinUsername();

    if (!username) { resetPinDots(true); return; }

    if (validateQuickPin(username, _pinEntry)) {

        /* PIN correct — log in, then load all cloud data */
        saveSession(username);
        setActiveUser(username);
        loadAllCloudData(username).then(() => {
            showWelcomeScreen(username);
        });

    } else {

        /* Wrong PIN — shake + clear */
        const errEl = document.getElementById("pinLoginError");
        if (errEl) { errEl.textContent = "Wrong PIN. Try again."; errEl.style.display = "block"; }
        resetPinDots(true);
        setTimeout(() => resetPinDots(), 800);

    }

}

/* ===============================
   PIN SETUP OVERLAY
   Shown once after a successful
   email login if no PIN is set yet.
=============================== */

function offerPinSetup(username) {

    /* Don't offer again if already set */
    if (hasQuickPin(username)) return;

    /* Build overlay HTML once */
    if (!document.getElementById("pinSetupOverlay")) {

        const overlay = document.createElement("div");
        overlay.id = "pinSetupOverlay";
        overlay.className = "pin-setup-overlay";
        overlay.innerHTML = `
            <div class="pin-setup-card">
                <div class="pin-setup-icon">🔐</div>
                <div class="pin-setup-title">Set a Quick PIN</div>
                <div class="pin-setup-sub">
                    Skip typing your email & password next time.<br>
                    Just tap 4 digits and you're in instantly.
                </div>
                <div class="pin-setup-step" id="pinSetupStepLabel">STEP 1 — ENTER NEW PIN</div>
                <div class="pin-setup-dots">
                    <span class="pin-dot" id="spd0"></span>
                    <span class="pin-dot" id="spd1"></span>
                    <span class="pin-dot" id="spd2"></span>
                    <span class="pin-dot" id="spd3"></span>
                </div>
                <div id="pinSetupError" class="text-danger small mb-1 text-center" style="display:none;"></div>
                <div class="pin-setup-numpad" id="pinSetupNumpad">
                    ${[1,2,3,4,5,6,7,8,9,"✕","0","⌫"].map((k,i) => {
                        const isX  = k === "✕";
                        const isDel = k === "⌫";
                        const cls  = isX ? "pin-key pin-key-clear" : isDel ? "pin-key pin-key-del" : "pin-key";
                        const attr = (!isX && !isDel) ? `data-sdigit="${k}"` : "";
                        const id   = isX ? 'id="pinSetupClear"' : isDel ? 'id="pinSetupDel"' : "";
                        return `<button type="button" class="${cls}" ${attr} ${id}>${k}</button>`;
                    }).join("")}
                </div>
                <div class="pin-setup-actions">
                    <button type="button" id="pinSetupSkipBtn" class="btn-forgot">Not now — maybe later</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        /* Wire up skip */
        document.getElementById("pinSetupSkipBtn").addEventListener("click", closePinSetup);

        /* Wire up numpad */
        _setupPinSetupNumpad(username);

    }

    /* Reset and show */
    _pinSetupEntry = "";
    _pinSetupConfirm = "";
    _pinSetupPhase = "enter";
    _updatePinSetupDots();
    document.getElementById("pinSetupStepLabel").textContent = "STEP 1 — ENTER NEW PIN";
    const errEl = document.getElementById("pinSetupError");
    if (errEl) errEl.style.display = "none";
    requestAnimationFrame(() => {
        document.getElementById("pinSetupOverlay").classList.add("active");
    });

}

function closePinSetup() {
    const ov = document.getElementById("pinSetupOverlay");
    if (ov) ov.classList.remove("active");
}

let _pinSetupEntry   = "";
let _pinSetupConfirm = "";
let _pinSetupPhase   = "enter"; /* "enter" | "confirm" */

function _updatePinSetupDots() {
    const current = _pinSetupPhase === "confirm" ? _pinSetupConfirm : _pinSetupEntry;
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("spd" + i);
        if (d) d.className = "pin-dot" + (i < current.length ? " filled" : "");
    }
}

function _setupPinSetupNumpad(username) {

    document.querySelectorAll("#pinSetupNumpad [data-sdigit]").forEach(btn => {
        btn.addEventListener("click", function () {
            const errEl = document.getElementById("pinSetupError");

            if (_pinSetupPhase === "enter") {
                if (_pinSetupEntry.length >= 4) return;
                _pinSetupEntry += this.dataset.sdigit;
                _updatePinSetupDots();

                if (_pinSetupEntry.length === 4) {
                    /* Move to confirm phase */
                    setTimeout(() => {
                        _pinSetupPhase = "confirm";
                        _pinSetupConfirm = "";
                        _updatePinSetupDots();
                        document.getElementById("pinSetupStepLabel").textContent = "STEP 2 — CONFIRM YOUR PIN";
                        if (errEl) errEl.style.display = "none";
                    }, 200);
                }

            } else {
                if (_pinSetupConfirm.length >= 4) return;
                _pinSetupConfirm += this.dataset.sdigit;
                _updatePinSetupDots();

                if (_pinSetupConfirm.length === 4) {
                    if (_pinSetupConfirm === _pinSetupEntry) {
                        /* Match — save and done */
                        saveQuickPin(username, _pinSetupEntry);
                        if (window._refreshAuthTabs) window._refreshAuthTabs();
                        closePinSetup();
                        if (typeof showToast === "function") {
                            showToast("PIN Set!", "You can now log in with just 4 taps.", "success");
                        }
                    } else {
                        /* Mismatch — shake and restart */
                        for (let i = 0; i < 4; i++) {
                            const d = document.getElementById("spd" + i);
                            if (d) d.className = "pin-dot error";
                        }
                        if (errEl) { errEl.textContent = "PINs don't match. Try again."; errEl.style.display = "block"; }
                        setTimeout(() => {
                            _pinSetupPhase = "enter";
                            _pinSetupEntry = "";
                            _pinSetupConfirm = "";
                            _updatePinSetupDots();
                            document.getElementById("pinSetupStepLabel").textContent = "STEP 1 — ENTER NEW PIN";
                        }, 700);
                    }
                }
            }
        });
    });

    const delBtn = document.getElementById("pinSetupDel");
    if (delBtn) {
        delBtn.addEventListener("click", function () {
            if (_pinSetupPhase === "enter") _pinSetupEntry = _pinSetupEntry.slice(0, -1);
            else _pinSetupConfirm = _pinSetupConfirm.slice(0, -1);
            _updatePinSetupDots();
        });
    }

    const clrBtn = document.getElementById("pinSetupClear");
    if (clrBtn) {
        clrBtn.addEventListener("click", function () {
            _pinSetupPhase = "enter";
            _pinSetupEntry = "";
            _pinSetupConfirm = "";
            _updatePinSetupDots();
            document.getElementById("pinSetupStepLabel").textContent = "STEP 1 — ENTER NEW PIN";
        });
    }

}

/* ===============================
   PROFILE MODAL — QUICK PIN SECTION
   Opened from topbar "Manage Quick PIN"
   or when avatarModal opens.
=============================== */

function setupProfileQuickPin() {

    /* "Manage Quick PIN" dropdown item */
    const manageBtn = document.getElementById("manageQuickPinBtn");
    if (manageBtn) {
        manageBtn.addEventListener("click", function () {
            const modalEl = document.getElementById("avatarModal");
            if (modalEl && typeof bootstrap !== "undefined") {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            }
        });
    }

    /* Refresh PIN section state whenever the modal opens */
    const avatarModal = document.getElementById("avatarModal");
    if (avatarModal) {
        avatarModal.addEventListener("show.bs.modal", _refreshQpSection);
    }

    /* Set-up numpad inside modal */
    _wireQpNumpad();

    /* "Give it a try" overlay */
    _wireQpTryOverlay();

    /* Change / Remove buttons */
    const changeBtn = document.getElementById("qpChangeBtn");
    if (changeBtn) {
        changeBtn.addEventListener("click", function () {
            /* Reset to setup area so user can enter new PIN */
            _qpEntry = ""; _qpConfirm = ""; _qpPhase = "enter";
            _updateQpDots();
            document.getElementById("qpSetupArea").style.display  = "";
            document.getElementById("qpManageArea").style.display = "none";
            document.getElementById("qpStepLabel").textContent    = "STEP 1 — ENTER NEW PIN";
            document.getElementById("qpStatusText").textContent   = "Enter a new 4-digit Quick Login PIN below:";
            const errEl = document.getElementById("qpError");
            if (errEl) errEl.style.display = "none";
        });
    }

    const removeBtn = document.getElementById("qpRemoveBtn");
    if (removeBtn) {
        removeBtn.addEventListener("click", function () {
            if (!confirm("Remove your Quick PIN? You'll need to log in with email next time.")) return;
            const u = getSession() ? getSession().username : null;
            if (u) clearQuickPin(u);
            if (window._refreshAuthTabs) window._refreshAuthTabs();
            _refreshQpSection();
            showToast("PIN Removed", "Quick PIN has been cleared.", "success");
        });
    }

}

let _qpEntry = "", _qpConfirm = "", _qpPhase = "enter";

function _refreshQpSection() {

    const session = getSession();
    const username = session ? session.username : null;
    const hasPIN   = username && hasQuickPin(username);

    const statusEl  = document.getElementById("qpStatusText");
    const setupArea = document.getElementById("qpSetupArea");
    const manageArea= document.getElementById("qpManageArea");

    if (hasPIN) {
        if (statusEl)   statusEl.textContent   = "✅ Quick PIN is active for this account.";
        if (setupArea)  setupArea.style.display  = "none";
        if (manageArea) manageArea.style.display = "";
    } else {
        if (statusEl)   statusEl.textContent   = "No Quick PIN set. Set one below for instant login.";
        if (setupArea)  setupArea.style.display  = "";
        if (manageArea) manageArea.style.display = "none";
        /* Reset numpad */
        _qpEntry = ""; _qpConfirm = ""; _qpPhase = "enter";
        _updateQpDots();
        const stepEl = document.getElementById("qpStepLabel");
        if (stepEl) stepEl.textContent = "STEP 1 — ENTER NEW PIN";
        const errEl  = document.getElementById("qpError");
        if (errEl) errEl.style.display = "none";
    }

}

function _updateQpDots() {

    const src = _qpPhase === "confirm" ? _qpConfirm : _qpEntry;
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("qpd" + i);
        if (d) d.className = "pin-dot" + (i < src.length ? " filled" : "");
    }

}

function _wireQpNumpad() {

    document.querySelectorAll("#qpNumpad [data-qdigit]").forEach(btn => {
        btn.addEventListener("click", function () {
            _handleQpDigit(this.dataset.qdigit);
        });
    });

    const delBtn = document.getElementById("qpDel");
    if (delBtn) delBtn.addEventListener("click", () => {
        if (_qpPhase === "enter") _qpEntry = _qpEntry.slice(0, -1);
        else _qpConfirm = _qpConfirm.slice(0, -1);
        _updateQpDots();
    });

    const clrBtn = document.getElementById("qpClear");
    if (clrBtn) clrBtn.addEventListener("click", () => {
        _qpPhase = "enter"; _qpEntry = ""; _qpConfirm = "";
        _updateQpDots();
        const stepEl = document.getElementById("qpStepLabel");
        if (stepEl) stepEl.textContent = "STEP 1 — ENTER NEW PIN";
    });

}

function _handleQpDigit(digit) {

    const errEl  = document.getElementById("qpError");
    const stepEl = document.getElementById("qpStepLabel");

    if (_qpPhase === "enter") {

        if (_qpEntry.length >= 4) return;
        _qpEntry += digit;
        _updateQpDots();

        if (_qpEntry.length === 4) {
            setTimeout(() => {
                _qpPhase = "confirm"; _qpConfirm = "";
                _updateQpDots();
                if (stepEl) stepEl.textContent = "STEP 2 — CONFIRM YOUR PIN";
                if (errEl)  errEl.style.display = "none";
            }, 180);
        }

    } else {

        if (_qpConfirm.length >= 4) return;
        _qpConfirm += digit;
        _updateQpDots();

        if (_qpConfirm.length === 4) {

            if (_qpConfirm === _qpEntry) {

                /* ✅ Match — save PIN */
                const session  = getSession();
                const username = session ? session.username : null;

                if (username) {
                    saveQuickPin(username, _qpEntry);
                    if (window._refreshAuthTabs) window._refreshAuthTabs();
                }

                /* Close avatar modal */
                const modalEl = document.getElementById("avatarModal");
                if (modalEl && typeof bootstrap !== "undefined") {
                    bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                }

                /* Show "Give it a try" overlay */
                setTimeout(() => _openQpTryOverlay(username), 300);

            } else {

                /* ❌ Mismatch */
                for (let i = 0; i < 4; i++) {
                    const d = document.getElementById("qpd" + i);
                    if (d) d.className = "pin-dot error";
                }
                if (errEl) { errEl.textContent = "PINs don't match. Try again."; errEl.style.display = "block"; }
                setTimeout(() => {
                    _qpPhase = "enter"; _qpEntry = ""; _qpConfirm = "";
                    _updateQpDots();
                    if (stepEl) stepEl.textContent = "STEP 1 — ENTER NEW PIN";
                }, 700);

            }

        }

    }

}

/* ── "Give it a try" overlay ── */
let _qpTryEntry = "";

function _openQpTryOverlay(username) {

    _qpTryEntry = "";
    _updateQpTryDots();
    const errEl = document.getElementById("qpTryError");
    if (errEl) errEl.style.display = "none";
    const subEl = document.getElementById("qpTrySub");
    if (subEl) subEl.textContent = `Your Quick PIN is saved${username ? " for " + username : ""}. Try entering it now to make sure it works!`;
    document.getElementById("qpTryOverlay").classList.add("active");

}

function _closeQpTryOverlay() {
    document.getElementById("qpTryOverlay").classList.remove("active");
    _qpTryEntry = "";
    _updateQpTryDots();
    const errEl = document.getElementById("qpTryError");
    if (errEl) errEl.style.display = "none";
}

function _updateQpTryDots() {

    for (let i = 0; i < 4; i++) {
        const d = document.getElementById("qtd" + i);
        if (d) d.className = "pin-dot" + (i < _qpTryEntry.length ? " filled" : "");
    }

}

function _wireQpTryOverlay() {

    document.querySelectorAll("#qpTryNumpad [data-tdigit]").forEach(btn => {
        btn.addEventListener("click", function () {
            if (_qpTryEntry.length >= 4) return;
            _qpTryEntry += this.dataset.tdigit;
            _updateQpTryDots();

            if (_qpTryEntry.length === 4) {
                const username = getQuickPinUsername();
                if (username && validateQuickPin(username, _qpTryEntry)) {
                    /* ✅ Correct */
                    _closeQpTryOverlay();
                    showToast("🎉 It works!", "Quick PIN verified. You can use it to log in anytime.", "success");
                    _refreshQpSection();
                } else {
                    /* ❌ Wrong */
                    for (let i = 0; i < 4; i++) {
                        const d = document.getElementById("qtd" + i);
                        if (d) d.className = "pin-dot error";
                    }
                    const errEl = document.getElementById("qpTryError");
                    if (errEl) errEl.style.display = "block";
                    setTimeout(() => { _qpTryEntry = ""; _updateQpTryDots(); if (errEl) errEl.style.display = "none"; }, 900);
                }
            }
        });
    });

    const delBtn = document.getElementById("qpTryDel");
    if (delBtn) delBtn.addEventListener("click", () => { _qpTryEntry = _qpTryEntry.slice(0,-1); _updateQpTryDots(); });

    const clrBtn = document.getElementById("qpTryClear");
    if (clrBtn) clrBtn.addEventListener("click", () => { _qpTryEntry = ""; _updateQpTryDots(); });

    const skipBtn = document.getElementById("qpTrySkipBtn");
    if (skipBtn) skipBtn.addEventListener("click", () => {
        _closeQpTryOverlay();
        _refreshQpSection();
    });

}

/* ===============================
   KEYBOARD SUPPORT — ALL PIN FIELDS
   Works on laptop, PC, MacBook.
   Digits 0-9 → add digit to the
   active numpad context.
   Backspace → delete last digit.
   Escape → clear all.
=============================== */

function setupPinKeyboardSupport() {

    document.addEventListener("keydown", function (e) {

        const key = e.key;

        /* Determine which context is active */
        const pinLoginVisible  = document.getElementById("pinLoginBox") &&
                                  document.getElementById("pinLoginBox").style.display !== "none" &&
                                  document.getElementById("authScreen") &&
                                  document.getElementById("authScreen").style.display !== "none";

        const lockOverlayActive = document.getElementById("lockOverlay") &&
                                   document.getElementById("lockOverlay").classList.contains("active");

        const setPinModalActive = document.getElementById("setPinModal") &&
                                   document.getElementById("setPinModal").classList.contains("active");

        const qpTryOverlayActive = document.getElementById("qpTryOverlay") &&
                                    document.getElementById("qpTryOverlay").classList.contains("active");

        /* Check if modal is open and PIN section visible */
        const avatarModalOpen = document.getElementById("avatarModal") &&
                                  document.getElementById("avatarModal").classList.contains("show") &&
                                  document.getElementById("qpSetupArea") &&
                                  document.getElementById("qpSetupArea").style.display !== "none";

        /* Don't intercept if user is typing in an input/textarea */
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;

        const isDigit = /^[0-9]$/.test(key);
        const isDel   = key === "Backspace" || key === "Delete";
        const isEsc   = key === "Escape";

        if (pinLoginVisible) {

            if (isDigit) { if (_pinEntry.length < 4) { _pinEntry += key; updatePinDots(); if (_pinEntry.length === 4) attemptPinLogin(); } }
            else if (isDel) { _pinEntry = _pinEntry.slice(0, -1); updatePinDots(); }
            else if (isEsc) { resetPinDots(); }
            e.preventDefault();

        } else if (lockOverlayActive) {

            /* Figure out which sub-section */
            const mainVisible   = document.getElementById("lockBoxMain") && document.getElementById("lockBoxMain").style.display !== "none";
            const forgotVisible = document.getElementById("lockBoxForgot") && document.getElementById("lockBoxForgot").style.display !== "none";
            const setNewVisible = document.getElementById("lockBoxSetNew") && document.getElementById("lockBoxSetNew").style.display !== "none";

            if (mainVisible) {
                if (isDigit) { if (_unlockEntry.length < 4) { _unlockEntry += key; _updateUnlockDots(); if (_unlockEntry.length === 4) attemptUnlock(); } }
                else if (isDel) { _unlockEntry = _unlockEntry.slice(0, -1); _updateUnlockDots(); }
                else if (isEsc) { _resetUnlockDots(); }
                e.preventDefault();
            } else if (forgotVisible) {
                if (isDigit) { document.querySelector(`[data-fdigit="${key}"]`) && document.querySelector(`[data-fdigit="${key}"]`).click(); }
                else if (isDel) { _forgotEntry = _forgotEntry.slice(0, -1); _updateForgotDots(); e.preventDefault(); }
            } else if (setNewVisible) {
                if (isDigit) { document.querySelector(`[data-ndigit="${key}"]`) && document.querySelector(`[data-ndigit="${key}"]`).click(); }
                else if (isDel) { if (_setNewPhase === "enter") _setNewEntry = _setNewEntry.slice(0,-1); else _setNewConfirm = _setNewConfirm.slice(0,-1); _updateSetNewDots(); e.preventDefault(); }
            }

        } else if (setPinModalActive) {

            if (isDigit) { document.querySelector(`[data-mpdigit="${key}"]`) && document.querySelector(`[data-mpdigit="${key}"]`).click(); }
            else if (isDel) { document.getElementById("setPinModalDel") && document.getElementById("setPinModalDel").click(); e.preventDefault(); }
            else if (isEsc) { _closeSetPinModal(); }

        } else if (qpTryOverlayActive) {

            if (isDigit) { document.querySelector(`[data-tdigit="${key}"]`) && document.querySelector(`[data-tdigit="${key}"]`).click(); }
            else if (isDel) { _qpTryEntry = _qpTryEntry.slice(0,-1); _updateQpTryDots(); e.preventDefault(); }
            else if (isEsc) { _closeQpTryOverlay(); }

        } else if (avatarModalOpen) {

            if (isDigit) { _handleQpDigit(key); }
            else if (isDel) { if (_qpPhase === "enter") _qpEntry = _qpEntry.slice(0,-1); else _qpConfirm = _qpConfirm.slice(0,-1); _updateQpDots(); e.preventDefault(); }
            else if (isEsc) { _qpPhase = "enter"; _qpEntry = ""; _qpConfirm = ""; _updateQpDots(); }

        }

    });

}
