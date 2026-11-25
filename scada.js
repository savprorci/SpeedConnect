"use strict";
/* ===== SCADA SpeedConnect : multi-protocole, interface conçue par IA à partir d'un texte =====
   Niveaux : niveau1 consulte · niveau2 acquitte les alarmes · sav configure (IA, sources, tags) et publie · admin supprime et gère les accès.
   Aucune commande n'est envoyée vers les automates : supervision et acquittement uniquement. */
const SC_ROLES = ["niveau1", "niveau2", "sav", "admin"];
const PROTO = {
  "modbus-tcp": { n: "Modbus TCP", f: [["host", "Adresse IP", ""], ["port", "Port", "502"], ["unit", "Adresse esclave", "1"]], a: "HR100 · IR100 · C5 · DI5 (maintien, entrée, bobine, entrée TOR ; base 0)", ty: "u16" },
  "modbus-rtu": { n: "Modbus RTU (RS-485)", f: [["port", "Port série / passerelle", "RS485-1"], ["baud", "Débit (bauds)", "9600"], ["par", "Parité", "N"], ["unit", "Adresse esclave", "1"]], a: "HR100 · IR100 · C5 · DI5 (base 0)", ty: "u16" },
  "opcua": { n: "OPC UA", f: [["endpoint", "Endpoint", "opc.tcp://IP:4840"], ["secu", "Sécurité", "SignAndEncrypt"]], a: "NodeId : ns=2;s=Zone.Tag", ty: "f32" },
  "s7": { n: "Siemens S7", f: [["host", "Adresse IP", ""], ["rack", "Rack", "0"], ["slot", "Slot", "1"]], a: "DB10.DBD0 (réel), DB10.DBW0 (entier), DB10.DBX0.0 (bit)", ty: "f32" },
  "mqtt": { n: "MQTT", f: [["broker", "Broker", ""], ["base", "Topic de base", ""]], a: "sous-topic ou topic#chemin.json", ty: "f32" },
  "http": { n: "HTTP / REST (JSON)", f: [["url", "URL de base", "https://"]], a: "chemin JSON : $.zone.mesure", ty: "f32" },
  "bacnet": { n: "BACnet/IP", f: [["host", "Adresse IP", ""], ["dev", "Device ID", ""]], a: "AI:1 · AV:2 · BI:3", ty: "f32" },
  "iec104": { n: "IEC 60870-5-104", f: [["host", "Adresse IP", ""], ["port", "Port", "2404"], ["asdu", "Adresse ASDU", "1"]], a: "IOA:1000", ty: "f32" },
  "dnp3": { n: "DNP3", f: [["host", "Adresse IP", ""], ["port", "Port", "20000"], ["out", "Adresse outstation", "1"]], a: "AI:5 · BI:2", ty: "f32" },
  "enip": { n: "EtherNet/IP (Allen-Bradley)", f: [["host", "Adresse IP", ""], ["slot", "Slot CPU", "0"]], a: "nom de tag automate", ty: "f32" },
  "snmp": { n: "SNMP", f: [["host", "Adresse IP", ""], ["ver", "Version", "v2c"]], a: "OID : 1.3.6.1.4.1…", ty: "f32" },
  "ana": { n: "Entrées analogiques 4-20 mA / 0-10 V", f: [["mod", "Module d'E/S", ""]], a: "AI1, AI2…", ty: "u16" },
  "lora": { n: "LoRaWAN", f: [["app", "Application / serveur réseau", ""]], a: "DEVEUI:champ", ty: "f32" },
};
const TYPES = ["u16", "s16", "u32", "s32", "f32", "bool"], WIDGETS = { gauge: "Cadran", bar: "Barre", tank: "Réservoir", value: "Valeur + courbe", state: "Marche / arrêt" };
const PROT_RE = /modbus|opc[\s-]?ua|siemens|simatic|\bs7\b|mqtt|bacnet|dnp3|iec|104|ethernet\/ip|rockwell|allen|snmp|4-?20|analogique|lora|\brest\b|http|protocole/i;
const PROT_KEYS = [[/modbus\s*rtu|rs-?485/i, "modbus-rtu"], [/modbus/i, "modbus-tcp"], [/opc[\s-]?ua/i, "opcua"], [/siemens|simatic|\bs7\b/i, "s7"], [/mqtt/i, "mqtt"], [/bacnet/i, "bacnet"], [/dnp3/i, "dnp3"], [/iec.?60870|\b104\b/i, "iec104"], [/ethernet\/ip|rockwell|allen/i, "enip"], [/snmp/i, "snmp"], [/4-?20|0-?10 ?v|analogique/i, "ana"], [/lora/i, "lora"], [/\brest\b|\bhttp|\bapi\b/i, "http"]];
/* Catalogue d'équipements : clé|libellé|unité|nominal|max|alerte|critique|bas(1)|affichage. Valeurs usuelles PROPOSÉES, à valider avec l'exploitant. */
const KIND = {
  pompe: ["💧", "pression|Pression|bar|6|15|4|2|1|gauge;debit|Débit|m³/h|110|200|60|30|1|bar;temperature|Température|°C|52|100|60|80|0|gauge;vibration|Vibration|mm/s|2.4|10|4.5|7|0|value"],
  moteur: ["⚙️", "courant|Courant|A|16|30|22|26|0|gauge;temperature|Température|°C|70|150|90|110|0|gauge;vibration|Vibration|mm/s|2.2|10|4.5|7|0|value;charge|Charge|%|64|100|85|95|0|bar"],
  concasseur: ["🪨", "courant|Courant|A|120|250|180|215|0|gauge;vibration|Vibration|mm/s|3|15|7|10|0|value;temp_palier|Temp. palier|°C|60|130|90|105|0|gauge;debit|Débit matière|t/h|150|300|60|30|1|bar"],
  crible: ["🔲", "vibration|Vibration|mm/s|3|15|7|10|0|value;courant|Courant|A|25|60|45|52|0|gauge;marche|Marche||1|1|||0|state"],
  convoyeur: ["➡️", "courant|Courant|A|18|40|30|36|0|gauge;vitesse|Vitesse|m/s|2|4|1|.5|1|bar;marche|Marche||1|1|||0|state"],
  cuve: ["🛢️", "niveau|Niveau|%|65|100|20|10|1|tank;temperature|Température|°C|30|80|50|65|0|value"],
  secheur: ["🔥", "temperature|Température|°C|90|250|120|140|0|gauge;humidite|Humidité|%|45|100|70|85|0|bar;ventilateur|Ventilateur||1|1|||0|state"],
  fermentation: ["🫘", "temperature|Température|°C|46|70|52|55|0|gauge;ph|pH||4.5|14|7|8|0|value;niveau|Remplissage|%|70|100|15|8|1|tank"],
  latex: ["🥛", "niveau|Niveau|%|65|100|20|10|1|tank;ph|pH||5|14|6.5|7.5|0|value;temperature|Température|°C|30|80|45|55|0|value"],
  presse: ["🗜️", "pression|Pression hydraulique|bar|180|350|270|310|0|gauge;temp_huile|Temp. huile|°C|45|120|65|80|0|gauge;courant|Courant|A|40|90|70|80|0|bar"],
  compresseur: ["🌀", "pression|Pression|bar|7.5|12|5.5|4.5|1|gauge;temperature|Température|°C|75|130|100|110|0|gauge;courant|Courant|A|30|70|55|62|0|bar"],
  groupe: ["🔋", "carburant|Carburant|%|70|100|30|15|1|tank;huile|Pression d'huile|bar|4.2|10|2.5|1.5|1|gauge;eau_moteur|Eau moteur|°C|78|150|95|105|0|gauge;batterie|Batterie|V|12.8|15|12|11.5|1|value"],
  transfo: ["⚡", "temperature|Température|°C|60|150|90|105|0|gauge;courant|Courant|A|120|400|320|370|0|bar;tension|Tension|V|400|500|370|350|1|value"],
  effluent: ["🧪", "ph|pH||7|14|8.5|9.5|0|value;turbidite|Turbidité|NTU|20|200|50|100|0|bar;debit|Débit|m³/h|15|60|45|55|0|value"],
  poussiere: ["🌫️", "pm10|Poussières PM10|µg/m³|40|500|150|300|0|gauge;arrosage|Arrosage actif||1|1|||0|state"],
  pesage: ["⚖️", "poids|Poids|t|20|60|||0|value;marche|Balance||1|1|||0|state"],
  ventilateur: ["🌬️", "courant|Courant|A|12|30|22|26|0|gauge;vibration|Vibration|mm/s|2|10|4.5|7|0|value;temperature|Température|°C|55|120|80|95|0|value"],
  autre: ["📟", "mesure|Mesure|||100|||0|value"],
};
const ALIAS = [[/groupe [ée]lectrog|g[ée]n[ée]ratrice/i, "groupe"], [/transfo/i, "transfo"], [/concasseur/i, "concasseur"], [/crible|tamis|trommel/i, "crible"], [/convoyeur|tapis|bande transp/i, "convoyeur"], [/ferment/i, "fermentation"], [/latex|coagul/i, "latex"], [/effluent|traitement des eaux|[ée]puration|lagunage/i, "effluent"], [/poussi[èe]re|pm10|empoussi/i, "poussiere"], [/bascule|pesage|balance/i, "pesage"], [/s[ée]choir|\bfour\b|torr[ée]f|[ée]tuve|st[ée]rilis/i, "secheur"], [/presse|pressoir/i, "presse"], [/compresseur/i, "compresseur"], [/ventilat|extracteur/i, "ventilateur"], [/pompe|exhaure|surpresseur|forage/i, "pompe"], [/silo|cuve|r[ée]servoir|\bbac\b|bassin|tr[ée]mie|citerne|ch[âa]teau d/i, "cuve"], [/broyeur|laminoir|malaxeur|moulin|moteur|digesteur|d[ée]cortiqueur|d[ée]cortiqueuse/i, "moteur"]];
const SECT = {
  hevea: { n: "Hévéa", re: /h[ée]v[ée]a|caoutchouc|latex/i, z: ["Cuve de réception du latex", "Bac de coagulation 1", "Bac de coagulation 2", "Laminoir", "Broyeur à crêpe", "Séchoir", "Presse à balles", "Station de traitement des effluents", "Groupe électrogène"] },
  cacao: { n: "Cacao", re: /cacao|chocolat|f[èe]ves/i, z: ["Silo de réception des fèves", "Caisse de fermentation", "Séchoir", "Torréfacteur", "Broyeur de fèves", "Presse à beurre", "Cuve de beurre", "Compresseur", "Groupe électrogène"] },
  carriere: { n: "Carrière", re: /carri[èe]re|granit|gravier|concass/i, z: ["Concasseur primaire", "Concasseur secondaire", "Crible", "Convoyeur 1", "Convoyeur 2", "Pompe d'exhaure", "Capteur de poussière", "Pont-bascule", "Transformateur", "Groupe électrogène"] },
  palmier: { n: "Huile de palme", re: /palm/i, z: ["Stérilisateur", "Digesteur", "Presse", "Cuve de clarification", "Séchoir", "Chaudière", "Station de traitement des effluents", "Groupe électrogène"] },
  eau: { n: "Eau", re: /station de pompage|ch[âa]teau d.eau|adduction|potable|forage/i, z: ["Pompe de forage", "Surpresseur", "Château d'eau", "Cuve de chloration", "Groupe électrogène"] },
};
const EX = { hevea: "Usine de traitement d'hévéa : cuve de réception du latex, 2 bacs de coagulation, laminoir, broyeur à crêpe, séchoir, presse à balles, station de traitement des effluents, groupe électrogène. Protocole Modbus TCP.", carriere: "Carrière de granit : concasseur primaire, concasseur secondaire, 2 cribles, 3 convoyeurs, pompe d'exhaure, capteur de poussière, pont-bascule, transformateur, groupe électrogène. OPC UA et Modbus RTU.", cacao: "Usine de transformation du cacao : silo de réception des fèves, caisses de fermentation, séchoir, torréfacteur, broyeur de fèves, presse à beurre, cuve de beurre, compresseur. Modbus TCP et MQTT." };

/* ---------- Utilitaires ---------- */
const slug = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const hashS = (s) => { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return Math.abs(h); };
const num = (v) => (v === "" || v == null || !Number.isFinite(+v) ? null : +v);
const kindOf = (s) => { const a = ALIAS.find(([re]) => re.test(s)); return a ? a[1] : null; };
const NUMW = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };
const mkTags = (kind) => KIND[kind][1].split(";").map((s) => { const [k, l, u, nom, max, w, c, low, wd] = s.split("|"); return { k, l, u, nom: +nom, max: +max, w: num(w), c: num(c), low: low === "1", wd }; });
const protoOf = (txt) => { const o = []; const t = String(txt || ""); PROT_KEYS.forEach(([re, k]) => { if (re.test(t) && !o.includes(k)) { if (k === "modbus-tcp" && o.includes("modbus-rtu") && !/modbus\s*tcp/i.test(t)) return; o.push(k); } }); return o; };
const defP = (p) => Object.fromEntries(PROTO[p].f.map(([k, , d]) => [k, d]));
const bare = (z, t) => t.k.startsWith(z.id + "_") ? t.k.slice(z.id.length + 1) : t.k;
const ADDR = { "modbus-tcp": (n) => "HR" + (100 + n), "modbus-rtu": (n) => "HR" + (100 + n), opcua: (n, z, t) => `ns=2;s=${slug(z.nom)}.${bare(z, t)}`, s7: (n) => `DB10.DBD${n * 4}`, mqtt: (n, z, t) => `${z.id}/${bare(z, t)}`, http: (n, z, t) => `$.${z.id}.${bare(z, t)}`, bacnet: (n) => "AI:" + (n + 1), iec104: (n) => "IOA:" + (1000 + n), dnp3: (n) => "AI:" + n, enip: (n, z, t) => `${slug(z.nom)}_${bare(z, t)}`, snmp: (n) => "1.3.6.1.4.1.99999.1." + (n + 1), ana: (n) => "AI" + (n + 1), lora: (n, z, t) => "DEVEUI:" + bare(z, t) };
function fillAddr(spec) {
  const cnt = {}; spec.zones.forEach((z) => z.tags.forEach((t) => { if (t.addr) cnt[t.src] = (cnt[t.src] || 0) + 1; }));
  spec.zones.forEach((z) => z.tags.forEach((t) => { if (t.addr) return; const s = spec.sources.find((x) => x.id === t.src) || spec.sources[0]; if (!s) return; const n = cnt[s.id] = (cnt[s.id] || 0); cnt[s.id]++; t.src = s.id; t.addr = ADDR[s.proto](n, z, t); t.ty = t.ty || PROTO[s.proto].ty; t.sc = t.sc ?? 1; t.chk = true; }));
}
/* Nettoyage de toute spécification (IA ou saisie) : structure, types et bornes. Idempotent : les identifiants de zones et clés de tags sont conservés. */
const tagKey = (zid, k) => (k.startsWith(zid + "_") ? k : zid + "_" + k);
const nextZ = (spec) => Math.max(0, ...spec.zones.map((z) => +String(z.id).slice(1) || 0)) + 1;
function normSpec(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const sources = (Array.isArray(r.sources) ? r.sources : []).slice(0, 8).map((s, i) => { const proto = PROTO[s && s.proto] ? s.proto : "modbus-tcp"; return { id: "s" + (i + 1), _o: s && s.id, nom: String((s && s.nom) || PROTO[proto].n).slice(0, 60), proto, p: { ...defP(proto), ...Object.fromEntries(Object.entries((s && s.p) || {}).filter(([k]) => PROTO[proto].f.some((f) => f[0] === k)).map(([k, v]) => [k, String(v).slice(0, 120)])) } }; });
  if (!sources.length) sources.push({ id: "s1", nom: PROTO["modbus-tcp"].n, proto: "modbus-tcp", p: defP("modbus-tcp") });
  const src = (x) => sources.find((s) => s._o === x || s.id === x) || sources[0], used = new Set(), pairs = [];
  (Array.isArray(r.zones) ? r.zones : []).slice(0, 24).forEach((z) => {
    if (!z || !Array.isArray(z.tags) || !z.tags.length) return;
    let id = /^z\d+$/.test(z.id) && !used.has(z.id) ? z.id : null;
    if (!id) { let n = 1; while (used.has("z" + n) || (r.zones || []).some((o) => o && o !== z && o.id === "z" + n)) n++; id = "z" + n; }
    used.add(id);
    const kind = KIND[z.kind] ? z.kind : "autre", seen = new Set();
    const tags = z.tags.slice(0, 12).map((t) => {
      t = t || {}; let k = tagKey(id, slug(t.k).slice(0, 30) || "mesure"); while (seen.has(k)) k += "_"; seen.add(k);
      const s = src(t.src);
      return { k, l: String(t.l || t.k || "Mesure").slice(0, 40), u: String(t.u || "").slice(0, 12), nom: num(t.nom) ?? 0, max: num(t.max) || 100, w: num(t.w), c: num(t.c), low: !!t.low, wd: WIDGETS[t.wd] ? t.wd : "value", src: s.id, addr: String(t.addr || "").slice(0, 120), ty: TYPES.includes(t.ty) ? t.ty : PROTO[s.proto].ty, sc: num(t.sc) ?? 1, chk: t.chk !== false };
    });
    pairs.push([z, { id, nom: String(z.nom || "Équipement " + id.slice(1)).slice(0, 60), kind, tags }]);
  });
  sources.forEach((s) => delete s._o);
  const zones = pairs.map((x) => x[1]);
  const flow = (Array.isArray(r.flow) ? r.flow : []).map((f) => { const q = pairs.find(([o]) => o.id === f); return q ? q[1].id : null; }).filter((f, i, a) => f && a.indexOf(f) === i);
  zones.forEach((z) => { if (!flow.includes(z.id)) flow.push(z.id); });
  const spec = { sources, zones, flow, notes: (Array.isArray(r.notes) ? r.notes : []).slice(0, 8).map((n) => String(n).slice(0, 300)) };
  fillAddr(spec); return spec;
}

/* ---------- Conception locale (mode démonstration, sans IA) à partir du texte ---------- */
function parseItems(text) {
  const items = [], ign = [];
  String(text || "").split(/[,;\n.:]|\bet\b|\+|\bainsi que\b/i).forEach((raw) => {
    let s = raw.trim();
    for (let i = 0; i < 2; i++) s = s.replace(/^(avec|plus|puis|ajoute[rz]?|ajout de|je veux|il y a|on a|comprenant|incluant)\s+/i, "").replace(/^(un|une|des|le|la|les|du|de)\s+|^(l'|d')/i, "");
    if (s.length < 3) return;
    let n = 1; const m = s.match(/^(\d+|deux|trois|quatre|cinq|six)\s*(x\s*)?/i);
    if (m) { n = Math.min(8, NUMW[m[1].toLowerCase()] || +m[1]); s = s.slice(m[0].length).trim(); }
    s = s.replace(/\s+(en|via|sur|par|protocole)\s+(?=modbus|opc|siemens|simatic|s7|mqtt|bacnet|dnp3|iec|ethernet|snmp|lora|http|rest|4-?20).*/i, "");
    const k = kindOf(s);
    if (!k) { if (!/\b(usine|unit[ée]|site|carri[èe]re|plantation|exploitation|supervision)\b/i.test(s) && !PROT_RE.test(s)) ign.push(raw.trim()); return; }
    const base = s.charAt(0).toUpperCase() + s.slice(1, 50);
    for (let i = 1; i <= n; i++) items.push({ nom: n > 1 ? base.replace(/^(\S+?)s\b/, "$1") + " " + i : base, kind: k });
  });
  return { items, ign };
}
function addZones(spec, items, protos) {
  protos.forEach((p) => { if (!spec.sources.some((s) => s.proto === p)) spec.sources.push({ id: "s" + (spec.sources.length + 1), nom: PROTO[p].n + " — passerelle " + (spec.sources.length + 1), proto: p, p: defP(p) }); });
  const pool = protos.length ? spec.sources.filter((s) => protos.includes(s.proto)) : spec.sources;
  items.forEach((it, i) => { const id = "z" + nextZ(spec), src = pool[i % pool.length].id; spec.zones.push({ id, nom: it.nom, kind: it.kind, tags: mkTags(it.kind).map((t) => ({ ...t, k: id + "_" + t.k, src, addr: "", ty: "", sc: null })) }); spec.flow.push(id); });
  fillAddr(spec);
}
function localDesign(text, o = {}) {
  const protos = [...new Set([...(o.protos || []), ...protoOf(text)])], sec = Object.values(SECT).find((s) => s.re.test(text));
  const { items, ign } = parseItems(text), all = [];
  const push = (it) => { if (!all.some((x) => slug(x.nom) === slug(it.nom))) all.push(it); };
  if (sec && items.length < 3) sec.z.forEach((n) => push({ nom: n, kind: kindOf(n) }));
  items.forEach(push);
  const spec = { sources: [], zones: [], flow: [], notes: [] };
  if (!protos.length) protos.push("modbus-tcp");
  addZones(spec, all, protos);
  spec.notes.push("Adresses, échelles et seuils proposés : à valider avec la documentation de l'automate et l'exploitant avant publication.");
  if (ign.length) spec.notes.push("Non reconnu (ignoré) : " + ign.slice(0, 6).join(" · "));
  return { nom: o.nom || (sec ? "Unité " + sec.n : "Unité industrielle"), site: o.site || "", secteur: sec ? sec.n : "", spec };
}
function localRefine(spec, text) {
  const s = JSON.parse(JSON.stringify(spec)), rm = text.match(/(?:supprime[rz]?|retire[rz]?|enl[èe]ve[rz]?)\s+([^,;.]+?)(?=\s+(?:et|puis|ajoute[rz]?)\s+|[,;.]|$)/i);
  let rest = text;
  if (rm) {
    rest = text.replace(rm[0], " "); const q = rm[1].trim().toLowerCase().replace(/^(le|la|les|l'|un|une|des)\s*/, ""), k = kindOf(q), before = s.zones.length;
    let keep = s.zones.filter((z) => !z.nom.toLowerCase().includes(q));
    if (keep.length === before && k) keep = s.zones.filter((z) => z.kind !== k);
    s.zones = keep; s.flow = s.flow.filter((f) => s.zones.some((z) => z.id === f));
    if (s.zones.length === before) s.notes.push("Rien à supprimer pour : " + rm[1]);
  }
  const { items } = parseItems(rest), protos = protoOf(rest);
  if (items.length || protos.length) addZones(s, items, protos);
  s.notes = [...new Set(s.notes)].slice(-6);
  return s;
}
async function aiDesign(body) {
  if (!isLive) {
    await new Promise((r) => setTimeout(r, 500));
    if (body.current) return { spec: localRefine(body.current, body.instruction) };
    return localDesign(body.description, { nom: body.nom, site: body.site, protos: body.protocols });
  }
  const { data, error } = await sb.functions.invoke("scada-design", { body });
  if (error) { let m = error.message; try { const j = await error.context.json(); if (j.error) m = j.error; } catch (x) { /* corps non JSON */ } throw new Error(m); }
  return data;
}

/* ---------- État, données ---------- */
const SC = { tab: "view", unit: null, draft: null, prev: false, busy: false, txt: "", instr: "", nom: "", site: "", protos: [] };
let UNITS = [], SV = {}, ALM = [], schan = null;
const HIST = {};
const SKEY = "sc_scada_demo_v1";
const unitRow = (r) => ({ id: r.id, nom: r.nom, site: r.site || "", secteur: r.secteur || "", description: r.description || "", status: r.status, rev: r.rev || 0, spec: normSpec(r.spec) });
function demoSeed() {
  try { const j = JSON.parse(localStorage.getItem(SKEY) || "null"); if (Array.isArray(j) && j.length) return j.map((u) => ({ ...u, spec: normSpec(u.spec) })); } catch (x) { /* stockage indisponible */ }
  return [["hevea", "Usine hévéa (démo)", "Site démo 1"], ["carriere", "Carrière de granit (démo)", "Site démo 2"], ["cacao", "Usine cacao (démo)", "Site démo 3"]].map(([k, nom, site], i) => { const d = localDesign(EX[k], { nom, site }); return { id: "d" + (i + 1), nom, site, secteur: d.secteur, description: EX[k], status: "published", rev: 1, spec: normSpec(d.spec) }; });
}
const demoSave = () => { if (!isLive) try { localStorage.setItem(SKEY, JSON.stringify(UNITS)); } catch (x) { /* ignoré */ } };
let UINIT = false;
const uInit = () => { if (!UINIT) { UINIT = true; if (!isLive) UNITS = demoSeed(); } };
async function loadScada() {
  if (!isLive || !S) return;
  const [u, a, m] = await Promise.all([sb.from("scada_units").select("*").order("nom"), sb.from("scada_alarms").select("*").order("created_at", { ascending: false }).limit(100), sb.from("scada_latest").select("*")]);
  UNITS = (u.data || []).map(unitRow); SV = {};
  (m.data || []).forEach((r) => { (SV[r.unit_id] = SV[r.unit_id] || {})[r.tag] = r.value; });
  ALM = (a.data || []).map(alRow);
}
const alRow = (r) => ({ id: r.id, unit: r.unit_id, tag: r.tag, msg: r.message, niv: r.severity, ts: r.created_at, st: r.status, at: r.confirmed_at });
let slt = null; const scLater = () => { clearTimeout(slt); slt = setTimeout(scLive, 300); };
function scadaSub() {
  scadaUnsub(); if (!isLive) return;
  schan = sb.channel("sc-scada")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "scada_measurements" }, (p) => { const r = p.new; (SV[r.unit_id] = SV[r.unit_id] || {})[r.tag] = r.value; scLater(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "scada_alarms" }, (p) => { if (p.eventType === "DELETE") ALM = ALM.filter((x) => x.id !== p.old.id); else { const n = alRow(p.new), i = ALM.findIndex((x) => x.id === n.id); if (i < 0) ALM.unshift(n); else ALM[i] = n; } scLater(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "scada_units" }, async () => { await loadScada(); if (curH() === "scada" && SC.tab === "view") rScada(); })
    .subscribe();
}
function scadaUnsub() { if (schan) { sb.removeChannel(schan); schan = null; } }
const visUnits = () => (uInit(), UNITS).filter((u) => u.status === "published" || SAV_ROLES.includes(S && S.role));
const curUnit = () => { const v = visUnits(); return v.find((u) => u.id === SC.unit) || v[0] || null; };

/* ---------- Valeurs, états, alarmes ---------- */
function simTag(u, t) {
  const h = hashS(u.id + t.k), x = Date.now() / 1000;
  if (t.wd === "state") return h % 17 === 0 && x % 60 > 45 ? 0 : 1;
  let v = t.nom + Math.sin(x / 4 + h) * t.max * .015 + (Math.random() - .5) * t.max * .01;
  if (t.w != null && t.c != null && h % 13 === 0) { const p = (x + h) % 120; if (p > 85) v = p > 105 ? t.c + (t.c - t.w) * .25 : (t.w + t.c) / 2; }
  return Math.max(0, v);
}
const tst = (t, v) => (v == null ? "off" : t.w == null || t.c == null ? "ok" : t.low ? (v < t.c ? "crit" : v < t.w ? "warn" : "ok") : (v > t.c ? "crit" : v > t.w ? "warn" : "ok"));
const worst = (a) => (a.includes("crit") ? "crit" : a.includes("warn") ? "warn" : a.every((x) => x === "off") ? "off" : "ok");
function scCompute(u, pv) {
  const V = {};
  u.spec.zones.forEach((z) => z.tags.forEach((t) => { const v = isLive && !pv ? (((SV[u.id] || {})[t.k]) ?? null) : simTag(u, t); V[t.k] = v; if (v != null) { const h = (HIST[u.id + t.k] = HIST[u.id + t.k] || []); h.push(v); if (h.length > 40) h.shift(); } }));
  return V;
}
function scEval() { // alarmes du mode démonstration (en réel : pont MQTT)
  if (isLive) return;
  visUnits().forEach((u) => { u.spec.zones.forEach((z) => z.tags.forEach((t) => { const v = simTag(u, t), st = tst(t, v), a = ALM.find((x) => x.unit === u.id && x.tag === t.k && x.st !== "resolue"); if (st === "warn" || st === "crit") { if (!a) ALM.unshift({ id: "a" + Date.now() + t.k + u.id, unit: u.id, tag: t.k, msg: `${z.nom} — ${t.l} ${t.low ? "sous" : "au-dessus de"} le seuil (${v.toFixed(1)} ${t.u})`, niv: st, ts: Date.now(), st: "active" }); else a.niv = st; } else if (a) a.st = "resolue"; })); });
  ALM = ALM.slice(0, 100);
}
async function scAck(id) {
  const a = ALM.find((x) => x.id === id); if (!a || !S || !CONFIRM_ROLES.includes(S.role)) return;
  if (isLive) { const { error } = await sb.rpc("confirm_scada_alarm", { p_alarm: id }); if (error) { toast("Échec : " + error.message, 1); return; } }
  a.st = "confirmee"; a.at = new Date().toISOString(); scLive(); toast("Alarme acquittée");
}

/* ---------- Rendu : supervision ---------- */
function widget(t, v, hk) {
  const s = tst(t, v), col = COL[s], nul = v == null, lab = esc(t.l);
  if (t.wd === "gauge") return gauge(v, t.max, lab, esc(t.u), s);
  const val = nul ? "—" : v.toFixed(t.max <= 30 ? 1 : 0), head = `<div class="n" style="color:${col}">${val} <span style="font-size:11px">${nul ? "" : esc(t.u)}</span></div><div class="t">${lab}</div>`;
  if (t.wd === "bar") return `<div class="g" style="padding:12px 10px">${head}<div style="height:8px;background:var(--line);border-radius:4px;margin-top:8px;overflow:hidden"><i style="display:block;height:100%;width:${nul ? 0 : Math.min(100, Math.max(0, v / t.max * 100))}%;background:${col}"></i></div></div>`;
  if (t.wd === "tank") return `<div class="g" style="padding:10px"><svg viewBox="0 0 60 70" style="width:54px"><rect x="8" y="4" width="44" height="60" rx="5" fill="none" stroke="var(--line)" stroke-width="3"/><rect x="11" y="${7 + 54 * (1 - (nul ? 0 : Math.min(1, v / t.max)))}" width="38" height="${54 * (nul ? 0 : Math.min(1, v / t.max))}" fill="${col}" opacity=".85"/></svg>${head}</div>`;
  if (t.wd === "state") return `<div class="g" style="padding:14px 10px"><div style="font-size:26px;color:${nul ? "var(--dim)" : v >= .5 ? "var(--ok)" : "var(--crit)"}">●</div><div class="n" style="font-size:13px">${nul ? "—" : v >= .5 ? "MARCHE" : "ARRÊT"}</div><div class="t">${lab}</div></div>`;
  const h = HIST[hk] || [], lo = Math.min(...h), hi = Math.max(...h), r = hi - lo || 1, pts = h.map((y, i) => `${(i / Math.max(1, h.length - 1) * 100).toFixed(1)},${(22 - (y - lo) / r * 20).toFixed(1)}`).join(" ");
  return `<div class="g" style="padding:12px 10px">${head}<svg viewBox="0 0 100 24" style="width:100%;height:24px;margin-top:6px">${h.length > 1 ? `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6"/>` : ""}</svg></div>`;
}
function synoptic(u, V) {
  const Z = u.spec.flow.map((id) => u.spec.zones.find((z) => z.id === id)).filter(Boolean), W = 170, H = 62, G = 34, per = Math.min(4, Math.max(1, Z.length)), rows = Math.ceil(Z.length / per) || 1, pos = [];
  Z.forEach((z, i) => { const r = Math.floor(i / per), c0 = i % per, c = r % 2 ? per - 1 - c0 : c0; pos.push({ x: c * (W + G) + 4, y: r * (H + G) + 4 }); });
  let s = `<svg viewBox="0 0 ${per * (W + G) - G + 8} ${rows * (H + G) - G + 8}" style="width:100%;max-width:960px;display:block">`;
  pos.forEach((p, i) => { if (i === 0) return; const q = pos[i - 1], same = q.y === p.y, x1 = same ? (p.x > q.x ? q.x + W : q.x) : q.x + W / 2, y1 = same ? q.y + H / 2 : q.y + H, x2 = same ? (p.x > q.x ? p.x : p.x + W) : p.x + W / 2, y2 = same ? p.y + H / 2 : p.y; s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--dim)" stroke-width="2" stroke-dasharray="5 4"/>`; });
  Z.forEach((z, i) => { const p = pos[i], st = worst(z.tags.map((t) => tst(t, V[t.k]))), n = z.tags.filter((t) => ["warn", "crit"].includes(tst(t, V[t.k]))).length; s += `<g style="cursor:pointer" onclick="document.getElementById('zz_${z.id}').scrollIntoView({behavior:'smooth',block:'center'})"><rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="10" fill="var(--card2)" stroke="${COL[st]}" stroke-width="2.5"/><text x="${p.x + 12}" y="${p.y + 27}" font-size="19">${KIND[z.kind][0]}</text><text x="${p.x + 40}" y="${p.y + 25}" font-size="12.5" fill="var(--ink)" font-family="IBM Plex Sans,sans-serif" font-weight="600">${esc(z.nom.length > 17 ? z.nom.slice(0, 16) + "…" : z.nom)}</text><text x="${p.x + 40}" y="${p.y + 45}" font-size="11" fill="${COL[st]}" font-family="IBM Plex Mono,monospace">${st === "off" ? "sans données" : n ? n + " en alarme" : "normal"}</text></g>`; });
  return s + "</svg>";
}
function unitView(u, V) {
  const L = { ok: "NORMAL", warn: "ALERTE", crit: "CRITIQUE", off: "SANS DONNÉES" };
  return `<div class="card" style="margin-bottom:16px;overflow-x:auto">${synoptic(u, V)}</div>` + u.spec.zones.map((z) => { const st = worst(z.tags.map((t) => tst(t, V[t.k]))), src = [...new Set(z.tags.map((t) => (u.spec.sources.find((s) => s.id === t.src) || {}).nom))].filter(Boolean); return `<div class="card eq" id="zz_${z.id}"><div class="eh"><div><b>${KIND[z.kind][0]} ${esc(z.nom)}</b><div class="dim" style="font-size:12.5px">${src.map(esc).join(" · ")}</div></div><span class="pill" style="color:${COL[st]}">● ${L[st]}</span></div><div class="g4">${z.tags.map((t) => widget(t, V[t.k], u.id + t.k)).join("")}</div></div>`; }).join("");
}
function almHTML(u) {
  const L = ALM.filter((x) => x.unit === u.id).slice(0, 30), P = u.spec.zones.flatMap((z) => z.tags);
  return L.map((x) => { const act = x.st === "active", right = act ? (CONFIRM_ROLES.includes(S.role) ? `<button class="btn" onclick="scAck('${x.id}')">Acquitter</button>` : '<span class="pill dim">🔒 Niveau 2</span>') : x.st === "confirmee" ? '<span class="pill" style="color:var(--ok)">✓ Acquittée</span>' : '<span class="pill dim">Résolue</span>'; return `<div class="al"><span class="d" style="background:${act ? COL[x.niv] || COL.warn : "var(--ok)"}"></span><div>${esc(x.msg)}<small>${ago(x.ts)}</small></div>${right}</div>`; }).join("") || '<div class="dim">Aucune alarme.</div>';
}
function scLive() {
  const u = curUnit(); if (!u || !$("scLive") || !S) return;
  scEval(); const V = scCompute(u); $("scLive").innerHTML = unitView(u, V); $("scAl").innerHTML = almHTML(u);
}
setInterval(() => { if (curH() === "scada" && S && SC.tab === "view" && $("scLive")) scLive(); }, 1500);

/* ---------- Page SCADA ---------- */
const canCfg = () => S && SAV_ROLES.includes(S.role);
function rScada() {
  const c = $("scada"), g = gate("scada", "SCADA", "Supervision industrielle multi-protocole. Accès par niveau.", SC_ROLES, 1);
  if (g) { c.innerHTML = g; return; }
  if (SC.tab === "cfg" && !canCfg()) SC.tab = "view";
  const tabs = [["view", "📺 Supervision"], ...(canCfg() ? [["cfg", "🧩 Configuration par IA"]] : []), ["acc", "🔑 Accès et niveaux"]];
  const note = { niveau1: "Niveau 1 : consultation des synoptiques, mesures et alarmes.", niveau2: "Niveau 2 : consultation et acquittement des alarmes.", sav: "SAV : consultation, acquittement, conception d'interface par IA, sources et tags, publication.", admin: "Administrateur : tous droits, y compris suppression des unités et affectation des accès." }[S.role];
  c.innerHTML = `<div class="wrap"><div class="bar"><div><div class="eyebrow">SCADA multi-protocole</div><h2>Supervision industrielle</h2></div><div class="who"><span class="mono">${esc(S.email)}</span><span class="lv">${ROLES[S.role].toUpperCase()}</span><button class="btn ghost" onclick="out()">Déconnexion</button></div></div><div class="note">${note}</div><div class="tb">${tabs.map(([k, n]) => `<button class="${SC.tab === k ? "on" : ""}" onclick="SC.tab='${k}';rScada()">${n}</button>`).join("")}</div><div id="scBody"></div></div>`;
  if (SC.tab === "cfg") cfgRender(); else if (SC.tab === "acc") accRender(); else viewRender();
}
function viewRender() {
  const v = visUnits(), u = curUnit(), b = $("scBody");
  if (!u) { b.innerHTML = `<div class="card dim">Aucune unité disponible.${canCfg() ? " Ouvrez « Configuration par IA » pour en créer une à partir d'une description." : " Demandez à votre administrateur de vous affecter une unité."}</div>`; return; }
  SC.unit = u.id;
  const pr = [...new Set(u.spec.sources.map((s) => PROTO[s.proto].n))];
  b.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="frm"><div><label>Unité industrielle</label><select onchange="SC.unit=this.value;viewRender()">${v.map((x) => `<option value="${x.id}" ${x.id === u.id ? "selected" : ""}>${esc(x.nom)}${x.status !== "published" ? " (brouillon)" : ""}</option>`).join("")}</select></div></div><div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap"><span class="pill dim">${esc(u.site || "—")}</span>${pr.map((p) => `<span class="pill" style="color:var(--or2)">${esc(p)}</span>`).join("")}${isLive ? "" : '<span class="pill dim">données simulées</span>'}</div></div><div id="scLive"></div><h3 style="margin:24px 0 12px">Alarmes</h3><div id="scAl"></div>`;
  scLive();
}

/* ---------- Configuration par IA ---------- */
function cfgRender() {
  uInit(); const b = $("scBody"), d = SC.draft, U = UNITS;
  const prot = Object.entries(PROTO).map(([k, p]) => `<label style="display:inline-flex;gap:6px;margin:0 12px 6px 0;font-size:12.5px;color:var(--ink)"><input type="checkbox" ${SC.protos.includes(k) ? "checked" : ""} onchange="scProto('${k}',this.checked)">${p.n}</label>`).join("");
  b.innerHTML = `<div class="card"><div class="eyebrow">Étape 1 — décrire l'unité</div><h3 style="margin-bottom:6px">Décrivez l'unité à superviser</h3><div class="dim" style="font-size:12.5px;margin-bottom:10px">Texte libre : type d'unité, équipements, protocoles. L'IA conçoit le synoptique, les écrans, les tags, les seuils et propose les adresses.</div>
<textarea id="scTxt" rows="5" oninput="SC.txt=this.value" placeholder="Ex. : usine d'hévéa avec cuve de latex, 2 bacs de coagulation, laminoir, séchoir, presse, groupe électrogène. Automate Siemens S7 et compteurs Modbus RTU.">${esc(SC.txt)}</textarea>
<div style="margin:8px 0;display:flex;gap:8px;flex-wrap:wrap"><span class="dim" style="font-size:12.5px;align-self:center">Exemples :</span>${[["hevea", "Hévéa"], ["carriere", "Carrière"], ["cacao", "Cacao"]].map(([k, n]) => `<button class="btn ghost" style="padding:6px 12px;font-size:12.5px" onclick="SC.txt=EX['${k}'];cfgRender()">${n}</button>`).join("")}</div>
<div class="frm"><div><label>Nom de l'unité (facultatif)</label><input value="${qa(SC.nom)}" oninput="SC.nom=this.value"></div><div><label>Site (facultatif)</label><input value="${qa(SC.site)}" oninput="SC.site=this.value"></div></div>
<label class="dim" style="display:block;font-size:12.5px;margin:12px 0 6px">Protocoles imposés (facultatif : sinon déduits du texte, par défaut Modbus TCP)</label><div>${prot}</div>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="btn" ${SC.busy ? "disabled" : ""} onclick="scGen()">✨ ${SC.busy ? "Conception en cours…" : "Concevoir l'interface"}</button>${U.length ? `<select style="max-width:300px" onchange="scOpen(this.value)"><option value="">Modifier une unité existante…</option>${U.map((x) => `<option value="${x.id}">${esc(x.nom)}${x.status !== "published" ? " (brouillon)" : ""}</option>`).join("")}</select>` : ""}</div>
<div class="dim" style="font-size:12.5px;margin-top:8px">${isLive ? "Les descriptions sont envoyées au service IA (jamais de mot de passe ni de clé)." : "Mode démonstration : conception locale par mots-clés (hévéa, cacao, carrière, palmier, eau ; pompe, concasseur, silo, séchoir, etc.), sans IA. L'IA complète s'active avec Supabase."}</div></div>
${d ? edHTML(d) : ""}`;
  if (d && SC.prev) { const V = scCompute({ ...d, id: "draft" }, true); $("scPrev").innerHTML = unitView(d, V); }
}
const scProto = (k, on) => { SC.protos = on ? [...new Set([...SC.protos, k])] : SC.protos.filter((x) => x !== k); };
async function scGen() {
  const t = SC.txt.trim(); if (t.length < 12) { toast("Décrivez l'unité (au moins une phrase)", 1); return; }
  SC.busy = true; cfgRender();
  try {
    const r = await aiDesign({ description: t.slice(0, 4000), nom: SC.nom, site: SC.site, protocols: SC.protos });
    const spec = normSpec(r.spec);
    if (!spec.zones.length) { toast("Aucun équipement reconnu : citez des équipements (pompe, concasseur, silo, séchoir…)", 1); SC.busy = false; cfgRender(); return; }
    SC.draft = { id: null, nom: r.nom || SC.nom || "Nouvelle unité", site: r.site || SC.site, secteur: r.secteur || "", description: t, status: "draft", rev: 0, spec }; SC.prev = true;
  } catch (e) { toast("Échec : " + e.message, 1); }
  SC.busy = false; cfgRender();
}
async function scRefine() {
  readEd(); const ins = (SC.instr || "").trim(); if (!ins || !SC.draft) return;
  SC.busy = true; cfgRender();
  try { const r = await aiDesign({ current: gwSpec(SC.draft.spec), instruction: ins.slice(0, 1500), description: SC.draft.description }); SC.draft.spec = normSpec(r.spec); SC.instr = ""; SC.prev = true; }
  catch (e) { toast("Échec : " + e.message, 1); }
  SC.busy = false; cfgRender();
}
const gwSpec = (sp) => JSON.parse(JSON.stringify(sp));
function scOpen(id) { const u = UNITS.find((x) => x.id === id); if (!u) return; SC.draft = JSON.parse(JSON.stringify(u)); SC.prev = true; cfgRender(); const e = $("edNom"); if (e) e.scrollIntoView({ behavior: "smooth", block: "center" }); }
const selOpts = (arr, cur) => arr.map(([v, n]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(n)}</option>`).join("");
function edHTML(d) {
  const sp = d.spec, chk = sp.zones.reduce((n, z) => n + z.tags.filter((t) => t.chk).length, 0), srcOpt = sp.sources.map((s) => [s.id, s.nom]);
  const srcs = sp.sources.map((s, i) => `<div class="card" style="background:var(--card2);padding:14px;margin-bottom:10px"><div class="frm"><div><label>Source ${i + 1}</label><input id="sn${i}" value="${qa(s.nom)}"></div><div><label>Protocole</label><select onchange="readEd();SC.draft.spec.sources[${i}].proto=this.value;SC.draft.spec.sources[${i}].p=defP(this.value);cfgRender()">${selOpts(Object.entries(PROTO).map(([k, p]) => [k, p.n]), s.proto)}</select></div>${PROTO[s.proto].f.map(([k, l]) => `<div><label>${l}</label><input id="sp${i}_${k}" value="${qa(s.p[k])}"></div>`).join("")}</div>${sp.sources.length > 1 ? `<button class="btn ghost" style="margin-top:8px;padding:5px 12px;font-size:12px" onclick="scRmSrc(${i})">Retirer la source</button>` : ""}</div>`).join("");
  const zones = sp.zones.map((z, zi) => `<div style="margin:16px 0 6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:20px">${KIND[z.kind][0]}</span><input id="zn${zi}" value="${qa(z.nom)}" style="max-width:280px"><button class="btn ghost" style="padding:5px 12px;font-size:12px" onclick="scRmZone(${zi})">Retirer l'équipement</button></div><div class="sc"><table><tr><th>Libellé</th><th>Unité</th><th>Source</th><th>Adresse</th><th>Type</th><th>Échelle</th><th>Alerte</th><th>Critique</th><th>Sens</th><th>Affichage</th></tr>${z.tags.map((t, ti) => { const g = (f) => `t${zi}_${ti}_${f}`; return `<tr><td><input id="${g("l")}" value="${qa(t.l)}"></td><td><input id="${g("u")}" value="${qa(t.u)}" style="min-width:56px"></td><td><select id="${g("s")}">${selOpts(srcOpt, t.src)}</select></td><td><input id="${g("a")}" value="${qa(t.addr)}" style="min-width:150px">${t.chk ? '<div class="dim" style="font-size:11px;color:var(--warn)">⚠ à vérifier</div>' : ""}</td><td><select id="${g("y")}">${selOpts(TYPES.map((x) => [x, x]), t.ty)}</select></td><td><input type="number" step="any" id="${g("c")}" value="${t.sc ?? 1}" style="min-width:64px"></td><td><input type="number" step="any" id="${g("w")}" value="${t.w ?? ""}" style="min-width:64px"></td><td><input type="number" step="any" id="${g("x")}" value="${t.c ?? ""}" style="min-width:64px"></td><td><select id="${g("d")}">${selOpts([["0", "alerte si supérieur"], ["1", "alerte si inférieur"]], t.low ? "1" : "0")}</select></td><td><select id="${g("v")}">${selOpts(Object.entries(WIDGETS), t.wd)}</select></td></tr>`; }).join("")}</table></div>`).join("");
  return `<div class="card" style="margin-top:16px"><div class="eyebrow">Étape 2 — vérifier et ajuster</div><div class="frm"><div><label>Nom de l'unité</label><input id="edNom" value="${qa(d.nom)}"></div><div><label>Site</label><input id="edSite" value="${qa(d.site)}"></div><div><label>Statut</label><div style="padding:10px 0"><span class="pill" style="color:${d.status === "published" ? "var(--ok)" : "var(--warn)"}">${d.status === "published" ? "● PUBLIÉ" : "● BROUILLON"}</span></div></div></div>
${sp.notes.length ? `<div class="note" style="margin-top:14px">${sp.notes.map(esc).join("<br>")}</div>` : ""}
${chk ? `<div class="note" style="border-left-color:var(--warn)">⚠ ${chk} adresse(s) proposée(s) par la conception : à remplacer par celles de la documentation de l'automate (modifier une adresse la valide).</div>` : ""}
<h3 style="margin:18px 0 8px">Sources de données (protocoles)</h3><div class="dim" style="font-size:12.5px;margin-bottom:8px">Les identifiants, mots de passe et certificats ne sont jamais saisis ici : ils restent dans la passerelle de terrain.</div>${srcs}<div style="display:flex;gap:8px;flex-wrap:wrap"><select id="newProto" style="max-width:280px">${selOpts(Object.entries(PROTO).map(([k, p]) => [k, p.n]), "")}</select><button class="btn ghost" style="padding:8px 14px" onclick="scAddSrc()">+ Source</button></div>
<h3 style="margin:22px 0 4px">Équipements et paramètres</h3>${zones}
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><select id="newKind" style="max-width:240px">${selOpts(Object.entries(KIND).map(([k, v]) => [k, v[0] + " " + k]), "pompe")}</select><button class="btn ghost" style="padding:8px 14px" onclick="scAddZone()">+ Équipement</button></div>
<h3 style="margin:22px 0 6px">Affiner par texte</h3><div class="dim" style="font-size:12.5px;margin-bottom:8px">Ex. : « ajoute 2 pompes et un silo, protocole OPC UA » ou « supprime le laminoir ».</div><div style="display:flex;gap:8px;align-items:flex-end"><textarea rows="2" oninput="SC.instr=this.value" placeholder="Votre modification…">${esc(SC.instr)}</textarea><button class="btn" ${SC.busy ? "disabled" : ""} onclick="scRefine()">Appliquer</button></div>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:22px"><button class="btn ghost" onclick="readEd();SC.prev=true;cfgRender()">👁 Aperçu</button><button class="btn" onclick="scSave(false)">Enregistrer en brouillon</button><button class="btn" onclick="scSave(true)">Publier</button><button class="btn ghost" onclick="scExport()">⬇ Config passerelle (JSON)</button>${d.id && S.role === "admin" ? `<button class="btn ghost" onclick="scDel('${d.id}')">Supprimer l'unité</button>` : ""}<button class="btn ghost" onclick="SC.draft=null;cfgRender()">Abandonner</button></div></div>
${SC.prev ? '<h3 style="margin:24px 0 6px">Aperçu de l\'interface générée</h3><div class="dim" style="font-size:12.5px;margin-bottom:10px">Valeurs simulées pour juger la mise en page.</div><div id="scPrev"></div>' : ""}`;
}
function readEd() {
  const d = SC.draft; if (!d || !$("edNom")) return; const sp = d.spec;
  d.nom = $("edNom").value.trim() || d.nom; d.site = $("edSite").value.trim();
  sp.sources.forEach((s, i) => { s.nom = $("sn" + i).value.trim() || s.nom; PROTO[s.proto].f.forEach(([k]) => { const e = $(`sp${i}_${k}`); if (e) s.p[k] = e.value.trim(); }); });
  sp.zones.forEach((z, zi) => { z.nom = $("zn" + zi).value.trim() || z.nom; z.tags.forEach((t, ti) => { const g = (f) => $(`t${zi}_${ti}_${f}`).value; t.l = g("l").trim() || t.k; t.u = g("u").trim(); t.src = g("s"); const a = g("a").trim(); if (a !== t.addr) t.chk = false; t.addr = a; t.ty = g("y"); t.sc = num(g("c")) ?? 1; t.w = num(g("w")); t.c = num(g("x")); t.low = g("d") === "1"; t.wd = g("v"); }); });
}
function scAddSrc() { readEd(); const p = $("newProto").value, sp = SC.draft.spec; sp.sources.push({ id: "s" + (sp.sources.length + 1), nom: PROTO[p].n + " — passerelle " + (sp.sources.length + 1), proto: p, p: defP(p) }); cfgRender(); }
function scRmSrc(i) { readEd(); const sp = SC.draft.spec, id = sp.sources[i].id, fb = sp.sources.find((s) => s.id !== id).id; sp.zones.forEach((z) => z.tags.forEach((t) => { if (t.src === id) { t.src = fb; t.addr = ""; t.chk = true; } })); sp.sources.splice(i, 1); fillAddr(sp); cfgRender(); }
function scAddZone() { readEd(); const k = $("newKind").value, sp = SC.draft.spec; addZones(sp, [{ nom: k.charAt(0).toUpperCase() + k.slice(1) + " " + (sp.zones.length + 1), kind: k }], []); cfgRender(); }
function scRmZone(i) { readEd(); const sp = SC.draft.spec, z = sp.zones[i]; sp.zones.splice(i, 1); sp.flow = sp.flow.filter((f) => f !== z.id); cfgRender(); }
function gwConfig(u) { return { v: 1, unite: { id: u.id, nom: u.nom, site: u.site }, rev: u.rev || 0, sources: u.spec.sources.map((s) => ({ id: s.id, nom: s.nom, proto: s.proto, params: s.p })), tags: u.spec.zones.flatMap((z) => z.tags.map((t) => ({ cle: t.k, zone: z.nom, source: t.src, adresse: t.addr, type: t.ty, echelle: t.sc, unite: t.u, seuils: { alerte: t.w, critique: t.c, sens: t.low ? "bas" : "haut" } }))) }; }
function scExport() {
  readEd(); const d = SC.draft; if (!d) return;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(gwConfig(d), null, 2)], { type: "application/json" })); a.download = "scada-" + (slug(d.nom) || "unite") + ".json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function scSave(pub) {
  readEd(); const d = SC.draft; if (!d || !canCfg()) return;
  if (pub) { const c = d.spec.zones.reduce((n, z) => n + z.tags.filter((t) => !t.addr).length, 0); if (c) { toast(c + " paramètre(s) sans adresse", 1); return; } }
  const row = { nom: d.nom, site: d.site, secteur: d.secteur, description: d.description, status: pub ? "published" : d.status === "published" ? "published" : "draft", spec: d.spec };
  if (isLive) {
    const q = d.id ? sb.from("scada_units").update(row).eq("id", d.id) : sb.from("scada_units").insert({ ...row, created_by: S.id });
    const { data, error } = await q.select().single(); if (error) { toast("Échec : " + error.message, 1); return; }
    const u = unitRow(data), i = UNITS.findIndex((x) => x.id === u.id); if (i < 0) UNITS.push(u); else UNITS[i] = u; SC.draft = JSON.parse(JSON.stringify(u));
  } else {
    if (!d.id) { d.id = "d" + Date.now() % 1e7; UNITS.push(d); } else { const i = UNITS.findIndex((x) => x.id === d.id); UNITS[i] = d; }
    Object.assign(d, row, { rev: (d.rev || 0) + 1 }); demoSave();
  }
  SC.unit = SC.draft.id; toast(pub ? "Unité publiée" : "Brouillon enregistré"); cfgRender();
}
async function scDel(id) {
  if (!S || S.role !== "admin" || !confirm("Supprimer définitivement cette unité ?")) return;
  if (isLive) { const { error } = await sb.from("scada_units").delete().eq("id", id); if (error) { toast("Échec : " + error.message, 1); return; } }
  UNITS = UNITS.filter((x) => x.id !== id); ALM = ALM.filter((x) => x.unit !== id); demoSave(); SC.draft = null; SC.unit = null; toast("Unité supprimée"); cfgRender();
}

/* ---------- Accès et niveaux (essai) ---------- */
const MATRIX = [["Voir synoptiques, mesures, courbes", 1, 1, 1, 1], ["Acquitter les alarmes", 0, 1, 1, 1], ["Concevoir une interface par IA, éditer sources et tags", 0, 0, 1, 1], ["Publier une unité, exporter la configuration passerelle", 0, 0, 1, 1], ["Supprimer une unité, affecter les accès", 0, 0, 0, 1]];
function accRender() {
  const T = (x) => (x ? '<span style="color:var(--ok);font-weight:700">✓</span>' : '<span class="dim">—</span>');
  $("scBody").innerHTML = `<div class="card"><h3 style="margin-bottom:10px">Droits par niveau</h3><div class="sc"><table><tr><th>Fonction</th><th>Niveau 1</th><th>Niveau 2</th><th>SAV</th><th>Admin</th></tr>${MATRIX.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((x) => `<td>${T(x)}</td>`).join("")}</tr>`).join("")}</table></div><div class="note" style="margin:16px 0 0">Aucune commande n'est envoyée vers les automates depuis le site : supervision et acquittement uniquement. En mode réel, ces droits sont appliqués par la base (RLS), pas seulement par l'interface.</div></div>${!isLive ? `<div class="card" style="margin-top:16px"><h3 style="margin-bottom:6px">Comptes d'essai (mode démonstration)</h3><div class="dim" style="font-size:12.5px;margin-bottom:10px">Données fictives, enregistrées uniquement dans votre navigateur.</div>${trialTable()}</div>` : `<div class="card dim" style="margin-top:16px">Mode réel : les comptes d'essai se créent avec <span class="mono">bridge/seed-essai.mjs</span> (voir docs/scada.md). Ne publiez jamais les identifiants SAV ou admin.</div>`}`;
}
function trialTable() {
  const N = { niveau1: "Niveau 1 — consultation", niveau2: "Niveau 2 — acquittement", sav: "SAV — configuration", admin: "Administrateur" };
  return `<div class="sc"><table><tr><th>Niveau</th><th>E-mail</th><th>Mot de passe</th><th></th></tr>${SC_ROLES.map((r) => { const u = LOCAL_USERS.find((x) => x.role === r); return u ? `<tr><td>${N[r]}</td><td class="mono">${esc(u.email)}</td><td class="mono">${esc(u.pw)}</td><td><button class="btn ghost" style="padding:6px 12px" onclick="trialIn('${r}')">Entrer</button></td></tr>` : ""; }).join("")}</table></div><div class="dim" style="font-size:12.5px;margin-top:10px">Mode Admin (comptes, canaux) : 7 clics rapides sur le logo SPEEDCONNECT, code <span class="mono">SDRB2026</span>.</div>`;
}
function trialHTML() { return `<div style="margin-top:22px;padding-top:16px;border-top:1px solid var(--line)"><div class="eyebrow">Accès d'essai</div><div class="dim" style="font-size:12.5px;margin-bottom:10px">Entrez directement à un niveau (données fictives).</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${[["niveau1", "Niveau 1"], ["niveau2", "Niveau 2"], ["sav", "SAV"], ["admin", "Admin"]].map(([r, n]) => `<button class="btn ghost" style="padding:9px 8px;margin:0" onclick="trialIn('${r}')">${n}</button>`).join("")}</div></div>`; }
function trialIn(role) { const u = LOCAL_USERS.find((x) => x.role === role); if (!u) return; S = u; SC.tab = "view"; route(); }

/* ---------- Mode Admin : affectation des unités (mode réel) ---------- */
async function scAdmLoad() { if (!isLive) return {}; const r = await sb.from("scada_user_units").select("*"), m = {}; (r.data || []).forEach((x) => (m[x.user_id] = m[x.user_id] || []).push(x.unit_id)); return m; }
function scAdmCell(u, i, m) { if (u.role === "sav" || u.role === "admin") return '<span class="dim">Toutes</span>'; return UNITS.map((x) => `<label style="display:inline-flex;gap:4px;margin-right:10px;font-size:12.5px"><input type="checkbox" ${(m[u.id] || []).includes(x.id) ? "checked" : ""} onchange="tgUnit('${u.id}','${x.id}',this.checked)">${esc(x.nom)}</label>`).join("") || '<span class="dim">Aucune unité</span>'; }
async function tgUnit(uid, unit, on) { const { error } = on ? await sb.from("scada_user_units").insert({ user_id: uid, unit_id: unit }) : await sb.from("scada_user_units").delete().eq("user_id", uid).eq("unit_id", unit); if (error) toast("Échec : " + error.message, 1); }
