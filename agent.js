/* ═══════════════════════════════════════════════════════════════
   AUDIT AGENT  —  agent.js  v2
   Files:
     1. Consolidate Revenue Report  → Cash, Return, Digital, ETC
     2. Traffic Count Report        → Barcode (Return Barcode row)
     3. Violation Matrix            → Violation + Pass (violation side)
     4. Exemption Matrix            → Exemption + Pass (exemption side)
   Features:
     - Correct & Learn system (Firebase saved rules)
     - Agent Rules history panel
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── TARIFF DEFAULTS ── */
  const DEFAULT_TARIFFS = [
    { key: 'car',   label: 'Car',         single: 85,  tariffRet: 130 },
    { key: 'lcv',   label: 'LCV/Mini Bus', single: 130, tariffRet: 195 },
    { key: 'bus',   label: 'Bus',          single: 255, tariffRet: 385 },
    { key: 'truck', label: 'Truck',        single: 255, tariffRet: 385 },
    { key: 'mav',   label: 'MAV 3-6 Axl', single: 415, tariffRet: 625 },
    { key: 'osv',   label: 'OSV',          single: 510, tariffRet: 770 },
  ];

  /* ── CONSOLIDATE REVENUE → audit key ── */
  const CR_MAP = {
    'CAR': 'car', 'LCV': 'lcv', 'MINI BUS': 'lcv', 'MINIBUS': 'lcv',
    'BUS 2 AXLE': 'bus', 'BUS 2AXLE': 'bus', 'BUS': 'bus',
    'TRUCK 2 AXLE': 'truck', 'TRUCK 2AXLE': 'truck',
    'TRUCK 3 AXLE': 'mav', 'TRUCK 3AXLE': 'mav',
    'MAV 4 AXLE': 'mav', 'MAV 4AXLE': 'mav',
    'MAV 5 AXLE': 'mav', 'MAV 5AXLE': 'mav',
    'MAV 6 AXLE': 'mav', 'MAV 6AXLE': 'mav',
    'MAV': 'mav', 'OSV': 'osv', 'OVERSIZED': 'osv',
  };

  /* ── TRAFFIC COUNT REPORT columns → audit key ── */
  const TC_COL_MAP = {
    'CAR': 'car',
    'LCV': 'lcv', 'MINI BUS': 'lcv', 'MINIBUS': 'lcv',
    'TRUCK 2 AXLE': 'truck', 'TRUCK 2AXLE': 'truck', 'TRUCK': 'truck',
    'TRUCK 3 AXLE': 'mav', 'TRUCK 3AXLE': 'mav',
    'MAV 4 AXLE': 'mav', 'MAV 4AXLE': 'mav', 'MAV 4 -6 AXLE': 'mav',
    'MAV 5 AXLE': 'mav', 'MAV 5AXLE': 'mav',
    'MAV 6 AXLE': 'mav', 'MAV 6AXLE': 'mav',
    'BUS 2 AXLE': 'bus', 'BUS 2AXLE': 'bus', 'BUS': 'bus',
    'OSV': 'osv',
  };

  /* ── VIOLATION/EXEMPTION MATRIX diagonal rows → audit key ── */
  const VM_DIAG_MAP = {
    'CAR': 'car', 'LCV/MINIBUS': 'lcv', 'LCV': 'lcv',
    'MINI BUS': 'lcv', 'MINIBUS': 'lcv',
    'TRUCK 2 AXLE': 'truck', 'TRUCK 2AXLE': 'truck',
    'TRUCK 3 AXLE': 'mav', 'TRUCK 3AXLE': 'mav',
    'MAV 4 - 6 AXLE': 'mav', 'MAV 4-6 AXLE': 'mav', 'MAV 4 -6 AXLE': 'mav',
    'MAV': 'mav', 'BUS 2 AXLE': 'bus', 'BUS 2AXLE': 'bus', 'BUS': 'bus',
    'OSV': 'osv',
  };

  /* ── Non-Tollable rows ── */
  const NT_KEY_MAP = {
    'AUTO': 'auto', 'BIKE': 'bike', 'TRACTOR': 'tractor',
    'AMBULANCE': 'ambulance', 'JCB': 'jcb',
    'GOVT. VEHICLE': 'govt', 'GOVT VEHICLE': 'govt', 'GOVT': 'govt',
    'POLICE': 'police', 'FORCEFULLY': 'forcefully',
    'CONCESSIONAIRE': 'concessionaire',
    'FAKE TRANSACTION': 'fake',
    'PASS MONTHLY/LOCAL': 'pass', 'PASS MONTHLY': 'pass', 'PASS': 'pass',
    'ALREADY PAID FOUND WITH ANOTHER TXN': 'alreadypaid',
    'ALREADY PAID': 'alreadypaid',
  };

  const AUDIT_KEYS   = ['car','lcv','bus','truck','mav','osv'];
  const AUDIT_LABELS = { car:'Car', lcv:'LCV/Mini Bus', bus:'Bus', truck:'Truck', mav:'MAV 3-6 Axl', osv:'OSV' };

  /* ── STATE ── */
  let files    = { cr: null, tc: null, vm: null, em: null };
  let tariffs  = DEFAULT_TARIFFS.map(t => ({...t}));
  let result   = null;
  let learnedRules = {};   // { fieldKey: { value, reason, timestamp } }

  /* ═══════════════ INIT ═══════════════ */
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    renderTariffGrid();
    loadRulesFromStorage();
  });

  function bindEvents() {
    bindFileInput('agentCRInput',  'cr');
    bindFileInput('agentTCInput',  'tc');
    bindFileInput('agentVMInput',  'vm');
    bindFileInput('agentEMInput',  'em');

    safeOn('agentRunBtn',      'click', runAgent);
    safeOn('agentDownloadBtn', 'click', downloadTemplate);
    safeOn('agentResetBtn',    'click', resetAgent);
    safeOn('agentViewRulesBtn','click', openRulesPanel);
    safeOn('agentRulesClose',  'click', closeRulesPanel);
    safeOn('agentRulesClearBtn','click', clearAllRules);
  }

  function bindFileInput(inputId, type) {
    const el = document.getElementById(inputId);
    if (el) el.addEventListener('change', e => handleFile(e.target.files[0], type));
  }

  function safeOn(id, evt, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
  }

  /* ═══════════════ TARIFF GRID ═══════════════ */
  function renderTariffGrid() {
    const grid = document.getElementById('agentTariffGrid');
    if (!grid) return;
    grid.innerHTML = tariffs.map(t => `
      <div class="agent-tariff-item">
        <label>${t.label}</label>
        <div style="display:flex;gap:6px;">
          <input type="number" id="tariff_${t.key}_s" value="${t.single}"    min="0" placeholder="Single" style="width:50%">
          <input type="number" id="tariff_${t.key}_r" value="${t.tariffRet}" min="0" placeholder="Return" style="width:50%">
        </div>
        <div style="font-size:10px;color:#9ca3af;margin-top:2px;">Single / Return</div>
      </div>`).join('');
  }

  function readTariffsFromUI() {
    tariffs.forEach(t => {
      const s = document.getElementById(`tariff_${t.key}_s`);
      const r = document.getElementById(`tariff_${t.key}_r`);
      if (s) t.single    = parseFloat(s.value) || 0;
      if (r) t.tariffRet = parseFloat(r.value) || 0;
    });
  }

  function getTariff(key) { return tariffs.find(t => t.key === key) || {single:0,tariffRet:0}; }

  /* ═══════════════ FILE HANDLING ═══════════════ */
  function handleFile(file, type) {
    if (!file) return;
    const ids = {
      cr: ['agentCRFileName','agentCRStatus','agentCRCard'],
      tc: ['agentTCFileName','agentTCStatus','agentTCCard'],
      vm: ['agentVMFileName','agentVMStatus','agentVMCard'],
      em: ['agentEMFileName','agentEMStatus','agentEMCard'],
    };
    const [nameId, statId, cardId] = ids[type];
    setText(nameId, file.name);
    setText(statId, 'Reading…');
    setClass(statId, 'agent-file-status');

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        files[type] = wb;
        setText(statId, '✓ Parsed successfully');
        setClass(statId, 'agent-file-status ok');
        document.getElementById(cardId).classList.add('ready');
        checkFilesReady();
      } catch (err) {
        setText(statId, '✗ Error: ' + err.message);
        setClass(statId, 'agent-file-status err');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function checkFilesReady() {
    const loaded = Object.values(files).filter(Boolean).length;
    if (loaded === 4) {
      show('agentTariffSection'); show('agentProcessSection');
      setFooterNote('All 4 files loaded. Confirm tariffs and click Generate.');
    } else {
      setFooterNote(`${loaded}/4 files loaded.`);
    }
  }

  /* ═══════════════ PARSE CONSOLIDATE REVENUE ═══════════════ */
  function parseCR(wb) {
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(sheet, { header:1, defval:0 });

    // Detect sub-header row (has NORTH-SOUTH / TOTAL pattern)
    let subHdr = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const r = rows[i].map(c => String(c).toUpperCase());
      if (r.filter(c => c === 'TOTAL').length >= 3) { subHdr = i; break; }
    }
    if (subHdr === -1) subHdr = 1;

    // Detect group header row just above subHdr
    const grpHdr = rows[Math.max(0, subHdr - 1)].map(c => String(c||'').toUpperCase());

    // Find Total columns per group
    const cols = detectCRCols(rows, subHdr, grpHdr);

    const data = {};
    const unmappedRows = [];
    for (let i = subHdr + 1; i < rows.length - 1; i++) {
      const row  = rows[i];
      const name = String(row[0]||'').trim().toUpperCase();
      if (!name || name === 'TOTAL') continue;
      const key  = CR_MAP[name];
      if (!key) { unmappedRows.push(`CR: unmapped label "${name}" — row skipped`); continue; }
      if (!data[key]) data[key] = emptyCR();

      const revRow = rows[i+1];
      const isRevNext = revRow && (String(revRow[0]||'').trim() === '' || revRow[0] === 0);

      data[key].cashSingle   += n(row[cols.cashSingle]);
      data[key].cashReturn   += n(row[cols.cashReturn]);
      data[key].digSingle    += n(row[cols.digSingle]);
      data[key].digReturn    += n(row[cols.digReturn]);
      data[key].fastag       += n(row[cols.fastag]);

      if (isRevNext) {
        data[key].cashSingleRev += n(revRow[cols.cashSingle]);
        data[key].cashReturnRev += n(revRow[cols.cashReturn]);
        data[key].digSingleRev  += n(revRow[cols.digSingle]);
        data[key].digReturnRev  += n(revRow[cols.digReturn]);
        data[key].fastagRev     += n(revRow[cols.fastag]);
        i++;
      }
    }
    return { data, unmappedRows };
  }

  function detectCRCols(rows, subHdr, grpHdr) {
    const cols = { cashSingle:-1, cashReturn:-1, digSingle:-1, digReturn:-1, fastag:-1 };
    const sub  = rows[subHdr].map(c => String(c||'').toUpperCase());

    // Mark group boundaries from group header
    let curGroup = '';
    grpHdr.forEach((cell, ci) => {
      if (cell.includes('SINGLE') && cell.includes('CASH'))    curGroup = 'cashSingle';
      else if (cell.includes('SINGLE') && cell.includes('DIGITAL')) curGroup = 'digSingle';
      else if (cell.includes('RETURN') && cell.includes('CASH'))    curGroup = 'cashReturn';
      else if (cell.includes('RETURN') && cell.includes('DIGITAL')) curGroup = 'digReturn';
      else if (cell.includes('FASTAG') || cell.includes('ETC'))     curGroup = 'fastag';

      if (sub[ci] === 'TOTAL' && curGroup && cols[curGroup] === -1) {
        cols[curGroup] = ci;
      }
    });

    // Fallback: collect all TOTAL column indices
    if (cols.cashSingle === -1) {
      const totals = [];
      sub.forEach((c,i) => { if (c === 'TOTAL') totals.push(i); });
      if (totals.length >= 5) {
        [cols.cashSingle, cols.digSingle, cols.cashReturn, cols.digReturn, cols.fastag] = totals;
      } else if (totals.length >= 3) {
        cols.cashSingle = totals[0]; cols.cashReturn = totals[1]; cols.fastag = totals[totals.length-1];
        if (totals.length > 3) cols.digSingle = totals[2];
      }
    }
    return cols;
  }

  function emptyCR() {
    return { cashSingle:0, cashReturn:0, digSingle:0, digReturn:0, fastag:0,
             cashSingleRev:0, cashReturnRev:0, digSingleRev:0, digReturnRev:0, fastagRev:0 };
  }

  /* ═══════════════ PARSE TRAFFIC COUNT REPORT ═══════════════ */
  function parseTC(wb) {
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(sheet, { header:1, defval:0 });

    // Find header row (has MOP + vehicle columns)
    let hdrRow = 0;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = rows[i].map(c => String(c||'').toUpperCase());
      if (r.includes('MOP') || r.includes('CAR')) { hdrRow = i; break; }
    }

    const headers = rows[hdrRow].map(c => String(c||'').trim().toUpperCase());

    // Map column index → audit key
    const colKeyMap = {};
    headers.forEach((h, ci) => {
      const k = TC_COL_MAP[h];
      if (k) colKeyMap[ci] = k;
    });

    const data = { barcode: { car:0, lcv:0, bus:0, truck:0, mav:0, osv:0 } };

    for (let i = hdrRow + 1; i < rows.length; i++) {
      const row = rows[i];
      const mop = String(row[0]||'').trim().toUpperCase();
      if (!mop) continue;

      if (mop === 'RETURN BARCODE' || mop.includes('RETURN BARCODE')) {
        Object.entries(colKeyMap).forEach(([ci, key]) => {
          data.barcode[key] = (data.barcode[key] || 0) + n(row[ci]);
        });
      }
    }
    return data;
  }

  /* ═══════════════ PARSE VIOLATION / EXEMPTION MATRIX ═══════════════ */
  function parseMatrix(wb) {
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(sheet, { header:1, defval:0 });

    // Find header row with vehicle class columns
    let hdrRow = 0;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = rows[i].map(c => String(c||'').toUpperCase());
      if (r.includes('CAR') || r.some(c => c.includes('CLASS AS PER'))) { hdrRow = i; break; }
    }

    const headers = rows[hdrRow].map(c => String(c||'').trim().toUpperCase());
    const colKeyMap = {};
    headers.forEach((h, ci) => {
      const k = VM_DIAG_MAP[h] || TC_COL_MAP[h];
      if (k && ci > 0) colKeyMap[ci] = k;
    });

    const result = {
      colTotal:  { car:0, lcv:0, bus:0, truck:0, mav:0, osv:0 },
      diagonal:  { car:0, lcv:0, bus:0, truck:0, mav:0, osv:0 },
      passPerClass: { car:0, lcv:0, bus:0, truck:0, mav:0, osv:0 },
      nt: { ambulance:0, auto:0, bike:0, tractor:0, jcb:0, govt:0, police:0, forcefully:0 },
      unmappedRows: [],
    };

    // Yellow row = system totals (usually row hdrRow+1)
    // Skip it and parse actual rows
    for (let i = hdrRow + 1; i < rows.length; i++) {
      const row       = rows[i];
      const actualCls = String(row[0]||'').trim().toUpperCase();
      if (!actualCls) continue;

      // Total row → save column totals
      if (actualCls === 'TOTAL') {
        Object.entries(colKeyMap).forEach(([ci, key]) => {
          result.colTotal[key] = (result.colTotal[key]||0) + n(row[ci]);
        });
        continue;
      }

      const diagKey = VM_DIAG_MAP[actualCls];
      const ntKey   = NT_KEY_MAP[actualCls];

      // Log rows whose label is not in any map
      if (!diagKey && !ntKey) {
        result.unmappedRows.push(`Matrix: unmapped label "${actualCls}" — row skipped`);
        continue;
      }

      // Diagonal row (correctly classified)
      if (diagKey) {
        Object.entries(colKeyMap).forEach(([ci, key]) => {
          if (key === diagKey) result.diagonal[diagKey] = (result.diagonal[diagKey]||0) + n(row[ci]);
        });
      }

      // Pass row — distribute per class column
      if (ntKey === 'pass') {
        Object.entries(colKeyMap).forEach(([ci, key]) => {
          result.passPerClass[key] = (result.passPerClass[key]||0) + n(row[ci]);
        });
        continue;
      }

      // Non-tollable rows
      if (ntKey && result.nt.hasOwnProperty(ntKey)) {
        let rowTotal = 0;
        Object.keys(colKeyMap).forEach(ci => { rowTotal += n(row[ci]); });
        result.nt[ntKey] = (result.nt[ntKey]||0) + rowTotal;
      }
    }

    // If colTotal is all zeros (no explicit Total row), sum from all rows
    const colTotalSum = Object.values(result.colTotal).reduce((a,b)=>a+b,0);
    if (colTotalSum === 0) {
      for (let i = hdrRow + 2; i < rows.length - 1; i++) {
        const row = rows[i];
        const lbl = String(row[0]||'').trim().toUpperCase();
        if (!lbl || lbl === 'TOTAL') continue;
        Object.entries(colKeyMap).forEach(([ci, key]) => {
          result.colTotal[key] = (result.colTotal[key]||0) + n(row[ci]);
        });
      }
    }

    return result;   // includes result.unmappedRows
  }

  /* ═══════════════ MAIN RUN ═══════════════ */
  function runAgent() {
    if (!files.cr || !files.tc || !files.vm || !files.em) {
      alert('Please upload all 4 files first!'); return;
    }
    readTariffsFromUI();

    const log  = document.getElementById('agentLog');
    const bar  = document.getElementById('agentProgressBar');
    const prog = document.getElementById('agentProgress');
    log.innerHTML = '';
    prog.style.display = 'block';
    setProgress(bar, 5);
    addLog(log, '▶ Agent starting…', 'ok');

    setTimeout(() => {
      try {
        addLog(log, '📊 Parsing Consolidate Revenue Report…');
        const crRaw  = parseCR(files.cr);
        const crData = crRaw.data;
        crRaw.unmappedRows.forEach(m => addLog(log, '⚠️ ' + m, 'warn'));
        setProgress(bar, 25);

        addLog(log, '🎫 Parsing Traffic Count Report (Barcode)…');
        const tcData = parseTC(files.tc);
        setProgress(bar, 45);

        addLog(log, '🔴 Parsing Violation Matrix…');
        const vmData = parseMatrix(files.vm);
        vmData.unmappedRows.forEach(m => addLog(log, '⚠️ ' + m, 'warn'));
        setProgress(bar, 65);

        addLog(log, '🟢 Parsing Exemption Matrix…');
        const emData = parseMatrix(files.em);
        emData.unmappedRows.forEach(m => addLog(log, '⚠️ ' + m, 'warn'));
        setProgress(bar, 80);

        addLog(log, '🧠 Applying learned rules…');
        result = buildAuditData(crData, tcData, vmData, emData);
        applyLearnedRules(result, log);
        setProgress(bar, 95);

        addLog(log, '📋 Rendering preview…');
        renderPreview(result);
        setProgress(bar, 100);

        addLog(log, '✅ Done! Review below and correct any values.', 'ok');
        show('agentPreviewSection');
        document.getElementById('agentRunBtn').disabled = true;
        setFooterNote('Review the table. Click ✏️ on any cell to correct and teach the agent.');

      } catch (err) {
        addLog(log, '✗ Error: ' + err.message, 'err');
        console.error('Agent error:', err);
      }
    }, 150);
  }

  /* ═══════════════ BUILD AUDIT DATA ═══════════════ */
  function buildAuditData(cr, tc, vm, em) {
    const rows = [];
    const anomalies = [];

    AUDIT_KEYS.forEach(key => {
      const c  = cr[key] || emptyCR();
      const tf = getTariff(key);

      // Paid Traffic
      const cash      = c.cashSingle;
      const retCount  = c.cashReturn + c.digReturn;   // traffic return count
      const barcode   = tc.barcode[key] || 0;
      const digital   = c.digSingle;
      const etc       = c.fastag;
      const pass      = (vm.passPerClass[key]||0) + (em.passPerClass[key]||0);
      const paidTotal = cash + retCount + barcode + digital + etc + pass;

      // Violation = colTotal - diagonal (from Violation Matrix)
      const vmColTotal  = vm.colTotal[key] || 0;
      const vmDiag      = vm.diagonal[key] || 0;
      // If diagonal exceeds column total the source file is malformed — flag it
      // rather than silently clamping: a negative result hides a parse failure.
      if (vmDiag > vmColTotal) {
        anomalies.push(
          `${AUDIT_LABELS[key]}: Violation Matrix diagonal (${vmDiag}) exceeds column ` +
          `total (${vmColTotal}) — possible column-detection or source file error. ` +
          `Violation count set to 0.`
        );
      }
      const violation   = Math.max(0, vmColTotal - vmDiag);
      const revLossViol = violation * tf.single;

      // Exemption = colTotal - diagonal (from Exemption Matrix)
      const emColTotal  = em.colTotal[key] || 0;
      const emDiag      = em.diagonal[key] || 0;
      if (emDiag > emColTotal) {
        anomalies.push(
          `${AUDIT_LABELS[key]}: Exemption Matrix diagonal (${emDiag}) exceeds column ` +
          `total (${emColTotal}) — possible column-detection or source file error. ` +
          `Exemption count set to 0.`
        );
      }
      const exemption   = Math.max(0, emColTotal - emDiag);
      const revLossExem = exemption * tf.single;

      const totalUnpaid  = violation + exemption;
      const totalLoss    = revLossViol + revLossExem;
      const totalTraffic = paidTotal + totalUnpaid;
      const totalRevenue = (cash * tf.single) + (retCount * tf.tariffRet) +
                           (barcode * tf.tariffRet) + (digital * tf.single) + (etc * tf.single);
      const lossPercent  = totalTraffic > 0
        ? Math.round((totalUnpaid / totalTraffic) * 100) : 0;

      // Revenue check — cash single count vs reported revenue
      const expectedCashRev = cash * tf.single;
      if (c.cashSingleRev > 0 && Math.abs(c.cashSingleRev - expectedCashRev) > 200) {
        anomalies.push(`${AUDIT_LABELS[key]}: Cash revenue mismatch — Expected ₹${fmt(expectedCashRev)}, Report shows ₹${fmt(c.cashSingleRev)}`);
      }

      rows.push({ key, label: AUDIT_LABELS[key],
        single: tf.single, tariffRet: tf.tariffRet,    // tariff prices
        cash, retCount, barcode, digital, etc, pass, paidTotal,
        violation, revLossViol, exemption, revLossExem,
        totalUnpaid, totalLoss, totalTraffic, lossPercent, totalRevenue,
      });
    });

    // Non-Tollable row
    const ntViol = Object.values(vm.nt).reduce((a,b)=>a+b,0);
    const ntExem = Object.values(em.nt).reduce((a,b)=>a+b,0);
    rows.push({ key:'nt', label:'Non-Tollable',
      single:0, tariffRet:0, cash:0, retCount:0, barcode:0, digital:0, etc:0, pass:0, paidTotal:0,
      violation: ntViol, revLossViol:0, exemption: ntExem, revLossExem:0,
      totalUnpaid: ntViol+ntExem, totalLoss:0,
      totalTraffic: ntViol+ntExem, lossPercent:0, totalRevenue:0,
    });

    // ── Cross-file traffic reconciliation check ──────────────────────────────
    // Grand total from Traffic Count (VM colTotal is a superset-of-paid check;
    // actual TC grand total = sum of all vm.colTotal entries for tollable classes
    // plus pass traffic from both matrices — i.e. everything that passed through
    // a booth and was recorded in the matrices).
    // Formula: violation + exemption + paidTotal (per key) should equal
    //          vm.colTotal[key] + em.colTotal[key] for each tollable class.
    // At the aggregate level: sum(vm.colTotal) + sum(em.colTotal)  vs
    //                          sum(violation) + sum(exemption) + sum(paidTotal)
    const matricesTotalVehicles = AUDIT_KEYS.reduce((s, k) =>
      s + (vm.colTotal[k]||0) + (em.colTotal[k]||0), 0);
    const auditTotalVehicles = rows.reduce((s, r) => {
      if (r.key === 'nt') return s;
      return s + r.violation + r.exemption + r.paidTotal;
    }, 0);
    const trafficDiff = Math.abs(matricesTotalVehicles - auditTotalVehicles);
    const TRAFFIC_TOLERANCE = 5;
    if (matricesTotalVehicles > 0 && trafficDiff > TRAFFIC_TOLERANCE) {
      anomalies.push(
        `Traffic count mismatch: Violation+Exemption+Paid totals (${auditTotalVehicles}) differ from ` +
        `matrix grand totals (${matricesTotalVehicles}) by ${trafficDiff} vehicles. ` +
        `Check for unmapped rows or double-counting.`
      );
    }

    // Merge NT from both matrices
    const ntCombined = {};
    ['ambulance','auto','bike','tractor','jcb','govt','police','forcefully'].forEach(k => {
      ntCombined[k] = { viol: vm.nt[k]||0, exem: em.nt[k]||0 };
    });

    // Total Collection Classwise (from CR revenue)
    const tcRows = AUDIT_KEYS.slice(0,5).map(key => {
      const c = cr[key] || emptyCR();
      return {
        label: { car:'Car', lcv:'LCV/Mini Bus', bus:'T/B 2 Axl', truck:'Truck', mav:'MAV 3-6 Axl' }[key] || key,
        cash: c.cashSingleRev, ret: c.cashReturnRev,
        digital: c.digSingleRev, etc: c.fastagRev,
        total: c.cashSingleRev + c.cashReturnRev + c.digSingleRev + c.fastagRev,
      };
    });

    return { rows, ntCombined, tcRows, anomalies };
  }

  /* ═══════════════ APPLY LEARNED RULES ═══════════════ */
  function applyLearnedRules(data, log) {
    Object.entries(learnedRules).forEach(([fieldKey, rule]) => {
      // fieldKey format: "rowKey_fieldName"  e.g. "car_barcode"
      const [rowKey, field] = fieldKey.split('_');
      const row = data.rows.find(r => r.key === rowKey);
      if (row && field && rule.value !== undefined) {
        row[field] = rule.value;
        row['_corrected_' + field] = true;
        // Always surface applied overrides in the run log so users know
        // a stored rule is silently changing a number.
        const date = new Date(rule.timestamp).toLocaleDateString('en-IN');
        addLog(log,
          `🧠 Applied learned rule: ${rule.label} = ${rule.value}` +
          (rule.reason ? ` (reason: "${rule.reason}")` : '') +
          ` [saved ${date}]`,
          'warn'
        );
      }
    });
  }

  /* ═══════════════ RENDER PREVIEW ═══════════════ */
  function renderPreview(data) {
    renderMainTable(data.rows);
    renderNTTable(data.ntCombined);
    renderTCTable(data.tcRows);
    renderSummary(data.rows);
    renderAnomalies(data.anomalies);
  }

  function renderMainTable(rows) {
    const tbody = document.getElementById('agentMainTbody');
    const tfoot = document.getElementById('agentMainTfoot');
    const T = { cash:0,retCount:0,barcode:0,digital:0,etc:0,pass:0,paidTotal:0,
                violation:0,revLossViol:0,exemption:0,revLossExem:0,
                totalUnpaid:0,totalLoss:0,totalTraffic:0 };

    tbody.innerHTML = rows.map(r => {
      const isNT = r.key === 'nt';
      if (!isNT) {
        T.cash+=r.cash; T.retCount+=r.retCount; T.barcode+=r.barcode;
        T.digital+=r.digital; T.etc+=r.etc; T.pass+=r.pass;
        T.paidTotal+=r.paidTotal; T.violation+=r.violation;
        T.revLossViol+=r.revLossViol; T.exemption+=r.exemption;
        T.revLossExem+=r.revLossExem; T.totalUnpaid+=r.totalUnpaid;
        T.totalLoss+=r.totalLoss; T.totalTraffic+=r.totalTraffic;
      } else {
        T.violation+=r.violation; T.exemption+=r.exemption;
        T.totalUnpaid+=r.totalUnpaid; T.totalTraffic+=r.totalTraffic;
      }

      const lp   = isNT ? '-' : r.lossPercent + '%';
      const lCol = !isNT && r.lossPercent > 30 ? '#dc2626' : '#16a34a';

      const cell = (val, field) => {
        const corrected = r['_corrected_' + field] ? ' agent-cell-corrected' : '';
        return `<td class="agent-cell${corrected}" data-row="${r.key}" data-field="${field}"
                    title="Click ✏️ to correct">${val}
                  <span class="agent-cell-edit" onclick="agentEditCell('${r.key}','${field}',${val})">✏️</span>
                </td>`;
      };

      return `<tr>
        <td class="cls-name">${r.label}</td>
        <td>${r.single}</td><td>${r.tariffRet}</td>
        ${cell(r.cash,'cash')}${cell(r.retCount,'retCount')}${cell(r.barcode,'barcode')}
        ${cell(r.digital,'digital')}${cell(r.etc,'etc')}${cell(r.pass,'pass')}
        <td><strong>${r.paidTotal}</strong></td>
        ${cell(r.violation,'violation')}
        <td>${fmt(r.revLossViol)}</td>
        ${cell(r.exemption,'exemption')}
        <td>${fmt(r.revLossExem)}</td>
        <td style="background:#fef08a;font-weight:800;">${fmt(r.totalLoss)}</td>
        <td><strong>${r.totalTraffic}</strong></td>
        <td style="font-weight:800;color:${lCol}">${lp}</td>
      </tr>`;
    }).join('');

    tfoot.innerHTML = `<tr>
      <td class="cls-name">Total</td><td></td><td></td>
      <td>${T.cash}</td><td>${T.retCount}</td><td>${T.barcode}</td>
      <td>${T.digital}</td><td>${T.etc}</td><td>${T.pass}</td><td>${T.paidTotal}</td>
      <td>${T.violation}</td><td>${fmt(T.revLossViol)}</td>
      <td>${T.exemption}</td><td>${fmt(T.revLossExem)}</td>
      <td>${fmt(T.totalLoss)}</td><td>${T.totalTraffic}</td><td>-</td>
    </tr>`;
  }

  function renderNTTable(ntCombined) {
    const tbody = document.getElementById('agentNTTbody');
    const tfoot = document.getElementById('agentNTTfoot');
    const order = ['ambulance','auto','bike','tractor','jcb','govt','police','forcefully'];
    const labels = { ambulance:'Ambulance', auto:'Auto', bike:'Bike', tractor:'Tractor',
                     jcb:'JCB', govt:'Govt', police:'Police', forcefully:'Forcefully' };
    let tv=0,te=0,tt=0;
    tbody.innerHTML = order.map(k => {
      const v = ntCombined[k]?.viol||0, e2 = ntCombined[k]?.exem||0, t = v+e2;
      tv+=v; te+=e2; tt+=t;
      return `<tr><td class="cls-name">${labels[k]}</td><td>${v}</td><td>${e2}</td><td><strong>${t}</strong></td></tr>`;
    }).join('');
    tfoot.innerHTML = `<tr><td class="cls-name">Total</td><td>${tv}</td><td>${te}</td><td>${tt}</td></tr>`;
  }

  function renderTCTable(tcRows) {
    const tbody = document.getElementById('agentTCTbody');
    const tfoot = document.getElementById('agentTCTfoot');
    let tc=0,tr2=0,td2=0,te=0,tt=0;
    tbody.innerHTML = tcRows.map(r => {
      tc+=r.cash; tr2+=r.ret; td2+=r.digital; te+=r.etc; tt+=r.total;
      return `<tr><td class="cls-name">${r.label}</td>
        <td>${fmt(r.cash)}</td><td>${fmt(r.ret)}</td>
        <td>${fmt(r.digital)}</td><td>${fmt(r.etc)}</td>
        <td><strong>${fmt(r.total)}</strong></td></tr>`;
    }).join('');
    tfoot.innerHTML = `<tr><td class="cls-name">Total</td>
      <td>${fmt(tc)}</td><td>${fmt(tr2)}</td><td>${fmt(td2)}</td>
      <td>${fmt(te)}</td><td>${fmt(tt)}</td></tr>`;
  }

  function renderSummary(rows) {
    const bar = document.getElementById('agentSummaryBar');
    const tt  = rows.reduce((s,r)=>s+r.totalTraffic,0);
    const tp  = rows.reduce((s,r)=>s+r.paidTotal,0);
    const tv  = rows.reduce((s,r)=>s+r.violation,0);
    const tl  = rows.reduce((s,r)=>s+r.totalLoss,0);
    const lp  = tt>0?Math.round((tv/tt)*100):0;
    const rulesCount = Object.keys(learnedRules).length;
    bar.innerHTML = `
      <span class="agent-chip"><i class="bi bi-car-front-fill"></i> Total Traffic: ${tt}</span>
      <span class="agent-chip"><i class="bi bi-cash"></i> Paid: ${tp}</span>
      <span class="agent-chip ${lp>30?'red':'warn'}"><i class="bi bi-exclamation-triangle-fill"></i> Violations: ${tv}</span>
      <span class="agent-chip ${lp>30?'red':'warn'}"><i class="bi bi-graph-down-arrow"></i> Loss: ₹${fmt(tl)}</span>
      ${rulesCount>0?`<span class="agent-chip" style="background:#f0f9ff;border-color:#bae6fd;color:#0c4a6e"><i class="bi bi-brain"></i> ${rulesCount} rules learned</span>`:''}
    `;
  }

  function renderAnomalies(anomalies) {
    const box  = document.getElementById('agentAnomalyBox');
    const list = document.getElementById('agentAnomalyList');
    if (!anomalies || anomalies.length === 0) { box.style.display='none'; return; }
    box.style.display = 'block';
    list.innerHTML = anomalies.map(a=>`<li>${a}</li>`).join('');
  }

  /* ═══════════════ CORRECT & LEARN ═══════════════ */
  window.agentEditCell = function(rowKey, field, currentVal) {
    const overlay = document.getElementById('agentEditOverlay');
    document.getElementById('agentEditRowKey').value   = rowKey;
    document.getElementById('agentEditField').value    = field;
    document.getElementById('agentEditOldVal').textContent = currentVal;
    document.getElementById('agentEditNewVal').value   = currentVal;
    document.getElementById('agentEditReason').value   = '';
    document.getElementById('agentEditTitle').textContent =
      `Correct: ${AUDIT_LABELS[rowKey]||rowKey} → ${fieldLabel(field)}`;
    overlay.style.display = 'flex';
    document.getElementById('agentEditNewVal').focus();
  };

  safeOnLazy('agentEditSave', 'click', function() {
    const rowKey  = document.getElementById('agentEditRowKey').value;
    const field   = document.getElementById('agentEditField').value;
    const newVal  = parseFloat(document.getElementById('agentEditNewVal').value);
    const reason  = document.getElementById('agentEditReason').value.trim();

    if (isNaN(newVal)) { alert('Please enter a valid number.'); return; }

    // Save rule
    const ruleKey = rowKey + '_' + field;
    learnedRules[ruleKey] = { value: newVal, reason, timestamp: Date.now(),
                               label: `${AUDIT_LABELS[rowKey]||rowKey} → ${fieldLabel(field)}` };
    saveRulesToStorage();

    // Apply immediately to result
    if (result) {
      const row = result.rows.find(r => r.key === rowKey);
      if (row) {
        row[field] = newVal;
        row['_corrected_' + field] = true;
        recalcRow(row);
        renderPreview(result);
      }
    }

    document.getElementById('agentEditOverlay').style.display = 'none';
    showToastMsg(`✅ Corrected & saved! Agent will remember this.`);
  });

  safeOnLazy('agentEditCancel','click', () => {
    document.getElementById('agentEditOverlay').style.display = 'none';
  });

  function recalcRow(r) {
    r.paidTotal   = r.cash + r.retCount + r.barcode + r.digital + r.etc + r.pass;
    const tf      = getTariff(r.key);
    r.revLossViol = r.violation * tf.single;
    r.revLossExem = r.exemption * tf.single;
    r.totalUnpaid = r.violation + r.exemption;
    r.totalLoss   = r.revLossViol + r.revLossExem;
    r.totalTraffic = r.paidTotal + r.totalUnpaid;
    r.lossPercent  = r.totalTraffic > 0 ? Math.round((r.totalUnpaid/r.totalTraffic)*100) : 0;
  }

  /* ═══════════════ RULES PANEL ═══════════════ */
  function openRulesPanel() {
    renderRulesPanel();
    show('agentRulesPanel');
  }
  function closeRulesPanel() { hide('agentRulesPanel'); }

  function renderRulesPanel() {
    const list = document.getElementById('agentRulesList');
    const keys = Object.keys(learnedRules);
    if (!keys.length) {
      list.innerHTML = '<div class="agent-rules-empty"><i class="bi bi-robot"></i><p>No rules learned yet.<br>Correct cells in the preview and the agent will learn.</p></div>';
      return;
    }
    // Build items using DOM manipulation so user-supplied text (r.reason, r.label)
    // is set via textContent and never interpreted as HTML — prevents self-XSS.
    const fragment = document.createDocumentFragment();
    keys.forEach(k => {
      const r    = learnedRules[k];
      const date = new Date(r.timestamp).toLocaleDateString('en-IN');

      const item = document.createElement('div');
      item.className = 'agent-rule-item';

      const lbl = document.createElement('div');
      lbl.className = 'agent-rule-label';
      lbl.innerHTML = '<i class="bi bi-check-circle-fill" style="color:#16a34a"></i> ';
      lbl.appendChild(document.createTextNode(r.label));

      const val = document.createElement('div');
      val.className = 'agent-rule-val';
      val.innerHTML = 'Corrected value: <strong></strong>';
      val.querySelector('strong').textContent = r.value;

      const meta = document.createElement('div');
      meta.className = 'agent-rule-meta';
      meta.textContent = date;

      const btn = document.createElement('button');
      btn.className = 'agent-rule-del';
      btn.innerHTML = '<i class="bi bi-trash"></i>';
      btn.addEventListener('click', () => window.agentDeleteRule(k));

      item.appendChild(lbl);
      item.appendChild(val);

      if (r.reason) {
        const reason = document.createElement('div');
        reason.className = 'agent-rule-reason';
        reason.textContent = '\u201c' + r.reason + '\u201d';  // " … " via textContent
        item.appendChild(reason);
      }

      item.appendChild(meta);
      item.appendChild(btn);
      fragment.appendChild(item);
    });
    list.innerHTML = '';
    list.appendChild(fragment);
  }

  window.agentDeleteRule = function(key) {
    delete learnedRules[key];
    saveRulesToStorage();
    renderRulesPanel();
    showToastMsg('Rule deleted.');
  };

  function clearAllRules() {
    if (!confirm('Delete ALL learned rules? This cannot be undone.')) return;
    learnedRules = {};
    saveRulesToStorage();
    renderRulesPanel();
    showToastMsg('All rules cleared.');
  }

  /* ═══════════════ RULES STORAGE ═══════════════ */
  function saveRulesToStorage() {
    try {
      localStorage.setItem('agentLearnedRules', JSON.stringify(learnedRules));
      // Also save to Firebase if available
      if (typeof fbDb !== 'undefined' && typeof fbCurrentUid !== 'undefined' && fbCurrentUid) {
        fbDb.collection('agentRules').doc(fbCurrentUid)
          .set({ rules: learnedRules, updated: Date.now() })
          .catch(e => console.warn('Agent rules Firebase save:', e));
      }
    } catch(e) { console.warn('Rules save error:', e); }
  }

  function loadRulesFromStorage() {
    try {
      const stored = localStorage.getItem('agentLearnedRules');
      if (stored) learnedRules = JSON.parse(stored);
    } catch(e) { learnedRules = {}; }

    // Also try Firebase
    if (typeof fbDb !== 'undefined' && typeof fbCurrentUid !== 'undefined' && fbCurrentUid) {
      fbDb.collection('agentRules').doc(fbCurrentUid).get()
        .then(doc => {
          if (doc.exists && doc.data().rules) {
            learnedRules = { ...learnedRules, ...doc.data().rules };
            localStorage.setItem('agentLearnedRules', JSON.stringify(learnedRules));
          }
        }).catch(() => {});
    }
  }

  /* ═══════════════ DOWNLOAD ═══════════════ */
  function downloadTemplate() {
    if (!result) return;
    const wb = XLSX.utils.book_new();

    // Sheet 1: Main Audit Table
    const hdr1 = [['Class','Tariff (Single)','Tariff (Return)',
                    'Cash','Return','Barcode','Digital','ETC','Pass','Total Traffic (Paid)',
                    'Violation','Revenue Loss','Exemption','Revenue Loss (Exempt)',
                    'Total Unpaid','Total Loss','Total Traffic','Loss in %']];
    const data1 = result.rows.map(r => [
      r.label, r.single, r.tariffRet,           // ← tariff prices, not traffic counts
      r.cash, r.retCount, r.barcode, r.digital, r.etc, r.pass, r.paidTotal,
      r.violation, r.revLossViol, r.exemption, r.revLossExem,
      r.totalUnpaid, r.totalLoss, r.totalTraffic,
      r.key==='nt'?'-':(r.lossPercent+'%'),
    ]);
    const ws1 = XLSX.utils.aoa_to_sheet([...hdr1, ...data1]);
    ws1['!cols'] = [{ wch:15 }, ...Array(17).fill({ wch:12 })];
    XLSX.utils.book_append_sheet(wb, ws1, 'Audit Template');

    // Sheet 2: Non-Tollable
    const nt = result.ntCombined;
    const order = ['ambulance','auto','bike','tractor','jcb','govt','police','forcefully'];
    const lbs   = { ambulance:'Ambulance', auto:'Auto', bike:'Bike', tractor:'Tractor',
                    jcb:'JCB', govt:'Govt', police:'Police', forcefully:'Forcefully' };
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['Non-Tollable Exemption & Violation'],
      ['Category','Violation','Exemption','Total'],
      ...order.map(k => [lbs[k], nt[k]?.viol||0, nt[k]?.exem||0, (nt[k]?.viol||0)+(nt[k]?.exem||0)]),
    ]);
    XLSX.utils.book_append_sheet(wb, ws2, 'Non-Tollable');

    // Sheet 3: Total Collection
    const ws3 = XLSX.utils.aoa_to_sheet([
      ['Total Collection Classwise'],
      ['Class','Cash','Return','Digital','ETC','Total Traffic'],
      ...result.tcRows.map(r => [r.label, r.cash, r.ret, r.digital, r.etc, r.total]),
    ]);
    XLSX.utils.book_append_sheet(wb, ws3, 'Total Collection');

    const today = new Date().toISOString().slice(0,10);
    XLSX.writeFile(wb, `Audit_Template_${today}.xlsx`);
    addLog(document.getElementById('agentLog'), `📥 Downloaded: Audit_Template_${today}.xlsx`, 'ok');
  }

  /* ═══════════════ RESET ═══════════════ */
  function resetAgent() {
    files = { cr:null, tc:null, vm:null, em:null };
    result = null;
    tariffs = DEFAULT_TARIFFS.map(t=>({...t}));

    ['CR','TC','VM','EM'].forEach(t => {
      const id = t.toLowerCase();
      const card = document.getElementById(`agent${t}Card`);
      if (card) card.classList.remove('ready');
      setText(`agent${t}FileName`, 'No file chosen');
      setText(`agent${t}Status`, '');
      setClass(`agent${t}Status`, 'agent-file-status');
      const inp = document.getElementById(`agent${t}Input`);
      if (inp) inp.value = '';
    });

    ['agentTariffSection','agentProcessSection','agentPreviewSection'].forEach(hide);
    document.getElementById('agentLog').innerHTML = '';
    document.getElementById('agentProgress').style.display = 'none';
    document.getElementById('agentProgressBar').style.width = '0%';
    document.getElementById('agentRunBtn').disabled = false;
    document.getElementById('agentAnomalyBox').style.display = 'none';
    document.getElementById('agentSummaryBar').innerHTML = '';
    renderTariffGrid();
    setFooterNote('');
  }

  /* ═══════════════ HELPERS ═══════════════ */
  function n(v)    { const x=parseFloat(v); return isNaN(x)?0:x; }
  function fmt(v)  { return Number(v).toLocaleString('en-IN'); }
  function show(id){ const e=document.getElementById(id); if(e) e.style.display=''; }
  function hide(id){ const e=document.getElementById(id); if(e) e.style.display='none'; }
  function setText(id,t){ const e=document.getElementById(id); if(e) e.textContent=t; }
  function setClass(id,c){ const e=document.getElementById(id); if(e) e.className=c; }
  function setProgress(bar,p){ if(bar) bar.style.width=p+'%'; }
  function setFooterNote(t){ setText('agentFooterNote',t); }
  function addLog(el,msg,cls){ if(!el)return; const d=document.createElement('div'); d.className=cls?'log-'+cls:''; d.textContent=msg; el.appendChild(d); }
  function fieldLabel(f){ return {cash:'Cash',retCount:'Return',barcode:'Barcode',digital:'Digital',etc:'ETC',pass:'Pass',violation:'Violation',exemption:'Exemption'}[f]||f; }
  function showToastMsg(msg) {
    if (typeof showToast === 'function') { showToast(msg); return; }
    const t=document.createElement('div');
    t.style.cssText='position:fixed;bottom:24px;right:24px;background:#16a34a;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2)';
    t.textContent=msg; document.body.appendChild(t);
    setTimeout(()=>t.remove(),3000);
  }

  // Lazy event binding for dynamically-added elements
  function safeOnLazy(id, evt, fn) {
    document.addEventListener(evt, e => {
      if (e.target && e.target.id === id) fn(e);
      if (e.target && e.target.closest && e.target.closest('#'+id)) fn(e);
    });
  }

})();
