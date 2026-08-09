/* ==========================================================
   Toll Audit — Daily Audit & Monthly Master Module
   audit-module.js
   Depends on: data.js, firebase.js, ui.js
========================================================== */

/* ══════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════ */

const DA_STORAGE_KEY = "tollAuditDailyAudits";

const DA_VEHICLE_CLASSES = [
    { id: "car",     label: "Car",          tariffSingle: 85,  tariffReturn: 130 },
    { id: "lcv",     label: "LCV/Mini Bus", tariffSingle: 130, tariffReturn: 195 },
    { id: "bus",     label: "Bus",          tariffSingle: 255, tariffReturn: 385 },
    { id: "truck",   label: "Truck 2 Axle", tariffSingle: 255, tariffReturn: 385 },
    { id: "mav",     label: "MAV 3-6 Axle", tariffSingle: 415, tariffReturn: 625 },
    { id: "osv",     label: "OSV",          tariffSingle: 510, tariffReturn: 770 },
    { id: "nonToll", label: "Non-Tollable", tariffSingle: 0,   tariffReturn: 0   }
];

const DA_TOLLABLE_CLASSES = DA_VEHICLE_CLASSES.filter(c => c.id !== "nonToll");

const DA_PAYMENT_MODES  = ["cash", "ret", "barcode", "digital", "etc", "pass"];
const DA_PAYMENT_LABELS = { cash:"Cash", ret:"Return", barcode:"Barcode", digital:"Digital", etc:"ETC", pass:"Pass" };

const DA_MONTHS = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
];

/* ══════════════════════════════════════════════
   IN-MEMORY STORE
   dailyAudits["YYYY-MM-DD"] = DailyAuditRecord
══════════════════════════════════════════════ */

let dailyAudits = {};

/* ══════════════════════════════════════════════
   DATA MODEL
══════════════════════════════════════════════ */

function daEmptyClassRecord() {
    const paid = {};
    DA_PAYMENT_MODES.forEach(m => { paid[m] = 0; });
    return {
        paid,
        violationReported: 0,
        violationActual:   0,
        violationRemark:   "",
        exemptionReported: 0,
        exemptionActual:   0,
        exemptionRemark:   ""
    };
}

function daEmptyRecord(dateKey) {
    const classes = {};
    DA_VEHICLE_CLASSES.forEach(vc => { classes[vc.id] = daEmptyClassRecord(); });
    return {
        dateKey,
        status:      "not_started",   // "not_started" | "in_progress" | "completed"
        classes,
        lastUpdated: null
    };
}

/* ── Calculations ── */

function daCalcPaid(classRec) {
    return DA_PAYMENT_MODES.reduce((s, m) => s + (Number(classRec.paid[m]) || 0), 0);
}

function daCalcViolationLoss(classRec, vcObj) {
    return (Number(classRec.violationActual) || 0) * vcObj.tariffSingle;
}

function daCalcExemptionLoss(classRec, vcObj) {
    return (Number(classRec.exemptionActual) || 0) * vcObj.tariffSingle;
}

function daCalcTotalLoss(classRec, vcObj) {
    return daCalcViolationLoss(classRec, vcObj) + daCalcExemptionLoss(classRec, vcObj);
}

function daCalcTotal(classRec) {
    return daCalcPaid(classRec)
        + (Number(classRec.violationActual) || 0)
        + (Number(classRec.exemptionActual) || 0);
}

/* Build a full summary for one daily record */
function daSummary(record) {
    let totalPaid = 0, totalViolation = 0, totalExemption = 0;
    let violLoss = 0, exemLoss = 0;
    const byClass = {};

    DA_VEHICLE_CLASSES.forEach(vc => {
        const cr = record.classes[vc.id] || daEmptyClassRecord();
        const paid = daCalcPaid(cr);
        const viol = Number(cr.violationActual) || 0;
        const exem = Number(cr.exemptionActual) || 0;
        const vl   = daCalcViolationLoss(cr, vc);
        const el   = daCalcExemptionLoss(cr, vc);
        byClass[vc.id] = { paid, viol, exem, total: paid + viol + exem, vl, el, totalLoss: vl + el };
        if (vc.id !== "nonToll") {
            totalPaid      += paid;
            totalViolation += viol;
            totalExemption += exem;
            violLoss       += vl;
            exemLoss       += el;
        } else {
            // Non-tollable: count viol+exem but no revenue
            totalViolation += viol;
            totalExemption += exem;
        }
    });

    const totalUnpaid  = totalViolation + totalExemption;
    const totalTraffic = totalPaid + totalUnpaid;
    const totalLoss    = violLoss + exemLoss;
    const trafficLossPct = totalTraffic > 0
        ? ((totalUnpaid / totalTraffic) * 100).toFixed(2)
        : "0.00";

    return { totalPaid, totalViolation, totalExemption, totalUnpaid, totalTraffic,
             violLoss, exemLoss, totalLoss, trafficLossPct, byClass };
}

/* ══════════════════════════════════════════════
   PERSISTENCE  (localStorage)
══════════════════════════════════════════════ */

function daLoad() {
    try {
        const raw = localStorage.getItem(DA_STORAGE_KEY);
        if (raw) dailyAudits = JSON.parse(raw);
    } catch (e) { dailyAudits = {}; }
}

function daSave() {
    try {
        localStorage.setItem(DA_STORAGE_KEY, JSON.stringify(dailyAudits));
    } catch (e) { console.warn("[DA] localStorage save failed", e); }
}

function daGetOrCreate(dateKey) {
    if (!dailyAudits[dateKey]) {
        dailyAudits[dateKey] = daEmptyRecord(dateKey);
    }
    return dailyAudits[dateKey];
}

function daGetRecord(dateKey) {
    return dailyAudits[dateKey] || null;
}

/* Save a record and mark as in_progress if not completed */
function daSaveRecord(record) {
    if (record.status === "not_started") record.status = "in_progress";
    record.lastUpdated = new Date().toISOString();
    dailyAudits[record.dateKey] = record;
    daSave();
}

/* Complete a record */
function daCompleteRecord(record) {
    record.status      = "completed";
    record.lastUpdated = new Date().toISOString();
    dailyAudits[record.dateKey] = record;
    daSave();
}

/* ══════════════════════════════════════════════
   MONTHLY MASTER  (computed — never stored separately)
══════════════════════════════════════════════ */

/* Returns rows for a given year/month (1-based month) */
function daMonthlyMasterRows(year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const rows = [];
    for (let d = 1; d <= daysInMonth; d++) {
        const mm   = String(month).padStart(2, "0");
        const dd   = String(d).padStart(2, "0");
        const key  = `${year}-${mm}-${dd}`;
        const rec  = dailyAudits[key] || null;
        const summ = rec ? daSummary(rec) : null;
        rows.push({ day: d, dateKey: key, record: rec, summary: summ });
    }
    return rows;
}

/* ══════════════════════════════════════════════
   DATE HELPERS
══════════════════════════════════════════════ */

function daFormatDate(dateKey) {
    const [y, m, d] = dateKey.split("-");
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${parseInt(d)} ${monthNames[parseInt(m) - 1]} ${y}`;
}

function daFormatCurrency(n) {
    return "₹" + Number(n || 0).toLocaleString("en-IN");
}

function daDatesInRange(startKey, endKey) {
    const result = [];
    const cur = new Date(startKey);
    const end = new Date(endKey);
    while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, "0");
        const d = String(cur.getDate()).padStart(2, "0");
        result.push(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
    }
    return result;
}

/* ══════════════════════════════════════════════
   ANALYTICS ENGINE
══════════════════════════════════════════════ */

function daAnalytics(dateKeys) {
    const completed = dateKeys.filter(k => {
        const r = dailyAudits[k];
        return r && r.status !== "not_started";
    });
    if (!completed.length) return null;

    let totalPaid=0, totalViol=0, totalExem=0, totalLoss=0, violLoss=0, exemLoss=0;
    const byClass = {};
    DA_VEHICLE_CLASSES.forEach(vc => { byClass[vc.id] = { paid:0, viol:0, exem:0 }; });

    let highTrafficDay=null, highTrafficVal=0;
    let lowTrafficDay=null,  lowTrafficVal=Infinity;
    let highViolDay=null,    highViolVal=0;
    let highExemDay=null,    highExemVal=0;

    completed.forEach(k => {
        const rec = dailyAudits[k];
        if (!rec) return;
        const s = daSummary(rec);
        totalPaid += s.totalPaid;
        totalViol += s.totalViolation;
        totalExem += s.totalExemption;
        totalLoss += s.totalLoss;
        violLoss  += s.violLoss;
        exemLoss  += s.exemLoss;

        DA_VEHICLE_CLASSES.forEach(vc => {
            byClass[vc.id].paid += s.byClass[vc.id].paid;
            byClass[vc.id].viol += s.byClass[vc.id].viol;
            byClass[vc.id].exem += s.byClass[vc.id].exem;
        });

        if (s.totalTraffic > highTrafficVal) { highTrafficVal = s.totalTraffic; highTrafficDay = k; }
        if (s.totalTraffic < lowTrafficVal)  { lowTrafficVal  = s.totalTraffic; lowTrafficDay  = k; }
        if (s.totalViolation > highViolVal)  { highViolVal    = s.totalViolation; highViolDay  = k; }
        if (s.totalExemption > highExemVal)  { highExemVal    = s.totalExemption; highExemDay  = k; }
    });

    const totalUnpaid  = totalViol + totalExem;
    const totalTraffic = totalPaid + totalUnpaid;
    const trafficLossPct = totalTraffic > 0
        ? ((totalUnpaid / totalTraffic) * 100).toFixed(2) : "0.00";

    // Most violated / exempted category
    let topViolClass = DA_TOLLABLE_CLASSES[0].id, topViolVal = -1;
    let topExemClass = DA_TOLLABLE_CLASSES[0].id, topExemVal = -1;
    DA_TOLLABLE_CLASSES.forEach(vc => {
        if (byClass[vc.id].viol > topViolVal) { topViolVal = byClass[vc.id].viol; topViolClass = vc.id; }
        if (byClass[vc.id].exem > topExemVal) { topExemVal = byClass[vc.id].exem; topExemClass = vc.id; }
    });

    return {
        totalPaid, totalViol, totalExem, totalUnpaid, totalTraffic,
        totalLoss, violLoss, exemLoss, trafficLossPct,
        byClass,
        highTrafficDay, highTrafficVal,
        lowTrafficDay,  lowTrafficVal: lowTrafficVal === Infinity ? 0 : lowTrafficVal,
        highViolDay,    highViolVal,
        highExemDay,    highExemVal,
        topViolClass, topExemClass,
        daysAudited: completed.length
    };
}

/* ══════════════════════════════════════════════
   SEED DEMO DATA
══════════════════════════════════════════════ */

function daLoadSeedData() {
    const today   = new Date();
    const year    = today.getFullYear();
    const month   = today.getMonth() + 1;
    const mm      = String(month).padStart(2, "0");
    const key01   = `${year}-${mm}-01`;
    const key02   = `${year}-${mm}-02`;

    if (dailyAudits[key01]) return;  // already have data

    // 01 Aug seed
    const r01 = daEmptyRecord(key01);
    r01.status = "completed";
    r01.lastUpdated = new Date().toISOString();
    const setClass = (rec, id, paid, vRep, vAct, vRmk, eRep, eAct, eRmk) => {
        const cr = rec.classes[id];
        // paid = [cash, ret, barcode, digital, etc, pass]
        DA_PAYMENT_MODES.forEach((m, i) => { cr.paid[m] = paid[i] || 0; });
        cr.violationReported = vRep; cr.violationActual = vAct; cr.violationRemark = vRmk;
        cr.exemptionReported = eRep; cr.exemptionActual = eAct; cr.exemptionRemark = eRmk;
    };
    setClass(r01, "car",     [65,38,34,28,648,16], 140, 140, "",          980, 977, "LCV - 1, Tractor - 2");
    setClass(r01, "lcv",     [20,5,10,8,73,5],     6,   1,  "Car - 5",   28,  28,  "");
    setClass(r01, "bus",     [5,2,3,2,13,1],       6,   6,  "",          12,  12,  "");
    setClass(r01, "truck",   [30,10,20,15,155,4],  1,   1,  "",          0,   0,   "");
    setClass(r01, "mav",     [20,5,15,10,310,4],   8,   8,  "",          6,   6,   "");
    setClass(r01, "osv",     [0,0,0,0,0,0],        0,   0,  "",          0,   0,   "");
    setClass(r01, "nonToll", [0,0,0,0,0,0],        5,   5,  "",          12,  12,  "");
    dailyAudits[key01] = r01;

    // 02 Aug seed
    const r02 = daEmptyRecord(key02);
    r02.status = "completed";
    r02.lastUpdated = new Date().toISOString();
    setClass(r02, "car",     [70,40,36,30,700,20], 155, 155, "",          900, 897, "");
    setClass(r02, "lcv",     [22,6,11,9,80,5],     7,   7,  "",          30,  30,  "");
    setClass(r02, "bus",     [6,3,4,2,15,2],       5,   5,  "",          14,  14,  "");
    setClass(r02, "truck",   [32,12,22,16,160,5],  2,   2,  "",          0,   0,   "");
    setClass(r02, "mav",     [22,6,16,11,320,5],   9,   9,  "",          7,   7,   "");
    setClass(r02, "osv",     [0,0,0,0,0,0],        0,   0,  "",          0,   0,   "");
    setClass(r02, "nonToll", [0,0,0,0,0,0],        6,   6,  "",          14,  14,  "");
    dailyAudits[key02] = r02;

    daSave();
}

/* ══════════════════════════════════════════════
   UI  —  NAVIGATION STATE
══════════════════════════════════════════════ */

let daCurrentView = "da-dashboard";   // active panel id
let daCurrentDate = "";               // the date being edited
let daCurrentYear  = new Date().getFullYear();
let daCurrentMonth = new Date().getMonth() + 1;

function daShowPanel(id) {
    ["da-dashboard","da-daily","da-monthly","da-analytics","da-comparison"]
        .forEach(p => {
            const el = document.getElementById(p);
            if (el) el.style.display = p === id ? "" : "none";
        });
    daCurrentView = id;
    // update nav pills
    document.querySelectorAll(".da-nav-pill").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.panel === id);
    });
}

/* ══════════════════════════════════════════════
   RENDER  —  DASHBOARD
══════════════════════════════════════════════ */

function daRenderDashboard() {
    const year  = daCurrentYear;
    const month = daCurrentMonth;
    const mm    = String(month).padStart(2, "0");

    // Sync month selector
    const mSel = document.getElementById("daDashMonthSel");
    if (mSel && !mSel.value) {
        mSel.value = `${year}-${mm}`;
    }

    daRenderMonthCalendar(year, month);
    daRenderDashboardStats(year, month);
}

function daRenderDashboardStats(year, month) {
    const rows = daMonthlyMasterRows(year, month);
    let completed=0, inProgress=0, notStarted=0;
    rows.forEach(r => {
        if (!r.record || r.record.status === "not_started") notStarted++;
        else if (r.record.status === "in_progress") inProgress++;
        else completed++;
    });
    const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    setEl("daDashCompleted",   completed);
    setEl("daDashInProgress",  inProgress);
    setEl("daDashNotStarted",  notStarted);
    setEl("daDashTotal",       rows.length);

    // Monthly totals
    const dateKeys = rows.map(r => r.dateKey);
    const analytics = daAnalytics(dateKeys);
    if (analytics) {
        setEl("daDashPaid",     analytics.totalPaid.toLocaleString("en-IN"));
        setEl("daDashViol",     analytics.totalViol.toLocaleString("en-IN"));
        setEl("daDashExem",     analytics.totalExem.toLocaleString("en-IN"));
        setEl("daDashLoss",     daFormatCurrency(analytics.totalLoss));
        setEl("daDashLossPct",  analytics.trafficLossPct + "%");
    } else {
        ["daDashPaid","daDashViol","daDashExem"].forEach(id => setEl(id, "0"));
        setEl("daDashLoss",    "₹0");
        setEl("daDashLossPct", "0.00%");
    }
}

function daRenderMonthCalendar(year, month) {
    const grid = document.getElementById("daDashCalendar");
    if (!grid) return;
    const rows = daMonthlyMasterRows(year, month);
    const monthName = DA_MONTHS[month - 1];
    const titleEl = document.getElementById("daDashCalTitle");
    if (titleEl) titleEl.textContent = `${monthName} ${year}`;

    grid.innerHTML = rows.map(r => {
        const status = r.record ? r.record.status : "not_started";
        const summ   = r.summary;
        const lossStr = summ ? daFormatCurrency(summ.totalLoss) : "";
        const trafficStr = summ ? summ.totalTraffic.toLocaleString("en-IN") : "";
        return `<div class="da-cal-day da-cal-${status}" data-date="${r.dateKey}" role="button">
            <div class="da-cal-day-num">${r.day}</div>
            <div class="da-cal-status-dot"></div>
            ${trafficStr ? `<div class="da-cal-traffic">${trafficStr}</div>` : ""}
            ${lossStr    ? `<div class="da-cal-loss">${lossStr}</div>` : ""}
        </div>`;
    }).join("");

    grid.querySelectorAll(".da-cal-day").forEach(el => {
        el.addEventListener("click", () => {
            daOpenAudit(el.dataset.date);
        });
    });
}

/* ══════════════════════════════════════════════
   RENDER  —  DAILY AUDIT FORM
══════════════════════════════════════════════ */

function daOpenAudit(dateKey) {
    daCurrentDate = dateKey;
    const record = daGetOrCreate(dateKey);

    document.getElementById("daDailyTitle").textContent = "Daily Audit — " + daFormatDate(dateKey);
    const statusBadge = document.getElementById("daDailyStatusBadge");
    const statusLabels = { not_started: "Not Started", in_progress: "In Progress", completed: "Completed" };
    statusBadge.textContent = statusLabels[record.status] || "Not Started";
    statusBadge.className = "da-status-badge da-status-" + record.status;

    daRenderAuditForm(record);
    daShowPanel("da-daily");
}

function daRenderAuditForm(record) {
    const wrap = document.getElementById("daDailyFormWrap");
    if (!wrap) return;

    let html = "";

    DA_VEHICLE_CLASSES.forEach(vc => {
        const cr  = record.classes[vc.id] || daEmptyClassRecord();
        const isNT = vc.id === "nonToll";
        const totalPaid = daCalcPaid(cr);
        const viol = Number(cr.violationActual) || 0;
        const exem = Number(cr.exemptionActual) || 0;
        const total = totalPaid + viol + exem;
        const vLoss  = daCalcViolationLoss(cr, vc);
        const eLoss  = daCalcExemptionLoss(cr, vc);
        const tLoss  = vLoss + eLoss;

        html += `<div class="da-class-card" id="da-card-${vc.id}">
            <div class="da-class-header">
                <span class="da-class-label">${vc.label}</span>
                ${!isNT ? `<span class="da-class-tariff">₹${vc.tariffSingle} / ₹${vc.tariffReturn}</span>` : `<span class="da-class-tariff">No Tariff</span>`}
                <span class="da-class-total">Total: <strong id="da-total-${vc.id}">${total.toLocaleString("en-IN")}</strong></span>
            </div>`;

        if (!isNT) {
            // Paid Traffic breakdown
            html += `<div class="da-section-label"><i class="bi bi-credit-card-2-front-fill"></i> Paid Traffic</div>
            <div class="da-paid-grid">`;
            DA_PAYMENT_MODES.forEach(pm => {
                html += `<div class="da-paid-cell">
                    <label>${DA_PAYMENT_LABELS[pm]}</label>
                    <input type="number" min="0" class="da-input da-paid-input"
                           data-class="${vc.id}" data-mode="${pm}"
                           value="${cr.paid[pm] || 0}">
                </div>`;
            });
            html += `<div class="da-paid-cell da-paid-total-cell">
                    <label>Paid Total</label>
                    <div class="da-calc-val" id="da-paid-total-${vc.id}">${totalPaid.toLocaleString("en-IN")}</div>
                </div>
            </div>`;
        }

        // Violation Section
        html += `<div class="da-two-col">
            <div>
                <div class="da-section-label da-viol-label"><i class="bi bi-exclamation-triangle-fill"></i> Violation</div>
                <div class="da-report-row">
                    <label>As Per Report</label>
                    <input type="number" min="0" class="da-input da-input-reported"
                           data-class="${vc.id}" data-field="violationReported"
                           value="${cr.violationReported || 0}">
                </div>
                <div class="da-report-row">
                    <label>Actual Checked</label>
                    <input type="number" min="0" class="da-input da-input-actual"
                           data-class="${vc.id}" data-field="violationActual"
                           value="${cr.violationActual || 0}">
                </div>
                <div class="da-report-row da-diff-row">
                    <label>Difference</label>
                    <div class="da-calc-val da-diff" id="da-viol-diff-${vc.id}">${(Number(cr.violationReported||0)-Number(cr.violationActual||0)).toLocaleString("en-IN")}</div>
                </div>
                <div class="da-report-row">
                    <label>Revenue Loss</label>
                    <div class="da-calc-val da-loss-val" id="da-viol-loss-${vc.id}">${daFormatCurrency(vLoss)}</div>
                </div>
                <div class="da-report-row">
                    <label>Remark</label>
                    <input type="text" class="da-input da-remark-input"
                           data-class="${vc.id}" data-field="violationRemark"
                           placeholder="e.g. Car - 5"
                           value="${(cr.violationRemark || '').replace(/"/g,'&quot;')}">
                </div>
            </div>
            <div>
                <div class="da-section-label da-exem-label"><i class="bi bi-shield-check"></i> Exemption</div>
                <div class="da-report-row">
                    <label>As Per Report</label>
                    <input type="number" min="0" class="da-input da-input-reported"
                           data-class="${vc.id}" data-field="exemptionReported"
                           value="${cr.exemptionReported || 0}">
                </div>
                <div class="da-report-row">
                    <label>Actual Checked</label>
                    <input type="number" min="0" class="da-input da-input-actual"
                           data-class="${vc.id}" data-field="exemptionActual"
                           value="${cr.exemptionActual || 0}">
                </div>
                <div class="da-report-row da-diff-row">
                    <label>Difference</label>
                    <div class="da-calc-val da-diff" id="da-exem-diff-${vc.id}">${(Number(cr.exemptionReported||0)-Number(cr.exemptionActual||0)).toLocaleString("en-IN")}</div>
                </div>
                <div class="da-report-row">
                    <label>Revenue Loss</label>
                    <div class="da-calc-val da-loss-val" id="da-exem-loss-${vc.id}">${daFormatCurrency(eLoss)}</div>
                </div>
                <div class="da-report-row">
                    <label>Remark</label>
                    <input type="text" class="da-input da-remark-input"
                           data-class="${vc.id}" data-field="exemptionRemark"
                           placeholder="e.g. LCV - 1, Tractor - 2"
                           value="${(cr.exemptionRemark || '').replace(/"/g,'&quot;')}">
                </div>
            </div>
        </div>`;

        // Class totals bar
        html += `<div class="da-class-totals">
            ${!isNT ? `<span>Paid: <strong id="da-sum-paid-${vc.id}">${totalPaid.toLocaleString("en-IN")}</strong></span>` : ""}
            <span>Violation: <strong id="da-sum-viol-${vc.id}">${viol.toLocaleString("en-IN")}</strong></span>
            <span>Exemption: <strong id="da-sum-exem-${vc.id}">${exem.toLocaleString("en-IN")}</strong></span>
            <span>Total: <strong id="da-sum-total-${vc.id}">${total.toLocaleString("en-IN")}</strong></span>
            ${!isNT ? `<span class="da-loss-chip">Loss: <strong id="da-sum-loss-${vc.id}">${daFormatCurrency(tLoss)}</strong></span>` : ""}
        </div>
        </div>`; // .da-class-card
    });

    wrap.innerHTML = html;

    // Attach live calculation listeners
    wrap.querySelectorAll(".da-paid-input").forEach(inp => {
        inp.addEventListener("input", () => daLiveCalc(record, inp.dataset.class, "paid", inp.dataset.mode, inp.value));
    });
    wrap.querySelectorAll(".da-input-reported, .da-input-actual").forEach(inp => {
        inp.addEventListener("input", () => daLiveCalc(record, inp.dataset.class, "field", inp.dataset.field, inp.value));
    });
    wrap.querySelectorAll(".da-remark-input").forEach(inp => {
        inp.addEventListener("input", () => {
            const cr = record.classes[inp.dataset.class];
            if (cr) cr[inp.dataset.field] = inp.value;
        });
    });
}

function daLiveCalc(record, classId, type, key, rawVal) {
    const val = Math.max(0, parseInt(rawVal) || 0);
    const cr  = record.classes[classId];
    if (!cr) return;
    if (type === "paid") {
        cr.paid[key] = val;
    } else {
        cr[key] = val;
    }
    // Update negative guard
    if (val < 0) return;

    const vcObj = DA_VEHICLE_CLASSES.find(v => v.id === classId);
    if (!vcObj) return;

    const totalPaid = daCalcPaid(cr);
    const viol = Number(cr.violationActual) || 0;
    const exem = Number(cr.exemptionActual) || 0;
    const vRep = Number(cr.violationReported) || 0;
    const eRep = Number(cr.exemptionReported) || 0;
    const vLoss = daCalcViolationLoss(cr, vcObj);
    const eLoss = daCalcExemptionLoss(cr, vcObj);
    const tLoss = vLoss + eLoss;
    const total = totalPaid + viol + exem;

    const setEl = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    if (vcObj.id !== "nonToll") {
        setEl(`da-paid-total-${classId}`, totalPaid.toLocaleString("en-IN"));
        setEl(`da-sum-paid-${classId}`,   totalPaid.toLocaleString("en-IN"));
        setEl(`da-viol-loss-${classId}`,  daFormatCurrency(vLoss));
        setEl(`da-exem-loss-${classId}`,  daFormatCurrency(eLoss));
        setEl(`da-sum-loss-${classId}`,   daFormatCurrency(tLoss));
    }
    setEl(`da-viol-diff-${classId}`, (vRep - viol).toLocaleString("en-IN"));
    setEl(`da-exem-diff-${classId}`, (eRep - exem).toLocaleString("en-IN"));
    setEl(`da-sum-viol-${classId}`,  viol.toLocaleString("en-IN"));
    setEl(`da-sum-exem-${classId}`,  exem.toLocaleString("en-IN"));
    setEl(`da-sum-total-${classId}`, total.toLocaleString("en-IN"));
    setEl(`da-total-${classId}`,     total.toLocaleString("en-IN"));

    // Update grand footer totals
    daUpdateGrandTotals(record);
}

function daUpdateGrandTotals(record) {
    const s = daSummary(record);
    const setEl = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    setEl("daDailyGrandPaid",    s.totalPaid.toLocaleString("en-IN"));
    setEl("daDailyGrandViol",    s.totalViolation.toLocaleString("en-IN"));
    setEl("daDailyGrandExem",    s.totalExemption.toLocaleString("en-IN"));
    setEl("daDailyGrandUnpaid",  s.totalUnpaid.toLocaleString("en-IN"));
    setEl("daDailyGrandTraffic", s.totalTraffic.toLocaleString("en-IN"));
    setEl("daDailyGrandLoss",    daFormatCurrency(s.totalLoss));
    setEl("daDailyGrandLossPct", s.trafficLossPct + "%");
}

/* ══════════════════════════════════════════════
   SAVE & COMPLETE AUDIT
══════════════════════════════════════════════ */

function daSaveCurrentAudit(complete) {
    if (!daCurrentDate) return;
    const record = daGetOrCreate(daCurrentDate);
    // validation: no negatives (already prevented via max(0,...) in daLiveCalc)
    if (complete) {
        daCompleteRecord(record);
    } else {
        daSaveRecord(record);
    }
    // Update status badge
    const statusBadge = document.getElementById("daDailyStatusBadge");
    if (statusBadge) {
        const statusLabels = { not_started:"Not Started", in_progress:"In Progress", completed:"Completed" };
        statusBadge.textContent = statusLabels[record.status];
        statusBadge.className = "da-status-badge da-status-" + record.status;
    }
    if (typeof showToast === "function") {
        showToast(complete ? "✅ Audit completed & saved!" : "💾 Audit saved.", complete ? "success" : "info");
    }
    if (complete) {
        daShowSummaryModal(record);
    }
}

/* ══════════════════════════════════════════════
   DAILY SUMMARY MODAL
══════════════════════════════════════════════ */

function daShowSummaryModal(record) {
    const s    = daSummary(record);
    const date = daFormatDate(record.dateKey);

    // Highest violation / exemption class
    let topViolLabel = "", topViolVal = -1;
    let topExemLabel = "", topExemVal = -1;
    DA_TOLLABLE_CLASSES.forEach(vc => {
        const b = s.byClass[vc.id];
        if (b.viol > topViolVal) { topViolVal = b.viol; topViolLabel = vc.label; }
        if (b.exem > topExemVal) { topExemVal = b.exem; topExemLabel = vc.label; }
    });

    const modal = document.getElementById("daSummaryModal");
    const body  = document.getElementById("daSummaryBody");
    if (!modal || !body) return;

    body.innerHTML = `
    <div class="da-summary-grid">
        <div class="da-summary-date"><i class="bi bi-calendar-check-fill"></i> ${date}</div>
        <div class="da-summ-row"><span>Total Paid Traffic</span><strong>${s.totalPaid.toLocaleString("en-IN")}</strong></div>
        <div class="da-summ-row"><span>Total Violation</span><strong class="da-red">${s.totalViolation.toLocaleString("en-IN")}</strong></div>
        <div class="da-summ-row"><span>Total Exemption</span><strong class="da-amber">${s.totalExemption.toLocaleString("en-IN")}</strong></div>
        <div class="da-summ-row"><span>Total Unpaid Traffic</span><strong>${s.totalUnpaid.toLocaleString("en-IN")}</strong></div>
        <div class="da-summ-row"><span>Total Traffic</span><strong>${s.totalTraffic.toLocaleString("en-IN")}</strong></div>
        <hr>
        <div class="da-summ-row"><span>Violation Revenue Loss</span><strong class="da-red">${daFormatCurrency(s.violLoss)}</strong></div>
        <div class="da-summ-row"><span>Exemption Revenue Loss</span><strong class="da-amber">${daFormatCurrency(s.exemLoss)}</strong></div>
        <div class="da-summ-row da-summ-total"><span>Total Revenue Loss</span><strong>${daFormatCurrency(s.totalLoss)}</strong></div>
        <div class="da-summ-row"><span>Traffic Loss %</span><strong class="da-red">${s.trafficLossPct}%</strong></div>
        <hr>
        <div class="da-summ-row"><span>Highest Violation Category</span><strong>${topViolLabel || "—"}</strong></div>
        <div class="da-summ-row"><span>Highest Exemption Category</span><strong>${topExemLabel || "—"}</strong></div>
    </div>`;

    const bsModal = bootstrap && bootstrap.Modal
        ? bootstrap.Modal.getOrCreateInstance(modal)
        : null;
    if (bsModal) bsModal.show();
}

/* ══════════════════════════════════════════════
   RENDER  —  MONTHLY MASTER
══════════════════════════════════════════════ */

function daRenderMonthlyMaster() {
    const year  = daCurrentYear;
    const month = daCurrentMonth;

    const monthName = DA_MONTHS[month - 1];
    const titleEl = document.getElementById("daMonthlyTitle");
    if (titleEl) titleEl.textContent = `${monthName} ${year} — Monthly Master`;

    const monSel = document.getElementById("daMonthlyMonthSel");
    if (monSel) {
        const mm = String(month).padStart(2,"0");
        monSel.value = `${year}-${mm}`;
    }

    const rows = daMonthlyMasterRows(year, month);
    const tbody = document.getElementById("daMonthlyTbody");
    const tfoot = document.getElementById("daMonthlyTfoot");
    if (!tbody) return;

    const tollable = DA_TOLLABLE_CLASSES;

    // Totals accumulators
    const colTotals = {};
    tollable.forEach(vc => {
        colTotals[vc.id] = { paid:0, viol:0, exem:0, total:0 };
    });
    let ntViol=0, ntExem=0, ntTotal=0;
    let grandPaid=0, grandViol=0, grandExem=0, grandNT=0, grandTotal=0;

    tbody.innerHTML = rows.map(r => {
        const s = r.summary;
        if (!s) {
            return `<tr class="da-mm-empty-row">
                <td>${r.day}</td>
                ${tollable.map(() => '<td>—</td><td>—</td><td>—</td>').join("")}
                <td>—</td><td>—</td><td>—</td>
                <td>—</td><td>—</td>
                <td class="da-mm-status"><span class="da-status-badge da-status-not_started">Not Started</span></td>
            </tr>`;
        }

        tollable.forEach(vc => {
            colTotals[vc.id].paid  += s.byClass[vc.id].paid;
            colTotals[vc.id].viol  += s.byClass[vc.id].viol;
            colTotals[vc.id].exem  += s.byClass[vc.id].exem;
            colTotals[vc.id].total += s.byClass[vc.id].total;
            grandPaid  += s.byClass[vc.id].paid;
            grandViol  += s.byClass[vc.id].viol;
            grandExem  += s.byClass[vc.id].exem;
        });
        const nt = s.byClass["nonToll"];
        ntViol    += nt.viol;
        ntExem    += nt.exem;
        ntTotal   += nt.viol + nt.exem;
        grandNT   += nt.viol + nt.exem;
        grandTotal += s.totalTraffic;

        const status = r.record ? r.record.status : "not_started";
        const statusLabels = { not_started:"Not Started", in_progress:"In Progress", completed:"Completed" };

        return `<tr class="da-mm-row da-mm-${status}" data-date="${r.dateKey}">
            <td>${r.day}</td>
            ${tollable.map(vc => `
                <td>${s.byClass[vc.id].paid.toLocaleString("en-IN")}</td>
                <td>${s.byClass[vc.id].viol.toLocaleString("en-IN")}</td>
                <td>${s.byClass[vc.id].exem.toLocaleString("en-IN")}</td>
            `).join("")}
            <td>${nt.viol.toLocaleString("en-IN")}</td>
            <td>${nt.exem.toLocaleString("en-IN")}</td>
            <td>${(nt.viol + nt.exem).toLocaleString("en-IN")}</td>
            <td><strong>${s.totalTraffic.toLocaleString("en-IN")}</strong></td>
            <td class="da-loss-val">${daFormatCurrency(s.totalLoss)}</td>
            <td class="da-mm-status"><span class="da-status-badge da-status-${status}">${statusLabels[status]}</span></td>
        </tr>`;
    }).join("");

    // Footer totals
    if (tfoot) {
        tfoot.innerHTML = `<tr class="da-mm-footer">
            <td><strong>TOTAL</strong></td>
            ${tollable.map(vc => `
                <td><strong>${colTotals[vc.id].paid.toLocaleString("en-IN")}</strong></td>
                <td><strong>${colTotals[vc.id].viol.toLocaleString("en-IN")}</strong></td>
                <td><strong>${colTotals[vc.id].exem.toLocaleString("en-IN")}</strong></td>
            `).join("")}
            <td><strong>${ntViol.toLocaleString("en-IN")}</strong></td>
            <td><strong>${ntExem.toLocaleString("en-IN")}</strong></td>
            <td><strong>${ntTotal.toLocaleString("en-IN")}</strong></td>
            <td><strong>${grandTotal.toLocaleString("en-IN")}</strong></td>
            <td></td><td></td>
        </tr>`;
    }

    // Click row to open audit
    tbody.querySelectorAll("[data-date]").forEach(tr => {
        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => {
            daOpenAudit(tr.dataset.date);
        });
    });
}

/* ══════════════════════════════════════════════
   RENDER  —  ANALYTICS
══════════════════════════════════════════════ */

function daRenderAnalytics() {
    const year  = daCurrentYear;
    const month = daCurrentMonth;
    const rows  = daMonthlyMasterRows(year, month);
    const dateKeys = rows.map(r => r.dateKey);

    // Custom range override
    const startEl = document.getElementById("daAnalyticsStart");
    const endEl   = document.getElementById("daAnalyticsEnd");
    let keys = dateKeys;
    if (startEl && endEl && startEl.value && endEl.value) {
        keys = daDatesInRange(startEl.value, endEl.value);
    }

    const a = daAnalytics(keys);
    if (!a) {
        document.getElementById("daAnalyticsBody").innerHTML =
            `<div class="da-empty"><i class="bi bi-inbox"></i> No completed audits found for this period.</div>`;
        return;
    }

    const fmt  = n => n.toLocaleString("en-IN");
    const fmtC = n => daFormatCurrency(n);

    const topViolClass = DA_VEHICLE_CLASSES.find(v => v.id === a.topViolClass);
    const topExemClass = DA_VEHICLE_CLASSES.find(v => v.id === a.topExemClass);

    document.getElementById("daAnalyticsBody").innerHTML = `
    <div class="da-analytics-cards">
        <div class="da-anl-card da-anl-paid"><div class="da-anl-val">${fmt(a.totalPaid)}</div><div class="da-anl-lbl">Total Paid Traffic</div></div>
        <div class="da-anl-card da-anl-viol"><div class="da-anl-val">${fmt(a.totalViol)}</div><div class="da-anl-lbl">Total Violation</div></div>
        <div class="da-anl-card da-anl-exem"><div class="da-anl-val">${fmt(a.totalExem)}</div><div class="da-anl-lbl">Total Exemption</div></div>
        <div class="da-anl-card da-anl-traffic"><div class="da-anl-val">${fmt(a.totalTraffic)}</div><div class="da-anl-lbl">Total Traffic</div></div>
        <div class="da-anl-card da-anl-loss"><div class="da-anl-val">${fmtC(a.totalLoss)}</div><div class="da-anl-lbl">Total Revenue Loss</div></div>
        <div class="da-anl-card da-anl-pct"><div class="da-anl-val">${a.trafficLossPct}%</div><div class="da-anl-lbl">Traffic Loss %</div></div>
        <div class="da-anl-card da-anl-vloss"><div class="da-anl-val">${fmtC(a.violLoss)}</div><div class="da-anl-lbl">Violation Revenue Loss</div></div>
        <div class="da-anl-card da-anl-eloss"><div class="da-anl-val">${fmtC(a.exemLoss)}</div><div class="da-anl-lbl">Exemption Revenue Loss</div></div>
    </div>

    <div class="da-analytics-highlights">
        <div class="da-hl-card">
            <div class="da-hl-icon"><i class="bi bi-graph-up-arrow"></i></div>
            <div class="da-hl-content">
                <div class="da-hl-lbl">Highest Traffic Day</div>
                <div class="da-hl-val">${a.highTrafficDay ? daFormatDate(a.highTrafficDay) : "—"}</div>
                <div class="da-hl-sub">${fmt(a.highTrafficVal)} vehicles</div>
            </div>
        </div>
        <div class="da-hl-card">
            <div class="da-hl-icon"><i class="bi bi-graph-down-arrow"></i></div>
            <div class="da-hl-content">
                <div class="da-hl-lbl">Lowest Traffic Day</div>
                <div class="da-hl-val">${a.lowTrafficDay ? daFormatDate(a.lowTrafficDay) : "—"}</div>
                <div class="da-hl-sub">${fmt(a.lowTrafficVal)} vehicles</div>
            </div>
        </div>
        <div class="da-hl-card">
            <div class="da-hl-icon"><i class="bi bi-exclamation-triangle-fill"></i></div>
            <div class="da-hl-content">
                <div class="da-hl-lbl">Highest Violation Day</div>
                <div class="da-hl-val">${a.highViolDay ? daFormatDate(a.highViolDay) : "—"}</div>
                <div class="da-hl-sub">${fmt(a.highViolVal)} violations</div>
            </div>
        </div>
        <div class="da-hl-card">
            <div class="da-hl-icon"><i class="bi bi-shield-check"></i></div>
            <div class="da-hl-content">
                <div class="da-hl-lbl">Highest Exemption Day</div>
                <div class="da-hl-val">${a.highExemDay ? daFormatDate(a.highExemDay) : "—"}</div>
                <div class="da-hl-sub">${fmt(a.highExemVal)} exemptions</div>
            </div>
        </div>
        <div class="da-hl-card">
            <div class="da-hl-icon"><i class="bi bi-car-front-fill"></i></div>
            <div class="da-hl-content">
                <div class="da-hl-lbl">Most Violated Category</div>
                <div class="da-hl-val">${topViolClass ? topViolClass.label : "—"}</div>
                <div class="da-hl-sub">${fmt(a.byClass[a.topViolClass]?.viol || 0)} violations</div>
            </div>
        </div>
        <div class="da-hl-card">
            <div class="da-hl-icon"><i class="bi bi-tag-fill"></i></div>
            <div class="da-hl-content">
                <div class="da-hl-lbl">Most Exempted Category</div>
                <div class="da-hl-val">${topExemClass ? topExemClass.label : "—"}</div>
                <div class="da-hl-sub">${fmt(a.byClass[a.topExemClass]?.exem || 0)} exemptions</div>
            </div>
        </div>
    </div>

    <div class="da-anl-class-table-wrap">
        <table class="da-anl-class-table">
            <thead>
                <tr>
                    <th>Class</th>
                    <th>Paid Traffic</th>
                    <th>Violation</th>
                    <th>Exemption</th>
                    <th>Total</th>
                    <th>Rev. Loss</th>
                </tr>
            </thead>
            <tbody>
                ${DA_VEHICLE_CLASSES.map(vc => {
                    const b = a.byClass[vc.id];
                    const rec = { classes: {} };
                    rec.classes[vc.id] = { paid:{cash:0,ret:0,barcode:0,digital:0,etc:0,pass:0}, violationActual: b.viol, exemptionActual: b.exem, violationReported:0, exemptionReported:0 };
                    DA_PAYMENT_MODES.forEach(pm => { rec.classes[vc.id].paid[pm] = 0; });
                    const vl = b.viol * vc.tariffSingle;
                    const el = b.exem * vc.tariffSingle;
                    return `<tr>
                        <td>${vc.label}</td>
                        <td>${b.paid.toLocaleString("en-IN")}</td>
                        <td>${b.viol.toLocaleString("en-IN")}</td>
                        <td>${b.exem.toLocaleString("en-IN")}</td>
                        <td>${(b.paid + b.viol + b.exem).toLocaleString("en-IN")}</td>
                        <td>${daFormatCurrency(vl + el)}</td>
                    </tr>`;
                }).join("")}
            </tbody>
        </table>
    </div>
    <div class="da-anl-days-badge">
        <i class="bi bi-calendar-range"></i>
        ${a.daysAudited} day${a.daysAudited !== 1 ? "s" : ""} audited
    </div>`;
}

/* ══════════════════════════════════════════════
   RENDER  —  DATE COMPARISON
══════════════════════════════════════════════ */

function daRenderComparison() {
    const dateAEl = document.getElementById("daCompDateA");
    const dateBEl = document.getElementById("daCompDateB");
    const body    = document.getElementById("daCompBody");
    if (!dateAEl || !dateBEl || !body) return;

    const keyA = dateAEl.value;
    const keyB = dateBEl.value;

    if (!keyA || !keyB) {
        body.innerHTML = `<div class="da-empty"><i class="bi bi-calendar2-range"></i> Select two dates above to compare.</div>`;
        return;
    }

    const recA = dailyAudits[keyA];
    const recB = dailyAudits[keyB];
    const sA   = recA ? daSummary(recA) : null;
    const sB   = recB ? daSummary(recB) : null;

    if (!sA && !sB) {
        body.innerHTML = `<div class="da-empty">No audit data found for either date.</div>`;
        return;
    }

    const labelA = daFormatDate(keyA);
    const labelB = daFormatDate(keyB);

    const safeSumm = s => s || { totalPaid:0, totalViolation:0, totalExemption:0, totalUnpaid:0, totalTraffic:0, totalLoss:0, violLoss:0, exemLoss:0, trafficLossPct:"0.00", byClass:{} };
    const sa = safeSumm(sA);
    const sb = safeSumm(sB);

    const diff   = (a, b) => a - b;
    const pct    = (a, b) => b === 0 ? (a === 0 ? "0.00" : "∞") : (((a - b) / b) * 100).toFixed(2);
    const arrow  = (a, b) => a > b ? "▲" : a < b ? "▼" : "—";
    const cls    = (a, b) => a > b ? "da-comp-up" : a < b ? "da-comp-dn" : "";

    const compRow = (label, a, b, isLoss = false) => {
        const d = diff(a, b);
        const p = pct(a, b);
        const ar = arrow(a, b);
        const clsA = isLoss ? (a > b ? "da-comp-dn" : "da-comp-up") : cls(a, b);
        const clsD = isLoss ? (d > 0 ? "da-comp-dn" : d < 0 ? "da-comp-up" : "") : cls(d, 0);
        return `<tr>
            <td>${label}</td>
            <td class="${cls(a, b)}">${typeof a === "string" ? a : a.toLocaleString("en-IN")}</td>
            <td class="${cls(b, a)}">${typeof b === "string" ? b : b.toLocaleString("en-IN")}</td>
            <td class="${clsD}">${ar} ${Math.abs(typeof d === "number" ? d : 0).toLocaleString("en-IN")}</td>
            <td class="${clsD}">${p}%</td>
        </tr>`;
    };

    body.innerHTML = `
    <table class="da-comp-table">
        <thead>
            <tr>
                <th>Metric</th>
                <th>${labelA}</th>
                <th>${labelB}</th>
                <th>Difference</th>
                <th>Change %</th>
            </tr>
        </thead>
        <tbody>
            ${compRow("Total Traffic",        sa.totalTraffic,    sb.totalTraffic)}
            ${compRow("Total Paid Traffic",    sa.totalPaid,       sb.totalPaid)}
            ${compRow("Total Violation",       sa.totalViolation,  sb.totalViolation,  true)}
            ${compRow("Total Exemption",       sa.totalExemption,  sb.totalExemption,  true)}
            ${compRow("Total Unpaid Traffic",  sa.totalUnpaid,     sb.totalUnpaid,     true)}
            ${compRow("Total Revenue Loss",    sa.totalLoss,       sb.totalLoss,       true)}
            ${compRow("Violation Loss",        sa.violLoss,        sb.violLoss,        true)}
            ${compRow("Exemption Loss",        sa.exemLoss,        sb.exemLoss,        true)}
            <tr>
                <td>Traffic Loss %</td>
                <td>${sa.trafficLossPct}%</td>
                <td>${sb.trafficLossPct}%</td>
                <td>${(parseFloat(sa.trafficLossPct) - parseFloat(sb.trafficLossPct)).toFixed(2)}%</td>
                <td>—</td>
            </tr>
        </tbody>
    </table>

    <div class="da-comp-class-section">
        <div class="da-section-label" style="margin:16px 0 8px">Vehicle Class Comparison</div>
        <div class="da-comp-class-grid">
        ${DA_VEHICLE_CLASSES.map(vc => {
            const bA = (sa.byClass && sa.byClass[vc.id]) || { paid:0, viol:0, exem:0, total:0 };
            const bB = (sb.byClass && sb.byClass[vc.id]) || { paid:0, viol:0, exem:0, total:0 };
            return `<div class="da-comp-class-card">
                <div class="da-comp-class-label">${vc.label}</div>
                <table>
                    <thead><tr><th></th><th>${labelA}</th><th>${labelB}</th></tr></thead>
                    <tbody>
                        <tr><td>Paid</td><td>${bA.paid.toLocaleString("en-IN")}</td><td>${bB.paid.toLocaleString("en-IN")}</td></tr>
                        <tr><td>Violation</td><td>${bA.viol.toLocaleString("en-IN")}</td><td>${bB.viol.toLocaleString("en-IN")}</td></tr>
                        <tr><td>Exemption</td><td>${bA.exem.toLocaleString("en-IN")}</td><td>${bB.exem.toLocaleString("en-IN")}</td></tr>
                        <tr><td>Total</td><td>${bA.total.toLocaleString("en-IN")}</td><td>${bB.total.toLocaleString("en-IN")}</td></tr>
                    </tbody>
                </table>
            </div>`;
        }).join("")}
        </div>
    </div>`;
}

/* ══════════════════════════════════════════════
   EXPORT  —  CSV / PDF
══════════════════════════════════════════════ */

function daExportDailyCSV(dateKey) {
    const record = dailyAudits[dateKey];
    if (!record) { if (typeof showToast === "function") showToast("No data for this date.", "warn"); return; }
    const rows = [
        ["Toll Audit — Daily Report", daFormatDate(dateKey)],
        [],
        ["Class", "Cash","Return","Barcode","Digital","ETC","Pass","Total Paid",
         "Viol (Reported)","Viol (Actual)","Viol Diff","Viol Loss",
         "Exem (Reported)","Exem (Actual)","Exem Diff","Exem Loss","Total Traffic","Total Loss"]
    ];
    DA_VEHICLE_CLASSES.forEach(vc => {
        const cr  = record.classes[vc.id] || daEmptyClassRecord();
        const tp  = daCalcPaid(cr);
        const vl  = daCalcViolationLoss(cr, vc);
        const el  = daCalcExemptionLoss(cr, vc);
        const tot = tp + Number(cr.violationActual||0) + Number(cr.exemptionActual||0);
        rows.push([
            vc.label,
            cr.paid.cash, cr.paid.ret, cr.paid.barcode, cr.paid.digital, cr.paid.etc, cr.paid.pass,
            tp,
            cr.violationReported, cr.violationActual, cr.violationReported - cr.violationActual, vl,
            cr.exemptionReported, cr.exemptionActual, cr.exemptionReported - cr.exemptionActual, el,
            tot, vl + el
        ]);
    });
    const s = daSummary(record);
    rows.push([]);
    rows.push(["TOTALS","","","","","","", s.totalPaid,"","", "","",  "", s.totalViolation,"","","", s.totalExemption,"","","", s.totalTraffic, s.totalLoss]);
    rows.push(["Traffic Loss %", s.trafficLossPct + "%"]);
    _daDownloadCSV(rows, `DailyAudit_${dateKey}.csv`);
}

function daExportMonthlyCSV() {
    const year = daCurrentYear, month = daCurrentMonth;
    const monthRows = daMonthlyMasterRows(year, month);
    const tollable = DA_TOLLABLE_CLASSES;
    const hdr = ["Day"];
    tollable.forEach(vc => { hdr.push(`${vc.label} Paid`, `${vc.label} Viol`, `${vc.label} Exem`); });
    hdr.push("NT Violation","NT Exemption","NT Total","Total Traffic","Revenue Loss","Status");
    const rows = [["Toll Audit — Monthly Master", `${DA_MONTHS[month-1]} ${year}`], [], hdr];
    monthRows.forEach(r => {
        if (!r.summary) { rows.push([r.day, ...Array(hdr.length - 1).fill("")]); return; }
        const s = r.summary;
        const row = [r.day];
        tollable.forEach(vc => { row.push(s.byClass[vc.id].paid, s.byClass[vc.id].viol, s.byClass[vc.id].exem); });
        const nt = s.byClass["nonToll"];
        row.push(nt.viol, nt.exem, nt.viol + nt.exem, s.totalTraffic, s.totalLoss,
                 r.record ? r.record.status : "not_started");
        rows.push(row);
    });
    _daDownloadCSV(rows, `MonthlyMaster_${year}-${String(month).padStart(2,"0")}.csv`);
}

function _daDownloadCSV(rows, filename) {
    const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */

function daInit() {
    daLoad();
    daLoadSeedData();

    // Show the dashboard panel by default (hidden until user clicks the nav)
    daShowPanel("da-dashboard");

    // Month selector on dashboard
    const daDashMonthSel = document.getElementById("daDashMonthSel");
    if (daDashMonthSel) {
        const today = new Date();
        const mm    = String(today.getMonth() + 1).padStart(2, "0");
        daDashMonthSel.value = `${today.getFullYear()}-${mm}`;
        daDashMonthSel.addEventListener("change", e => {
            const [y, m] = e.target.value.split("-").map(Number);
            daCurrentYear  = y;
            daCurrentMonth = m;
            daRenderDashboard();
        });
    }

    // Monthly master month selector
    const daMonthlyMonthSel = document.getElementById("daMonthlyMonthSel");
    if (daMonthlyMonthSel) {
        daMonthlyMonthSel.addEventListener("change", e => {
            const [y, m] = e.target.value.split("-").map(Number);
            daCurrentYear  = y;
            daCurrentMonth = m;
            daRenderMonthlyMaster();
        });
    }

    // Nav pills
    document.querySelectorAll(".da-nav-pill").forEach(btn => {
        btn.addEventListener("click", () => {
            const panel = btn.dataset.panel;
            daShowPanel(panel);
            if (panel === "da-dashboard")   daRenderDashboard();
            if (panel === "da-monthly")     { daRenderMonthlyMaster(); }
            if (panel === "da-analytics")   daRenderAnalytics();
            if (panel === "da-comparison")  daRenderComparison();
        });
    });

    // Sidebar nav button
    const sbBtn = document.getElementById("sbDailyAuditModuleBtn");
    if (sbBtn) {
        sbBtn.addEventListener("click", () => {
            // Show the module wrapper and hide default main content sections
            daShowModule(true);
            daRenderDashboard();
        });
    }

    // Back to main button
    const backBtn = document.getElementById("daBackToMainBtn");
    if (backBtn) {
        backBtn.addEventListener("click", () => daShowModule(false));
    }

    // Daily Audit save buttons
    document.getElementById("daDailySaveBtn")?.addEventListener("click", () => daSaveCurrentAudit(false));
    document.getElementById("daDailyCompleteBtn")?.addEventListener("click", () => {
        if (confirm("Mark this audit as Completed? This will save all data.")) {
            daSaveCurrentAudit(true);
        }
    });

    // Back from daily form to dashboard
    document.getElementById("daDailyBackBtn")?.addEventListener("click", () => {
        daShowPanel("da-dashboard");
        daRenderDashboard();
    });

    // Analytics range apply
    document.getElementById("daAnalyticsApplyBtn")?.addEventListener("click", daRenderAnalytics);

    // Comparison run
    document.getElementById("daCompRunBtn")?.addEventListener("click", daRenderComparison);

    // Export buttons
    document.getElementById("daDailyExportCsvBtn")?.addEventListener("click", () => daExportDailyCSV(daCurrentDate));
    document.getElementById("daMonthlyExportCsvBtn")?.addEventListener("click", daExportMonthlyCSV);

    // Render initial dashboard (don't show module — stays hidden until nav click)
    daRenderDashboard();
}

function daShowModule(show) {
    const mod  = document.getElementById("daModuleWrapper");
    const main = document.getElementById("mainInnerContent");
    if (mod)  mod.style.display  = show ? "flex" : "none";
    if (main) main.style.display = show ? "none" : "";
}
