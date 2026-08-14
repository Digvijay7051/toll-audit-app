/* ═══════════════════════════════════════════════════════════════
   AUDIT AGENT  —  agent.js  v3
   Redesigned as a modular, confidence-scored, step-tracked agent.

   MODULE LAYOUT (all inside the IIFE):
     AgentConfig   — constants, maps, tariff defaults
     AgentTrail    — structured audit trail (item 15)
     Parser        — per-file parsing with fuzzy matching + confidence (items 1,2,13)
     Reconciler    — buildAuditData + cross-checks (items 3,4,11)
     AnomalyDetector — anomaly helpers
     RulesEngine   — scoped learned rules (items 6,12)
     Pipeline      — step-tracked run orchestrator (items 7,9,14)
     Renderer      — all DOM rendering (items 5,19)
     Eval          — evaluation/accuracy hooks (item 18)
     Guardrails    — hard safety limits (item 17)

   ITEMS IMPLEMENTED:
     1  Fuzzy header matching + confidence score per column
     2  Unmapped label log (was partial — now with confidence)
     3  Cross-file traffic reconciliation check
     4  Negative-clamp anomaly (diagonal > colTotal)
     5  Every automated decision logged with reason + confidence
     6  Scoped rules — scope stored per rule, consent UI on save
     7  Per-file error isolation — one bad file doesn't abort the run
     8  Firestore security (see firestore.rules) + DOM XSS-safe
     9  Explicit sequential step pipeline, each independently retryable
    10  External AI classification hook (stubbed, pluggable via AgentConfig)
    11  Reflect-and-retry self-check pass after reconciliation
    12  Date-scoped state — rules keyed by auditDate
    13  Confidence scoring on every automated decision
    14  Autonomy modes: Suggest / Confirm / Auto
    15  Structured audit trail per run
    16  Parser / Reconciler / AnomalyDetector module split
    17  Hard guardrails — no overwrite without backup, UID ownership
    18  Evaluation hooks — sample-run accuracy reporter
    19  Log verbosity toggle — Summary / Detailed
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     MODULE 1 — AgentConfig
     All constants, lookup maps, defaults.  Nothing mutable here.
  ══════════════════════════════════════════════════════════════ */
  const AgentConfig = (() => {
    const DEFAULT_TARIFFS = [
      { key: 'car',   label: 'Car',          single: 85,  tariffRet: 130 },
      { key: 'lcv',   label: 'LCV/Mini Bus',  single: 130, tariffRet: 195 },
      { key: 'bus',   label: 'Bus',           single: 255, tariffRet: 385 },
      { key: 'truck', label: 'Truck',         single: 255, tariffRet: 385 },
      { key: 'mav',   label: 'MAV 3-6 Axl',  single: 415, tariffRet: 625 },
      { key: 'osv',   label: 'OSV',           single: 510, tariffRet: 770 },
    ];

    /* Canonical vehicle-class label → audit key.
       Keys are stored UPPER-CASE; values are the internal audit key. */
    const CR_MAP = {
      'CAR':'car','LCV':'lcv','MINI BUS':'lcv','MINIBUS':'lcv',
      'BUS 2 AXLE':'bus','BUS 2AXLE':'bus','BUS':'bus',
      'TRUCK 2 AXLE':'truck','TRUCK 2AXLE':'truck',
      'TRUCK 3 AXLE':'mav','TRUCK 3AXLE':'mav',
      'MAV 4 AXLE':'mav','MAV 4AXLE':'mav',
      'MAV 5 AXLE':'mav','MAV 5AXLE':'mav',
      'MAV 6 AXLE':'mav','MAV 6AXLE':'mav',
      'MAV':'mav','OSV':'osv','OVERSIZED':'osv',
    };
    const TC_COL_MAP = {
      'CAR':'car','LCV':'lcv','MINI BUS':'lcv','MINIBUS':'lcv',
      'TRUCK 2 AXLE':'truck','TRUCK 2AXLE':'truck','TRUCK':'truck',
      'TRUCK 3 AXLE':'mav','TRUCK 3AXLE':'mav',
      'MAV 4 AXLE':'mav','MAV 4AXLE':'mav','MAV 4 -6 AXLE':'mav',
      'MAV 5 AXLE':'mav','MAV 5AXLE':'mav',
      'MAV 6 AXLE':'mav','MAV 6AXLE':'mav',
      'BUS 2 AXLE':'bus','BUS 2AXLE':'bus','BUS':'bus','OSV':'osv',
    };
    const VM_DIAG_MAP = {
      'CAR':'car','LCV/MINIBUS':'lcv','LCV':'lcv',
      'MINI BUS':'lcv','MINIBUS':'lcv',
      'TRUCK 2 AXLE':'truck','TRUCK 2AXLE':'truck',
      'TRUCK 3 AXLE':'mav','TRUCK 3AXLE':'mav',
      'MAV 4 - 6 AXLE':'mav','MAV 4-6 AXLE':'mav','MAV 4 -6 AXLE':'mav',
      'MAV':'mav','BUS 2 AXLE':'bus','BUS 2AXLE':'bus','BUS':'bus','OSV':'osv',
    };
    const NT_KEY_MAP = {
      'AUTO':'auto','BIKE':'bike','TRACTOR':'tractor',
      'AMBULANCE':'ambulance','JCB':'jcb',
      'GOVT. VEHICLE':'govt','GOVT VEHICLE':'govt','GOVT':'govt',
      'POLICE':'police','FORCEFULLY':'forcefully',
      'CONCESSIONAIRE':'concessionaire','FAKE TRANSACTION':'fake',
      'PASS MONTHLY/LOCAL':'pass','PASS MONTHLY':'pass','PASS':'pass',
      'ALREADY PAID FOUND WITH ANOTHER TXN':'alreadypaid','ALREADY PAID':'alreadypaid',
    };

    const AUDIT_KEYS   = ['car','lcv','bus','truck','mav','osv'];
    const AUDIT_LABELS = { car:'Car', lcv:'LCV/Mini Bus', bus:'Bus', truck:'Truck', mav:'MAV 3-6 Axl', osv:'OSV' };

    /* Confidence threshold below which a column mapping is flagged
       and (in Confirm/Suggest mode) must be approved before proceeding. */
    const CONFIDENCE_THRESHOLD = 0.55;
    const TRAFFIC_TOLERANCE    = 5;      // vehicles

    /* External AI classification hook — replace with real API call if desired.
       Signature: async (label: string) => { key: string|null, confidence: number }
       Item 10: stub returns null so the pipeline falls through to unmapped logging. */
    const aiClassifyLabel = null;   // set to async fn to enable

    /* Autonomy mode: 'suggest' | 'confirm' | 'auto'
       Loaded from localStorage; default 'confirm'. */
    const AUTONOMY_STORAGE_KEY = 'agentAutonomyMode';

    return {
      DEFAULT_TARIFFS, CR_MAP, TC_COL_MAP, VM_DIAG_MAP, NT_KEY_MAP,
      AUDIT_KEYS, AUDIT_LABELS,
      CONFIDENCE_THRESHOLD, TRAFFIC_TOLERANCE,
      aiClassifyLabel, AUTONOMY_STORAGE_KEY,
    };
  })();


  /* ══════════════════════════════════════════════════════════════
     MODULE 2 — AgentTrail  (item 15)
     Structured, queryable audit trail.  One Trail per run.
     Each entry: { ts, step, decision, reason, confidence, detail }
  ══════════════════════════════════════════════════════════════ */
  const AgentTrail = (() => {
    let _entries = [];

    function record(step, decision, reason, confidence, detail) {
      _entries.push({
        ts:         new Date().toISOString(),
        step,
        decision,
        reason:     reason   || '',
        confidence: confidence != null ? +confidence.toFixed(2) : null,
        detail:     detail   || null,
      });
    }

    function reset()   { _entries = []; }
    function all()     { return [..._entries]; }
    function asJSON()  { return JSON.stringify(_entries, null, 2); }

    /* Filtered convenience accessors */
    function warnings() { return _entries.filter(e => e.confidence != null && e.confidence < 0.7); }
    function byStep(s)  { return _entries.filter(e => e.step === s); }

    return { record, reset, all, asJSON, warnings, byStep };
  })();

  /* ══════════════════════════════════════════════════════════════
     MODULE 3 — Fuzzy utilities  (items 1, 13)
     Levenshtein-based similarity + map-lookup with confidence.
  ══════════════════════════════════════════════════════════════ */
  const Fuzzy = (() => {
    /* Levenshtein distance (O(mn), fine for short header strings) */
    function lev(a, b) {
      const m = a.length, n = b.length;
      const dp = Array.from({length: m+1}, (_, i) => [i]);
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
          dp[i][j] = a[i-1] === b[j-1]
            ? dp[i-1][j-1]
            : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      return dp[m][n];
    }

    /* Similarity in [0,1]: 1 = identical */
    function sim(a, b) {
      if (!a && !b) return 1;
      if (!a || !b) return 0;
      const dist = lev(a.toUpperCase(), b.toUpperCase());
      return 1 - dist / Math.max(a.length, b.length);
    }

    /* Look up a label in a map; try exact first, then fuzzy.
       Returns { key, confidence } — confidence 1.0 for exact,
       partial for fuzzy, 0 for no match. */
    function lookupInMap(label, map) {
      const up = label.toUpperCase().trim();
      if (map[up]) return { key: map[up], confidence: 1.0 };

      let best = { key: null, confidence: 0 };
      for (const [canonical, key] of Object.entries(map)) {
        const s = sim(up, canonical);
        if (s > best.confidence) best = { key, confidence: s };
      }
      return best;
    }

    return { lev, sim, lookupInMap };
  })();

  /* ══════════════════════════════════════════════════════════════
     MODULE 4 — Parser  (items 1, 2, 5, 7, 13)
     All file parsing.  Each parser:
       • returns { data, unmappedRows, colConfidences, errors }
       • never throws — errors go into the errors array (item 7)
       • logs every fuzzy match via AgentTrail (items 5, 13)
  ══════════════════════════════════════════════════════════════ */
  const Parser = (() => {
    const { CR_MAP, TC_COL_MAP, VM_DIAG_MAP, NT_KEY_MAP,
            CONFIDENCE_THRESHOLD } = AgentConfig;

    /* ── helpers ── */
    function n(v)      { const x = parseFloat(v); return isNaN(x) ? 0 : x; }
    function emptyCR() {
      return {
        cashSingle:0, cashReturn:0, digSingle:0, digReturn:0, fastag:0,
        cashSingleRev:0, cashReturnRev:0, digSingleRev:0, digReturnRev:0, fastagRev:0,
      };
    }

    /* Classify a row label against a given map with fuzzy fallback.
       Also attempts external AI hook if configured and confidence < threshold. */
    async function classifyLabel(rawLabel, map, fileTag) {
      const res = Fuzzy.lookupInMap(rawLabel, map);
      if (res.confidence < CONFIDENCE_THRESHOLD && AgentConfig.aiClassifyLabel) {
        /* Item 10 — AI hook */
        try {
          const aiResult = await AgentConfig.aiClassifyLabel(rawLabel);
          if (aiResult && aiResult.key) {
            AgentTrail.record(fileTag, `AI classified "${rawLabel}" → ${aiResult.key}`,
              'External AI classifier', aiResult.confidence, { rawLabel });
            return { key: aiResult.key, confidence: aiResult.confidence, source: 'ai' };
          }
        } catch (_) { /* AI unavailable — fall through */ }
      }
      if (res.confidence > 0) {
        const isFuzzy = res.confidence < 1.0;
        AgentTrail.record(
          fileTag,
          `${isFuzzy ? 'Fuzzy' : 'Exact'} match: "${rawLabel}" → ${res.key}`,
          isFuzzy ? `Levenshtein similarity ${(res.confidence * 100).toFixed(0)}%` : 'Exact map lookup',
          res.confidence,
          { rawLabel, mappedKey: res.key }
        );
      }
      return { key: res.confidence >= CONFIDENCE_THRESHOLD ? res.key : null,
               confidence: res.confidence, source: 'map' };
    }

    /* ── CRCols detection with confidence ── */
    function detectCRCols(rows, subHdr, grpHdr) {
      const cols = { cashSingle:-1, cashReturn:-1, digSingle:-1, digReturn:-1, fastag:-1 };
      const confidences = {};
      const sub = rows[subHdr].map(c => String(c||'').toUpperCase());

      let curGroup = '';
      grpHdr.forEach((cell, ci) => {
        let matched = false;
        if (cell.includes('SINGLE') && cell.includes('CASH'))         { curGroup = 'cashSingle'; matched = true; }
        else if (cell.includes('SINGLE') && cell.includes('DIGITAL')) { curGroup = 'digSingle';  matched = true; }
        else if (cell.includes('RETURN') && cell.includes('CASH'))    { curGroup = 'cashReturn'; matched = true; }
        else if (cell.includes('RETURN') && cell.includes('DIGITAL')) { curGroup = 'digReturn';  matched = true; }
        else if (cell.includes('FASTAG') || cell.includes('ETC'))     { curGroup = 'fastag';     matched = true; }

        if (sub[ci] === 'TOTAL' && curGroup && cols[curGroup] === -1) {
          cols[curGroup] = ci;
          confidences[curGroup] = matched ? 1.0 : 0.6;
        }
      });

      /* Fallback positional assignment */
      if (cols.cashSingle === -1) {
        const totals = [];
        sub.forEach((c, i) => { if (c === 'TOTAL') totals.push(i); });
        if (totals.length >= 5) {
          [cols.cashSingle, cols.digSingle, cols.cashReturn, cols.digReturn, cols.fastag] = totals;
          ['cashSingle','digSingle','cashReturn','digReturn','fastag'].forEach(k => {
            confidences[k] = 0.6;   // positional = lower confidence
          });
        } else if (totals.length >= 3) {
          cols.cashSingle = totals[0]; cols.cashReturn = totals[1];
          cols.fastag = totals[totals.length-1];
          if (totals.length > 3) cols.digSingle = totals[2];
          ['cashSingle','cashReturn','fastag','digSingle'].forEach(k => { confidences[k] = 0.5; });
        }
      }
      return { cols, confidences };
    }

    /* ── parseCR ── */
    async function parseCR(wb) {
      const errors = [], unmappedRows = [], colConfidences = {};
      const data = {};
      try {
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows  = XLSX.utils.sheet_to_json(sheet, { header:1, defval:0 });

        let subHdr = -1;
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
          const r = rows[i].map(c => String(c).toUpperCase());
          if (r.filter(c => c === 'TOTAL').length >= 3) { subHdr = i; break; }
        }
        if (subHdr === -1) {
          subHdr = 1;
          AgentTrail.record('parseCR', 'Sub-header not found — defaulting to row 1',
            'No row with 3+ TOTAL cells found in first 20 rows', 0.4, null);
        }

        const grpHdr = rows[Math.max(0, subHdr - 1)].map(c => String(c||'').toUpperCase());
        const { cols, confidences: cc } = detectCRCols(rows, subHdr, grpHdr);
        Object.assign(colConfidences, cc);

        /* Flag any column whose detection confidence is below threshold */
        Object.entries(cc).forEach(([col, conf]) => {
          if (conf < CONFIDENCE_THRESHOLD) {
            AgentTrail.record('parseCR',
              `Low-confidence column detection: ${col} (${(conf*100).toFixed(0)}%)`,
              'Positional fallback used; header labels not matched definitively', conf,
              { col, colIndex: cols[col] });
          }
        });

        for (let i = subHdr + 1; i < rows.length - 1; i++) {
          const row  = rows[i];
          const name = String(row[0]||'').trim().toUpperCase();
          if (!name || name === 'TOTAL') continue;

          /* Item 1+13: fuzzy lookup with confidence */
          const cls = await classifyLabel(name, CR_MAP, 'parseCR');
          if (!cls.key) {
            const msg = `CR: unmapped label "${name}" (best confidence: ${(cls.confidence*100).toFixed(0)}%) — row skipped`;
            unmappedRows.push(msg);
            AgentTrail.record('parseCR', `Unmapped label: "${name}"`,
              `Fuzzy score ${(cls.confidence*100).toFixed(0)}% below threshold ${CONFIDENCE_THRESHOLD*100}%`,
              cls.confidence, { rawLabel: name });
            continue;
          }

          if (!data[cls.key]) data[cls.key] = emptyCR();
          const revRow = rows[i+1];
          const isRevNext = revRow && (String(revRow[0]||'').trim() === '' || revRow[0] === 0);

          data[cls.key].cashSingle   += n(row[cols.cashSingle]);
          data[cls.key].cashReturn   += n(row[cols.cashReturn]);
          data[cls.key].digSingle    += n(row[cols.digSingle]);
          data[cls.key].digReturn    += n(row[cols.digReturn]);
          data[cls.key].fastag       += n(row[cols.fastag]);

          if (isRevNext) {
            data[cls.key].cashSingleRev += n(revRow[cols.cashSingle]);
            data[cls.key].cashReturnRev += n(revRow[cols.cashReturn]);
            data[cls.key].digSingleRev  += n(revRow[cols.digSingle]);
            data[cls.key].digReturnRev  += n(revRow[cols.digReturn]);
            data[cls.key].fastagRev     += n(revRow[cols.fastag]);
            i++;
          }
        }
      } catch (err) {
        /* Item 7: catch here so caller can proceed with other files */
        errors.push(`CR parse error: ${err.message}`);
        AgentTrail.record('parseCR', 'Fatal parse error', err.message, 0, { stack: err.stack });
      }
      return { data, unmappedRows, colConfidences, errors, emptyCR };
    }

    /* ── parseTC ── */
    async function parseTC(wb) {
      const errors = [], unmappedRows = [], colConfidences = {};
      const data = { barcode: { car:0, lcv:0, bus:0, truck:0, mav:0, osv:0 } };
      try {
        const sheet   = wb.Sheets[wb.SheetNames[0]];
        const rows    = XLSX.utils.sheet_to_json(sheet, { header:1, defval:0 });
        let hdrRow    = 0;
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
          const r = rows[i].map(c => String(c||'').toUpperCase());
          if (r.includes('MOP') || r.includes('CAR')) { hdrRow = i; break; }
        }
        const headers = rows[hdrRow].map(c => String(c||'').trim().toUpperCase());
        const colKeyMap = {};
        for (let ci = 0; ci < headers.length; ci++) {
          const cls = await classifyLabel(headers[ci], TC_COL_MAP, 'parseTC');
          if (cls.key) {
            colKeyMap[ci] = cls.key;
            colConfidences[`col_${ci}`] = cls.confidence;
          } else if (headers[ci] && headers[ci] !== 'MOP') {
            unmappedRows.push(`TC: unmapped column header "${headers[ci]}"`);
          }
        }
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
      } catch (err) {
        errors.push(`TC parse error: ${err.message}`);
        AgentTrail.record('parseTC', 'Fatal parse error', err.message, 0, null);
      }
      return { data, unmappedRows, colConfidences, errors };
    }

    /* ── parseMatrix ── */
    async function parseMatrix(wb, fileTag) {
      const errors = [], unmappedRows = [], colConfidences = {};
      const result = {
        colTotal:     { car:0, lcv:0, bus:0, truck:0, mav:0, osv:0 },
        diagonal:     { car:0, lcv:0, bus:0, truck:0, mav:0, osv:0 },
        passPerClass: { car:0, lcv:0, bus:0, truck:0, mav:0, osv:0 },
        nt:           { ambulance:0, auto:0, bike:0, tractor:0, jcb:0, govt:0, police:0, forcefully:0 },
      };
      try {
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows  = XLSX.utils.sheet_to_json(sheet, { header:1, defval:0 });
        let hdrRow  = 0;
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
          const r = rows[i].map(c => String(c||'').toUpperCase());
          if (r.includes('CAR') || r.some(c => c.includes('CLASS AS PER'))) { hdrRow = i; break; }
        }
        const headers = rows[hdrRow].map(c => String(c||'').trim().toUpperCase());
        const colKeyMap = {};
        for (let ci = 1; ci < headers.length; ci++) {
          const cls = await classifyLabel(headers[ci], {...VM_DIAG_MAP, ...TC_COL_MAP}, fileTag);
          if (cls.key) {
            colKeyMap[ci] = cls.key;
            colConfidences[`col_${ci}`] = cls.confidence;
          }
        }

        for (let i = hdrRow + 1; i < rows.length; i++) {
          const row = rows[i];
          const actualCls = String(row[0]||'').trim().toUpperCase();
          if (!actualCls) continue;

          if (actualCls === 'TOTAL') {
            Object.entries(colKeyMap).forEach(([ci, key]) => {
              result.colTotal[key] = (result.colTotal[key]||0) + n(row[ci]);
            });
            continue;
          }

          const diag = await classifyLabel(actualCls, VM_DIAG_MAP, fileTag);
          const nt   = Fuzzy.lookupInMap(actualCls, NT_KEY_MAP);

          if (!diag.key && nt.confidence < CONFIDENCE_THRESHOLD) {
            unmappedRows.push(`${fileTag}: unmapped label "${actualCls}" (confidence: ${(Math.max(diag.confidence, nt.confidence)*100).toFixed(0)}%) — row skipped`);
            AgentTrail.record(fileTag, `Unmapped label "${actualCls}"`,
              'Below threshold in both VM_DIAG_MAP and NT_KEY_MAP', Math.max(diag.confidence, nt.confidence),
              { rawLabel: actualCls });
            continue;
          }

          if (diag.key) {
            Object.entries(colKeyMap).forEach(([ci, key]) => {
              if (key === diag.key) result.diagonal[diag.key] = (result.diagonal[diag.key]||0) + n(row[ci]);
            });
          }

          const ntKey = nt.confidence >= CONFIDENCE_THRESHOLD ? nt.key : null;
          if (ntKey === 'pass') {
            Object.entries(colKeyMap).forEach(([ci, key]) => {
              result.passPerClass[key] = (result.passPerClass[key]||0) + n(row[ci]);
            });
            continue;
          }
          if (ntKey && result.nt.hasOwnProperty(ntKey)) {
            let rowTotal = 0;
            Object.keys(colKeyMap).forEach(ci => { rowTotal += n(row[ci]); });
            result.nt[ntKey] = (result.nt[ntKey]||0) + rowTotal;
          }
        }

        /* Fallback colTotal from rows if no explicit TOTAL row */
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
      } catch (err) {
        errors.push(`${fileTag} parse error: ${err.message}`);
        AgentTrail.record(fileTag, 'Fatal parse error', err.message, 0, null);
      }
      return { ...result, unmappedRows, colConfidences, errors };
    }

    return { parseCR, parseTC, parseMatrix, emptyCR, n };
  })();



  /* ══════════════════════════════════════════════════════════════
     MODULE 5 — Reconciler  (items 3, 4, 11)
     Builds the audit table, runs cross-checks, and does one
     reflect-and-retry self-check pass before returning.
  ══════════════════════════════════════════════════════════════ */
  const Reconciler = (() => {
    const { AUDIT_KEYS, AUDIT_LABELS, TRAFFIC_TOLERANCE } = AgentConfig;
    const n   = Parser.n;
    const fmt = v => Number(v).toLocaleString('en-IN');

    function getTariff(tariffs, key) {
      return tariffs.find(t => t.key === key) || { single:0, tariffRet:0 };
    }

    function buildAuditData(cr, tc, vm, em, tariffs) {
      const rows = [], anomalies = [];
      const emptyCR = Parser.emptyCR;

      AUDIT_KEYS.forEach(key => {
        const c  = cr[key] || emptyCR();
        const tf = getTariff(tariffs, key);

        const cash      = c.cashSingle;
        const retCount  = c.cashReturn + c.digReturn;
        const barcode   = tc.barcode[key] || 0;
        const digital   = c.digSingle;
        const etc       = c.fastag;
        const pass      = (vm.passPerClass[key]||0) + (em.passPerClass[key]||0);
        const paidTotal = cash + retCount + barcode + digital + etc + pass;

        /* Item 4 — flag negative clamp before it happens */
        const vmColTotal = vm.colTotal[key] || 0;
        const vmDiag     = vm.diagonal[key] || 0;
        if (vmDiag > vmColTotal) {
          const overshoot = vmDiag - vmColTotal;
          anomalies.push(`${AUDIT_LABELS[key]}: Violation Matrix diagonal (${vmDiag}) exceeds column total (${vmColTotal}) by ${overshoot} — likely column-detection error. Violation clamped to 0.`);
          AgentTrail.record('reconcile', `Negative clamp: ${AUDIT_LABELS[key]} VM diagonal > colTotal`,
            'Would have produced negative violation count', 0.0,
            { key, vmDiag, vmColTotal });
        }
        const violation   = Math.max(0, vmColTotal - vmDiag);
        const revLossViol = violation * tf.single;

        const emColTotal = em.colTotal[key] || 0;
        const emDiag     = em.diagonal[key] || 0;
        if (emDiag > emColTotal) {
          const overshoot = emDiag - emColTotal;
          anomalies.push(`${AUDIT_LABELS[key]}: Exemption Matrix diagonal (${emDiag}) exceeds column total (${emColTotal}) by ${overshoot} — likely column-detection error. Exemption clamped to 0.`);
          AgentTrail.record('reconcile', `Negative clamp: ${AUDIT_LABELS[key]} EM diagonal > colTotal`,
            'Would have produced negative exemption count', 0.0,
            { key, emDiag, emColTotal });
        }
        const exemption   = Math.max(0, emColTotal - emDiag);
        const revLossExem = exemption * tf.single;

        const totalUnpaid  = violation + exemption;
        const totalLoss    = revLossViol + revLossExem;
        const totalTraffic = paidTotal + totalUnpaid;
        const totalRevenue = (cash * tf.single) + (retCount * tf.tariffRet) +
                             (barcode * tf.tariffRet) + (digital * tf.single) + (etc * tf.single);
        const lossPercent  = totalTraffic > 0 ? Math.round((totalUnpaid / totalTraffic) * 100) : 0;

        /* Revenue mismatch check */
        const expectedCashRev = cash * tf.single;
        if (c.cashSingleRev > 0 && Math.abs(c.cashSingleRev - expectedCashRev) > 200) {
          anomalies.push(`${AUDIT_LABELS[key]}: Cash revenue mismatch — Expected ₹${fmt(expectedCashRev)}, Report shows ₹${fmt(c.cashSingleRev)}`);
        }

        rows.push({
          key, label: AUDIT_LABELS[key],
          single: tf.single, tariffRet: tf.tariffRet,
          cash, retCount, barcode, digital, etc, pass, paidTotal,
          violation, revLossViol, exemption, revLossExem,
          totalUnpaid, totalLoss, totalTraffic, lossPercent, totalRevenue,
        });
      });

      /* NT row */
      const ntViol = Object.values(vm.nt).reduce((a,b)=>a+b,0);
      const ntExem = Object.values(em.nt).reduce((a,b)=>a+b,0);
      rows.push({
        key:'nt', label:'Non-Tollable',
        single:0, tariffRet:0, cash:0, retCount:0, barcode:0, digital:0, etc:0, pass:0, paidTotal:0,
        violation:ntViol, revLossViol:0, exemption:ntExem, revLossExem:0,
        totalUnpaid:ntViol+ntExem, totalLoss:0,
        totalTraffic:ntViol+ntExem, lossPercent:0, totalRevenue:0,
      });

      /* Item 3 — cross-file traffic reconciliation */
      const matricesTotal = AUDIT_KEYS.reduce((s, k) => s + (vm.colTotal[k]||0) + (em.colTotal[k]||0), 0);
      const auditTotal    = rows.reduce((s, r) => r.key === 'nt' ? s : s + r.violation + r.exemption + r.paidTotal, 0);
      const diff          = Math.abs(matricesTotal - auditTotal);
      if (matricesTotal > 0 && diff > TRAFFIC_TOLERANCE) {
        anomalies.push(
          `Traffic count mismatch: Audit total (${auditTotal}) differs from matrix grand totals (${matricesTotal}) by ${diff} vehicles. ` +
          `Check for unmapped rows or double-counting.`
        );
        AgentTrail.record('reconcile', `Cross-file mismatch: ${diff} vehicles`,
          'Sum of VM+EM column totals ≠ sum of (paidTotal + violations + exemptions)',
          1 - Math.min(diff / Math.max(matricesTotal, 1), 1),
          { matricesTotal, auditTotal, diff });
      }

      /* NT combined */
      const ntCombined = {};
      ['ambulance','auto','bike','tractor','jcb','govt','police','forcefully'].forEach(k => {
        ntCombined[k] = { viol: vm.nt[k]||0, exem: em.nt[k]||0 };
      });

      /* TC revenue rows */
      const tcRows = AUDIT_KEYS.slice(0,5).map(key => {
        const c = cr[key] || Parser.emptyCR();
        return {
          label: { car:'Car', lcv:'LCV/Mini Bus', bus:'T/B 2 Axl', truck:'Truck', mav:'MAV 3-6 Axl' }[key] || key,
          cash: c.cashSingleRev, ret: c.cashReturnRev,
          digital: c.digSingleRev, etc: c.fastagRev,
          total: c.cashSingleRev + c.cashReturnRev + c.digSingleRev + c.fastagRev,
        };
      });

      return { rows, ntCombined, tcRows, anomalies };
    }

    /* Item 11 — one reflect-and-retry self-check pass */
    function selfCheck(result, tariffs) {
      let retried = false;
      result.rows.forEach(r => {
        if (r.key === 'nt') return;
        const expected = r.cash + r.retCount + r.barcode + r.digital + r.etc + r.pass;
        if (Math.abs(r.paidTotal - expected) > 1) {
          AgentTrail.record('selfCheck', `Row ${r.label}: paidTotal inconsistency — recalculating`,
            `Stored paidTotal=${r.paidTotal}, computed=${expected}`, 0.5,
            { key: r.key, stored: r.paidTotal, computed: expected });
          r.paidTotal    = expected;
          r.totalTraffic = r.paidTotal + r.totalUnpaid;
          r.lossPercent  = r.totalTraffic > 0 ? Math.round((r.totalUnpaid / r.totalTraffic) * 100) : 0;
          result.anomalies.push(`${r.label}: paidTotal was inconsistent — recomputed automatically.`);
          retried = true;
        }
      });
      return retried;
    }

    function recalcRow(r, tariffs) {
      r.paidTotal    = r.cash + r.retCount + r.barcode + r.digital + r.etc + r.pass;
      const tf       = tariffs.find(t => t.key === r.key) || { single:0, tariffRet:0 };
      r.revLossViol  = r.violation * tf.single;
      r.revLossExem  = r.exemption * tf.single;
      r.totalUnpaid  = r.violation + r.exemption;
      r.totalLoss    = r.revLossViol + r.revLossExem;
      r.totalTraffic = r.paidTotal + r.totalUnpaid;
      r.lossPercent  = r.totalTraffic > 0 ? Math.round((r.totalUnpaid / r.totalTraffic) * 100) : 0;
    }

    return { buildAuditData, selfCheck, recalcRow };
  })();

  /* ══════════════════════════════════════════════════════════════
     MODULE 6 — RulesEngine  (items 5, 6, 12)
     Scoped learned rules — each rule carries scope + auditDate.
     Keys: '__global__rowKey_field' | 'YYYY-MM-DD__rowKey_field'
  ══════════════════════════════════════════════════════════════ */
  const RulesEngine = (() => {
    const LS_KEY = 'agentLearnedRulesV3';
    const FB_COL = 'agentRules';
    let _rules   = {};

    function save() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(_rules));
        if (typeof fbDb !== 'undefined' && typeof fbCurrentUid !== 'undefined' && fbCurrentUid) {
          fbDb.collection(FB_COL).doc(fbCurrentUid)
            .set({ rules: _rules, updated: Date.now() })
            .catch(e => console.warn('RulesEngine Firebase save:', e));
        }
      } catch(e) { console.warn('RulesEngine save error:', e); }
    }

    function load() {
      try {
        const stored = localStorage.getItem(LS_KEY);
        if (stored) _rules = JSON.parse(stored);
        /* Migrate old v2 format */
        const oldStored = localStorage.getItem('agentLearnedRules');
        if (oldStored) {
          const old = JSON.parse(oldStored);
          Object.entries(old).forEach(([k, v]) => {
            const newKey = `__global__${k}`;
            if (!_rules[newKey]) _rules[newKey] = { ...v, scope:'all', auditDate:'__global__' };
          });
          save();
        }
      } catch(e) { _rules = {}; }
      if (typeof fbDb !== 'undefined' && typeof fbCurrentUid !== 'undefined' && fbCurrentUid) {
        fbDb.collection(FB_COL).doc(fbCurrentUid).get()
          .then(doc => {
            if (doc.exists && doc.data().rules) {
              _rules = { ..._rules, ...doc.data().rules };
              localStorage.setItem(LS_KEY, JSON.stringify(_rules));
            }
          }).catch(() => {});
      }
    }

    function applyToData(data, auditDate, log, forceShow) {
      Object.entries(_rules).forEach(([ruleKey, rule]) => {
        const isGlobal  = ruleKey.startsWith('__global__');
        const isForDate = rule.auditDate === auditDate;
        if (!isGlobal && !isForDate) return;

        const fieldKey = ruleKey.replace(/^__global__|^\d{4}-\d{2}-\d{2}__/, '');
        const sepIdx   = fieldKey.indexOf('_');
        if (sepIdx < 0) return;
        const rowKey = fieldKey.slice(0, sepIdx);
        const field  = fieldKey.slice(sepIdx + 1);
        const row    = data.rows.find(r => r.key === rowKey);
        if (!row || rule.value === undefined) return;

        row[field] = rule.value;
        row['_corrected_' + field] = true;

        const date      = new Date(rule.timestamp).toLocaleDateString('en-IN');
        const scopeHint = isGlobal ? 'global rule' : `scoped to ${rule.auditDate}`;
        addLogEl(log,
          `🧠 Applied learned rule (${scopeHint}): ${rule.label} = ${rule.value}` +
          (rule.reason ? ` — "${rule.reason}"` : '') + ` [saved ${date}]`,
          'warn', forceShow
        );
        AgentTrail.record('applyRules', `Applied: ${rule.label} = ${rule.value}`,
          scopeHint, 1.0, { ruleKey, scope: rule.scope });
      });
    }

    function addRule(rowKey, field, value, reason, label, auditDate, scope) {
      const prefix  = scope === 'all' ? '__global__' : `${auditDate}__`;
      const ruleKey = `${prefix}${rowKey}_${field}`;
      _rules[ruleKey] = { value, reason, timestamp: Date.now(), label, scope, auditDate };
      save();
      return ruleKey;
    }

    function deleteRule(key) { delete _rules[key]; save(); }
    function clearAll()      { _rules = {}; save(); }
    function all()           { return { ..._rules }; }

    return { save, load, applyToData, addRule, deleteRule, clearAll, all };
  })();

  /* ══════════════════════════════════════════════════════════════
     MODULE 7 — Guardrails  (item 17)
  ══════════════════════════════════════════════════════════════ */
  const Guardrails = (() => {
    function ownDoc(docUid) {
      if (typeof fbCurrentUid === 'undefined' || !fbCurrentUid) return false;
      return fbCurrentUid === docUid;
    }
    function requireBackupConsent(auditDate) {
      return window.confirm(
        `⚠️ Overwrite saved audit for ${auditDate}?\n\nMake sure you have downloaded the current Excel template first.\n\nClick OK only if you have a backup.`
      );
    }
    return { ownDoc, requireBackupConsent };
  })();

  /* ══════════════════════════════════════════════════════════════
     MODULE 8 — Eval  (item 18)
  ══════════════════════════════════════════════════════════════ */
  const Eval = (() => {
    let _lastReport = null;
    async function runSample(sampleFiles, expected, tariffs) {
      const crRaw = await Parser.parseCR(sampleFiles.cr);
      const tcRaw = await Parser.parseTC(sampleFiles.tc);
      const vmRaw = await Parser.parseMatrix(sampleFiles.vm, 'VM');
      const emRaw = await Parser.parseMatrix(sampleFiles.em, 'EM');
      const result = Reconciler.buildAuditData(crRaw.data, tcRaw.data, vmRaw, emRaw, tariffs);
      let correct = 0, wrong = 0;
      const details = expected.map(a => {
        const row    = result.rows.find(r => r.key === a.key);
        const actual = row ? row[a.field] : undefined;
        const pass   = actual === a.value;
        if (pass) correct++; else wrong++;
        return { ...a, actual, pass };
      });
      _lastReport = {
        timestamp: new Date().toISOString(), total: expected.length,
        correct, wrong, accuracy: expected.length > 0 ? correct / expected.length : 0,
        anomalies: result.anomalies, details,
      };
      console.table(details);
      console.log(`[Eval] Accuracy: ${(_lastReport.accuracy*100).toFixed(1)}%`);
      return _lastReport;
    }
    function lastReport() { return _lastReport; }
    return { runSample, lastReport };
  })();

  /* ══════════════════════════════════════════════════════════════
     GLOBAL MUTABLE STATE + HELPERS
  ══════════════════════════════════════════════════════════════ */
  let _files     = { cr:null, tc:null, vm:null, em:null };
  let _tariffs   = AgentConfig.DEFAULT_TARIFFS.map(t=>({...t}));
  let _result    = null;
  let _autonomy  = localStorage.getItem(AgentConfig.AUTONOMY_STORAGE_KEY) || 'confirm';
  let _verbosity = localStorage.getItem('agentVerbosity') || 'detail';
  let _auditDate = new Date().toISOString().slice(0,10);

  function addLogEl(el, msg, cls, forceShow) {
    if (!el) return;
    if (_verbosity === 'summary' && !forceShow && cls !== 'err' && cls !== 'ok') return;
    const d = document.createElement('div');
    d.className = cls ? 'log-' + cls : '';
    d.textContent = msg;
    el.appendChild(d);
  }

  function n(v)    { return Parser.n(v); }
  function fmt(v)  { return Number(v).toLocaleString('en-IN'); }
  function show(id){ const e=document.getElementById(id); if(e) e.style.display=''; }
  function hide(id){ const e=document.getElementById(id); if(e) e.style.display='none'; }
  function setText(id,t){ const e=document.getElementById(id); if(e) e.textContent=t; }
  function setClass(id,c){ const e=document.getElementById(id); if(e) e.className=c; }
  function setProgress(bar,p){ if(bar) bar.style.width=p+'%'; }
  function setFooterNote(t){ setText('agentFooterNote',t); }
  function fieldLabel(f){ return {cash:'Cash',retCount:'Return',barcode:'Barcode',digital:'Digital',etc:'ETC',pass:'Pass',violation:'Violation',exemption:'Exemption'}[f]||f; }
  function showToastMsg(msg) {
    if (typeof showToast === 'function') { showToast(msg); return; }
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#16a34a;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2)';
    t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
  function safeOn(id, evt, fn) { const el=document.getElementById(id); if(el) el.addEventListener(evt, fn); }
  function safeOnLazy(id, evt, fn) {
    document.addEventListener(evt, e => {
      if (e.target && e.target.id === id) fn(e);
      if (e.target && e.target.closest && e.target.closest('#'+id)) fn(e);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     STEP TRACKER UI  (item 9)
  ══════════════════════════════════════════════════════════════ */
  const STEPS = [
    { id:'parseCR',    label:'Revenue Report' },
    { id:'parseTC',    label:'Traffic Count'  },
    { id:'parseVM',    label:'Violation Matrix'},
    { id:'parseEM',    label:'Exemption Matrix'},
    { id:'reconcile',  label:'Reconcile'      },
    { id:'selfCheck',  label:'Self-check'     },
    { id:'applyRules', label:'Apply Rules'    },
    { id:'render',     label:'Render'         },
  ];
  function renderStepTracker(statusMap) {
    const el = document.getElementById('agentStepTracker');
    if (!el) return;
    el.innerHTML = '';
    STEPS.forEach(s => {
      const status = (statusMap && statusMap[s.id]) || 'pending';
      const icon   = status==='done'?'✅': status==='error'?'❌': status==='active'?'⏳':'○';
      const span   = document.createElement('span');
      span.className   = `agent-step agent-step-${status}`;
      span.textContent = `${icon} ${s.label}`;
      el.appendChild(span);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     MAIN RUN PIPELINE  (items 7, 9, 14)
  ══════════════════════════════════════════════════════════════ */
  async function runAgent() {
    if (!_files.cr || !_files.tc || !_files.vm || !_files.em) {
      alert('Please upload all 4 files first!'); return;
    }
    /* Sync audit date with the main app's selected date so that
       date-scoped learned rules always match the correct session. */
    if (typeof selectedAuditDate !== 'undefined' && selectedAuditDate) {
      _auditDate = selectedAuditDate;
    }
    readTariffsFromUI();
    AgentTrail.reset();

    const log  = document.getElementById('agentLog');
    const bar  = document.getElementById('agentProgressBar');
    const prog = document.getElementById('agentProgress');
    if (log)  log.innerHTML = '';
    if (prog) prog.style.display = 'block';
    setProgress(bar, 5);
    addLogEl(log, `▶ Agent starting — mode: ${_autonomy.toUpperCase()}, verbosity: ${_verbosity}`, 'ok', true);
    AgentTrail.record('init', `Run started in ${_autonomy} mode`, '', 1.0, { auditDate: _auditDate });

    const ss = {};
    STEPS.forEach(s => { ss[s.id] = 'pending'; });
    renderStepTracker(ss);

    let crData, tcData, vmData, emData;

    /* parseCR */
    ss['parseCR'] = 'active'; renderStepTracker(ss); setProgress(bar, 12);
    addLogEl(log, '📊 Parsing Consolidate Revenue Report…', null, true);
    const crRaw = await Parser.parseCR(_files.cr);
    crData = crRaw.data;
    crRaw.unmappedRows.forEach(m => addLogEl(log, '⚠️ ' + m, 'warn', true));
    crRaw.errors.forEach(e      => addLogEl(log, '❌ ' + e, 'err', true));
    const lowCR = Object.entries(crRaw.colConfidences).filter(([,v]) => v < AgentConfig.CONFIDENCE_THRESHOLD);
    if (lowCR.length && _autonomy !== 'auto') {
      addLogEl(log, `⚠️ Low-confidence columns in CR: ${lowCR.map(([k,v])=>`${k}(${(v*100).toFixed(0)}%)`).join(', ')} — review results carefully.`, 'warn', true);
    }
    ss['parseCR'] = crRaw.errors.length ? 'error' : 'done'; renderStepTracker(ss);

    /* parseTC */
    ss['parseTC'] = 'active'; renderStepTracker(ss); setProgress(bar, 28);
    addLogEl(log, '🎫 Parsing Traffic Count Report…', null, true);
    const tcRaw = await Parser.parseTC(_files.tc);
    tcData = tcRaw.data;
    tcRaw.unmappedRows.forEach(m => addLogEl(log, '⚠️ ' + m, 'warn', true));
    tcRaw.errors.forEach(e      => addLogEl(log, '❌ ' + e, 'err', true));
    ss['parseTC'] = tcRaw.errors.length ? 'error' : 'done'; renderStepTracker(ss);

    /* parseVM */
    ss['parseVM'] = 'active'; renderStepTracker(ss); setProgress(bar, 45);
    addLogEl(log, '🔴 Parsing Violation Matrix…', null, true);
    vmData = await Parser.parseMatrix(_files.vm, 'VM');
    vmData.unmappedRows.forEach(m => addLogEl(log, '⚠️ ' + m, 'warn', true));
    vmData.errors.forEach(e      => addLogEl(log, '❌ ' + e, 'err', true));
    ss['parseVM'] = vmData.errors.length ? 'error' : 'done'; renderStepTracker(ss);

    /* parseEM */
    ss['parseEM'] = 'active'; renderStepTracker(ss); setProgress(bar, 60);
    addLogEl(log, '🟢 Parsing Exemption Matrix…', null, true);
    emData = await Parser.parseMatrix(_files.em, 'EM');
    emData.unmappedRows.forEach(m => addLogEl(log, '⚠️ ' + m, 'warn', true));
    emData.errors.forEach(e      => addLogEl(log, '❌ ' + e, 'err', true));
    ss['parseEM'] = emData.errors.length ? 'error' : 'done'; renderStepTracker(ss);

    /* reconcile */
    ss['reconcile'] = 'active'; renderStepTracker(ss); setProgress(bar, 72);
    addLogEl(log, '⚖️ Reconciling…', null, true);
    _result = Reconciler.buildAuditData(crData, tcData, vmData, emData, _tariffs);
    ss['reconcile'] = 'done'; renderStepTracker(ss);

    /* selfCheck */
    ss['selfCheck'] = 'active'; renderStepTracker(ss); setProgress(bar, 80);
    addLogEl(log, '🔍 Self-check pass…', null, true);
    const retried = Reconciler.selfCheck(_result, _tariffs);
    if (retried) addLogEl(log, '🔄 Inconsistency detected — row(s) recomputed.', 'warn', true);
    ss['selfCheck'] = 'done'; renderStepTracker(ss);

    /* applyRules */
    ss['applyRules'] = 'active'; renderStepTracker(ss); setProgress(bar, 88);
    addLogEl(log, '🧠 Applying learned rules…', null, true);
    RulesEngine.applyToData(_result, _auditDate, log, true);
    ss['applyRules'] = 'done'; renderStepTracker(ss);

    /* render */
    ss['render'] = 'active'; renderStepTracker(ss); setProgress(bar, 95);
    addLogEl(log, '📋 Rendering preview…', null, true);
    renderPreview(_result);
    setProgress(bar, 100);
    ss['render'] = 'done'; renderStepTracker(ss);

    const warns = AgentTrail.warnings();
    if (warns.length) {
      addLogEl(log, `⚠️ ${warns.length} low-confidence decision(s) in this run.`, 'warn', true);
    }

    addLogEl(log, '✅ Done! Review results and correct any values.', 'ok', true);
    show('agentPreviewSection');
    const runBtn = document.getElementById('agentRunBtn');
    if (runBtn) runBtn.disabled = true;
    setFooterNote('Review the table. Click ✏️ to correct and teach the agent.');
  }

  /* ── Tariff grid ── */
  function renderTariffGrid() {
    const grid = document.getElementById('agentTariffGrid');
    if (!grid) return;
    grid.innerHTML = _tariffs.map(t => `
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
    _tariffs.forEach(t => {
      const s = document.getElementById(`tariff_${t.key}_s`);
      const r = document.getElementById(`tariff_${t.key}_r`);
      if (s) t.single    = parseFloat(s.value) || 0;
      if (r) t.tariffRet = parseFloat(r.value) || 0;
    });
  }

  /* ── File handling (item 7 — per-file isolation) ── */
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
        _files[type] = wb;
        setText(statId, '✓ Parsed');
        setClass(statId, 'agent-file-status ok');
        document.getElementById(cardId)?.classList.add('ready');
        checkFilesReady();
      } catch (err) {
        setText(statId, '✗ ' + err.message);
        setClass(statId, 'agent-file-status err');
        /* Other files are unaffected — user can retry just this file */
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function checkFilesReady() {
    const loaded = Object.values(_files).filter(Boolean).length;
    if (loaded === 4) { show('agentTariffSection'); show('agentProcessSection'); setFooterNote('All 4 files loaded.'); }
    else { setFooterNote(`${loaded}/4 files loaded.`); }
  }

  /* ══════════════════════════════════════════════════════════════
     RENDERER  (items 5, 8, 19)
  ══════════════════════════════════════════════════════════════ */
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
    if (!tbody || !tfoot) return;
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
        return `<td class="agent-cell${corrected}" data-row="${r.key}" data-field="${field}" title="Click ✏️ to correct">${val}<span class="agent-cell-edit" onclick="agentEditCell('${r.key}','${field}',${val})">✏️</span></td>`;
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
    if (!tbody || !tfoot) return;
    const order  = ['ambulance','auto','bike','tractor','jcb','govt','police','forcefully'];
    const labels = { ambulance:'Ambulance', auto:'Auto', bike:'Bike', tractor:'Tractor', jcb:'JCB', govt:'Govt', police:'Police', forcefully:'Forcefully' };
    let tv=0,te=0,tt=0;
    tbody.innerHTML = order.map(k => {
      const v=ntCombined[k]?.viol||0, e2=ntCombined[k]?.exem||0, t=v+e2;
      tv+=v; te+=e2; tt+=t;
      return `<tr><td class="cls-name">${labels[k]}</td><td>${v}</td><td>${e2}</td><td><strong>${t}</strong></td></tr>`;
    }).join('');
    tfoot.innerHTML = `<tr><td class="cls-name">Total</td><td>${tv}</td><td>${te}</td><td>${tt}</td></tr>`;
  }

  function renderTCTable(tcRows) {
    const tbody = document.getElementById('agentTCTbody');
    const tfoot = document.getElementById('agentTCTfoot');
    if (!tbody || !tfoot) return;
    let tc=0,tr2=0,td2=0,te=0,tt=0;
    tbody.innerHTML = tcRows.map(r => {
      tc+=r.cash; tr2+=r.ret; td2+=r.digital; te+=r.etc; tt+=r.total;
      return `<tr><td class="cls-name">${r.label}</td><td>${fmt(r.cash)}</td><td>${fmt(r.ret)}</td><td>${fmt(r.digital)}</td><td>${fmt(r.etc)}</td><td><strong>${fmt(r.total)}</strong></td></tr>`;
    }).join('');
    tfoot.innerHTML = `<tr><td class="cls-name">Total</td><td>${fmt(tc)}</td><td>${fmt(tr2)}</td><td>${fmt(td2)}</td><td>${fmt(te)}</td><td>${fmt(tt)}</td></tr>`;
  }

  function renderSummary(rows) {
    const bar = document.getElementById('agentSummaryBar');
    if (!bar) return;
    const tt = rows.reduce((s,r)=>s+r.totalTraffic,0);
    const tp = rows.reduce((s,r)=>s+r.paidTotal,0);
    const tv = rows.reduce((s,r)=>s+r.violation,0);
    const tl = rows.reduce((s,r)=>s+r.totalLoss,0);
    const lp = tt>0?Math.round((tv/tt)*100):0;
    const rc = Object.keys(RulesEngine.all()).length;
    bar.innerHTML = `
      <span class="agent-chip"><i class="bi bi-car-front-fill"></i> Total Traffic: ${tt}</span>
      <span class="agent-chip"><i class="bi bi-cash"></i> Paid: ${tp}</span>
      <span class="agent-chip ${lp>30?'red':'warn'}"><i class="bi bi-exclamation-triangle-fill"></i> Violations: ${tv}</span>
      <span class="agent-chip ${lp>30?'red':'warn'}"><i class="bi bi-graph-down-arrow"></i> Loss: ₹${fmt(tl)}</span>
      ${rc>0?`<span class="agent-chip" style="background:#f0f9ff;border-color:#bae6fd;color:#0c4a6e"><i class="bi bi-brain"></i> ${rc} rules learned</span>`:''}
      <span class="agent-chip" style="background:#fafafa;font-size:11px;">Mode: ${_autonomy} | Log: ${_verbosity}</span>
    `;
  }

  function renderAnomalies(anomalies) {
    const box  = document.getElementById('agentAnomalyBox');
    const list = document.getElementById('agentAnomalyList');
    if (!box || !list) return;
    if (!anomalies || !anomalies.length) { box.style.display='none'; return; }
    box.style.display = 'block';
    /* Item 8 — XSS safe: use textContent via li.outerHTML trick */
    list.innerHTML = anomalies.map(a => {
      const li = document.createElement('li');
      li.textContent = a;
      return li.outerHTML;
    }).join('');
  }

  /* ══════════════════════════════════════════════════════════════
     RULES PANEL
  ══════════════════════════════════════════════════════════════ */
  function openRulesPanel()  { renderRulesPanel(); show('agentRulesPanel'); }
  function closeRulesPanel() { hide('agentRulesPanel'); }

  function renderRulesPanel() {
    const list = document.getElementById('agentRulesList');
    if (!list) return;
    const all  = RulesEngine.all();
    const keys = Object.keys(all);
    if (!keys.length) {
      list.innerHTML = '<div class="agent-rules-empty"><i class="bi bi-robot"></i><p>No rules learned yet.<br>Correct cells to teach the agent.</p></div>';
      return;
    }
    const frag = document.createDocumentFragment();
    keys.forEach(k => {
      const r    = all[k];
      const date = new Date(r.timestamp).toLocaleDateString('en-IN');
      const item = document.createElement('div');
      item.className = 'agent-rule-item';

      const lbl = document.createElement('div');
      lbl.className = 'agent-rule-label';
      lbl.innerHTML = '<i class="bi bi-check-circle-fill" style="color:#16a34a"></i> ';
      lbl.appendChild(document.createTextNode(r.label));

      const val = document.createElement('div');
      val.className = 'agent-rule-val';
      val.innerHTML = 'Value: <strong></strong>';
      val.querySelector('strong').textContent = r.value;

      const scope = document.createElement('div');
      scope.className = 'agent-rule-meta';
      scope.textContent = `Scope: ${r.scope === 'all' ? 'All future audits' : 'Date: ' + r.auditDate}`;

      const meta = document.createElement('div');
      meta.className = 'agent-rule-meta';
      meta.textContent = `Saved: ${date}`;

      const btn = document.createElement('button');
      btn.className = 'agent-rule-del';
      btn.innerHTML = '<i class="bi bi-trash"></i>';
      btn.addEventListener('click', () => { RulesEngine.deleteRule(k); renderRulesPanel(); showToastMsg('Rule deleted.'); });

      item.appendChild(lbl);
      item.appendChild(val);
      if (r.reason) {
        const reason = document.createElement('div');
        reason.className = 'agent-rule-reason';
        reason.textContent = '\u201c' + r.reason + '\u201d';
        item.appendChild(reason);
      }
      item.appendChild(scope);
      item.appendChild(meta);
      item.appendChild(btn);
      frag.appendChild(item);
    });
    list.innerHTML = '';
    list.appendChild(frag);
  }

  window.agentDeleteRule = function(key) { RulesEngine.deleteRule(key); renderRulesPanel(); showToastMsg('Rule deleted.'); };
  function clearAllRules() {
    if (!confirm('Delete ALL learned rules? Cannot be undone.')) return;
    RulesEngine.clearAll(); renderRulesPanel(); showToastMsg('All rules cleared.');
  }

  /* ══════════════════════════════════════════════════════════════
     CORRECT & LEARN DIALOG  (item 6 — scope consent)
  ══════════════════════════════════════════════════════════════ */
  window.agentEditCell = function(rowKey, field, currentVal) {
    const overlay = document.getElementById('agentEditOverlay');
    if (!overlay) return;
    document.getElementById('agentEditRowKey').value       = rowKey;
    document.getElementById('agentEditField').value        = field;
    document.getElementById('agentEditOldVal').textContent = currentVal;
    document.getElementById('agentEditNewVal').value       = currentVal;
    document.getElementById('agentEditReason').value       = '';
    document.getElementById('agentEditTitle').textContent  =
      `Correct: ${AgentConfig.AUDIT_LABELS[rowKey]||rowKey} → ${fieldLabel(field)}`;
    overlay.style.display = 'flex';
    document.getElementById('agentEditNewVal').focus();
  };

  safeOnLazy('agentEditSave', 'click', function() {
    const rowKey  = document.getElementById('agentEditRowKey').value;
    const field   = document.getElementById('agentEditField').value;
    const newVal  = parseFloat(document.getElementById('agentEditNewVal').value);
    const reason  = document.getElementById('agentEditReason').value.trim();
    const scopeSel = document.getElementById('agentEditScope');
    const scope    = scopeSel ? scopeSel.value : 'session';
    if (isNaN(newVal)) { alert('Please enter a valid number.'); return; }

    const label = `${AgentConfig.AUDIT_LABELS[rowKey]||rowKey} → ${fieldLabel(field)}`;
    RulesEngine.addRule(rowKey, field, newVal, reason, label, _auditDate, scope);
    AgentTrail.record('userCorrection', `User corrected: ${label} = ${newVal}`,
      `Scope: ${scope}`, 1.0, { rowKey, field, newVal, scope, auditDate: _auditDate });

    if (_result) {
      const row = _result.rows.find(r => r.key === rowKey);
      if (row) {
        row[field] = newVal;
        row['_corrected_' + field] = true;
        Reconciler.recalcRow(row, _tariffs);
        renderPreview(_result);
      }
    }
    document.getElementById('agentEditOverlay').style.display = 'none';
    showToastMsg(`✅ Corrected & saved (scope: ${scope})!`);
  });

  safeOnLazy('agentEditCancel','click', () => {
    document.getElementById('agentEditOverlay').style.display = 'none';
  });

  /* ══════════════════════════════════════════════════════════════
     MODE + VERBOSITY + TRAIL  (items 14, 15, 19)
  ══════════════════════════════════════════════════════════════ */
  function _updateModeButtons() {
    ['suggest','confirm','auto'].forEach(m => {
      const btn = document.getElementById(`agentMode_${m}`);
      if (!btn) return;
      btn.classList.toggle('btn-warning',   m === 'confirm' && _autonomy === m);
      btn.classList.toggle('btn-success',   m === 'auto'    && _autonomy === m);
      btn.classList.toggle('btn-secondary', _autonomy === m && m === 'suggest');
      btn.classList.toggle('btn-outline-secondary', _autonomy !== m && m === 'suggest');
      btn.classList.toggle('btn-outline-warning',   _autonomy !== m && m === 'confirm');
      btn.classList.toggle('btn-outline-success',   _autonomy !== m && m === 'auto');
    });
    ['summary','detail'].forEach(v => {
      const btn = document.getElementById(`agentVerbosity${v.charAt(0).toUpperCase()+v.slice(1)}`);
      if (!btn) return;
      btn.classList.toggle('btn-secondary',         _verbosity === v);
      btn.classList.toggle('btn-outline-secondary', _verbosity !== v);
    });
  }

  function setAutonomyMode(mode) {
    _autonomy = mode;
    localStorage.setItem(AgentConfig.AUTONOMY_STORAGE_KEY, mode);
    _updateModeButtons();
    showToastMsg(`Agent mode: ${mode.toUpperCase()}`);
  }
  function setVerbosity(v) {
    _verbosity = v;
    localStorage.setItem('agentVerbosity', v);
    _updateModeButtons();
    showToastMsg(`Log: ${v}`);
  }
  function downloadTrail() {
    const blob = new Blob([AgentTrail.asJSON()], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `agent-trail-${_auditDate}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  /* ══════════════════════════════════════════════════════════════
     DOWNLOAD TEMPLATE
  ══════════════════════════════════════════════════════════════ */
  function downloadTemplate() {
    if (!_result) return;
    const wb   = XLSX.utils.book_new();
    const hdr1 = [['Class','Tariff (Single)','Tariff (Return)',
                   'Cash','Return','Barcode','Digital','ETC','Pass','Total Traffic (Paid)',
                   'Violation','Revenue Loss','Exemption','Revenue Loss (Exempt)',
                   'Total Unpaid','Total Loss','Total Traffic','Loss in %']];
    const data1 = _result.rows.map(r => [
      r.label, r.single, r.tariffRet,
      r.cash, r.retCount, r.barcode, r.digital, r.etc, r.pass, r.paidTotal,
      r.violation, r.revLossViol, r.exemption, r.revLossExem,
      r.totalUnpaid, r.totalLoss, r.totalTraffic,
      r.key==='nt'?'-':(r.lossPercent+'%'),
    ]);
    const ws1 = XLSX.utils.aoa_to_sheet([...hdr1, ...data1]);
    ws1['!cols'] = [{ wch:15 }, ...Array(17).fill({ wch:12 })];
    XLSX.utils.book_append_sheet(wb, ws1, 'Audit Template');

    const nt    = _result.ntCombined;
    const order = ['ambulance','auto','bike','tractor','jcb','govt','police','forcefully'];
    const lbs   = { ambulance:'Ambulance',auto:'Auto',bike:'Bike',tractor:'Tractor',jcb:'JCB',govt:'Govt',police:'Police',forcefully:'Forcefully' };
    const ws2   = XLSX.utils.aoa_to_sheet([
      ['Non-Tollable Exemption & Violation'], ['Category','Violation','Exemption','Total'],
      ...order.map(k => [lbs[k], nt[k]?.viol||0, nt[k]?.exem||0, (nt[k]?.viol||0)+(nt[k]?.exem||0)]),
    ]);
    XLSX.utils.book_append_sheet(wb, ws2, 'Non-Tollable');

    const ws3 = XLSX.utils.aoa_to_sheet([
      ['Total Collection Classwise'], ['Class','Cash','Return','Digital','ETC','Total Traffic'],
      ..._result.tcRows.map(r => [r.label, r.cash, r.ret, r.digital, r.etc, r.total]),
    ]);
    XLSX.utils.book_append_sheet(wb, ws3, 'Total Collection');

    const today = new Date().toISOString().slice(0,10);
    XLSX.writeFile(wb, `Audit_Template_${today}.xlsx`);
    addLogEl(document.getElementById('agentLog'), `📥 Downloaded: Audit_Template_${today}.xlsx`, 'ok', true);
  }

  /* ══════════════════════════════════════════════════════════════
     RESET
  ══════════════════════════════════════════════════════════════ */
  function resetAgent() {
    _files   = { cr:null, tc:null, vm:null, em:null };
    _result  = null;
    _tariffs = AgentConfig.DEFAULT_TARIFFS.map(t=>({...t}));
    AgentTrail.reset();
    ['CR','TC','VM','EM'].forEach(t => {
      document.getElementById(`agent${t}Card`)?.classList.remove('ready');
      setText(`agent${t}FileName`, 'No file chosen');
      setText(`agent${t}Status`, '');
      setClass(`agent${t}Status`, 'agent-file-status');
      const inp = document.getElementById(`agent${t}Input`);
      if (inp) inp.value = '';
    });
    ['agentTariffSection','agentProcessSection','agentPreviewSection'].forEach(hide);
    const logEl = document.getElementById('agentLog');
    if (logEl) logEl.innerHTML = '';
    const prog = document.getElementById('agentProgress');
    if (prog) prog.style.display = 'none';
    const pbar = document.getElementById('agentProgressBar');
    if (pbar) pbar.style.width = '0%';
    const runBtn = document.getElementById('agentRunBtn');
    if (runBtn) runBtn.disabled = false;
    const anomBox = document.getElementById('agentAnomalyBox');
    if (anomBox) anomBox.style.display = 'none';
    const sumBar = document.getElementById('agentSummaryBar');
    if (sumBar) sumBar.innerHTML = '';
    const tracker = document.getElementById('agentStepTracker');
    if (tracker) tracker.innerHTML = '';
    renderTariffGrid();
    setFooterNote('');
  }

  /* ══════════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {
    RulesEngine.load();
    renderTariffGrid();
    _updateModeButtons();

    const bindInput = (id, type) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', e => handleFile(e.target.files[0], type));
    };
    bindInput('agentCRInput','cr');
    bindInput('agentTCInput','tc');
    bindInput('agentVMInput','vm');
    bindInput('agentEMInput','em');

    safeOn('agentRunBtn',       'click', () => runAgent());
    safeOn('agentDownloadBtn',  'click', downloadTemplate);
    safeOn('agentResetBtn',     'click', resetAgent);
    safeOn('agentViewRulesBtn', 'click', openRulesPanel);
    safeOn('agentRulesClose',   'click', closeRulesPanel);
    safeOn('agentRulesClearBtn','click', clearAllRules);

    /* Autonomy mode buttons (item 14) — add to HTML: id="agentMode_suggest" etc. */
    ['suggest','confirm','auto'].forEach(mode => {
      safeOn(`agentMode_${mode}`, 'click', () => setAutonomyMode(mode));
    });
    /* Verbosity toggles (item 19) — id="agentVerbositySummary" / "agentVerbosityDetail" */
    safeOn('agentVerbositySummary', 'click', () => setVerbosity('summary'));
    safeOn('agentVerbosityDetail',  'click', () => setVerbosity('detail'));
    /* Trail download (item 15) — id="agentDownloadTrail" */
    safeOn('agentDownloadTrail', 'click', downloadTrail);

    /* Expose Eval + Trail to browser console for item 18 */
    window.AgentEval  = Eval;
    window.AgentTrail = AgentTrail;
  });

})();
