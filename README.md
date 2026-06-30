# 🏇 PARISPROMAX

Application Android légère (React Native / Expo) de **pronostics IA pour les
courses PMU françaises**, optimisée pour les connexions lentes et le marché
africain. Système d'essai gratuit 48h, paywall Mobile Money, mode hors-ligne.

## 🚀 Démarrage

```bash
npm install
npm run android      # lance sur l'émulateur / appareil Android
# ou
npm start            # ouvre le Metro bundler (QR code Expo Go)
```

## 🧱 Architecture

```
src/
├── components/        Composants réutilisables
│   ├── TrialBanner.js     Bandeau d'essai persistant (compte à rebours)
│   ├── HorseCard.js       Carte "racing card" d'un partant
│   ├── TrackCard.js       Carte hippodrome + courses
│   ├── AIBadge.js         Badges IA (TOP PRONO / VALUE BET / CHRONO)
│   └── LockCard.js        Overlay flou + verrou (hard paywall)
├── context/
│   └── AuthContext.js     Login tel., essai 48h, abonnement (AsyncStorage)
├── navigation/
│   └── RootNavigator.js   Stack + Tabs (thème sombre émeraude)
├── screens/
│   ├── LoginScreen.js     Connexion par téléphone (démarre l'essai)
│   ├── HomeScreen.js      Hippodromes, terrains, dotations
│   ├── RaceDetailScreen.js Partants + pronostics IA (verrouillables)
│   ├── PaywallScreen.js   Orange Money / MTN / Wave / Moov — 5000 XOF/mois
│   ├── HistoryScreen.js   Résultats passés + taux de réussite 74%
│   └── ProfileScreen.js   Profil + Dev Panel (5 taps sur ⚙️)
├── services/
│   ├── aiEngine.js        Moteur de score IA + attribution des badges
│   ├── dataService.js     Chargement offline-first (remote→cache→seed)
│   ├── NotificationService.js  Alertes locales (8h + 15min avant départ)
│   └── live_races.json    Données de courses (générées par le scraper)
├── theme/
│   └── colors.js          Palette : #064e3b / #0f172a / #10b981
└── backend-scraper/
    ├── scraper.js         Scraper Node (axios + cheerio, Zone-Turf/LeTrot)
    └── README.md          Mode d'emploi du scraper
```

## 🤖 Moteur IA (`aiEngine.js`)

Score 0–100 par cheval = mélange pondéré de la forme récente (40%), de la
confiance du marché via la cote (30%), du taux de victoire (18%) et de la note
du jockey (12%). Attribue ensuite :

- 🔥 **TOP PRONO** — meilleur score IA de la course
- ⭐ **VALUE BET** — meilleur indice de valeur (bon score + cote intéressante)
- ⏱️ **RECORD CHRONO** — meilleur chrono (réduction km) de la course

## 🔒 Système d'essai & paywall

- Connexion → essai **48h** (`isTrialActive`, `hoursRemaining`).
- Essai expiré **et** non abonné → **hard paywall** : Top 3, Value Bets et
  Chronos floutés derrière `LockCard`, redirection vers le Paywall.
- Abonnement Mobile Money simulé (5000 XOF/mois) → `hasPaid = true`.

### 🛠️ Dev Panel

Profil → taper 5× sur l'icône ⚙️ pour révéler le panneau :
- **Simulate Day 1 (Trial Active)** — essai actif (~48h)
- **Simulate Day 3 (Trial Expired)** — essai expiré (test du lockdown)

## 📡 Mode hors-ligne

`dataService.loadRaces()` essaie le scraper distant (timeout court), puis
retombe sur le cache `AsyncStorage`, puis sur le `live_races.json` embarqué.
Définir `EXPO_PUBLIC_RACES_URL` pour pointer vers le JSON hébergé.

## 🔔 Notifications

`NotificationService` planifie une alerte quotidienne à 8h et des alertes
"15 min avant le départ" (notifications locales, fonctionnent hors-ligne).
