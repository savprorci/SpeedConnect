"use strict";
/* ===== Assistants SpeedConnect (Espace SAV et mode Admin) =====
   1) Contrôleurs / systèmes de commande (configuration Modbus)
   2) Diagnostic interactif assisté par IA
   3) Assistant de vérification pour la mise en parallèle de groupes électrogènes */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
const PD = { du: 5, df: 0.2, dphi: 10, dp: 10, dq: 10, stale: 15 }; // valeurs usuelles, réglables en mode Admin
let PCFG = { ...PD };
const savTabs = () => `<div class="tb">${[["cfg", "⚙️ Configuration"], ["ia", "🤖 Diagnostic IA"], ["par", "🔗 Mise en parallèle"]].map(([k, n]) => `<button class="${savTab === k ? "on" : ""}" onclick="savTab='${k}';rSav()">${n}</button>`).join("")}</div>`;
function asstRender() { if (savTab === "ia") iaRender(); else parRender(); }

/* ---------- Contrôleurs ---------- */
const BRANDS = ["DSE (Deep Sea Electronics)", "Caterpillar EMCP 2", "Caterpillar EMCP 3", "Caterpillar EMCP 4", "Caterpillar PowerWizard", "SmartGen (HGM)", "ComAp (InteliLite / InteliGen / InteliSys)", "DEIF (AGC)", "Datakom", "Cummins PowerCommand", "Lovato", "Woodward", "Autre / Modbus générique"];
const CTRL_KEY_LIST = ["u12", "u23", "u31", "freq", "kw", "kw1", "kw2", "kw3", "kvar", "pf", "rot", "rotbus", "gcb", "angle", "ubus", "fbus", "rpm"];
const CTRL_KEYS = "u12, u23, u31, freq, kw (ou kw1, kw2, kw3), kvar, pf, rot, rotbus, gcb, angle, ubus, fbus, rpm";
/* Modèles de tables de registres. DSE : standard GenComm v2.228 (16/07/2020), adresse = page × 256 + décalage, fonction 3.
   Page 4 = instrumentation de base (1024 + décalage) ; page 6 = instrumentation dérivée (1536 + décalage). */
const DSE_BASE = [
  "# DSE GenComm - page 4 (1024 + decalage) - fonction 3",
  "huile;1024;u16;0.01;3", "eau_moteur;1025;s16;1;3", "carburant;1027;u16;1;3", "batterie;1029;u16;0.1;3", "rpm;1030;u16;1;3", "freq;1031;u16;0.1;3",
  "u12;1038;u32;0.1;3", "u23;1040;u32;0.1;3", "u31;1042;u32;0.1;3",
  "kw1;1052;s32;0.001;3", "kw2;1054;s32;0.001;3", "kw3;1056;s32;0.001;3",
  "rot;1073;u16;1;3",
  "# Jeu de barres (modules synchronisants uniquement)",
  "fbus;1091;u16;0.1;3", "ubus;1098;u32;0.1;3", "rotbus;1118;u16;1;3",
].join("\n");
const DSE_P6 = [
  "# Page 6 - famille 61xx MkII uniquement (1536 + decalage). Autres familles : voir leur table page 6",
  "kw;1536;s32;0.001;3", "kvar;1552;s32;0.001;3", "pf;1557;s16;0.01;3",
].join("\n");
const CTRL_PRESETS = {
  "dse-base": { label: "DSE GenComm — instrumentation de base (page 4)", regs: DSE_BASE },
  "dse-p6": { label: "DSE GenComm — base + page 6 (61xx MkII uniquement)", regs: DSE_BASE + "\n" + DSE_P6 },
};
function ctrlPreset() {
  const p = CTRL_PRESETS[$("kpre").value];
  if (!p) { toast("Choisissez un modèle de registres", 1); return; }
  $("kb").value = "DSE (Deep Sea Electronics)"; $("kl").value = "rtu"; $("kp").value = "N"; $("ksb").value = "2"; $("ksw").checked = false; $("kse").checked = true; $("kreg").value = p.regs;
  toast("Modèle appliqué : vérifiez l’adresse esclave, le débit et les bits d’arrêt");
}
function ctrlParse(txt) {
  const regs = [], bad = [];
  String(txt || "").split(/\r?\n/).forEach((ln, i) => {
    const l = ln.trim(); if (!l || l[0] === "#") return;
    const [cle, adr, type = "u16", ech = "1", fn = "3"] = l.split(/[;\t]/).map((x) => x.trim());
    const a = parseInt(adr, 10), sc = parseFloat(String(ech).replace(",", ".")), f = parseInt(fn, 10);
    if (!/^[a-z0-9_]+$/i.test(cle || "") || !Number.isInteger(a) || a < 0 || a > 65535 || !["u16", "s16", "u32", "s32"].includes(type) || !Number.isFinite(sc) || ![3, 4].includes(f)) { bad.push(i + 1); return; }
    regs.push({ cle, adr: a, type, ech: sc, fn: f });
  });
  return { regs, bad };
}
const ctrlText = (regs) => (regs || []).map((r) => [r.cle, r.adr, r.type, r.ech, r.fn].join(";")).join("\n");
function ctrlHTML(e) {
  const c = e.controller || {};
  return `<h3 style="margin:22px 0 4px">Contrôleur / système de commande</h3><div class="dim" style="font-size:12.5px;margin-bottom:10px">Les adresses de registres figurent dans la documentation Modbus du modèle exact. Une ligne par mesure : <span class="mono">clé;adresse;type;échelle;fonction</span> (type u16, s16, u32 ou s32 ; fonction 3 ou 4). Clés électriques : ${CTRL_KEYS}. Clés moteur : carburant, huile, eau_moteur, batterie.</div>
<div class="frm"><div><label>Marque</label><select id="kb"><option value="">—</option>${BRANDS.map((b) => `<option ${c.marque === b ? "selected" : ""}>${esc(b)}</option>`).join("")}</select></div><div><label>Modèle exact</label><input id="km" value="${qa(c.modele)}" placeholder="ex. 7320, AGC 150…"></div><div><label>Liaison</label><select id="kl"><option value="rtu" ${c.liaison !== "tcp" ? "selected" : ""}>Modbus RTU (RS-485)</option><option value="tcp" ${c.liaison === "tcp" ? "selected" : ""}>Modbus TCP (Ethernet)</option></select></div><div><label>Adresse esclave</label><input type="number" id="ka" value="${c.adresse ?? 1}"></div><div><label>Débit (bauds)</label><input type="number" id="kbd" value="${c.baud ?? 9600}"></div><div><label>Parité</label><select id="kp">${["N", "E", "O"].map((x) => `<option ${(c.parite || "N") === x ? "selected" : ""}>${x}</option>`).join("")}</select></div><div><label>Adresse IP (TCP)</label><input id="ki" value="${qa(c.ip)}"></div><div><label>Port TCP</label><input type="number" id="kpt" value="${c.port ?? 502}"></div><div><label>Interrogation (s)</label><input type="number" id="kint" value="${c.intervalle ?? 2}"></div><div><label>Puissance nominale (kW)</label><input type="number" id="kpn" value="${c.p_nom ?? ""}"></div><div><label>Puissance apparente (kVA)</label><input type="number" id="ksn" value="${c.s_nom ?? ""}"></div><div><label>Mots 32 bits</label><label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="ksw" ${c.swap ? "checked" : ""}> Ordre inversé</label></div><div><label>Bits d’arrêt</label><select id="ksb">${[1, 2].map((x) => `<option ${(c.arrets ?? 2) === x ? "selected" : ""}>${x}</option>`).join("")}</select></div><div><label>Valeurs GenComm</label><label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="kse" ${c.sentinelles ? "checked" : ""}> Ignorer les valeurs sentinelles</label></div></div>
<div class="frm" style="margin-top:14px"><div><label>Modèle de registres</label><select id="kpre"><option value="">—</option>${Object.entries(CTRL_PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join("")}</select></div><div style="display:flex;align-items:flex-end"><button class="btn ghost" style="padding:10px 14px" onclick="ctrlPreset()">Appliquer le modèle</button></div></div><div class="dim" style="font-size:12.5px;margin:8px 0 0">DSE : RS-485 en 8 bits sans parité, 2 bits d’arrêt (1 seul sur les 73xx/74xx MkII, 86xx MkII, 61xx MkIII et 63xx). Modbus TCP : port 502, adresse esclave 10. Adresses en base 0 ; valeurs 32 bits sans inversion de mots. Les valeurs sentinelles (0xFFFF, 0x7FFF…) signalent une mesure absente ou en défaut.</div><label class="dim" style="display:block;font-size:12.5px;margin:14px 0 5px">Table des registres</label><textarea id="kreg" rows="7" class="mono" style="font-size:12.5px" placeholder="freq;ADRESSE;u16;0.1;3">${esc(ctrlText(c.registres))}</textarea><button class="btn ghost" style="margin-top:8px;padding:8px 14px" onclick="ctrlTpl()">Insérer le modèle de saisie</button>`;
}
function ctrlTpl() { const t = $("kreg"); if (t.value.trim()) t.value += "\n"; t.value += ["# clé;adresse;type;échelle;fonction", ...CTRL_KEY_LIST.map((k) => "#" + k + ";ADRESSE;u16;1;3")].join("\n"); }
function ctrlRead() {
  const p = ctrlParse($("kreg").value), n = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
  return { marque: $("kb").value, modele: $("km").value.trim(), liaison: $("kl").value, adresse: n("ka") ?? 1, baud: n("kbd") ?? 9600, parite: $("kp").value, ip: $("ki").value.trim(), port: n("kpt") ?? 502, intervalle: n("kint") ?? 2, p_nom: n("kpn"), s_nom: n("ksn"), swap: $("ksw").checked, arrets: +$("ksb").value || 2, sentinelles: $("kse").checked, registres: p.regs, _bad: p.bad.join(", ") };
}

/* ---------- Mesures électriques (réelles ou simulées en démonstration) ---------- */
function simElec(e, k) {
  const t = Date.now() / 1000, id = parseInt(e.id, 10) || 1, o = (id % 3) * .4;
  switch (k) {
    case "u12": case "u23": case "u31": return 400 + o + 2 * Math.sin(t / 5 + id);
    case "freq": return 50 + o * .1 + .15 * Math.sin(t / 9 + id);
    case "ubus": return 400; case "fbus": return 50;
    case "angle": return 90 * Math.sin(t / 7 + id);
    case "rot": return 1; case "gcb": case "kw": case "kvar": return 0; case "pf": return .8;
    default: return null;
  }
}
function gv(e, k) {
  if (isLive) {
    const L = LIVE[e.id] || {}, v = L[k];
    if (v != null) return v;
    if (k === "kw" && [L.kw1, L.kw2, L.kw3].every((x) => x != null)) return L.kw1 + L.kw2 + L.kw3;
    return null;
  }
  const i = (SPEC[e.domaine] || []).findIndex((s) => s[7] === k);
  return i >= 0 ? sim(e, i) : simElec(e, k);
}
const uavg = (e) => { const a = ["u12", "u23", "u31"].map((k) => gv(e, k)).filter((v) => v != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };

/* ---------- Mise en parallèle ---------- */
const PAR = { a: null, b: "bus", m: {} };
const PARLOG = [];
let LASTPAR = null;
const PMAN = [["synchro", "Synchroniseur / relais de contrôle de synchronisme actif et testé"], ["neutre", "Régime de neutre et mise à la terre compatibles"], ["regul", "Statisme (vitesse) et régulation de tension (AVR) réglés de façon compatible"], ["verrou", "Verrouillages et séquence de couplage vérifiés (aucune fermeture forcée)"], ["charge", "Protections et disjoncteurs adaptés au couplage"]];
function parChecks(A, B, cfg, live) {
  const rows = [], add = (label, va, vb, dl, tol, st, hint) => rows.push({ label, va, vb, dl, tol, st, hint: hint || "" });
  const f = (v, d = 1) => (v == null ? "—" : v.toFixed(d));
  const ua = uavg(A), ub = B ? uavg(B) : gv(A, "ubus"), fa = gv(A, "freq"), fb = B ? gv(B, "freq") : gv(A, "fbus");
  const gA = gv(A, "gcb"), gB = B ? gv(B, "gcb") : null, coupled = gA === 1 && (B ? gB === 1 : true);
  const fresh = (e) => !live || (e.online && LIVET[e.id] && Date.now() - LIVET[e.id] < cfg.stale * 1000);
  const comOk = fresh(A) && (!B || fresh(B));
  add("Liaison avec les contrôleurs", fresh(A) ? "OK" : "perdue", B ? (fresh(B) ? "OK" : "perdue") : "—", "", "", comOk ? "ok" : "crit", "Mesures absentes ou trop anciennes : ne pas coupler.");
  const sa = eqState(A), sb2 = B ? eqState(B) : "ok", L = { ok: "OK", warn: "alerte", crit: "critique", off: "inconnu" };
  add("État moteur (carburant, huile, eau)", L[sa], B ? L[sb2] : "—", "", "", sa === "crit" || sb2 === "crit" ? "crit" : sa === "ok" && sb2 === "ok" ? "ok" : "na", "Un groupe en alerte ou sans données ne doit pas être couplé.");
  if (!coupled) {
    const du = ua != null && ub ? Math.abs(ua - ub) / ub * 100 : null;
    add("Tension (moyenne des phases)", f(ua) + " V", f(ub) + " V", du == null ? "—" : f(du) + " %", "≤ " + cfg.du + " %", du == null ? "na" : du <= cfg.du ? "ok" : "crit", du == null ? "Mesure indisponible." : "Corriger la tension (AVR) avant synchronisation.");
    const df = fa != null && fb != null ? Math.abs(fa - fb) : null;
    add("Fréquence", f(fa, 2) + " Hz", f(fb, 2) + " Hz", df == null ? "—" : f(df, 2) + " Hz", "≤ " + cfg.df + " Hz", df == null ? "na" : df <= cfg.df ? "ok" : "crit", df == null ? "Mesure indisponible." : "Ajuster la vitesse (régulateur) avant synchronisation.");
    const ang = gv(A, "angle") ?? (B ? gv(B, "angle") : null);
    add("Écart de phase", f(ang) + " °", "—", ang == null ? "—" : f(Math.abs(ang)) + " °", "≤ " + cfg.dphi + " °", ang == null ? "na" : Math.abs(ang) <= cfg.dphi ? "ok" : "crit", ang == null ? "Non fourni par le contrôleur : vérifier au synchroscope." : "Attendre la fenêtre de synchronisation.");
    const ra = gv(A, "rot"), rb = B ? gv(B, "rot") : gv(A, "rotbus"), okRot = (x) => x === 1 || x === 2;
    const rs = !okRot(ra) || !okRot(rb) ? "na" : ra === rb ? "ok" : "crit";
    add("Sens de rotation des phases", f(ra, 0), rb == null ? "—" : f(rb, 0), "", "identique (1 ou 2)", rs, rs === "na" ? "Sens indéterminé, en erreur (codes 0 ou 3) ou non fourni : contrôler au phasemètre." : rs === "crit" ? "Sens inversé : couplage interdit." : "");
    add("Disjoncteur du groupe A", gA == null ? "—" : gA === 0 ? "ouvert" : "fermé", B ? (gB == null ? "—" : gB === 0 ? "ouvert" : "fermé") : "—", "", "ouvert avant synchro", gA == null ? "na" : gA === 0 ? "ok" : "crit", gA === 1 ? "Disjoncteur A déjà fermé alors que B est ouvert." : "");
  } else {
    const kwA = gv(A, "kw"), kwB = B ? gv(B, "kw") : null, qA = gv(A, "kvar"), qB = B ? gv(B, "kvar") : null;
    const pn = (e) => e.controller && e.controller.p_nom, sn = (e) => (e.controller && e.controller.s_nom) || (pn(e) ? pn(e) / 0.8 : null);
    if (B) {
      const sh = (v, n) => (v == null || !n ? null : v / n * 100), pa = sh(kwA, pn(A)), pb = sh(kwB, pn(B)), dp = pa != null && pb != null ? Math.abs(pa - pb) : null;
      add("Répartition de puissance active", f(pa, 0) + " % (" + f(kwA, 0) + " kW)", f(pb, 0) + " % (" + f(kwB, 0) + " kW)", dp == null ? "—" : f(dp, 0) + " pts", "≤ " + cfg.dp + " pts", dp == null ? "na" : dp <= cfg.dp ? "ok" : "crit", dp == null ? "Renseigner la puissance nominale des deux groupes." : "Corriger le statisme / la répartition de charge.");
      const qa = sh(qA, sn(A)), qb = sh(qB, sn(B)), dq = qa != null && qb != null ? Math.abs(qa - qb) : null;
      add("Répartition de puissance réactive", f(qa, 0) + " % (" + f(qA, 0) + " kVAr)", f(qb, 0) + " % (" + f(qB, 0) + " kVAr)", dq == null ? "—" : f(dq, 0) + " pts", "≤ " + cfg.dq + " pts", dq == null ? "na" : dq <= cfg.dq ? "ok" : "crit", dq == null ? "Renseigner la puissance apparente des deux groupes." : "Corriger la régulation de tension (AVR / statisme tension).");
    }
    const neg = (kwA != null && kwA < 0) || (kwB != null && kwB < 0);
    add("Puissance inverse", f(kwA, 0) + " kW", B ? f(kwB, 0) + " kW" : "—", "", "≥ 0", kwA == null ? "na" : neg ? "crit" : "ok", neg ? "Retour de puissance : un groupe est entraîné. Risque pour le moteur." : "");
  }
  return { rows, coupled };
}
function parVerdict(rows, manualOk, coupled) {
  const crit = rows.some((r) => r.st === "crit"), na = rows.some((r) => r.st === "na");
  if (coupled) return crit ? { t: "RÉPARTITION À CORRIGER", c: "crit" } : na ? { t: "EN PARALLÈLE — À VÉRIFIER", c: "warn" } : { t: "EN PARALLÈLE — RÉPARTITION CORRECTE", c: "ok" };
  if (crit) return { t: "NON PRÊT À COUPLER", c: "crit" };
  if (na || !manualOk) return { t: "À VÉRIFIER AVANT COUPLAGE", c: "warn" };
  return { t: "CONDITIONS RÉUNIES — COUPLAGE PAR LE SYNCHRONISEUR", c: "ok" };
}
function parRender() {
  const a = $("asst"), ges = EQ.filter((e) => e.domaine === "ge");
  if (!ges.length) { a.innerHTML = '<div class="card dim">Aucun groupe électrogène configuré. Ajoutez-en un dans l’onglet Configuration.</div>'; return; }
  if (!PAR.a || !ges.find((e) => e.id === PAR.a)) PAR.a = ges[0].id;
  if (PAR.b !== "bus" && (PAR.b === PAR.a || !ges.find((e) => e.id === PAR.b))) PAR.b = "bus";
  a.innerHTML = `<div class="card"><div class="eyebrow">Mise en parallèle</div><h3 style="margin-bottom:12px">Assistant de vérification</h3><div class="frm"><div><label>Groupe à coupler (A)</label><select onchange="PAR.a=this.value;parRender()">${ges.map((e) => `<option value="${e.id}" ${e.id === PAR.a ? "selected" : ""}>${esc(e.nom)}</option>`).join("")}</select></div><div><label>Référence (B)</label><select onchange="PAR.b=this.value;parRender()"><option value="bus">Jeu de barres / réseau (mesuré par A)</option>${ges.filter((e) => e.id !== PAR.a).map((e) => `<option value="${e.id}" ${e.id === PAR.b ? "selected" : ""}>${esc(e.nom)}</option>`).join("")}</select></div></div>
<div id="parRes" style="margin-top:16px"></div>
<h4 style="margin:18px 0 8px;font:600 14px 'IBM Plex Sans'">Confirmations de l’opérateur (avant couplage)</h4>${PMAN.map(([k, l]) => `<label style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;font-size:13.5px"><input type="checkbox" ${PAR.m[k] ? "checked" : ""} onchange="PAR.m['${k}']=this.checked;parCalc()"> ${l}</label>`).join("")}
<div class="note" style="margin-top:14px">Cet outil vérifie et guide : il ne commande aucun disjoncteur. Le couplage doit être réalisé par le synchroniseur ou le contrôleur du groupe, selon les procédures du constructeur et de l’installation.</div>
<button class="btn" style="margin-top:12px" onclick="parSave()">Enregistrer cette vérification</button><div id="parHist" style="margin-top:16px"></div></div>`;
  parCalc(); parHist();
}
function parCalc() {
  const el = $("parRes"); if (!el) return;
  const A = EQ.find((e) => e.id === PAR.a); if (!A) return;
  const B = PAR.b === "bus" ? null : EQ.find((e) => e.id === PAR.b) || null;
  const r = parChecks(A, B, PCFG, isLive), manualOk = PMAN.every(([k]) => PAR.m[k]), v = parVerdict(r.rows, manualOk, r.coupled);
  LASTPAR = { rows: r.rows, coupled: r.coupled, verdict: v };
  const P = { ok: ["✓", "var(--ok)"], crit: ["✗", "var(--crit)"], warn: ["⚠", "var(--warn)"], na: ["?", "var(--dim)"] };
  el.innerHTML = `<div class="note" style="border-left-color:${COL[v.c]};color:var(--ink);font-weight:600">${v.t}<div class="dim" style="font-weight:400;font-size:12.5px;margin-top:2px">${r.coupled ? "Groupes couplés : contrôle de la répartition." : "Avant couplage : contrôle des conditions de synchronisation."}</div></div><div class="sc"><table><tr><th>Contrôle</th><th>Groupe A</th><th>B</th><th>Écart</th><th>Limite</th><th></th></tr>${r.rows.map((x) => `<tr><td>${x.label}${x.hint && x.st !== "ok" ? `<div class="dim" style="font-size:12px">${x.hint}</div>` : ""}</td><td class="mono">${x.va}</td><td class="mono">${x.vb}</td><td class="mono">${x.dl}</td><td class="dim">${x.tol}</td><td style="color:${P[x.st][1]};font-weight:700">${P[x.st][0]}</td></tr>`).join("")}</table></div>`;
}
async function parSave() {
  if (!LASTPAR) return;
  const rec = { equipment_a: PAR.a, equipment_b: PAR.b === "bus" ? null : PAR.b, verdict: LASTPAR.verdict.t, snapshot: { mode: LASTPAR.coupled ? "parallele" : "pre-couplage", controles: LASTPAR.rows, confirmations: PAR.m, tolerances: PCFG } };
  if (isLive) { const { error } = await sb.from("paralleling_checks").insert({ ...rec, user_id: S.id }); if (error) { toast("Échec : " + error.message, 1); return; } }
  else PARLOG.unshift({ ...rec, created_at: new Date().toISOString() });
  toast("Vérification enregistrée"); parHist();
}
async function parHist() {
  const h = $("parHist"); if (!h) return;
  let rows = PARLOG;
  if (isLive) { const r = await sb.from("paralleling_checks").select("verdict,created_at,equipment_a").order("created_at", { ascending: false }).limit(5); rows = r.data || []; }
  h.innerHTML = `<h4 style="margin-bottom:8px;font:600 14px 'IBM Plex Sans'">Dernières vérifications</h4>` + (rows.slice(0, 5).map((r) => `<div class="al"><div>${esc(r.verdict)}<small>${esc((EQ.find((x) => x.id === r.equipment_a) || {}).nom || "—")} · ${ago(r.created_at)}</small></div></div>`).join("") || '<div class="dim" style="font-size:13px">Aucune vérification enregistrée.</div>');
}
setInterval(() => { if (curH() === "sav" && S && savTab === "par" && $("parRes")) parCalc(); }, 1000);

/* ---------- Diagnostic IA ---------- */
const IA = { eq: null, busy: false }, CHAT = {};
const KB = {
  "carburant:bas": ["niveau de réservoir insuffisant ou consommation anormale", "contrôler jauge et sonde, ravitailler, chercher une fuite"],
  "huile:bas": ["niveau d’huile bas, huile diluée, pompe ou capteur défaillant", "contrôler le niveau à la jauge, l’absence de fuite, le capteur ; ne pas faire tourner à vide de pression"],
  "eau_moteur:haut": ["niveau de liquide de refroidissement bas, radiateur encrassé, courroie ou ventilateur défaillant, surcharge", "contrôler niveau, radiateur, courroie, ventilation du local, charge appliquée"],
  "batterie:bas": ["batteries vieillissantes, chargeur défaillant, bornes oxydées", "mesurer la tension au repos et en charge, contrôler le chargeur et les bornes"],
  "reserve_eau:bas": ["fuite, vidange non remise en eau, défaut de la vanne de remplissage", "contrôler le niveau réel, la vanne d’appoint et les fuites"],
  "sprinklers:bas": ["perte de pression du réseau, fuite, pompe de maintien en pression défaillante", "contrôler le manomètre, la pompe jockey et les vannes d’isolement"],
  "batt_cmsi:bas": ["batterie de secours usée ou chargeur de la centrale défaillant", "tester la batterie en charge, contrôler le chargeur de la centrale"],
  "zones_alarme:haut": ["détection réelle, détecteur encrassé ou défaut de câblage", "vérifier sur site la zone concernée avant toute réinitialisation"],
  "pression:bas": ["amorçage perdu, filtre d’aspiration colmaté, usure de la pompe, fuite", "contrôler l’aspiration, le filtre, les joints et la vitesse de rotation"],
  "debit:bas": ["aspiration partiellement obstruée, usure de la roue, vanne mal ouverte", "contrôler vannes, filtre et courbe de la pompe"],
  "temperature:haut": ["manque de ventilation, surcharge, roulement ou refroidissement défaillant", "contrôler la ventilation, la charge, la lubrification des roulements"],
  "vibration:haut": ["désalignement, balourd, roulement usé, fixation desserrée", "contrôler l’alignement, les fixations et l’état des roulements"],
  "courant:haut": ["surcharge mécanique, déséquilibre des phases, roulement grippé", "mesurer le courant par phase, contrôler la charge entraînée"],
  "charge:haut": ["process trop exigeant ou moteur sous-dimensionné", "comparer à la plaque signalétique et au besoin réel"],
};
function localDiag(e, msgs) {
  const bad = [];
  SPEC[e.domaine].forEach((s, i) => { const v = val(e, i), t = stt(e, i, v); if (t === "warn" || t === "crit") bad.push({ s, v, t }); });
  if (!bad.length) return `**Constat** : aucune mesure hors seuil sur « ${e.nom} » pour le moment.\n**Pour avancer** : précisez le symptôme (bruit, odeur, arrêt, alarme affichée), depuis quand et dans quelles conditions (charge, démarrage).\n(Réponse simulée, mode démonstration.)`;
  const parts = bad.map(({ s, v, t }) => { const k = KB[s[7] + ":" + (s[6] ? "bas" : "haut")] || ["valeur hors plage", "contrôler le capteur puis l’équipement"]; return `**${s[0]}** : ${v.toFixed(1)} ${s[3]} (${t === "crit" ? "critique" : "alerte"})\n• Causes probables : ${k[0]}\n• Vérifications : ${k[1]}`; });
  const crit = bad.some((b) => b.t === "crit");
  return `**Constat** sur « ${e.nom} » :\n${parts.join("\n")}\n**Urgence** : ${crit ? "élevée, envisager l’arrêt de l’équipement et appeler un technicien qualifié." : "modérée, à traiter rapidement."} Consigner l’équipement avant toute intervention.\n(Réponse simulée à partir des seuils, mode démonstration.)`;
}
function iaRender() {
  const a = $("asst");
  if (!EQ.length) { a.innerHTML = '<div class="card dim">Aucun équipement.</div>'; return; }
  if (!IA.eq || !EQ.find((x) => x.id === IA.eq)) IA.eq = EQ[0].id;
  const e = EQ.find((x) => x.id === IA.eq);
  const bad = SPEC[e.domaine].map((s, i) => { const v = val(e, i), t = stt(e, i, v); return t === "warn" || t === "crit" ? `<span class="pill" style="color:${COL[t]}">● ${s[0]} ${v.toFixed(1)} ${s[3]}</span>` : ""; }).join(" ");
  a.innerHTML = `<div class="card"><div class="eyebrow">Diagnostic assisté par IA</div><div class="frm"><div><label>Équipement</label><select onchange="IA.eq=this.value;iaRender()">${EQ.map((x) => `<option value="${x.id}" ${x.id === e.id ? "selected" : ""}>${esc(x.nom)}</option>`).join("")}</select></div></div><div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">${bad || '<span class="pill dim">Aucune mesure hors seuil</span>'}</div><div id="chat" style="margin:14px 0;max-height:46vh;overflow:auto"></div><div style="display:flex;gap:8px;align-items:flex-end"><textarea id="iaIn" rows="2" placeholder="Décrivez le symptôme : bruit, fumée, arrêt, alarme…"></textarea><button class="btn" onclick="iaSend()">Envoyer</button></div><div class="note" style="margin-top:12px">Aide au diagnostic à partir des mesures de l’équipement. Elle ne remplace ni la documentation du constructeur ni l’avis d’un technicien qualifié, et ne commande aucun équipement.${isLive ? "" : " Mode démonstration : réponses simulées localement."}</div></div>`;
  chatDraw();
}
function chatDraw(busy) {
  const c = $("chat"); if (!c) return;
  const m = CHAT[IA.eq] || [];
  c.innerHTML = m.map((x) => `<div style="display:flex;justify-content:${x.role === "user" ? "flex-end" : "flex-start"};margin-bottom:8px"><div style="max-width:88%;padding:10px 13px;border-radius:12px;font-size:14px;background:${x.role === "user" ? "var(--card2)" : "var(--deep)"};border:1px solid var(--line)">${fmt(x.content)}</div></div>`).join("") + (busy ? '<div class="dim" style="font-size:13px">Analyse en cours…</div>' : "") || '<div class="dim" style="font-size:13.5px">Posez votre question : l’assistant s’appuie sur les mesures, seuils et alertes de l’équipement.</div>';
  c.scrollTop = c.scrollHeight;
}
async function iaSend() {
  const e = EQ.find((x) => x.id === IA.eq), inp = $("iaIn"), txt = inp.value.trim();
  if (!e || !txt || IA.busy) return;
  const msgs = (CHAT[e.id] = CHAT[e.id] || []); msgs.push({ role: "user", content: txt }); inp.value = ""; IA.busy = true; chatDraw(true);
  try {
    let reply;
    if (isLive) {
      const { data, error } = await sb.functions.invoke("diagnostic", { body: { equipment_id: e.id, messages: msgs } });
      if (error) { let m = error.message; try { const j = await error.context.json(); if (j.error) m = j.error; } catch (x) { /* corps non JSON */ } throw new Error(m); }
      reply = data.reply;
    } else reply = localDiag(e, msgs);
    msgs.push({ role: "assistant", content: reply });
  } catch (x) { msgs.pop(); inp.value = txt; toast("Échec : " + x.message, 1); }
  IA.busy = false; chatDraw();
}

/* ---------- Mode Admin : tolérances des assistants ---------- */
function admPar() {
  $("admB").innerHTML = admHead() + `<h3>Tolérances de mise en parallèle</h3><div class="dim" style="font-size:12.5px;margin:6px 0 14px">Valeurs usuelles par défaut, à valider selon l’installation et la documentation du contrôleur ou du synchroniseur.</div><div class="frm">${[["du", "Écart de tension max (%)"], ["df", "Écart de fréquence max (Hz)"], ["dphi", "Écart de phase max (°)"], ["dp", "Écart de répartition kW max (points de %)"], ["dq", "Écart de répartition kVAr max (points de %)"], ["stale", "Ancienneté max des mesures (s)"]].map(([k, l]) => `<div><label>${l}</label><input type="number" step="any" id="pc_${k}" value="${PCFG[k]}"></div>`).join("")}</div><button class="btn" style="margin-top:14px" onclick="admParSave()">Enregistrer</button><p class="dim" style="margin-top:16px;font-size:13px">Le quota du diagnostic IA (requêtes par utilisateur et par jour) se règle côté serveur, dans la variable AI_DAILY_LIMIT de la fonction.</p>`;
}
async function admParSave() {
  const c = {};
  for (const k of Object.keys(PD)) { const v = parseFloat($("pc_" + k).value); if (!Number.isFinite(v) || v < 0) { toast("Valeur invalide : " + k, 1); return; } c[k] = v; }
  if (isLive) { const { error } = await sb.from("assistant_settings").update({ parallel: c }).eq("id", 1); if (error) { toast("Échec : " + error.message, 1); return; } }
  PCFG = { ...PD, ...c }; toast("Tolérances enregistrées");
}
