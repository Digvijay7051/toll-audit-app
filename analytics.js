/* ==========================================================
   Toll Audit Assistant — Advanced Analytics Module
   analytics.js
   Depends on: data.js (auditDataStore, AUDIT_MODES, REPORT_CATEGORIES, VEHICLE_CLASSES, getTodayKey)
   Depends on: ui.js  (showToast)
   Depends on: sheets.js / xlsx (for Excel export)
========================================================== */

/* ══════════════════════════════════════════════
   ANALYTICS SETTINGS (localStorage persisted)
══════════════════════════════════════════════ */

const ANALYTICS_STORAGE_KEY = "tollAuditAnalyticsSettings";

let analyticsSettings = {
    startDate:      "",          // "YYYY-MM-DD" — only dates >= this are included
    comparisonMode: "prevDay"    // "prevDay" | "weeklyAvg" | "monthlyAvg"
};

function loadAnalyticsSettings() {
    try {
        const raw = localStorage.getItem(ANALYTICS_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            analyticsSettings = Object.assign(analyticsSettings, parsed);
        }
    } catch (e) { /* ignore */ }
}

function saveAnalyticsSettings() {
    localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(analyticsSettings));
}

/* ══════════════════════════════════════════════
   ANALYTICS DATA ENGINE
   All functions read directly from auditDataStore
   — no duplicate data storage needed.
══════════════════════════════════════════════ */

/* Returns all date keys in auditDataStore that have at least one
   transaction, sorted ascending, filtered by analytics start date. */
function _getAnalyticsDates(overrideStart, overrideEnd) {
    const start = overrideStart || analyticsSettings.startDate || null;
    const end   = overrideEnd   || null;

    return Object.keys(auditDataStore)
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .filter(d => !start || d >= start)
        .filter(d => !end   || d <= end)
        .filter(d => _isBucketNonEmpty(auditDataStore[d]))
        .sort();
}

function _isBucketNonEmpty(bucket) {
    if (!bucket) return false;
    return AUDIT_MODES.some(mode =>
        REPORT_CATEGORIES.some(cat => {
            const c = bucket[mode] && bucket[mode][cat];
            return c && (c.transactions || []).length > 0;
        })
    );
}

/* Aggregates a single date bucket into a flat summary:
   { traffic, violations, exemptions, vehicleBreakdown: {veh: count}, catBreakdown: {cat: count} }
   traffic    = total transactions across ALL modes
   violations = transactions in Violation mode
   exemptions = transactions in Exemption mode */
function _summariseDate(dateKey) {
    const bucket = auditDataStore[dateKey];
    if (!bucket) return null;

    let violations = 0, exemptions = 0;
    const vehBreakdown = {};   // vehicle class → total count across all modes+cats
    const catBreakdown = {};   // report category → total count (violations mode)
    const vehModeBreakdown = { Violation: {}, Exemption: {} };

    VEHICLE_CLASSES.forEach(v => { vehBreakdown[v] = 0; });
    REPORT_CATEGORIES.forEach(c => { catBreakdown[c] = 0; });
    VEHICLE_CLASSES.forEach(v => {
        vehModeBreakdown.Violation[v] = 0;
        vehModeBreakdown.Exemption[v] = 0;
    });

    AUDIT_MODES.forEach(mode => {
        REPORT_CATEGORIES.forEach(cat => {
            const c = bucket[mode] && bucket[mode][cat];
            if (!c) return;
            const txnCount = (c.transactions || []).length;
            if (mode === "Violation")  violations += txnCount;
            if (mode === "Exemption")  exemptions += txnCount;
            if (mode === "Violation")  catBreakdown[cat] = (catBreakdown[cat] || 0) + txnCount;
            // aggregate vehicle counts
            VEHICLE_CLASSES.forEach(v => {
                const cnt = (c.vehicleCounts && c.vehicleCounts[v]) || 0;
                vehBreakdown[v]              = (vehBreakdown[v] || 0) + cnt;
                vehModeBreakdown[mode][v]    = (vehModeBreakdown[mode][v] || 0) + cnt;
            });
        });
    });

    const traffic = violations + exemptions;

    return {
        dateKey,
        traffic,
        violations,
        exemptions,
        vehBreakdown,
        vehModeBreakdown,
        catBreakdown
    };
}

/* Returns the summary for the "previous" date relative to referenceDate,
   according to the current comparisonMode. May return null if no data. */
function _getPreviousSummary(referenceDate) {
    const mode  = analyticsSettings.comparisonMode;
    const start = analyticsSettings.startDate || null;
    const allDates = _getAnalyticsDates();

    if (mode === "prevDay") {
        // Most recent date before referenceDate with data
        const candidates = allDates.filter(d => d < referenceDate);
        if (candidates.length === 0) return null;
        return _summariseDate(candidates[candidates.length - 1]);
    }

    if (mode === "weeklyAvg") {
        // Average of all days in the previous 7-day window
        const d = new Date(referenceDate + "T00:00:00");
        d.setDate(d.getDate() - 7);
        const weekStart = d.toISOString().slice(0, 10);
        const candidates = allDates.filter(dd => dd >= weekStart && dd < referenceDate);
        return _averageSummaries(candidates, referenceDate + "_weekAvg");
    }

    if (mode === "monthlyAvg") {
        // Average of all days in the previous calendar month
        const d = new Date(referenceDate + "T00:00:00");
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        const monthStart = d.toISOString().slice(0, 10);
        d.setMonth(d.getMonth() + 1);
        d.setDate(d.getDate() - 1);
        const monthEnd   = d.toISOString().slice(0, 10);
        const candidates = allDates.filter(dd => dd >= monthStart && dd <= monthEnd);
        return _averageSummaries(candidates, referenceDate + "_monthAvg");
    }

    return null;
}

/* Returns a "virtual" summary that is the average of multiple summaries */
function _averageSummaries(dateKeys, label) {
    if (dateKeys.length === 0) return null;
    const summaries = dateKeys.map(_summariseDate).filter(Boolean);
    if (summaries.length === 0) return null;
    const n = summaries.length;

    const vehBreakdown = {};
    const vehModeBreakdown = { Violation: {}, Exemption: {} };
    const catBreakdown = {};
    VEHICLE_CLASSES.forEach(v => {
        vehBreakdown[v] = Math.round(summaries.reduce((s, x) => s + (x.vehBreakdown[v] || 0), 0) / n);
        vehModeBreakdown.Violation[v] = Math.round(summaries.reduce((s, x) => s + (x.vehModeBreakdown.Violation[v] || 0), 0) / n);
        vehModeBreakdown.Exemption[v] = Math.round(summaries.reduce((s, x) => s + (x.vehModeBreakdown.Exemption[v] || 0), 0) / n);
    });
    REPORT_CATEGORIES.forEach(c => {
        catBreakdown[c] = Math.round(summaries.reduce((s, x) => s + (x.catBreakdown[c] || 0), 0) / n);
    });

    return {
        dateKey: label,
        traffic:    Math.round(summaries.reduce((s, x) => s + x.traffic, 0) / n),
        violations: Math.round(summaries.reduce((s, x) => s + x.violations, 0) / n),
        exemptions: Math.round(summaries.reduce((s, x) => s + x.exemptions, 0) / n),
        vehBreakdown,
        vehModeBreakdown,
        catBreakdown
    };
}

/* Compute KPIs for a range of dates */
function _computeKPIs(dates) {
    if (dates.length === 0) {
        return { total: 0, violations: 0, exemptions: 0, auditDays: 0,
                 avgTraffic: 0, avgViolations: 0, avgExemptions: 0 };
    }
    let total = 0, violations = 0, exemptions = 0;
    dates.forEach(d => {
        const s = _summariseDate(d);
        if (!s) return;
        total      += s.traffic;
        violations += s.violations;
        exemptions += s.exemptions;
    });
    const n = dates.length;
    return {
        total, violations, exemptions,
        auditDays:      n,
        avgTraffic:     Math.round(total / n),
        avgViolations:  Math.round(violations / n),
        avgExemptions:  Math.round(exemptions / n)
    };
}

/* Compute per-vehicle breakdown over a set of dates */
function _computeVehicleBreakdown(dates) {
    const totals = {};
    VEHICLE_CLASSES.forEach(v => { totals[v] = 0; });
    dates.forEach(d => {
        const s = _summariseDate(d);
        if (!s) return;
        VEHICLE_CLASSES.forEach(v => { totals[v] += s.vehBreakdown[v] || 0; });
    });
    return totals;
}

/* Smart percentage change helper */
function _pctChange(now, prev) {
    if (prev === 0 && now === 0) return { diff: 0, pct: 0, dir: "flat" };
    if (prev === 0) return { diff: now, pct: 100, dir: "up" };
    const diff = now - prev;
    const pct  = Math.abs(Math.round((diff / prev) * 100));
    return { diff, pct, dir: diff > 0 ? "up" : diff < 0 ? "down" : "flat" };
}

/* Format friendly date "15 Aug 2026" */
function _friendlyDate(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || "—";
    const [y, m, d] = dateStr.split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

/* Generate smart observation text from today vs previous summary */
function _generateObservation(today, prev) {
    if (!today) return "No audit data available for today.";
    if (!prev)  return `Today's audit recorded ${today.traffic} total transactions (${today.violations} violations, ${today.exemptions} exemptions). No previous data available for comparison.`;

    const lines = [];
    const tc = _pctChange(today.traffic, prev.traffic);
    const vc = _pctChange(today.violations, prev.violations);
    const ec = _pctChange(today.exemptions, prev.exemptions);

    // Traffic summary
    if (tc.dir === "up")   lines.push(`Compared to the previous audit, total traffic <strong>increased by ${tc.pct}%</strong> (${today.traffic} vs ${prev.traffic}).`);
    else if (tc.dir === "down") lines.push(`Compared to the previous audit, total traffic <strong>decreased by ${tc.pct}%</strong> (${today.traffic} vs ${prev.traffic}).`);
    else lines.push(`Total traffic remained the same as the previous audit (${today.traffic} transactions).`);

    // Violations
    if (vc.dir === "up" && vc.pct > 0)
        lines.push(`Violations <strong>increased by ${vc.pct}%</strong> — attention may be needed.`);
    else if (vc.dir === "down" && vc.pct > 0)
        lines.push(`Violations <strong>decreased by ${vc.pct}%</strong>.`);

    // Exemptions
    if (ec.dir === "up" && ec.pct > 0)
        lines.push(`Exemptions increased by ${ec.pct}%.`);
    else if (ec.dir === "down" && ec.pct > 0)
        lines.push(`Exemptions decreased by ${ec.pct}%.`);

    // Highest vehicle category today
    const maxVeh = Object.entries(today.vehBreakdown)
        .filter(([v]) => REPORT_CATEGORIES.includes(v))
        .reduce((a, b) => b[1] > a[1] ? b : a, ["", 0]);
    if (maxVeh[1] > 0)
        lines.push(`<strong>${maxVeh[0]}</strong> was the highest traffic vehicle category with ${maxVeh[1]} vehicles.`);

    // Recommendation
    if (vc.dir === "up" && vc.pct >= 20)
        lines.push(`<em>Recommendation:</em> Review ${maxVeh[0] || "vehicle"} transactions as violations have increased significantly.`);
    else if (ec.dir === "down" && ec.pct >= 20)
        lines.push(`<em>Recommendation:</em> Investigate why exemptions have decreased by ${ec.pct}%.`);

    return lines.join(" ");
}

/* Generate smart insights array for the insights panel */
function _generateInsights(dates) {
    if (dates.length === 0) return [];
    const insights = [];
    const allSummaries = dates.map(_summariseDate).filter(Boolean);

    // Traffic trend
    if (allSummaries.length >= 2) {
        const last = allSummaries[allSummaries.length - 1];
        const prev = allSummaries[allSummaries.length - 2];
        const tc = _pctChange(last.traffic, prev.traffic);
        if (tc.dir === "up")
            insights.push({ type: "green", icon: "bi-arrow-up-circle-fill", text: `Traffic <strong>increased by ${tc.pct}%</strong> from ${prev.traffic} to ${last.traffic} between the last two audit dates.` });
        else if (tc.dir === "down")
            insights.push({ type: "red", icon: "bi-arrow-down-circle-fill", text: `Traffic <strong>decreased by ${tc.pct}%</strong> from ${prev.traffic} to ${last.traffic} between the last two audit dates.` });

        const vc = _pctChange(last.violations, prev.violations);
        if (vc.dir === "up" && vc.pct >= 10)
            insights.push({ type: "red", icon: "bi-exclamation-triangle-fill", text: `Violations <strong>increased by ${vc.pct}%</strong> — investigate potential patterns.` });
        else if (vc.dir === "down" && vc.pct >= 10)
            insights.push({ type: "green", icon: "bi-check-circle-fill", text: `Violations <strong>decreased by ${vc.pct}%</strong> — good improvement.` });

        const ec = _pctChange(last.exemptions, prev.exemptions);
        if (ec.dir === "down" && ec.pct >= 10)
            insights.push({ type: "amber", icon: "bi-info-circle-fill", text: `Exemptions <strong>decreased by ${ec.pct}%</strong> in the most recent audit.` });
    }

    // Highest & lowest traffic vehicle categories (across full range)
    const rangeVeh = _computeVehicleBreakdown(dates);
    const mainVehs = REPORT_CATEGORIES.map(v => [v, rangeVeh[v] || 0]).filter(([, c]) => c > 0);
    if (mainVehs.length > 0) {
        mainVehs.sort((a, b) => b[1] - a[1]);
        insights.push({ type: "blue", icon: "bi-trophy-fill", text: `<strong>${mainVehs[0][0]}</strong> is the highest traffic vehicle category with ${mainVehs[0][1]} total vehicles in the selected period.` });
        if (mainVehs.length > 1)
            insights.push({ type: "violet", icon: "bi-dash-circle", text: `<strong>${mainVehs[mainVehs.length - 1][0]}</strong> is the lowest traffic vehicle category with ${mainVehs[mainVehs.length - 1][1]} vehicles.` });
    }

    // Most frequently violated
    const vioSummaries = allSummaries;
    const violationsByVeh = {};
    VEHICLE_CLASSES.forEach(v => { violationsByVeh[v] = 0; });
    vioSummaries.forEach(s => {
        VEHICLE_CLASSES.forEach(v => { violationsByVeh[v] += (s.vehModeBreakdown.Violation[v] || 0); });
    });
    const topViol = Object.entries(violationsByVeh)
        .filter(([v]) => REPORT_CATEGORIES.includes(v))
        .sort((a, b) => b[1] - a[1]);
    if (topViol.length > 0 && topViol[0][1] > 0)
        insights.push({ type: "red", icon: "bi-exclamation-octagon-fill", text: `<strong>${topViol[0][0]}</strong> is the most frequently violated vehicle category with ${topViol[0][1]} violations.` });

    // Consecutive increase check (last 3)
    if (allSummaries.length >= 3) {
        const last3 = allSummaries.slice(-3);
        if (last3[0].traffic < last3[1].traffic && last3[1].traffic < last3[2].traffic)
            insights.push({ type: "green", icon: "bi-graph-up-arrow", text: `Traffic has been on a <strong>consistent upward trend</strong> for the last 3 audit dates.` });
        if (last3[0].traffic > last3[1].traffic && last3[1].traffic > last3[2].traffic)
            insights.push({ type: "amber", icon: "bi-graph-down-arrow", text: `Traffic has been on a <strong>consistent downward trend</strong> for the last 3 audit dates.` });
    }

    // Categories with no change
    if (allSummaries.length >= 2) {
        const last = allSummaries[allSummaries.length - 1];
        const prev = allSummaries[allSummaries.length - 2];
        const unchanged = REPORT_CATEGORIES.filter(v => last.catBreakdown[v] === prev.catBreakdown[v] && last.catBreakdown[v] > 0);
        if (unchanged.length > 0)
            insights.push({ type: "violet", icon: "bi-dash-circle-fill", text: `<strong>${unchanged.join(", ")}</strong> showed no change between the last two audits.` });
    }

    return insights;
}

/* ══════════════════════════════════════════════
   TODAY'S AUDIT SUMMARY POPUP
══════════════════════════════════════════════ */

function showAuditSummaryPopup(dateKey) {
    // Remove any existing overlay
    const existing = document.getElementById("auditSummaryOverlay");
    if (existing) existing.remove();

    const today = _summariseDate(dateKey);
    const prev  = _getPreviousSummary(dateKey);

    const overlay = document.createElement("div");
    overlay.id = "auditSummaryOverlay";
    overlay.className = "audit-summary-overlay";

    const prevLabel = analyticsSettings.comparisonMode === "prevDay" ? "Previous Audit" :
                      analyticsSettings.comparisonMode === "weeklyAvg" ? "7-Day Average" : "Monthly Average";

    /* KPI section */
    const kpiHtml = today ? `
        <div class="asc-overview-grid">
            <div class="asc-kpi">
                <div class="asc-kpi-val">${today.traffic}</div>
                <div class="asc-kpi-lbl">Total Traffic</div>
            </div>
            <div class="asc-kpi">
                <div class="asc-kpi-val" style="color:var(--red)">${today.violations}</div>
                <div class="asc-kpi-lbl">Violations</div>
            </div>
            <div class="asc-kpi">
                <div class="asc-kpi-val" style="color:var(--green)">${today.exemptions}</div>
                <div class="asc-kpi-lbl">Exemptions</div>
            </div>
            <div class="asc-kpi">
                <div class="asc-kpi-val" style="color:var(--amber)">${_friendlyDate(dateKey)}</div>
                <div class="asc-kpi-lbl">Audit Date</div>
            </div>
        </div>` : `<div class="an-empty"><i class="bi bi-inbox"></i><p>No data for today's audit.</p></div>`;

    /* Comparison section */
    let compareHtml = "";
    if (today && prev) {
        const fields = [
            { label: "Total Traffic",   now: today.traffic,    old: prev.traffic },
            { label: "Violations",      now: today.violations, old: prev.violations },
            { label: "Exemptions",      now: today.exemptions, old: prev.exemptions }
        ];
        const rows = fields.map(f => {
            const c = _pctChange(f.now, f.old);
            const sign = c.dir === "up" ? "▲" : c.dir === "down" ? "▼" : "—";
            const cls  = c.dir === "up" ? "asc-diff-up" : c.dir === "down" ? "asc-diff-down" : "asc-diff-none";
            return `<div class="asc-compare-row">
                <span class="asc-compare-label">${f.label}</span>
                <span class="asc-compare-val asc-compare-today">${f.now}</span>
                <span class="asc-compare-val asc-compare-prev">${f.old}</span>
                <span class="asc-compare-diff ${cls}">${sign} ${c.dir !== "flat" ? (c.dir === "up" ? "+" : "−") + Math.abs(c.diff) + " (" + c.pct + "%)" : "No change"}</span>
            </div>`;
        }).join("");

        compareHtml = `
            <div>
                <div class="asc-section-title"><i class="bi bi-bar-chart-line"></i> Comparison with ${prevLabel}</div>
                <div class="asc-compare-row" style="background:var(--bg-dark);font-size:11px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.05em;color:var(--text-dim);">
                    <span>Metric</span><span style="text-align:center">Today</span><span style="text-align:center">Previous</span><span style="text-align:right">Change</span>
                </div>
                <div class="asc-compare-table">${rows}</div>
            </div>`;
    }

    /* Vehicle category analysis */
    let vehHtml = "";
    if (today) {
        const mainVehs = REPORT_CATEGORIES.map(v => ({
            v,
            todayCount: today.vehBreakdown[v] || 0,
            prevCount:  prev ? (prev.vehBreakdown[v] || 0) : null
        })).filter(x => x.todayCount > 0 || (x.prevCount && x.prevCount > 0));

        if (mainVehs.length > 0) {
            // Most increased / decreased
            if (prev) {
                const diffs = mainVehs.map(x => ({ ...x, diff: x.todayCount - (x.prevCount || 0) }));
                diffs.sort((a, b) => b.diff - a.diff);
                const mostInc = diffs[0];
                const mostDec = diffs[diffs.length - 1];

                vehHtml = `
                <div>
                    <div class="asc-section-title"><i class="bi bi-car-front-fill"></i> Vehicle Category Analysis</div>
                    <div class="asc-highlights-grid">
                        <div class="asc-highlight-card">
                            <div class="asc-highlight-icon">📈</div>
                            <div class="asc-highlight-label">Most Increased Category</div>
                            <div class="asc-highlight-val">${mostInc.diff >= 0 ? mostInc.v : "None"}</div>
                            <div class="asc-highlight-sub">${mostInc.diff > 0 ? `+${mostInc.diff} vs previous` : "No increase"}</div>
                        </div>
                        <div class="asc-highlight-card">
                            <div class="asc-highlight-icon">📉</div>
                            <div class="asc-highlight-label">Most Decreased Category</div>
                            <div class="asc-highlight-val">${mostDec.diff < 0 ? mostDec.v : "None"}</div>
                            <div class="asc-highlight-sub">${mostDec.diff < 0 ? `${mostDec.diff} vs previous` : "No decrease"}</div>
                        </div>
                        <div class="asc-highlight-card">
                            <div class="asc-highlight-icon">🚗</div>
                            <div class="asc-highlight-label">Highest Traffic Category</div>
                            <div class="asc-highlight-val">${diffs.slice().sort((a,b)=>b.todayCount-a.todayCount)[0]?.v || "—"}</div>
                            <div class="asc-highlight-sub">${diffs.slice().sort((a,b)=>b.todayCount-a.todayCount)[0]?.todayCount || 0} vehicles today</div>
                        </div>
                        <div class="asc-highlight-card">
                            <div class="asc-highlight-icon">🔻</div>
                            <div class="asc-highlight-label">Lowest Traffic Category</div>
                            <div class="asc-highlight-val">${diffs.filter(x=>x.todayCount>0).slice().sort((a,b)=>a.todayCount-b.todayCount)[0]?.v || "—"}</div>
                            <div class="asc-highlight-sub">${diffs.filter(x=>x.todayCount>0).slice().sort((a,b)=>a.todayCount-b.todayCount)[0]?.todayCount || 0} vehicles today</div>
                        </div>
                    </div>
                </div>`;
            }
        }
    }

    /* Smart observation */
    const obsText  = _generateObservation(today, prev);
    const obsHtml  = `
        <div>
            <div class="asc-section-title"><i class="bi bi-lightbulb-fill"></i> Smart Audit Observation</div>
            <div class="asc-observation">${obsText}</div>
        </div>`;

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    overlay.innerHTML = `
        <div class="audit-summary-card">
            <div class="asc-header">
                <div class="asc-header-left">
                    <div class="asc-header-icon">📊</div>
                    <div>
                        <div class="asc-header-title">Today's Audit Summary</div>
                        <div class="asc-header-sub"><i class="bi bi-calendar-event"></i> ${_friendlyDate(dateKey)} &nbsp;·&nbsp; <i class="bi bi-clock"></i> ${timeStr}</div>
                    </div>
                </div>
                <button class="asc-close-btn" id="auditSummaryCloseBtn" type="button">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            <div class="asc-body">
                <div>
                    <div class="asc-section-title"><i class="bi bi-grid-1x2-fill"></i> Today's Overview</div>
                    ${kpiHtml}
                </div>
                ${compareHtml}
                ${vehHtml}
                ${obsHtml}
            </div>
            <div class="asc-actions">
                <button class="asc-btn asc-btn-primary" id="ascViewDashboardBtn" type="button">
                    <i class="bi bi-bar-chart-line-fill"></i> View Detailed Analytics
                </button>
                <button class="asc-btn asc-btn-secondary" id="ascExportPdfBtn" type="button">
                    <i class="bi bi-file-earmark-pdf-fill"></i> Export PDF
                </button>
                <button class="asc-btn asc-btn-ghost" id="auditSummaryCloseBtnBottom" type="button">
                    <i class="bi bi-x"></i> Close
                </button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("active"));

    const closeOverlay = () => {
        overlay.classList.remove("active");
        setTimeout(() => overlay.remove(), 320);
    };

    document.getElementById("auditSummaryCloseBtn").addEventListener("click", closeOverlay);
    document.getElementById("auditSummaryCloseBtnBottom").addEventListener("click", closeOverlay);
    overlay.addEventListener("click", e => { if (e.target === overlay) closeOverlay(); });

    document.getElementById("ascViewDashboardBtn").addEventListener("click", () => {
        closeOverlay();
        setTimeout(() => openAnalyticsDashboard(), 350);
    });

    document.getElementById("ascExportPdfBtn").addEventListener("click", () => {
        exportAnalyticsPdf(dateKey);
    });
}

/* ══════════════════════════════════════════════
   ANALYTICS DASHBOARD
══════════════════════════════════════════════ */

function openAnalyticsDashboard() {
    const modal = document.getElementById("analyticsDashboardModal");
    if (!modal) return;
    const bsModal = bootstrap.Modal.getOrCreateInstance(modal);
    bsModal.show();
    _renderAnalyticsDashboard();
}

function _renderAnalyticsDashboard() {
    _renderKPIPanel();
    _renderTrendCharts();
    _renderVehiclePanel();
    _renderInsightsPanel();
    _renderComparePanel();
    _renderMonthlyPanel();
    _renderLeaderboardPanel();
}

/* ── KPI Panel ── */
function _renderKPIPanel() {
    const container = document.getElementById("anKpiGrid");
    if (!container) return;

    const startEl = document.getElementById("anFilterStart");
    const endEl   = document.getElementById("anFilterEnd");
    const start   = startEl && startEl.value ? startEl.value : null;
    const end     = endEl   && endEl.value   ? endEl.value   : null;

    const dates = _getAnalyticsDates(start, end);
    const kpis  = _computeKPIs(dates);

    // Comparison
    const prevDates = dates.length > 1 ? dates.slice(0, -1) : [];
    const prevKpis  = _computeKPIs(prevDates);

    const tc = _pctChange(kpis.total,         prevKpis.total);
    const vc = _pctChange(kpis.violations,     prevKpis.violations);
    const ec = _pctChange(kpis.exemptions,     prevKpis.exemptions);
    const av = _pctChange(kpis.avgTraffic,     prevKpis.avgTraffic);
    const va = _pctChange(kpis.avgViolations,  prevKpis.avgViolations);
    const ea = _pctChange(kpis.avgExemptions,  prevKpis.avgExemptions);

    const kpiDefs = [
        { id: "kpi-traffic",   lbl: "Total Traffic",       val: kpis.total,         change: tc, color: "kc-amber",  icon: "bi-speedometer2" },
        { id: "kpi-viol",      lbl: "Total Violations",     val: kpis.violations,     change: vc, color: "kc-red",    icon: "bi-exclamation-octagon-fill" },
        { id: "kpi-exem",      lbl: "Total Exemptions",     val: kpis.exemptions,     change: ec, color: "kc-green",  icon: "bi-patch-check-fill" },
        { id: "kpi-days",      lbl: "Audit Days",           val: kpis.auditDays,      change: null, color: "kc-blue", icon: "bi-calendar-check-fill" },
        { id: "kpi-avgtraffic",lbl: "Avg Daily Traffic",    val: kpis.avgTraffic,     change: av, color: "kc-amber",  icon: "bi-bar-chart-fill" },
        { id: "kpi-avgviol",   lbl: "Avg Daily Violations", val: kpis.avgViolations,  change: va, color: "kc-red",    icon: "bi-graph-up" },
        { id: "kpi-avgexem",   lbl: "Avg Daily Exemptions", val: kpis.avgExemptions,  change: ea, color: "kc-green",  icon: "bi-graph-down" },
    ];

    container.innerHTML = kpiDefs.map(k => {
        let trendHtml = "";
        if (k.change && prevDates.length > 0) {
            const cls  = k.change.dir === "up" ? "an-trend-up" : k.change.dir === "down" ? "an-trend-down" : "an-trend-flat";
            const sign = k.change.dir === "up" ? "▲" : k.change.dir === "down" ? "▼" : "—";
            trendHtml = `<div class="an-kpi-trend ${cls}">${sign} ${k.change.pct}% vs prev period</div>`;
        }
        return `<div class="an-kpi-card ${k.color}">
            <div class="an-kpi-icon"><i class="bi ${k.icon}"></i></div>
            <div class="an-kpi-val">${k.val.toLocaleString()}</div>
            <div class="an-kpi-lbl">${k.lbl}</div>
            ${trendHtml}
        </div>`;
    }).join("");
}

/* ── Trend Charts ── */
function _renderTrendCharts() {
    const startEl = document.getElementById("anFilterStart");
    const endEl   = document.getElementById("anFilterEnd");
    const start   = startEl && startEl.value ? startEl.value : null;
    const end     = endEl   && endEl.value   ? endEl.value   : null;
    const dates   = _getAnalyticsDates(start, end);

    if (dates.length === 0) {
        ["anChartTraffic","anChartViol","anChartExem"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `<div class="an-empty"><i class="bi bi-bar-chart"></i><p>No data in selected range.</p></div>`;
        });
        return;
    }

    const summaries = dates.map(_summariseDate).filter(Boolean);
    _drawSparkline("anChartTraffic", summaries.map(s => ({ date: s.dateKey, val: s.traffic })),    "var(--amber)");
    _drawSparkline("anChartViol",    summaries.map(s => ({ date: s.dateKey, val: s.violations })),  "var(--red)");
    _drawSparkline("anChartExem",    summaries.map(s => ({ date: s.dateKey, val: s.exemptions })),  "var(--green)");
}

function _drawSparkline(containerId, data, color) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (data.length === 0) {
        el.innerHTML = `<div class="an-empty"><i class="bi bi-bar-chart"></i><p>No data.</p></div>`;
        return;
    }
    const max = Math.max(...data.map(d => d.val), 1);
    const show = data.length > 30 ? data.slice(-30) : data;
    const bars = show.map(d => {
        const h = Math.max(4, Math.round((d.val / max) * 110));
        const label = `${_friendlyDate(d.date)}: ${d.val}`;
        return `<div class="an-spark-bar" style="height:${h}px;background:${color};opacity:.85;" title="${label}"></div>`;
    }).join("");
    const dateLabels = show.map(d => `<div class="an-spark-date-lbl">${d.date.slice(5)}</div>`).join(""); // MM-DD
    el.innerHTML = `<div class="an-sparkline">${bars}</div><div class="an-spark-dates">${dateLabels}</div>`;
}

/* ── Vehicle Panel ── */
function _renderVehiclePanel() {
    const container = document.getElementById("anVehicleTableBody");
    if (!container) return;

    const startEl = document.getElementById("anFilterStart");
    const endEl   = document.getElementById("anFilterEnd");
    const start   = startEl && startEl.value ? startEl.value : null;
    const end     = endEl   && endEl.value   ? endEl.value   : null;
    const dates   = _getAnalyticsDates(start, end);

    if (dates.length === 0) {
        container.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">No data in selected range.</td></tr>`;
        return;
    }

    const current  = _computeVehicleBreakdown(dates);
    const prevDates = dates.length > 1 ? dates.slice(0, -1) : [];
    const previous  = prevDates.length > 0 ? _computeVehicleBreakdown(prevDates) : null;

    const icon = VC_ICONS || {};
    const rows = VEHICLE_CLASSES
        .filter(v => current[v] > 0 || (previous && previous[v] > 0))
        .sort((a, b) => (current[b] || 0) - (current[a] || 0));

    if (rows.length === 0) {
        container.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">No vehicle data.</td></tr>`;
        return;
    }

    container.innerHTML = rows.map(v => {
        const cur  = current[v] || 0;
        const prev = previous ? (previous[v] || 0) : null;
        let diffCell = "<td>—</td><td>—</td><td>—</td>";
        if (prev !== null) {
            const c = _pctChange(cur, prev);
            const sign = c.dir === "up" ? "▲" : c.dir === "down" ? "▼" : "—";
            const cls  = c.dir === "up" ? "up" : c.dir === "down" ? "down" : "flat";
            const chipText = c.dir === "flat" ? "—" : `${sign} ${Math.abs(c.diff)} (${c.pct}%)`;
            diffCell = `<td style="text-align:center;font-family:var(--font-mono)">${prev}</td>
                        <td style="text-align:center"><span class="an-val-chip ${cls}">${chipText}</span></td>
                        <td style="text-align:center;font-family:var(--font-mono);color:${c.dir==="up"?"var(--green)":c.dir==="down"?"var(--red)":"var(--text-faint)"}">${c.dir !== "flat" ? c.pct + "%" : "—"}</span></td>`;
        }
        const iconCls = typeof icon[v] !== "undefined" ? icon[v] : "bi-circle-fill";
        return `<tr>
            <td class="an-vt-name"><i class="bi ${iconCls}"></i> ${v}</td>
            <td style="text-align:center;font-family:var(--font-mono);font-weight:700">${cur}</td>
            ${diffCell}
        </tr>`;
    }).join("");
}

/* ── Insights Panel ── */
function _renderInsightsPanel() {
    const container = document.getElementById("anInsightsList");
    if (!container) return;

    const startEl = document.getElementById("anFilterStart");
    const endEl   = document.getElementById("anFilterEnd");
    const start   = startEl && startEl.value ? startEl.value : null;
    const end     = endEl   && endEl.value   ? endEl.value   : null;
    const dates   = _getAnalyticsDates(start, end);
    const insights = _generateInsights(dates);

    if (insights.length === 0) {
        container.innerHTML = `<div class="an-empty"><i class="bi bi-lightbulb"></i><p>Save more audits to generate insights.</p></div>`;
        return;
    }
    container.innerHTML = insights.map(ins => `
        <div class="an-insight-item ins-${ins.type}">
            <i class="bi ${ins.icon} an-insight-icon"></i>
            <div class="an-insight-text">${ins.text}</div>
        </div>`).join("");
}

/* ── Compare Panel ── */
function _renderComparePanel() {
    const container = document.getElementById("anCompareResult");
    if (!container) return;
    container.innerHTML = `<div class="an-empty"><i class="bi bi-calendar2-range"></i><p>Select two dates above and click Compare.</p></div>`;
}

function _runCompare() {
    const d1El = document.getElementById("anCompareDate1");
    const d2El = document.getElementById("anCompareDate2");
    const container = document.getElementById("anCompareResult");
    if (!d1El || !d2El || !container) return;
    const d1 = d1El.value, d2 = d2El.value;
    if (!d1 || !d2) { if (typeof showToast === "function") showToast("Select Both Dates", "Please select two dates to compare.", "warning"); return; }
    if (d1 === d2) { if (typeof showToast === "function") showToast("Same Date", "Please select two different dates.", "warning"); return; }

    const s1 = _summariseDate(d1);
    const s2 = _summariseDate(d2);

    if (!s1 && !s2) { container.innerHTML = `<div class="an-empty"><i class="bi bi-inbox"></i><p>No audit data found for either date.</p></div>`; return; }
    if (!s1) { container.innerHTML = `<div class="an-empty"><i class="bi bi-inbox"></i><p>No data for ${_friendlyDate(d1)}.</p></div>`; return; }
    if (!s2) { container.innerHTML = `<div class="an-empty"><i class="bi bi-inbox"></i><p>No data for ${_friendlyDate(d2)}.</p></div>`; return; }

    const allFields = [
        { label: "Total Traffic",   v1: s1.traffic,    v2: s2.traffic },
        { label: "Violations",      v1: s1.violations, v2: s2.violations },
        { label: "Exemptions",      v1: s1.exemptions, v2: s2.exemptions },
        ...VEHICLE_CLASSES.filter(v => (s1.vehBreakdown[v] || 0) > 0 || (s2.vehBreakdown[v] || 0) > 0)
                           .map(v => ({ label: v, v1: s1.vehBreakdown[v] || 0, v2: s2.vehBreakdown[v] || 0 }))
    ];

    const rows = allFields.map(f => {
        const c = _pctChange(f.v2, f.v1);
        const sign = c.dir === "up" ? "▲" : c.dir === "down" ? "▼" : "—";
        const cls  = c.dir === "up" ? "an-val-chip up" : c.dir === "down" ? "an-val-chip down" : "an-val-chip flat";
        const chipText = c.dir === "flat" ? "—" : `${sign} ${Math.abs(c.diff)}`;
        const pctText  = c.dir !== "flat" ? `${c.pct}%` : "—";
        return `<tr>
            <td style="font-weight:600">${f.label}</td>
            <td style="text-align:center;font-family:var(--font-mono)">${f.v1}</td>
            <td style="text-align:center;font-family:var(--font-mono)">${f.v2}</td>
            <td style="text-align:center"><span class="${cls}">${chipText}</span></td>
            <td style="text-align:center;font-family:var(--font-mono)">${pctText}</td>
        </tr>`;
    }).join("");

    container.innerHTML = `
        <table class="an-compare-result-table">
            <thead>
                <tr>
                    <th>Metric</th>
                    <th style="text-align:center">${_friendlyDate(d1)}</th>
                    <th style="text-align:center">${_friendlyDate(d2)}</th>
                    <th style="text-align:center">Net Change</th>
                    <th style="text-align:center">% Change</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

/* ── Monthly Panel ── */
function _renderMonthlyPanel() {
    const sel = document.getElementById("anMonthSelect");
    if (!sel) return;

    // Populate month options from available data
    const allDates = _getAnalyticsDates();
    const months   = [...new Set(allDates.map(d => d.slice(0, 7)))].sort().reverse();

    // Preserve current selection
    const prevVal = sel.value;
    sel.innerHTML = `<option value="">-- Select Month --</option>` +
        months.map(m => {
            const [y, mo] = m.split("-");
            const mNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            return `<option value="${m}">${mNames[parseInt(mo)-1]} ${y}</option>`;
        }).join("");
    if (prevVal) sel.value = prevVal;

    _renderMonthlyStats();
}

function _renderMonthlyStats() {
    const sel       = document.getElementById("anMonthSelect");
    const container = document.getElementById("anMonthlyContent");
    if (!sel || !container) return;
    const month = sel.value;
    if (!month) {
        container.innerHTML = `<div class="an-empty"><i class="bi bi-calendar-month"></i><p>Select a month to view statistics.</p></div>`;
        return;
    }
    const dates = _getAnalyticsDates().filter(d => d.startsWith(month));
    if (dates.length === 0) {
        container.innerHTML = `<div class="an-empty"><i class="bi bi-inbox"></i><p>No audit data for this month.</p></div>`;
        return;
    }
    const kpis     = _computeKPIs(dates);
    const summaries = dates.map(_summariseDate).filter(Boolean);

    const highDay = summaries.reduce((a, b) => b.traffic > a.traffic ? b : a, summaries[0]);
    const lowDay  = summaries.reduce((a, b) => b.traffic < a.traffic ? b : a, summaries[0]);
    const highViolDay = summaries.reduce((a, b) => b.violations > a.violations ? b : a, summaries[0]);
    const highExemDay = summaries.reduce((a, b) => b.exemptions > a.exemptions ? b : a, summaries[0]);

    const stats = [
        { lbl: "Total Traffic",        val: kpis.total.toLocaleString(),        sub: "" },
        { lbl: "Total Violations",      val: kpis.violations.toLocaleString(),   sub: "" },
        { lbl: "Total Exemptions",      val: kpis.exemptions.toLocaleString(),   sub: "" },
        { lbl: "Working Days",          val: kpis.auditDays,                     sub: "audit sessions" },
        { lbl: "Avg Daily Traffic",     val: kpis.avgTraffic.toLocaleString(),   sub: "per audit day" },
        { lbl: "Avg Daily Violations",  val: kpis.avgViolations.toLocaleString(),sub: "per audit day" },
        { lbl: "Avg Daily Exemptions",  val: kpis.avgExemptions.toLocaleString(),sub: "per audit day" },
        { lbl: "Highest Traffic Day",   val: _friendlyDate(highDay.dateKey),     sub: `${highDay.traffic} transactions` },
        { lbl: "Lowest Traffic Day",    val: _friendlyDate(lowDay.dateKey),      sub: `${lowDay.traffic} transactions` },
        { lbl: "Highest Violation Day", val: _friendlyDate(highViolDay.dateKey), sub: `${highViolDay.violations} violations` },
        { lbl: "Highest Exemption Day", val: _friendlyDate(highExemDay.dateKey), sub: `${highExemDay.exemptions} exemptions` },
    ];

    container.innerHTML = `
        <div class="an-monthly-grid">
            ${stats.map(s => `<div class="an-monthly-card">
                <div class="an-monthly-card-lbl">${s.lbl}</div>
                <div class="an-monthly-card-val">${s.val}</div>
                ${s.sub ? `<div class="an-monthly-card-sub">${s.sub}</div>` : ""}
            </div>`).join("")}
        </div>`;
}

/* ── Leaderboard Panel ── */
function _renderLeaderboardPanel() {
    const container = document.getElementById("anLeaderboard");
    if (!container) return;

    const startEl = document.getElementById("anFilterStart");
    const endEl   = document.getElementById("anFilterEnd");
    const start   = startEl && startEl.value ? startEl.value : null;
    const end     = endEl   && endEl.value   ? endEl.value   : null;
    const dates   = _getAnalyticsDates(start, end);

    if (dates.length === 0) {
        container.innerHTML = `<div class="an-empty"><i class="bi bi-trophy"></i><p>No data in selected range.</p></div>`;
        return;
    }

    // Per-vehicle violation totals (only Violation mode, only report categories)
    const violByVeh = {};
    REPORT_CATEGORIES.forEach(v => { violByVeh[v] = 0; });
    dates.forEach(d => {
        const s = _summariseDate(d);
        if (!s) return;
        REPORT_CATEGORIES.forEach(v => { violByVeh[v] += s.vehModeBreakdown.Violation[v] || 0; });
    });

    const total = Object.values(violByVeh).reduce((a, b) => a + b, 0);
    const sorted = Object.entries(violByVeh).sort((a, b) => b[1] - a[1]).filter(([, c]) => c > 0);
    const max = sorted.length > 0 ? sorted[0][1] : 1;

    if (sorted.length === 0) {
        container.innerHTML = `<div class="an-empty"><i class="bi bi-trophy"></i><p>No violation data in selected range.</p></div>`;
        return;
    }

    const rankClasses = ["r1", "r2", "r3"];
    container.innerHTML = sorted.map(([v, count], i) => {
        const pct  = total > 0 ? Math.round((count / total) * 100) : 0;
        const barW = max > 0   ? Math.round((count / max)   * 100) : 0;
        const cls  = rankClasses[i] || "rn";
        return `<div class="an-lb-row">
            <div class="an-lb-rank ${cls}">${i + 1}</div>
            <div class="an-lb-name">${v}</div>
            <div class="an-lb-bar-wrap"><div class="an-lb-bar" style="width:${barW}%"></div></div>
            <div class="an-lb-count">${count}</div>
            <div class="an-lb-pct">${pct}%</div>
        </div>`;
    }).join("");
}

/* ── Highest / Lowest Traffic Day ── */
function _renderHighLowTrafficDays() {
    const container = document.getElementById("anHighLowDays");
    if (!container) return;

    const startEl = document.getElementById("anFilterStart");
    const endEl   = document.getElementById("anFilterEnd");
    const start   = startEl && startEl.value ? startEl.value : null;
    const end     = endEl   && endEl.value   ? endEl.value   : null;
    const dates   = _getAnalyticsDates(start, end);

    if (dates.length === 0) {
        container.innerHTML = `<div class="an-empty"><i class="bi bi-calendar-x"></i><p>No data in selected range.</p></div>`;
        return;
    }

    const summaries = dates.map(_summariseDate).filter(Boolean);
    const kpis = _computeKPIs(dates);
    const avg  = kpis.avgTraffic;

    const high = summaries.reduce((a, b) => b.traffic > a.traffic ? b : a, summaries[0]);
    const low  = summaries.reduce((a, b) => b.traffic < a.traffic ? b : a, summaries[0]);

    const highDiff = high.traffic - avg;
    const lowDiff  = low.traffic  - avg;

    container.innerHTML = `
        <div class="asc-highlights-grid">
            <div class="asc-highlight-card" style="border-left:3px solid var(--green)">
                <div class="asc-highlight-icon">🏆</div>
                <div class="asc-highlight-label">Highest Traffic Day</div>
                <div class="asc-highlight-val">${_friendlyDate(high.dateKey)}</div>
                <div class="asc-highlight-sub">${high.traffic} transactions · ${highDiff >= 0 ? "+" : ""}${highDiff} from avg (${avg > 0 ? Math.abs(Math.round((highDiff/avg)*100)) + "%" : "N/A"} ${highDiff >= 0 ? "above" : "below"})</div>
            </div>
            <div class="asc-highlight-card" style="border-left:3px solid var(--red)">
                <div class="asc-highlight-icon">🔻</div>
                <div class="asc-highlight-label">Lowest Traffic Day</div>
                <div class="asc-highlight-val">${_friendlyDate(low.dateKey)}</div>
                <div class="asc-highlight-sub">${low.traffic} transactions · ${lowDiff >= 0 ? "+" : ""}${lowDiff} from avg (${avg > 0 ? Math.abs(Math.round((lowDiff/avg)*100)) + "%" : "N/A"} ${lowDiff >= 0 ? "above" : "below"})</div>
            </div>
        </div>`;
}

/* ══════════════════════════════════════════════
   EXPORT ANALYTICS
══════════════════════════════════════════════ */

function exportAnalyticsExcel() {
    if (typeof XLSX === "undefined") {
        if (typeof showToast === "function") showToast("XLSX Not Available", "Excel export library not loaded.", "error");
        return;
    }

    const startEl = document.getElementById("anFilterStart");
    const endEl   = document.getElementById("anFilterEnd");
    const start   = startEl && startEl.value ? startEl.value : null;
    const end     = endEl   && endEl.value   ? endEl.value   : null;
    const dates   = _getAnalyticsDates(start, end);

    if (dates.length === 0) {
        if (typeof showToast === "function") showToast("No Data", "No audit data in selected range.", "warning");
        return;
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: KPI Summary
    const kpis = _computeKPIs(dates);
    const kpiRows = [
        ["KPI Summary"],
        ["Date Range", `${start || dates[0]} → ${end || dates[dates.length - 1]}`],
        ["Total Traffic",         kpis.total],
        ["Total Violations",      kpis.violations],
        ["Total Exemptions",      kpis.exemptions],
        ["Audit Days",            kpis.auditDays],
        ["Avg Daily Traffic",     kpis.avgTraffic],
        ["Avg Daily Violations",  kpis.avgViolations],
        ["Avg Daily Exemptions",  kpis.avgExemptions],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiRows), "KPI Summary");

    // Sheet 2: Daily Data
    const dailyHeader = ["Date", "Traffic", "Violations", "Exemptions",
                         ...REPORT_CATEGORIES];
    const dailyRows = [dailyHeader, ...dates.map(d => {
        const s = _summariseDate(d);
        if (!s) return [d, 0, 0, 0, ...REPORT_CATEGORIES.map(() => 0)];
        return [d, s.traffic, s.violations, s.exemptions,
                ...REPORT_CATEGORIES.map(v => s.vehBreakdown[v] || 0)];
    })];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailyRows), "Daily Data");

    // Sheet 3: Vehicle Breakdown
    const vehBreak = _computeVehicleBreakdown(dates);
    const vehRows  = [["Vehicle Class", "Total Count"],
                      ...VEHICLE_CLASSES.filter(v => vehBreak[v] > 0)
                                         .sort((a, b) => vehBreak[b] - vehBreak[a])
                                         .map(v => [v, vehBreak[v]])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vehRows), "Vehicle Breakdown");

    // Sheet 4: Insights
    const insights = _generateInsights(dates);
    const insRows  = [["#", "Insight"],
                      ...insights.map((ins, i) => [i + 1, ins.text.replace(/<[^>]+>/g, "")])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(insRows), "Smart Insights");

    XLSX.writeFile(wb, `toll-audit-analytics_${getTodayKey()}.xlsx`);
    if (typeof showToast === "function") showToast("Export Complete", "Analytics exported to Excel.", "success");
}

function exportAnalyticsPdf(dateKey) {
    const printDate = dateKey || (document.getElementById("anFilterStart") && document.getElementById("anFilterStart").value) || getTodayKey();
    const today     = _summariseDate(printDate);
    const prev      = _getPreviousSummary(printDate);
    const dates     = _getAnalyticsDates();
    const kpis      = _computeKPIs(dates);
    const insights  = _generateInsights(dates);
    const vehBreak  = _computeVehicleBreakdown(dates);

    const win = window.open("", "_blank");
    if (!win) {
        if (typeof showToast === "function") showToast("Popup Blocked", "Please allow popups to export PDF.", "warning");
        return;
    }

    const todayRows = today ? `
        <tr><td>Total Traffic</td><td><b>${today.traffic}</b></td></tr>
        <tr><td>Violations</td><td><b>${today.violations}</b></td></tr>
        <tr><td>Exemptions</td><td><b>${today.exemptions}</b></td></tr>` : "";

    const kpiRows = `
        <tr><td>Total Traffic (Period)</td><td><b>${kpis.total}</b></td></tr>
        <tr><td>Total Violations</td><td><b>${kpis.violations}</b></td></tr>
        <tr><td>Total Exemptions</td><td><b>${kpis.exemptions}</b></td></tr>
        <tr><td>Audit Days</td><td><b>${kpis.auditDays}</b></td></tr>
        <tr><td>Avg Daily Traffic</td><td><b>${kpis.avgTraffic}</b></td></tr>`;

    const vehRowsHtml = VEHICLE_CLASSES
        .filter(v => vehBreak[v] > 0)
        .sort((a, b) => vehBreak[b] - vehBreak[a])
        .map(v => `<tr><td>${v}</td><td><b>${vehBreak[v]}</b></td></tr>`)
        .join("");

    const insHtml = insights.map((ins, i) => `<li>${i + 1}. ${ins.text.replace(/<[^>]+>/g, "")}</li>`).join("");
    const obs = _generateObservation(today, prev).replace(/<[^>]+>/g, "");

    win.document.write(`<!DOCTYPE html><html><head><title>Toll Audit Analytics Report</title>
        <style>
            body { font-family: Arial, sans-serif; font-size: 13px; color: #1a1a1a; padding: 30px; }
            h1   { font-size: 22px; color: #1a1200; border-bottom: 2px solid #FFB020; padding-bottom: 8px; }
            h2   { font-size: 15px; color: #444; margin-top: 24px; background: #f5f5f5; padding: 6px 10px; border-left: 4px solid #FFB020; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { padding: 7px 10px; border: 1px solid #ddd; text-align: left; font-size: 12px; }
            th { background: #ffe7a0; color: #1a1200; }
            p { line-height: 1.6; }
            li { margin-bottom: 4px; }
            .footer { margin-top: 40px; font-size: 11px; color: #888; border-top: 1px solid #ddd; padding-top: 8px; }
        </style></head><body>
        <h1>Toll Audit — Analytics Report</h1>
        <p><b>Generated:</b> ${new Date().toLocaleString()} &nbsp;·&nbsp; <b>Audit Date:</b> ${_friendlyDate(printDate)}</p>
        <h2>Today's Audit Summary</h2>
        <table><tbody>${todayRows}</tbody></table>
        <p>${obs}</p>
        <h2>KPI Summary (Full Period)</h2>
        <table><tbody>${kpiRows}</tbody></table>
        <h2>Vehicle Breakdown</h2>
        <table><thead><tr><th>Vehicle Class</th><th>Count</th></tr></thead><tbody>${vehRowsHtml}</tbody></table>
        <h2>Smart Insights</h2>
        <ol>${insHtml}</ol>
        <p class="footer">Toll Audit Assistant — Analytics Report &nbsp;·&nbsp; ${new Date().toLocaleString()}</p>
        </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 600);
}

/* ══════════════════════════════════════════════
   ANALYTICS SETTINGS MODAL — RENDER + SAVE
══════════════════════════════════════════════ */

function _renderAnalyticsSettings() {
    const dateEl = document.getElementById("analyticsStartDate");
    const modeEls = document.querySelectorAll(".analytics-cmode-option input[type='radio']");

    if (dateEl) dateEl.value = analyticsSettings.startDate || "";
    modeEls.forEach(el => {
        el.checked = el.value === analyticsSettings.comparisonMode;
        el.closest(".analytics-cmode-option").classList.toggle("selected", el.checked);
    });
}

function _saveAnalyticsSettingsFromModal() {
    const dateEl = document.getElementById("analyticsStartDate");
    const modeEl = document.querySelector(".analytics-cmode-option input[type='radio']:checked");

    if (dateEl) analyticsSettings.startDate = dateEl.value || "";
    if (modeEl) analyticsSettings.comparisonMode = modeEl.value;

    saveAnalyticsSettings();
    if (typeof showToast === "function") showToast("Settings Saved", "Analytics settings have been updated.", "success");
}

/* ══════════════════════════════════════════════
   WIRING — TAB NAVIGATION IN DASHBOARD
══════════════════════════════════════════════ */

function _switchAnalyticsTab(tabName) {
    document.querySelectorAll(".an-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
    document.querySelectorAll(".an-panel").forEach(p => p.classList.toggle("active", p.id === "anPanel_" + tabName));
}

/* ══════════════════════════════════════════════
   INITIALIZATION
══════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", function () {

    loadAnalyticsSettings();

    /* ── Analytics Settings button ── */
    const settingsBtn = document.getElementById("analyticsSettingsBtn");
    if (settingsBtn) {
        settingsBtn.addEventListener("click", function () {
            _renderAnalyticsSettings();
            const modal = document.getElementById("analyticsSettingsModal");
            if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
        });
    }

    /* ── Settings save button ── */
    const saveSettingsBtn = document.getElementById("analyticsSettingsSaveBtn");
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener("click", function () {
            _saveAnalyticsSettingsFromModal();
            const modal = document.getElementById("analyticsSettingsModal");
            if (modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
        });
    }

    /* ── Comparison mode radio highlight ── */
    document.querySelectorAll(".analytics-cmode-option input[type='radio']").forEach(el => {
        el.addEventListener("change", function () {
            document.querySelectorAll(".analytics-cmode-option").forEach(o => o.classList.remove("selected"));
            this.closest(".analytics-cmode-option").classList.add("selected");
        });
    });

    /* ── Analytics Dashboard button ── */
    const dashBtn = document.getElementById("analyticsOpenDashboardBtn");
    if (dashBtn) {
        dashBtn.addEventListener("click", () => openAnalyticsDashboard());
    }

    /* ── Tab navigation in dashboard ── */
    document.querySelectorAll(".an-tab").forEach(t => {
        t.addEventListener("click", function () {
            _switchAnalyticsTab(this.dataset.tab);
            // Re-render the active tab's content
            const tab = this.dataset.tab;
            if (tab === "overview") { _renderKPIPanel(); _renderTrendCharts(); }
            if (tab === "vehicles") _renderVehiclePanel();
            if (tab === "insights") { _renderInsightsPanel(); _renderHighLowTrafficDays(); _renderLeaderboardPanel(); }
            if (tab === "compare")  _renderComparePanel();
            if (tab === "monthly")  _renderMonthlyPanel();
        });
    });

    /* ── Compare button ── */
    const compareBtn = document.getElementById("anCompareRunBtn");
    if (compareBtn) compareBtn.addEventListener("click", _runCompare);

    /* ── Filter apply button ── */
    const filterBtn = document.getElementById("anFilterApplyBtn");
    if (filterBtn) filterBtn.addEventListener("click", function () {
        _renderKPIPanel();
        _renderTrendCharts();
        _renderVehiclePanel();
        _renderInsightsPanel();
        _renderLeaderboardPanel();
        _renderHighLowTrafficDays();
        if (typeof showToast === "function") showToast("Filter Applied", "Analytics updated for selected date range.", "info");
    });

    /* ── Monthly select ── */
    const monthSel = document.getElementById("anMonthSelect");
    if (monthSel) monthSel.addEventListener("change", _renderMonthlyStats);

    /* ── Export buttons ── */
    const exportXlsBtn = document.getElementById("anExportXlsBtn");
    if (exportXlsBtn) exportXlsBtn.addEventListener("click", exportAnalyticsExcel);

    const exportPdfBtn = document.getElementById("anExportPdfBtn");
    if (exportPdfBtn) exportPdfBtn.addEventListener("click", () => exportAnalyticsPdf(null));

    /* ── Dashboard modal shown event — render fresh ── */
    const dashModal = document.getElementById("analyticsDashboardModal");
    if (dashModal) {
        dashModal.addEventListener("show.bs.modal", function () {
            // Populate month selector fresh on open
            setTimeout(() => {
                _renderMonthlyPanel();
                _switchAnalyticsTab("overview");
                _renderAnalyticsDashboard();
            }, 100);
        });
    }

    /* ── Hook into submitAuditLogBtn to show summary after successful save ── */
    _hookSaveAuditForAnalytics();

});

/* Wraps the Save Audit Log button to trigger summary popup after save */
function _hookSaveAuditForAnalytics() {
    const submitBtn = document.getElementById("submitAuditLogBtn");
    if (!submitBtn) return;

    // Listen for clicks — after a brief delay, check if save was likely successful
    // by wrapping at capture phase so we fire AFTER the existing handler runs.
    submitBtn.addEventListener("click", function () {
        // We trigger the summary after 3s to allow the save process to complete.
        setTimeout(() => {
            const dateKey = (typeof selectedAuditDate !== "undefined" && selectedAuditDate) || getTodayKey();
            // Only show if there is actual data for that date
            if (_isBucketNonEmpty(auditDataStore && auditDataStore[dateKey])) {
                showAuditSummaryPopup(dateKey);
            }
        }, 3200);
    }, true /* capture */);
}
