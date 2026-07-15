# Déployer le backend ParisPromax

Deux options. **Render** (recommandé, le plus simple) ou **Docker** (Railway / Fly / VPS).
En production on utilise **PostgreSQL** (le schéma Postgres est généré
automatiquement à partir du schéma dev par `npm run build:prod`).

---

## Option A — Render (recommandé)

### 1. Mettre le code sur GitHub
Depuis la racine du projet (`c:\laragon\www\parispromax`) :

```bash
git init
git add .
git commit -m "ParisPromax: app + backend"
git branch -M main
git remote add origin https://github.com/<vous>/parispromax.git
git push -u origin main
```

> Le `.gitignore` exclut déjà `node_modules`, `.env`, la base SQLite et les
> secrets. **Ne committez jamais votre `.env`.**

### 2. Créer les services sur Render
1. Compte gratuit sur https://render.com
2. **New + → Blueprint** → choisissez votre repo GitHub.
3. Render lit `render.yaml` et crée **2 ressources** : une base **PostgreSQL**
   + le **web service** `parispromax-backend`. Cliquez **Apply**.

### 3. Renseigner les variables marquées « manuel »
Dans le dashboard du service → **Environment** :
- `ADMIN_PASSWORD` : un mot de passe fort pour le back-office.
- `PUBLIC_BASE_URL` : l'URL du service (ex. `https://parispromax-backend.onrender.com`)
  — disponible après le 1er déploiement, puis **Redeploy**.
- (plus tard) `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY`
  quand votre compte marchand est prêt. Tant qu'elles sont vides → **mode mock**.

### 4. Charger des courses
La base démarre vide. Pour ingérer des données, lancez (onglet **Shell** du
service Render, ou en local pointé sur la DB Render) :

```bash
npm run scrape    # récupère les courses du jour (geny.com)
npm run ingest    # les charge en base + calcule les pronostics
```

> Pour automatiser : ajoutez un **Render Cron Job** (ex. 2×/jour) qui exécute
> `npm run scrape && npm run ingest`.
>
> Le dépôt fournit aussi `.github/workflows/refresh.yml`. Après configuration
> du secret GitHub `CRON_TOKEN` avec la même valeur que sur Render, il actualise
> automatiquement le programme à **06:00 UTC (06:00 au Burkina Faso)**, puis
> rafraîchit les cotes à 11:00 et 15:30.

### 5. Vérifier
- `https://<votre-url>/health` → `{ ok: true }`
- `https://<votre-url>/admin` → back-office (login `admin` / votre `ADMIN_PASSWORD`)

---

## Option B — Docker (Railway / Fly / VPS)

Un `Dockerfile` est fourni. Il faut une base PostgreSQL et `DATABASE_URL`.

```bash
docker build -t parispromax-backend ./backend
docker run -p 4000:4000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/parispromax" \
  -e JWT_SECRET="..." -e ADMIN_PASSWORD="..." \
  -e PUBLIC_BASE_URL="https://votre-domaine" \
  parispromax-backend
```

Sur **Railway** : New Project → Deploy from repo → ajoutez un plugin **PostgreSQL**
→ Railway injecte `DATABASE_URL`. Réglez `rootDir` = `backend` si demandé.

---

## Après le déploiement

1. **CinetPay** : une fois le compte marchand ouvert, mettez les 3 clés + repassez
   `CINETPAY_MODE=production`. Le **webhook** est `<PUBLIC_BASE_URL>/payments/cinetpay/webhook`
   (à déclarer dans votre dashboard CinetPay).
2. **OTP SMS** : passez `OTP_DEV_MODE=false` et implémentez un provider dans
   `src/services/sms.js`.
3. **App mobile** : pointez l'app sur `PUBLIC_BASE_URL` (Phase 2 — câblage de l'app).
4. **Sécurité** : changez `JWT_SECRET`, `ADMIN_PASSWORD` ; restreignez `CORS_ORIGINS`.
