// Crée 4 comptes d'essai (un par niveau) dans Supabase et affecte les équipements et unités SCADA.
// Usage : SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node seed-essai.mjs [domaine-email]
// Les mots de passe sont aléatoires et affichés une seule fois. Ne publiez jamais ceux du SAV et de l'admin.
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("SUPABASE_URL et SUPABASE_SERVICE_KEY requis"); process.exit(1); }
const domain = process.argv[2] || "essai.speedconnect.ci";
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const levels = [["niveau1", "Niveau 1 — consultation"], ["niveau2", "Niveau 2 — acquittement"], ["sav", "SAV — configuration"], ["admin", "Administrateur"]];
const [eq, un] = await Promise.all([db.from("equipments").select("id"), db.from("scada_units").select("id")]);
const rows = [];
for (const [role, label] of levels) {
  const email = `essai-${role}@${domain}`, password = crypto.randomBytes(9).toString("base64url");
  let id;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (c.error) {
    if (!/already|registered|exists/i.test(c.error.message)) { console.error(email, c.error.message); continue; }
    const list = await db.auth.admin.listUsers({ perPage: 1000 });
    const u = list.data.users.find((x) => x.email === email);
    if (!u) { console.error(email, "introuvable"); continue; }
    id = u.id; await db.auth.admin.updateUserById(id, { password });
  } else id = c.data.user.id;
  await db.from("profiles").update({ role }).eq("id", id);
  if (role === "niveau1" || role === "niveau2") {
    await db.from("user_equipments").upsert((eq.data ?? []).map((e) => ({ user_id: id, equipment_id: e.id })));
    await db.from("scada_user_units").upsert((un.data ?? []).map((u) => ({ user_id: id, unit_id: u.id })));
  }
  rows.push({ niveau: label, email, motdepasse: password });
}
console.table(rows);
