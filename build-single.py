#!/usr/bin/env python3
"""Génère dist/speedconnect-demo.html : la démo SpeedConnect en UN seul fichier (CSS + JS intégrés).
Fonctionne par double-clic, en pièce jointe ou dans un aperçu isolé. Mode démonstration uniquement
(supabaseUrl vide) : pour le mode réel, déployer le dossier public/ (voir README)."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
pub = root / "public"
h = (pub / "index.html").read_text(encoding="utf8")

def inline(name):
    js = (pub / name).read_text(encoding="utf8")
    assert "</script" not in js.lower(), name
    return f"<script>\n{js}\n</script>"

# config forcée en démonstration
demo_cfg = '<script>window.SC_CONFIG={supabaseUrl:"",supabaseAnonKey:"",demoEmail:"",demoPassword:""};</script>'
h = h.replace('<script src="config.js"></script>', demo_cfg)
h = re.sub(r'<script src="https://cdn\.jsdelivr\.net/npm/@supabase[^"]*"></script>\n?', "", h)   # inutile en démonstration
for n in ("assistants.js", "scada.js", "app.js"):
    h = h.replace(f'<script src="{n}"></script>', inline(n))
h = re.sub(r'<script>if\("serviceWorker"in navigator\).*?</script>\n?', "", h)                      # pas de service worker en fichier unique
h = re.sub(r'<link rel="manifest"[^>]*>\n?', "", h)
h = re.sub(r'<link rel="apple-touch-icon"[^>]*>\n?', "", h)
h = re.sub(r'<link rel="icon"[^>]*>', '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Ctext y=%27.9em%27 font-size=%2790%27%3E⚡%3C/text%3E%3C/svg%3E">', h)
assert 'src="app.js"' not in h and "serviceWorker" not in h
out = root / "dist" / "speedconnect-demo.html"
out.write_text(h, encoding="utf8")
print(out, round(out.stat().st_size / 1024), "Ko")
