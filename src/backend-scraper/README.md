# PARISPROMAX — Backend Scraper (geny.com)

Crawler Node.js qui récupère le programme PMU public de **geny.com** et écrit
`../services/live_races.json` (schéma consommé par l'app, mis en cache hors-ligne).

## Ce qu'il fait

1. `GET /reunions-courses-pmu?date=YYYY-MM-DD` → réunions du jour.
2. Extrait les liens `/partants-pmu/<date>-<hippo>-pmu-<prix>_c<id>`, regroupés par
   hippodrome.
3. Pour chaque course : tableau des partants (N°, Cheval, Driver, Entraîneur,
   Musique, Gains, Distance).
4. Page `/cotes/...` → cote par numéro.
5. Dérive un `formScore` (0–100) à partir de la **musique** (ex. `1aDa2a1a`),
   mappe le terrain → `condition`. Le moteur IA embarqué (`aiEngine.js`) calcule
   ensuite scores et badges.

## Lancer

```bash
node src/backend-scraper/scraper.js              # date du jour
node src/backend-scraper/scraper.js 2026-06-30   # date précise
```

### Variables d'environnement (overrides)

| Var | Effet | Défaut |
|-----|-------|--------|
| `PPM_OUTPUT` | chemin du JSON de sortie | `../services/live_races.json` |
| `PPM_MAX_REUNIONS` | nb max d'hippodromes | 8 |
| `PPM_MAX_COURSES` | nb max de courses/hippodrome | 4 |

```bash
PPM_MAX_REUNIONS=2 PPM_MAX_COURSES=2 node src/backend-scraper/scraper.js
```

## ⚠️ Rate-limiting (HTTP 429)

geny.com **limite les requêtes**. Le scraper inclut un backoff exponentiel
(1.5s → 3s → 6s → 12s) et un délai de 1.5s entre requêtes. En cas de crawl trop
fréquent, geny renvoie `429` et bloque temporairement l'IP. Bonnes pratiques :

- Ne lancer **qu'une à deux fois par jour** (cron), pas en boucle.
- En cas de 429 persistant, attendre (15–60 min) ou changer d'IP.
- En cas d'échec total, le scraper **conserve le dernier `live_races.json`**
  (les données ne sont jamais effacées).

## Déploiement recommandé

1. Héberger le `live_races.json` produit (S3, GitHub raw, petit serveur).
2. Dans l'app, définir `EXPO_PUBLIC_RACES_URL` vers ce fichier
   (cf. `src/services/dataService.js`).
3. L'app fait : **remote → cache AsyncStorage → seed embarqué** (offline-first).

## Schedule (cron, 2×/jour)

```cron
0 7,12 * * * cd /path/to/parispromax && node src/backend-scraper/scraper.js >> scraper.log 2>&1
```

> Le `live_races.json` versionné dans le repo est un **jeu de démo soigné**
> (Vincennes, ParisLongchamp, Chantilly, Deauville). Lancer le scraper le
> remplace par des données réelles du jour.
