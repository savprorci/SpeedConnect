// Configuration publique — la clé "anon" est conçue pour être exposée (la sécurité repose sur les règles RLS).
// Ne JAMAIS mettre ici la clé "service_role".
// Laisser supabaseUrl vide = mode démonstration (données simulées, sans serveur).
window.SC_CONFIG = {
  supabaseUrl: "",       // ex. "https://xxxx.supabase.co"
  supabaseAnonKey: "",   // clé "anon public" (Supabase > Project Settings > API)
  demoEmail: "",         // optionnel : compte niveau 1 en lecture seule pour la démo publique
  demoPassword: ""
};
