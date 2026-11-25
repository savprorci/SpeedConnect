"use strict";
const $ = (id) => document.getElementById(id);
const CFG = window.SC_CONFIG || {};
const wantLive = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const sb = wantLive && window.supabase
  ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
const isLive = !!sb;
const LIVE_DOWN = wantLive && !sb; // service configuré mais bibliothèque injoignable (hors ligne au premier chargement)

const DOM = { ge: "Groupe électrogène", ssi: "Sécurité incendie", pompes: "Motopompe", moteurs: "Moteur électrique" };
// [libellé, nominal, max, unité, seuil alerte, seuil critique, 1 = bas = mauvais, clé de mesure]
const SPEC = {
  ge: [["Carburant", 70, 100, "%", 30, 15, 1, "carburant"], ["Huile", 4.2, 10, "bar", 2.5, 1.5, 1, "huile"], ["Eau moteur", 78, 150, "°C", 95, 105, 0, "eau_moteur"], ["Batterie", 12.8, 15, "V", 12, 11.5, 1, "batterie"]],
  ssi: [["Réserve eau", 78, 100, "%", 40, 20, 1, "reserve_eau"], ["Sprinklers", 6.8, 10, "bar", 5, 3, 1, "sprinklers"], ["Batt. CMSI", 26, 30, "V", 24, 22.5, 1, "batt_cmsi"], ["Zones alarme", 0, 10, "", 1, 3, 0, "zones_alarme"]],
  pompes: [["Pression", 7.2, 15, "bar", 4, 2, 1, "pression"], ["Débit", 110, 200, "m³/h", 60, 30, 1, "debit"], ["Température", 52, 100, "°C", 60, 80, 0, "temperature"], ["Vibration", 2.4, 10, "mm/s", 4.5, 7, 0, "vibration"]],
  moteurs: [["Courant", 16, 30, "A", 22, 26, 0, "courant"], ["Température", 104, 150, "°C", 90, 110, 0, "temperature"], ["Vibration", 2.2, 10, "mm/s", 4.5, 7, 0, "vibration"], ["Charge", 64, 100, "%", 85, 95, 0, "charge"]],
};
const ROLES = { niveau1: "Niveau 1", niveau2: "Niveau 2", sav: "Technicien SAV", admin: "Administrateur" };
const VIEW_ROLES = ["niveau1", "niveau2", "admin"], SAV_ROLES = ["sav", "admin"], CONFIRM_ROLES = ["niveau2", "sav", "admin"];

/* ---------- Modèle de communication ---------- */
const LK = [["eth", "Ethernet", "IP / mode (DHCP)"], ["g4", "4G / LTE", "APN"], ["wifi", "Wi-Fi", "SSID"], ["lora", "LoRaWAN", "Identifiant passerelle"], ["sat", "Satellite", "Opérateur / terminal"]];
const AK = [["email", "E-mail", "Adresses, séparées par des virgules"], ["sms", "SMS", "Numéros"], ["wa", "WhatsApp", "Numéros"], ["voix", "Appel vocal", "Numéros"]];
const DCT = () => ({ l: { eth: { on: true, p: 1, d: "DHCP" }, g4: { on: true, p: 2, d: "" }, wifi: { on: true, p: 3, d: "" }, lora: { on: false, p: 4, d: "" }, sat: { on: false, p: 5, d: "" } }, m: { broker: "", port: 8883, tls: true, qos: 1, ka: 60, tb: "speedconnect/{site}/{domaine}/{equipement}" }, a: { email: { on: true, d: "", s: "mineure" }, sms: { on: true, d: "", s: "majeure" }, wa: { on: true, d: "", s: "majeure" }, voix: { on: false, d: "", s: "critique" } } });
const mc = (c) => { const d = DCT(); if (!c) return d; for (const k of Object.keys(d.l)) d.l[k] = { ...d.l[k], ...((c.l && c.l[k]) || {}) }; d.m = { ...d.m, ...(c.m || {}) }; for (const k of Object.keys(d.a)) d.a[k] = { ...d.a[k], ...((c.a && c.a[k]) || {}) }; return d; };
const qa = (s) => String(s == null ? "" : s).replace(/"/g, "&quot;");
const commHTML = (p, c) => `<h3 style="margin:22px 0 4px">Liaisons de communication</h3><div class="dim" style="font-size:12.5px;margin-bottom:8px">Priorité 1 = liaison principale ; bascule automatique vers la suivante en cas de coupure.</div><div class="sc"><table><tr><th>Liaison</th><th>Active</th><th>Priorité</th><th>Détail</th></tr>${LK.map(([k, n, h]) => `<tr><td>${n}</td><td><input type="checkbox" id="${p}${k}o" ${c.l[k].on ? "checked" : ""}></td><td><input type="number" min="1" max="5" id="${p}${k}p" value="${c.l[k].p}"></td><td><input id="${p}${k}d" placeholder="${h}" value="${qa(c.l[k].d)}"></td></tr>`).join("")}</table></div>
<h3 style="margin:22px 0 10px">Protocole MQTT</h3><div class="frm"><div><label>Broker</label><input id="${p}mb" value="${qa(c.m.broker)}" placeholder="xxxx.s1.eu.hivemq.cloud"></div><div><label>Port</label><input type="number" id="${p}mp" value="${c.m.port}"></div><div><label>QoS</label><select id="${p}mq">${[0, 1, 2].map((q) => `<option ${c.m.qos == q ? "selected" : ""}>${q}</option>`).join("")}</select></div><div><label>Keep-alive (s)</label><input type="number" id="${p}mk" value="${c.m.ka}"></div><div><label>Topic de base</label><input id="${p}mtb" value="${qa(c.m.tb)}"></div><div><label>Sécurité</label><label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="${p}mt" ${c.m.tls ? "checked" : ""}> Chiffrement TLS</label></div></div>
<h3 style="margin:22px 0 10px">Canaux d’alerte</h3><div class="sc"><table><tr><th>Canal</th><th>Actif</th><th>Destinataires</th><th>Sévérité min.</th></tr>${AK.map(([k, n, h]) => `<tr><td>${n}</td><td><input type="checkbox" id="${p}${k}ao" ${c.a[k].on ? "checked" : ""}></td><td><input id="${p}${k}ad" placeholder="${h}" value="${qa(c.a[k].d)}"></td><td><select id="${p}${k}as">${["mineure", "majeure", "critique"].map((s) => `<option ${c.a[k].s === s ? "selected" : ""}>${s}</option>`).join("")}</select></td></tr>`).join("")}</table></div>`;
const commRead = (p) => ({ l: Object.fromEntries(LK.map(([k]) => [k, { on: $(p + k + "o").checked, p: +$(p + k + "p").value || 1, d: $(p + k + "d").value.trim() }])), m: { broker: $(p + "mb").value.trim(), port: +$(p + "mp").value || 8883, tls: $(p + "mt").checked, qos: +$(p + "mq").value, ka: +$(p + "mk").value || 60, tb: $(p + "mtb").value.trim() }, a: Object.fromEntries(AK.map(([k]) => [k, { on: $(p + k + "ao").checked, d: $(p + k + "ad").value.trim(), s: $(p + k + "as").value }])) });

/* ---------- État ---------- */
let S = null, EQ = [], AL = [], LIVE = {}, USERS = [], DCFG = DCT(), chan = null, sel = null, savTab = "cfg";
const LIVET = {};
const LOCAL_USERS = [
  { id: "u1", email: "client@demo.ci", pw: "client123", role: "niveau2", eq: ["1", "2", "3", "4"] },
  { id: "u2", email: "demo@speedconnect.ci", pw: "demo", role: "niveau1", eq: ["1", "3"] },
  { id: "u3", email: "sav@sdepannage.com", pw: "sav12345", role: "sav", eq: [] },
  { id: "u4", email: "admin@demo.ci", pw: "admin123", role: "admin", eq: [] },
];
const mkEq = (id, nom, site, domaine, topic) => ({ id, nom, site, domaine, topic, thresholds: {}, comm: null, online: true, last_seen: null, config_rev: 0, config_ack: 0 });
if (!isLive) {
  EQ = [mkEq("1", "Groupe Perkins 100 kVA", "Usine Vridi", "ge", "speedconnect/vridi/ge/1"), mkEq("2", "Centrale SSI Bât. A", "Siège Marcory", "ssi", "speedconnect/marcory/ssi/2"), mkEq("3", "Motopompe incendie MP-1", "Usine Vridi", "pompes", "speedconnect/vridi/pompes/3"), mkEq("4", "Moteur broyeur M-4", "Usine Yopougon", "moteurs", "speedconnect/yopougon/moteurs/4")];
  const t = Date.now();
  AL = [{ id: "a1", eq: "4", msg: "Température moteur au-dessus du seuil", niv: "warn", ts: t - 3 * 6e4, st: "active" }, { id: "a2", eq: "1", msg: "Niveau carburant sous 30 % — ravitaillement conseillé", niv: "warn", ts: t - 12 * 6e4, st: "active" }, { id: "a3", eq: "2", msg: "Test hebdomadaire de la centrale réussi", niv: "ok", ts: t - 864e5, st: "confirmee", at: t - 864e5 + 6e5 }];
  sel = "1";
}
const normAl = (r) => ({ id: r.id, eq: r.equipment_id, msg: r.message, niv: r.severity, ts: r.created_at, st: r.status, by: r.confirmed_by, at: r.confirmed_at });
const ago = (ts) => { const m = Math.max(0, Math.round((Date.now() - new Date(ts)) / 6e4)); return m < 1 ? "à l’instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };
const visEq = () => (!S ? [] : isLive || S.role === "admin" ? EQ : EQ.filter((e) => S.eq.includes(e.id)));

/* ---------- Mesures et cadrans ---------- */
const COL = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)", off: "var(--dim)" };
const thr = (e, i) => { const s = SPEC[e.domaine][i], t = (e.thresholds || {})[s[7]]; return t ? [t.alerte, t.critique] : [s[4], s[5]]; };
const stt = (e, i, v) => { if (v == null) return "off"; const [w, c] = thr(e, i); return SPEC[e.domaine][i][6] ? (v < c ? "crit" : v < w ? "warn" : "ok") : (v > c ? "crit" : v > w ? "warn" : "ok"); };
const sim = (e, i) => { const s = SPEC[e.domaine][i]; return Math.max(0, s[1] + Math.sin(Date.now() / 4000 + (parseInt(e.id, 10) || 1) * 3 + i) * s[2] * .015 + (Math.random() - .5) * s[2] * .01); };
const val = (e, i) => { if (!isLive) return sim(e, i); const v = (LIVE[e.id] || {})[SPEC[e.domaine][i][7]]; return v == null ? null : v; };
function gauge(v, max, lab, unit, s) {
  const nul = v == null, a = nul ? -135 : -135 + 270 * Math.min(1, v / max), col = COL[s];
  const P = (d, r) => { const t = (d - 90) * Math.PI / 180; return [60 + r * Math.cos(t), 62 + r * Math.sin(t)]; };
  const [x1, y1] = P(-135, 44), [x2, y2] = P(135, 44), [nx, ny] = P(a, 36), [vx, vy] = P(a, 44), lg = a + 135 > 180 ? 1 : 0;
  return `<div class="g"><svg viewBox="0 0 120 100"><path d="M${x1} ${y1}A44 44 0 1 1 ${x2} ${y2}" fill="none" stroke="var(--line)" stroke-width="8" stroke-linecap="round"/>${nul ? "" : `<path d="M${x1} ${y1}A44 44 0 ${lg} 1 ${vx} ${vy}" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round"/>`}<line x1="60" y1="62" x2="${nx}" y2="${ny}" stroke="${nul ? "var(--dim)" : "var(--or)"}" stroke-width="2.5" stroke-linecap="round"/><circle cx="60" cy="62" r="4" fill="${nul ? "var(--dim)" : "var(--or)"}"/></svg><div class="n" style="color:${col}">${nul ? "—" : v.toFixed(max <= 30 ? 1 : 0)} <span style="font-size:11px">${nul ? "" : unit}</span></div><div class="t">${lab}</div></div>`;
}
const gset = (e, f = val) => SPEC[e.domaine].map((s, i) => { const v = f(e, i); return gauge(v, s[2], s[0], s[3], stt(e, i, v)); }).join("");
const eqState = (e) => { if (isLive && !e.online) return "off"; let w = "off"; SPEC[e.domaine].forEach((s, i) => { const t = stt(e, i, val(e, i)); if (t === "off") return; if (t === "crit") w = "crit"; else if (t === "warn" && w !== "crit") w = "warn"; else if (w === "off") w = "ok"; }); return w; };

/* ---------- Plans ---------- */
const PL = [{ n: "Éclaireur", p: 15000, x: 2500, pw: "1 à 5 équipements, un site : démarrer simplement.", f: ["5 équipements inclus", "1 site · 2 utilisateurs", "Tableau de bord et cadrans", "Alertes appli et e-mail", "Historique 3 mois"] },
  { n: "Pro", p: 45000, x: 1800, pop: 1, pw: "PME multi-sites avec groupes, pompes et SSI.", f: ["25 équipements inclus", "5 sites · 10 utilisateurs", "Alertes WhatsApp et SMS", "Rapport mensuel PDF", "Historique 12 mois · API"] },
  { n: "Industrie", p: 120000, x: 1200, pw: "Industries et groupes exigeant une disponibilité maximale.", f: ["100 équipements inclus", "Sites et utilisateurs illimités", "Appel vocal et escalade", "SLA 99,9 % · support prioritaire", "Marque blanche · cloud dédié"] }];
const F = (n) => n.toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ") + " FCFA";
$("plans").innerHTML = PL.map((p) => `<div class="card plan ${p.pop ? "pop" : ""}">${p.pop ? '<span class="tag">LE PLUS CHOISI</span>' : ""}<h3>${p.n}</h3><div class="price">${F(p.p)}<small> /mois</small></div><div class="dim" style="font-size:12.5px">puis ${F(p.x)} par équipement en plus</div><ul>${p.f.map((x) => "<li>" + x + "</li>").join("")}</ul><div class="for">Pour qui : ${p.pw}</div><a class="btn ${p.pop ? "" : "ghost"}" target="_blank" rel="noopener" href="https://wa.me/2250708534131?text=${encodeURIComponent("Bonjour, je souhaite la formule " + p.n + " SpeedConnect.")}">Choisir ${p.n}</a></div>`).join("");

/* ---------- Slider ---------- */
let si = 0;
const SL = document.querySelectorAll(".slide"), DT = document.querySelectorAll(".dots i");
function go(n) { si = (n + 3) % 3; SL.forEach((s, i) => s.classList.toggle("on", i === si)); DT.forEach((d, i) => d.classList.toggle("on", i === si)); }
setInterval(() => go(si + 1), 7000);
const heroTick = () => { $("heroG").innerHTML = gset({ id: "1", domaine: "ge" }, sim); };
heroTick(); setInterval(heroTick, 2200);

/* ---------- Données (Supabase) ---------- */
async function loadData() {
  if (!isLive) return;
  const [e, a, m] = await Promise.all([
    sb.from("equipments").select("*").order("nom"),
    sb.from("alerts").select("*").order("created_at", { ascending: false }).limit(100),
    sb.from("latest_measurements").select("*"),
  ]);
  EQ = e.data || []; AL = (a.data || []).map(normAl); LIVE = {};
  (m.data || []).forEach((r) => { (LIVE[r.equipment_id] = LIVE[r.equipment_id] || {})[r.param] = r.value; const t = new Date(r.ts).getTime(); if (!LIVET[r.equipment_id] || t > LIVET[r.equipment_id]) LIVET[r.equipment_id] = t; });
  if (SAV_ROLES.includes(S.role)) { const d = await sb.from("comm_defaults").select("config").eq("id", 1).maybeSingle(); if (d.data) DCFG = mc(d.data.config); const ps = await sb.from("assistant_settings").select("parallel").eq("id", 1).maybeSingle(); if (ps.data && ps.data.parallel) PCFG = { ...PD, ...ps.data.parallel }; }
  sel = EQ[0] ? EQ[0].id : null;
}
let rt = null;
const later = () => { clearTimeout(rt); rt = setTimeout(() => { eqTick(); rAl(); }, 250); };
function subscribe() {
  unsub();
  chan = sb.channel("sc-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "measurements" }, (p) => { const r = p.new; (LIVE[r.equipment_id] = LIVE[r.equipment_id] || {})[r.param] = r.value; LIVET[r.equipment_id] = Date.now(); later(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, (p) => {
      if (p.eventType === "DELETE") AL = AL.filter((x) => x.id !== p.old.id);
      else { const n = normAl(p.new), i = AL.findIndex((x) => x.id === n.id); if (i < 0) { AL.unshift(n); if (n.st === "active") toast("Nouvelle alerte : " + n.msg, n.niv === "crit"); } else AL[i] = n; }
      later();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "equipments" }, (p) => {
      if (p.eventType === "DELETE") EQ = EQ.filter((x) => x.id !== p.old.id);
      else { const i = EQ.findIndex((x) => x.id === p.new.id); if (i < 0) EQ.push(p.new); else EQ[i] = p.new; }
      later();
    })
    .subscribe();
}
const unsub = () => { if (chan) { sb.removeChannel(chan); chan = null; } if (typeof scadaUnsub === "function") scadaUnsub(); };

/* ---------- Authentification ---------- */
async function afterAuth(user) {
  const { data: p } = await sb.from("profiles").select("role").eq("id", user.id).maybeSingle();
  S = { id: user.id, email: user.email, role: (p && p.role) || "niveau1" };
  await loadData(); if (typeof loadScada === "function") { await loadScada(); scadaSub(); } subscribe(); route();
  if ($("adm").classList.contains("show")) rAdm();
}
async function login(k) {
  const em = $(k + "E").value.trim().toLowerCase(), pw = $(k + "P").value, err = $(k + "Err");
  err.textContent = "";
  if (LIVE_DOWN) { err.textContent = "Service injoignable. Vérifiez votre connexion et réessayez."; return; }
  if (isLive) {
    const { data, error } = await sb.auth.signInWithPassword({ email: em, password: pw });
    if (error) { err.textContent = "E-mail ou mot de passe incorrect."; return; }
    await afterAuth(data.user); return;
  }
  const u = LOCAL_USERS.find((x) => x.email === em && x.pw === pw);
  if (!u) { err.textContent = "E-mail ou mot de passe incorrect."; return; }
  S = u; route();
}
async function demoIn() {
  if (isLive) { const { data, error } = await sb.auth.signInWithPassword({ email: CFG.demoEmail, password: CFG.demoPassword }); if (!error) await afterAuth(data.user); return; }
  S = LOCAL_USERS[1]; route();
}
async function out() {
  if (isLive) { unsub(); await sb.auth.signOut(); EQ = []; AL = []; LIVE = {}; }
  S = null; route();
}
if (isLive) sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && S) { unsub(); S = null; EQ = []; AL = []; LIVE = {}; route(); } });

const loginHTML = (k, t, d, demo) => `<div class="wrap"><div class="card lg"><div class="eyebrow">${t}</div><h2>${t}</h2><p class="dim" style="margin-top:8px">${d}</p><label>E-mail</label><input id="${k}E" type="email" autocomplete="username"><label>Mot de passe</label><input id="${k}P" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')login('${k}')"><div class="err" id="${k}Err"></div><button class="btn" onclick="login('${k}')">Se connecter</button>${demo && (!isLive || CFG.demoEmail) ? '<button class="btn ghost" onclick="demoIn()">Voir la démo</button>' : ""}${!isLive && typeof trialHTML === "function" ? trialHTML() : ""}</div></div>`;
const gate = (k, t, d, allowed, demo) => {
  if (!S) return loginHTML(k, t, d, demo);
  if (!allowed.includes(S.role)) return `<div class="wrap"><div class="card lg"><h2>${t}</h2><p class="dim" style="margin:10px 0 16px">Ce compte (${ROLES[S.role]}) n’a pas accès à cet espace.</p><button class="btn" onclick="out()">Changer de compte</button></div></div>`;
  return null;
};

/* ---------- Mon espace ---------- */
function rEsp() {
  const c = $("espace"), g = gate("espace", "Mon espace", "Connectez-vous pour suivre vos équipements en temps réel.", VIEW_ROLES, 1);
  if (g) { c.innerHTML = g; return; }
  c.innerHTML = `<div class="wrap"><div class="bar"><div><div class="eyebrow">Mon espace</div><h2>Mes équipements</h2></div><div class="who"><span class="mono">${S.email}</span><span class="lv">${ROLES[S.role].toUpperCase()}</span><button class="btn ghost" onclick="out()">Déconnexion</button></div></div><div class="note">${S.role === "niveau1" ? "Niveau 1 : consultation en temps réel. La confirmation des alertes est réservée au niveau 2." : "Consultation en temps réel et confirmation des alertes."}</div><div id="eqA"></div><h3 style="margin:24px 0 12px">Alertes</h3><div id="alA"></div></div>`;
  eqTick(); rAl();
}
function eqTick() {
  const a = $("eqA"); if (!a || !S) return;
  const L = { ok: "EN SERVICE", warn: "ALERTE", crit: "CRITIQUE", off: "HORS LIGNE" };
  a.innerHTML = visEq().map((e) => { const s = eqState(e); return `<div class="card eq"><div class="eh"><div><b>${e.nom}</b><div class="dim" style="font-size:12.5px">${DOM[e.domaine]} · ${e.site || "—"}</div></div><span class="pill" style="color:${COL[s]}">● ${L[s]}</span></div><div class="g4">${gset(e)}</div></div>`; }).join("") || '<div class="dim">Aucun équipement affecté à ce compte.</div>';
}
function rAl() {
  const a = $("alA"); if (!a || !S) return;
  const ids = visEq().map((e) => e.id), L = AL.filter((x) => ids.includes(x.eq));
  a.innerHTML = L.map((x) => {
    const e = EQ.find((y) => y.id === x.eq) || { nom: "—" }, act = x.st === "active";
    const tail = act ? "" : x.st === "confirmee" ? " · confirmée" + (x.at ? " " + ago(x.at) : "") : " · résolue";
    const right = act ? (CONFIRM_ROLES.includes(S.role) ? `<button class="btn" onclick="conf('${x.id}')">Confirmer</button>` : '<span class="pill dim">🔒 Niveau 2</span>') : x.st === "confirmee" ? '<span class="pill" style="color:var(--ok)">✓ Confirmée</span>' : '<span class="pill dim">Résolue</span>';
    return `<div class="al"><span class="d" style="background:${act ? COL[x.niv] || COL.warn : "var(--ok)"}"></span><div>${x.msg}<small>${e.nom} · ${ago(x.ts)}${tail}</small></div>${right}</div>`;
  }).join("") || '<div class="dim">Aucune alerte.</div>';
}
async function conf(id) {
  const a = AL.find((x) => x.id === id);
  if (!a || !S || !CONFIRM_ROLES.includes(S.role)) return;
  if (isLive) { const { error } = await sb.rpc("confirm_alert", { p_alert: id }); if (error) { toast("Échec : " + error.message, 1); return; } }
  a.st = "confirmee"; a.at = new Date().toISOString(); a.by = S.id;
  rAl(); toast("Alerte confirmée");
}

/* ---------- Espace SAV ---------- */
function rSav() {
  const c = $("sav"), g = gate("sav", "Espace SAV", "Réservé aux techniciens et collaborateurs SpeedConnect.", SAV_ROLES);
  if (g) { c.innerHTML = g; return; }
  const e = EQ.find((x) => x.id === sel) || EQ[0];
  const head = `<div class="bar"><div><div class="eyebrow">Espace SAV</div><h2>Configuration des équipements</h2></div><div class="who"><span class="mono">${S.email}</span><button class="btn ghost" onclick="out()">Déconnexion</button></div></div>`;
  const tabs = savTabs();
  if (savTab !== "cfg") { c.innerHTML = `<div class="wrap">${head}${tabs}<div id="asst"></div></div>`; asstRender(); return; }
  const add = `<div><label>Nouveau type</label><div style="display:flex;gap:8px"><select id="nd">${Object.keys(DOM).map((k) => `<option value="${k}">${DOM[k]}</option>`).join("")}</select><button class="btn" style="padding:8px 14px" onclick="addEq()">+</button></div></div>`;
  if (!e) { c.innerHTML = `<div class="wrap">${head}${tabs}<div class="card"><div class="frm">${add}</div><p class="dim" style="margin-top:12px">Aucun équipement. Ajoutez-en un pour commencer.</p></div></div>`; return; }
  sel = e.id; const sp = SPEC[e.domaine];
  const stat = isLive ? `<div class="note" style="margin:16px 0 0">${e.online ? "🟢 En ligne" : "⚪ Hors ligne"}${e.last_seen ? " · vu " + ago(e.last_seen) : ""} · configuration révision ${e.config_rev} ${e.config_ack === e.config_rev ? "✓ appliquée par le coffret" : "⏳ en attente du coffret"}</div>` : "";
  c.innerHTML = `<div class="wrap">${head}${tabs}<div class="card"><div class="frm"><div><label>Équipement</label><select onchange="sel=this.value;rSav()">${EQ.map((x) => `<option value="${x.id}" ${x.id === e.id ? "selected" : ""}>${x.nom}</option>`).join("")}</select></div>${add}</div>${stat}
<div class="frm" style="margin-top:16px"><div><label>Nom</label><input id="fn" value="${qa(e.nom)}"></div><div><label>Site</label><input id="fs" value="${qa(e.site || "")}"></div><div><label>Topic MQTT</label><input id="ft" value="${qa(e.topic || "")}"></div></div>
<div class="sc" style="margin-top:16px"><table><tr><th>Paramètre</th><th>Unité</th><th>Seuil alerte</th><th>Seuil critique</th><th>Sens</th></tr>${sp.map((s, i) => { const t = thr(e, i); return `<tr><td>${s[0]}</td><td>${s[3] || "—"}</td><td><input type="number" step="any" id="tw${i}" value="${t[0]}"></td><td><input type="number" step="any" id="tc${i}" value="${t[1]}"></td><td class="dim">${s[6] ? "alerte si inférieur" : "alerte si supérieur"}</td></tr>`; }).join("")}</table></div>
${ctrlHTML(e)}${commHTML("s", mc(e.comm || DCFG))}<div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap"><button class="btn" onclick="saveEq('${e.id}')">Enregistrer</button>${!isLive || S.role === "admin" ? `<button class="btn ghost" onclick="delEq('${e.id}')">Supprimer l’équipement</button>` : ""}</div></div></div>`;
}
async function saveEq(id) {
  const e = EQ.find((x) => x.id === id); if (!e) return;
  const th = {};
  SPEC[e.domaine].forEach((s, i) => { const w = parseFloat($("tw" + i).value), c = parseFloat($("tc" + i).value); if (Number.isFinite(w) && Number.isFinite(c)) th[s[7]] = { alerte: w, critique: c }; });
  const ctl = ctrlRead(); if (ctl._bad) { toast("Registres : ligne(s) invalide(s) " + ctl._bad, 1); return; } delete ctl._bad;
  const patch = { nom: $("fn").value.trim() || e.nom, site: $("fs").value.trim(), topic: $("ft").value.trim() || e.topic, thresholds: th, comm: commRead("s"), controller: ctl };
  if (isLive) { const { data, error } = await sb.from("equipments").update(patch).eq("id", id).select().single(); if (error) { toast("Échec : " + error.message, 1); return; } Object.assign(e, data); }
  else Object.assign(e, patch);
  rSav(); toast("Configuration enregistrée");
}
async function addEq() {
  const dom = $("nd").value || "ge", row = { nom: "Nouvel équipement", site: "", domaine: dom, topic: `speedconnect/nouveau/${dom}/${Date.now() % 1e6}` };
  if (isLive) { const { data, error } = await sb.from("equipments").insert(row).select().single(); if (error) { toast("Échec : " + error.message, 1); return; } EQ.push(data); sel = data.id; }
  else { const id = String(Date.now() % 1e7); EQ.push({ ...mkEq(id, row.nom, "", dom, row.topic), online: false }); sel = id; }
  rSav();
}
async function delEq(id) {
  if (isLive) { const { error } = await sb.from("equipments").delete().eq("id", id); if (error) { toast("Échec : " + error.message, 1); return; } }
  else LOCAL_USERS.forEach((u) => { u.eq = u.eq.filter((x) => x !== id); });
  EQ = EQ.filter((x) => x.id !== id); sel = EQ[0] ? EQ[0].id : null; rSav();
}

/* ---------- Mode Admin : 7 clics sur le logo ---------- */
let kc = 0, kt, adminOK = false, admTab = "u", admSel = "d";
$("logo").onclick = () => { kc++; clearTimeout(kt); kt = setTimeout(() => (kc = 0), 2200); if (kc >= 7) { kc = 0; $("adm").classList.add("show"); rAdm(); } };
const closeAdm = () => { $("adm").classList.remove("show"); adminOK = false; };
const admHead = () => `<div class="bar"><div><div class="eyebrow">Mode Admin</div><h2>${admTab === "u" ? "Comptes &amp; niveaux d’accès" : admTab === "p" ? "Assistants" : "Canaux de communication"}</h2></div><button class="btn ghost" onclick="closeAdm()">Fermer</button></div><div style="display:flex;gap:8px;margin-bottom:16px"><button class="btn ${admTab === "u" ? "" : "ghost"}" style="padding:8px 16px" onclick="admTab='u';rAdm()">Comptes</button><button class="btn ${admTab === "c" ? "" : "ghost"}" style="padding:8px 16px" onclick="admTab='c';rAdm()">Canaux de communication</button><button class="btn ${admTab === "p" ? "" : "ghost"}" style="padding:8px 16px" onclick="admTab='p';rAdm()">Assistants</button></div>`;
async function rAdm() {
  const B = $("admB");
  if (isLive) {
    if (!S) { B.innerHTML = `<div class="eyebrow">Mode Admin</div><h2>Accès administrateur</h2><label class="dim" style="display:block;margin:14px 0 5px;font-size:12.5px">E-mail</label><input id="aE" type="email"><label class="dim" style="display:block;margin:12px 0 5px;font-size:12.5px">Mot de passe</label><input id="aP" type="password" onkeydown="if(event.key==='Enter')login('a')"><div class="err" id="aErr"></div><button class="btn" style="margin-top:10px" onclick="login('a')">Se connecter</button>`; return; }
    if (S.role !== "admin") { B.innerHTML = `<h2>Accès réservé</h2><p class="dim" style="margin:10px 0 16px">Le mode Admin est réservé aux comptes administrateurs.</p><button class="btn ghost" onclick="closeAdm()">Fermer</button>`; return; }
  } else if (!adminOK) {
    B.innerHTML = `<div class="eyebrow">Mode Admin</div><h2>Accès administrateur</h2><label class="dim" style="display:block;margin:14px 0 5px;font-size:12.5px">Code</label><input id="ac" type="password" onkeydown="if(event.key==='Enter')admIn()"><div class="err" id="aErr"></div><button class="btn" style="margin-top:10px" onclick="admIn()">Déverrouiller</button>`; return;
  }
  if (admTab === "c") admComm(); else if (admTab === "p") admPar(); else await admUsers();
}
function admIn() { if ($("ac").value === "SDRB2026") { adminOK = true; rAdm(); } else $("aErr").textContent = "Code incorrect."; }
async function admUsers() {
  if (isLive) {
    const [p, u] = await Promise.all([sb.from("profiles").select("id,email,role").order("email"), sb.from("user_equipments").select("*")]);
    USERS = (p.data || []).map((x) => ({ ...x, eq: (u.data || []).filter((y) => y.user_id === x.id).map((y) => y.equipment_id) }));
  } else USERS = LOCAL_USERS;
  const SM = await scAdmLoad();
  const self = (u) => isLive && S && u.id === S.id;
  $("admB").innerHTML = admHead() + `<div class="sc"><table><tr><th>E-mail</th><th>Niveau</th><th>Équipements</th>${isLive ? "<th>Unités SCADA</th>" : "<th></th>"}</tr>${USERS.map((u, i) => `<tr><td>${u.email}</td><td><select ${self(u) ? "disabled" : ""} onchange="setRole(${i},this.value)">${Object.keys(ROLES).map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${ROLES[r]}</option>`).join("")}</select></td><td>${u.role === "sav" || u.role === "admin" ? '<span class="dim">Tous</span>' : EQ.map((e) => `<label style="display:inline-flex;gap:4px;margin-right:10px;font-size:12.5px"><input type="checkbox" ${u.eq.includes(e.id) ? "checked" : ""} onchange="tgEq(${i},'${e.id}')">${e.nom}</label>`).join("") || '<span class="dim">Aucun équipement</span>'}</td>${isLive ? `<td>${scAdmCell(u, i, SM)}</td>` : `<td><button class="btn ghost" style="padding:6px 12px" onclick="delU(${i})">✕</button></td>`}</tr>`).join("")}</table></div>` +
    (isLive ? `<p class="dim" style="margin-top:16px;font-size:13px">Pour ajouter un utilisateur : Supabase › Authentication › Users › « Invite user ». Il apparaît ici avec le niveau 1 ; ajustez ensuite son niveau et ses équipements.</p>`
      : `<h3 style="margin:22px 0 10px">Créer un compte</h3><div class="frm"><div><label>E-mail</label><input id="ne" type="email"></div><div><label>Mot de passe</label><input id="np" type="text"></div><div><label>Niveau</label><select id="nl2">${Object.keys(ROLES).filter((r) => r !== "admin").map((r) => `<option value="${r}">${ROLES[r]}</option>`).join("")}</select></div></div><button class="btn" style="margin-top:14px" onclick="addU()">Créer le compte</button><div class="err" id="aErr"></div>`);
}
async function setRole(i, v) {
  const u = USERS[i];
  if (isLive) { const { error } = await sb.from("profiles").update({ role: v }).eq("id", u.id); if (error) toast("Échec : " + error.message, 1); } else u.role = v;
  admUsers();
}
async function tgEq(i, eid) {
  const u = USERS[i], has = u.eq.includes(eid);
  if (isLive) {
    const { error } = has ? await sb.from("user_equipments").delete().eq("user_id", u.id).eq("equipment_id", eid) : await sb.from("user_equipments").insert({ user_id: u.id, equipment_id: eid });
    if (error) { toast("Échec : " + error.message, 1); admUsers(); return; }
  }
  u.eq = has ? u.eq.filter((x) => x !== eid) : [...u.eq, eid];
}
function delU(i) { LOCAL_USERS.splice(i, 1); admUsers(); }
function addU() {
  const em = $("ne").value.trim().toLowerCase(), pw = $("np").value, r = $("nl2").value;
  if (!em || pw.length < 4 || LOCAL_USERS.some((u) => u.email === em)) { $("aErr").textContent = "E-mail manquant ou existant, mot de passe de 4 caractères minimum."; return; }
  LOCAL_USERS.push({ id: "u" + Date.now(), email: em, pw, role: r, eq: [] }); admUsers();
}
function admComm() {
  const t = admSel === "d" ? DCFG : mc((EQ.find((x) => x.id === admSel) || {}).comm || DCFG);
  $("admB").innerHTML = admHead() + `<label class="dim" style="display:block;font-size:12.5px;margin-bottom:5px">Appliquer à</label><select onchange="admSel=this.value;rAdm()"><option value="d">Modèle par défaut (équipements sans réglage propre)</option>${EQ.map((e) => `<option value="${e.id}" ${admSel === e.id ? "selected" : ""}>${e.nom}</option>`).join("")}</select>${commHTML("a", mc(t))}<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px"><button class="btn" onclick="admSave()">Enregistrer</button>${admSel === "d" ? '<button class="btn ghost" onclick="admAll()">Appliquer à tous les équipements</button>' : ""}</div>`;
}
async function admSave() {
  const c = commRead("a");
  if (admSel === "d") {
    if (isLive) { const { error } = await sb.from("comm_defaults").update({ config: c }).eq("id", 1); if (error) { toast("Échec : " + error.message, 1); return; } }
    DCFG = c;
  } else {
    const e = EQ.find((x) => x.id === admSel); if (!e) return;
    if (isLive) { const { data, error } = await sb.from("equipments").update({ comm: c }).eq("id", e.id).select().single(); if (error) { toast("Échec : " + error.message, 1); return; } Object.assign(e, data); } else e.comm = c;
  }
  toast("Canaux enregistrés");
}
async function admAll() {
  const c = commRead("a");
  if (isLive) {
    const r1 = await sb.from("comm_defaults").update({ config: c }).eq("id", 1);
    const r2 = await sb.from("equipments").update({ comm: c }).not("id", "is", null);
    if (r1.error || r2.error) { toast("Échec : " + ((r1.error || r2.error).message), 1); return; }
  }
  DCFG = c; EQ.forEach((e) => (e.comm = JSON.parse(JSON.stringify(c))));
  toast("Appliqué à tous les équipements");
}

/* ---------- Divers et routage ---------- */
function toast(m, bad) { const t = $("toast"); t.textContent = m; t.style.background = bad ? "var(--crit)" : "var(--ok)"; t.style.color = bad ? "#fff" : "#04210f"; t.style.display = "block"; setTimeout(() => (t.style.display = "none"), 2600); }
function route() {
  const h = curH() || "accueil", v = h === "espace" || h === "sav" || h === "scada";
  $("site").style.display = v ? "none" : "block"; $("espace").style.display = h === "espace" ? "block" : "none"; $("sav").style.display = h === "sav" ? "block" : "none"; $("scada").style.display = h === "scada" ? "block" : "none"; $("nl").classList.remove("open");
  if (v) { rEsp(); rSav(); rScada(); scrollTo(0, 0); } else { const t = $(h); if (t) t.scrollIntoView(); }
}
// Navigation interne : les liens #ancre ne dépendent plus de l'URL du document (aperçus intégrés, iframes srcdoc, fichiers isolés)
let navH;
const curH = () => (navH !== undefined ? navH : location.hash.slice(1));
function navTo(h) {
  navH = h;
  try { history.pushState(null, "", "#" + h); } catch (e) { /* URL non modifiable : le routage interne suffit */ }
  const nl = $("nl"); if (nl) nl.classList.remove("open");
  route();
}
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a) return;
  const h = a.getAttribute("href").slice(1); if (!h || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault(); navTo(h);
}, true);
const fromUrl = () => { navH = undefined; route(); };
addEventListener("hashchange", fromUrl); addEventListener("popstate", fromUrl);
setInterval(() => { if (curH() === "espace") eqTick(); }, isLive ? 5000 : 2200);
(async () => {
  if (isLive) { const { data } = await sb.auth.getSession(); if (data.session) { await afterAuth(data.session.user); return; } }
  route();
})();
