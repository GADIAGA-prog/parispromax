# PARISPROMAX — Backend (API + paiements + back-office)

API de production : auth par OTP, abonnements, **paiements CinetPay**, ingestion
des courses + pronostics IA, suivi du **taux de réussite réel**, et back-office
web pour l'historique des paiements.

Stack : Node + Express + Prisma. Dev = SQLite (zéro config). Prod = PostgreSQL/MySQL.

## Démarrage (dev)

```bash
cd backend
npm install
cp .env.example .env          # déjà fait ; ajustez les valeurs
npx prisma migrate dev        # crée la base SQLite
node src/jobs/ingest.js       # charge les courses (depuis live_races.json)
npm run dev                   # démarre l'API sur http://localhost:4000
```

- Back-office : http://localhost:4000/admin (login `ADMIN_USER` / `ADMIN_PASSWORD` du .env)
- Santé : http://localhost:4000/health

## Endpoints principaux

| Méthode | Route | Auth | Rôle |
|--------|-------|------|------|
| POST | `/auth/request-otp` | — | Envoie un code (dev : renvoyé dans la réponse) |
| POST | `/auth/verify-otp` | — | Vérifie le code → JWT + crée le compte + essai 48h |
| GET | `/me` | Bearer | Profil + état d'accès (essai/abonné) |
| GET | `/races` | — | Programme du jour (public) |
| GET | `/races/:id` | — | Détail course + partants (public, sans IA) |
| GET | `/races/:id/prediction` | Bearer | Pronostics IA — **gated** (abonnement/essai) |
| POST | `/payments/initiate` | Bearer | Crée un paiement → URL de paiement CinetPay |
| POST | `/payments/cinetpay/webhook` | — | Webhook PSP (re-vérifie la transaction) |
| GET | `/payments/me` | Bearer | Historique des paiements de l'utilisateur |
| GET | `/stats/success-rate` | — | **Taux de réussite réel** (null tant qu'aucun résultat) |
| GET | `/admin` | Basic | Back-office (historique paiements + stats) |
| POST | `/admin/api/results` | Basic | Saisir une arrivée → calcule le hit vs pronostic |

## Paiements CinetPay

- **Sans clés** → mode **MOCK** : une page locale simule le checkout (parfait pour
  tester tout le flux). Voir `/payments/mock/:txn`.
- **Avec clés** (`CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY` dans
  `.env`) → vrais paiements (carte, Orange Money, Wave, MTN, Moov).
- Le webhook **re-vérifie** chaque transaction via l'API CinetPay avant
  d'activer l'abonnement (sécurité anti-fraude).
- ⚠️ En dev, CinetPay doit pouvoir atteindre votre webhook : exposez le backend
  via un tunnel (ngrok/cloudflared) et mettez cette URL dans `PUBLIC_BASE_URL`.

## Taux de réussite — honnête par construction

`/stats/success-rate` renvoie `rate: null` tant qu'aucune arrivée réelle n'est
enregistrée. On ne montre **jamais** de chiffre inventé. Le taux se construit au
fur et à mesure : après chaque course, on saisit l'arrivée (`/admin/api/results`)
et le système calcule si notre pronostic #1 était placé.

## Production — à faire

1. Passer la datasource Prisma en `postgresql` (ou `mysql`) + `DATABASE_URL`.
2. Renseigner les clés CinetPay réelles + `PUBLIC_BASE_URL` public (domaine HTTPS).
3. Brancher un vrai fournisseur SMS pour l'OTP (`src/services/sms.js`).
4. Changer `ADMIN_PASSWORD`, `JWT_SECRET`.
5. Héberger (Render, Railway, VPS…) + planifier le scraper + l'ingestion (cron).
