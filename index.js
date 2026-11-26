// Pont SpeedConnect : HiveMQ (MQTT) <-> Supabase
//  - {base}/telemetry   coffret -> mesures en base + évaluation des seuils -> alertes
//  - {base}/status      coffret -> en ligne / hors ligne (message Last Will)
//  - {base}/config/ack  coffret -> révision de configuration appliquée
//  - {base}/config      base -> coffret (message retenu, republié à chaque modification)
//  SCADA multi-protocole (unités publiées) :
//  - {root}/scada/{unité}/telemetry   passerelle de terrain -> {"ts":epoch_s,"v":{"z1_pression":6.2,...}}
//  - {root}/scada/{unité}/config      base -> passerelle (sources, adresses, échelles ; sans secret ; retenu)
//  Les pilotes de protocole (OPC UA, S7, BACnet, etc.) tournent dans la passerelle de terrain, pas dans ce pont.
import fs from "node:fs";
import mqtt from "mqtt";
import { createClient } from "@supabase/supabase-js";

const P = JSON.parse(fs.readFileSync(new URL("./params.json", import.meta.url), "utf8"));
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, MQTT_URL, MQTT_USER, MQTT_PASS, MQTT_ROOT = "speedconnect" } = process.env;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const bus = mqtt.connect(MQTT_URL, {
  username: MQTT_USER, password: MQTT_PASS, clientId: "speedconnect-bridge",
  clean: false, reconnectPeriod: 3000,
});

let equipments = new Map();   // topic de base -> équipement
let defaults = null;          // modèle de communication par défaut
const lastSeverity = new Map(); // `${id}:${param}` -> "ok" | "warn" | "crit"

async function loadAll() {
  const [eq, cd] = await Promise.all([db.from("equipments").select("*"), db.from("comm_defaults").select("config").eq("id", 1).single()]);
  if (eq.error) throw eq.error;
  equipments = new Map(eq.data.map((e) => [e.topic, e]));
  defaults = cd.data?.config ?? null;
}

// ---------- Configuration envoyée au coffret ----------
function buildConfig(eq) {
  const c = eq.comm ?? defaults ?? { l: {}, m: {}, a: {} };
  return {
    v: 1,
    rev: eq.config_rev,
    equipement: { id: eq.id, nom: eq.nom, domaine: eq.domaine, site: eq.site },
    seuils: Object.fromEntries((P[eq.domaine] ?? []).map((p) => {
      const t = eq.thresholds?.[p.key] ?? {};
      return [p.key, { alerte: t.alerte ?? p.warn, critique: t.critique ?? p.crit, sens: p.low ? "bas" : "haut" }];
    })),
    liaisons: Object.entries(c.l ?? {}).map(([type, x]) => ({ type, actif: !!x.on, priorite: x.p, detail: x.d })),
    mqtt: { broker: c.m?.broker, port: c.m?.port, tls: !!c.m?.tls, qos: c.m?.qos, keepalive: c.m?.ka, topic: eq.topic },
    alertes: Object.fromEntries(Object.entries(c.a ?? {}).map(([k, x]) => [k, { actif: !!x.on, destinataires: x.d, severite_min: x.s }])),
    controleur: eq.controller ?? {},
  };
}
const publishConfig = (eq) =>
  bus.publish(`${eq.topic}/config`, JSON.stringify(buildConfig(eq)), { qos: 1, retain: true });

// ---------- Alertes ----------
function severity(p, value, th) {
  const w = th?.alerte ?? p.warn, c = th?.critique ?? p.crit;
  return p.low ? (value < c ? "crit" : value < w ? "warn" : "ok") : (value > c ? "crit" : value > w ? "warn" : "ok");
}
async function notify(eq, alert) {
  // Point d'extension : WhatsApp Business API, SMS, appel vocal, e-mail selon eq.comm.a (severite_min)
  console.log(`[ALERTE ${alert.severity}] ${eq.nom} — ${alert.message}`);
}
async function handleTelemetry(eq, payload) {
  const values = payload.v ?? {};
  const ts = payload.ts ? new Date(payload.ts * 1000).toISOString() : new Date().toISOString();
  const rows = Object.entries(values).filter(([, v]) => Number.isFinite(v))
    .map(([param, value]) => ({ equipment_id: eq.id, param, value, ts }));
  if (rows.length) await db.from("measurements").insert(rows);

  for (const p of P[eq.domaine] ?? []) {
    const v = values[p.key];
    if (!Number.isFinite(v)) continue;
    const sev = severity(p, v, eq.thresholds?.[p.key]);
    const k = `${eq.id}:${p.key}`;
    if (sev === (lastSeverity.get(k) ?? "ok")) continue;
    lastSeverity.set(k, sev);
    if (sev === "ok") {
      await db.from("alerts").update({ status: "resolue" }).eq("equipment_id", eq.id).eq("param", p.key).eq("status", "active");
      continue;
    }
    const { data: open } = await db.from("alerts").select("id").eq("equipment_id", eq.id).eq("param", p.key).eq("status", "active").limit(1);
    const message = `${p.label} ${p.low ? "sous" : "au-dessus de"} le seuil (${v}${p.unit ? " " + p.unit : ""})`;
    if (open?.length) { await db.from("alerts").update({ severity: sev, message }).eq("id", open[0].id); continue; }
    const { data } = await db.from("alerts").insert({ equipment_id: eq.id, param: p.key, message, severity: sev }).select().single();
    if (data) await notify(eq, data);
  }
}

// ---------- SCADA multi-protocole ----------
let scada = new Map(); // id d'unité -> unité publiée
const scadaSev = new Map(); // `${unité}:${tag}` -> "ok" | "warn" | "crit"
async function loadScada() {
  const r = await db.from("scada_units").select("*").eq("status", "published");
  if (r.error) { console.warn("SCADA indisponible (migration 003 appliquée ?) :", r.error.message); return; }
  scada = new Map(r.data.map((u) => [u.id, u]));
}
function scadaConfig(u) {
  const z = u.spec?.zones ?? [];
  return {
    v: 1, rev: u.rev, unite: { id: u.id, nom: u.nom, site: u.site },
    sources: (u.spec?.sources ?? []).map((s) => ({ id: s.id, nom: s.nom, proto: s.proto, params: s.p })),
    tags: z.flatMap((zn) => zn.tags.map((t) => ({ cle: t.k, zone: zn.nom, source: t.src, adresse: t.addr, type: t.ty, echelle: t.sc, unite: t.u, seuils: { alerte: t.w, critique: t.c, sens: t.low ? "bas" : "haut" } }))),
  };
}
const publishScada = (u) => bus.publish(`${MQTT_ROOT}/scada/${u.id}/config`, JSON.stringify(scadaConfig(u)), { qos: 1, retain: true });
const scadaSeverity = (t, v) => (t.w == null || t.c == null ? "ok" : t.low ? (v < t.c ? "crit" : v < t.w ? "warn" : "ok") : (v > t.c ? "crit" : v > t.w ? "warn" : "ok"));
async function handleScada(u, payload) {
  const values = payload.v ?? {};
  const ts = payload.ts ? new Date(payload.ts * 1000).toISOString() : new Date().toISOString();
  const tags = new Map((u.spec?.zones ?? []).flatMap((z) => z.tags.map((t) => [t.k, { ...t, zone: z.nom }])));
  const rows = Object.entries(values).filter(([k, v]) => tags.has(k) && Number.isFinite(v)).map(([tag, value]) => ({ unit_id: u.id, tag, value, ts }));
  if (rows.length) await db.from("scada_measurements").insert(rows);
  for (const r of rows) {
    const t = tags.get(r.tag), sev = scadaSeverity(t, r.value), k = `${u.id}:${r.tag}`;
    if (sev === (scadaSev.get(k) ?? "ok")) continue;
    scadaSev.set(k, sev);
    if (sev === "ok") { await db.from("scada_alarms").update({ status: "resolue" }).eq("unit_id", u.id).eq("tag", r.tag).eq("status", "active"); continue; }
    const message = `${t.zone} — ${t.l} ${t.low ? "sous" : "au-dessus de"} le seuil (${r.value}${t.u ? " " + t.u : ""})`;
    const { data: open } = await db.from("scada_alarms").select("id").eq("unit_id", u.id).eq("tag", r.tag).eq("status", "active").limit(1);
    if (open?.length) { await db.from("scada_alarms").update({ severity: sev, message }).eq("id", open[0].id); continue; }
    await db.from("scada_alarms").insert({ unit_id: u.id, tag: r.tag, message, severity: sev });
    console.log(`[ALARME SCADA ${sev}] ${u.nom} — ${message}`);
  }
}

// ---------- Messages MQTT ----------
bus.on("connect", async () => {
  console.log("MQTT connecté");
  await loadAll(); await loadScada();
  bus.subscribe(`${MQTT_ROOT}/scada/+/telemetry`, { qos: 1 });
  scada.forEach(publishScada);
  bus.subscribe([`${MQTT_ROOT}/+/+/+/telemetry`, `${MQTT_ROOT}/+/+/+/status`, `${MQTT_ROOT}/+/+/+/config/ack`], { qos: 1 });
  equipments.forEach(publishConfig); // état initial retenu pour chaque coffret
});

bus.on("message", async (topic, buf) => {
  try {
    const sm = topic.match(new RegExp(`^${MQTT_ROOT}/scada/([0-9a-f-]{36})/telemetry$`));
    if (sm) { const u = scada.get(sm[1]); if (u) await handleScada(u, JSON.parse(buf.toString())); else console.warn("Unité SCADA inconnue ou non publiée :", sm[1]); return; }
    const m = topic.match(/^(.*)\/(telemetry|status|config\/ack)$/);
    if (!m) return;
    const eq = equipments.get(m[1]);
    if (!eq) return console.warn("Topic inconnu :", m[1]);
    const text = buf.toString();
    if (m[2] === "telemetry") {
      await db.from("equipments").update({ online: true, last_seen: new Date().toISOString() }).eq("id", eq.id);
      await handleTelemetry(eq, JSON.parse(text));
    } else if (m[2] === "status") {
      await db.from("equipments").update({ online: text.trim() === "online", last_seen: new Date().toISOString() }).eq("id", eq.id);
    } else {
      const ack = JSON.parse(text);
      if (ack.ok) await db.from("equipments").update({ config_ack: ack.rev }).eq("id", eq.id);
    }
  } catch (e) { console.error("Erreur de traitement", topic, e.message); }
});

// ---------- Republication de la config quand la base change ----------
db.channel("sc-config")
  .on("postgres_changes", { event: "*", schema: "public", table: "equipments" }, async (ev) => {
    const eq = ev.new?.id ? ev.new : null;
    if (!eq) { await loadAll(); return; }
    const old = equipments.get(eq.topic);
    equipments.set(eq.topic, eq);
    if (!old || old.config_rev !== eq.config_rev) publishConfig(eq);
  })
  .on("postgres_changes", { event: "*", schema: "public", table: "comm_defaults" }, async () => {
    await loadAll(); equipments.forEach((e) => { if (!e.comm) publishConfig(e); });
  })
  .subscribe();

db.channel("sc-scada-config")
  .on("postgres_changes", { event: "*", schema: "public", table: "scada_units" }, async () => {
    const before = new Map([...scada].map(([id, u]) => [id, u.rev]));
    await loadScada();
    scada.forEach((u) => { if (before.get(u.id) !== u.rev) publishScada(u); });
  })
  .subscribe();
