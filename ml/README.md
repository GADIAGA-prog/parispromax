# PARISPROMAX — Pipeline IA Turf (Learning-to-Rank)

Pipeline Python modulaire qui remplace le scoring heuristique de
[`backend/src/services/aiEngine.js`](../backend/src/services/aiEngine.js) par un
modèle **Learning-to-Rank** (LightGBM `lambdarank` / CatBoost `QueryRMSE`),
entraîné sur l'historique réel des arrivées et servi en continu.

> ⚠️ **Mention légale.** Les pronostics sont fournis à titre informatif. Aucun
> modèle ne garantit un gain ; jouez de manière responsable.

## Structure

```
ml/
├── requirements.txt
├── train.py                 # entraînement + CV temporelle -> artifacts/turf_ranker.joblib
├── serve.py                 # démon 10 min : données fraîches -> prédictions JSON
└── turf_pipeline/
    ├── config.py            # schéma canonique, encodages ordinaux, hyper-params
    ├── features.py          # BLOC 1 — les 5 piliers (sans fuite de données)
    ├── ranker.py            # BLOC 2 — lambdarank/QueryRMSE + GroupTimeSeriesSplit
    ├── scratchings.py       # BLOC 3 — non-partants (NP) + renormalisation 100 %
    ├── inference.py         # scores -> P(gagnant)/P(podium) (Plackett-Luce) + payload
    ├── data_source.py       # adaptateurs backend (/races/full, /races/history)
    └── scheduler.py         # BLOC 4 — boucle 10 min + export Android
```

## Installation

```bash
python -m venv .mlvenv
.mlvenv/Scripts/activate          # Windows ;  source .mlvenv/bin/activate sous *nix
pip install -r ml/requirements.txt
```

## Les 4 blocs

### BLOC 1 — Ingénierie des caractéristiques (`features.py`)
`compute_advanced_features(df)` calcule les 15 variables des 5 piliers. **Anti-fuite**
garanti par : tri chronologique + `shift(1)` + fenêtres temporelles `closed="left"`.
Aucune variable d'une course ne dépend de son propre résultat.

| Pilier | Variables |
|---|---|
| 1 · Cheval | `elo_rating` (ELO multi-partants pré-course), `days_since_last_race` (NaN→999), `form_index_3_races` (moyenne pondérée), `is_unshod_feature` (déferrage trot) |
| 2 · Acteurs | `couple_success_rate` (expanding+shift jockey×entraîneur), `jockey_form_30d`, `trainer_form_30d` (rolling 30 j) |
| 3 · Hippodrome | `track_suitability_index` (corde × sol), `ground_severity` (1→5, corrélé météo) |
| 4 · Course | `rope_advantage` (galop, corde×distance), `start_type_encoded`, `race_density` |
| 5 · Marché | `odds_trend_15m` (dérive cote), `market_implied_prob` (implicite, overround retiré) |

### BLOC 2 — Learning-to-Rank (`ranker.py`)
- Objectif **listwise** `lambdarank` (LightGBM) ou `QueryRMSE` (CatBoost) — pas de
  régression ni de classif binaire.
- Groupe = `race_id`. Cible graduée : **3** (1ᵉʳ), **2** (2ᵉ), **1** (3ᵉ), **0** sinon.
- `GroupTimeSeriesSplit` : validation croisée temporelle qui **n'éclate jamais une
  course** entre train/val (le futur n'influence jamais le passé). Métrique NDCG@3.

### BLOC 3 — Non-partants (`scratchings.py`)
`handle_scratchings(race_df, non_partants_list)` :
1. supprime les lignes NP ;
2. recalcule `race_density` sur le champ réel restant ;
3. renormalise `market_implied_prob` (softmax-inverse des cotes, overround retiré) ;
4. renormalise les prédictions finales → **Σ P(gagnant) = 100 %** sur les partants restants.

### BLOC 4 — Automatisation 10 min + export Android (`scheduler.py`)
`start_scheduler()` : toutes les 10 minutes → données fraîches → features →
interception NP live → prédiction révisée → payload JSON. Recharge le modèle à
chaque tick (retrain sans redémarrage). Payload par partant :
`race_id, cheval_id, nom, probabilite_gagnant, probabilite_podium, rang_predit`.

## Utilisation

```bash
# Entraînement (depuis l'API backend /races/history, ou un export local)
python ml/train.py                         # -> ml/artifacts/turf_ranker.joblib
python ml/train.py --source ml/data/history.json --backend catboost

# Démon de prédiction toutes les 10 minutes
python ml/serve.py                         # boucle
python ml/serve.py --once --source ../src/services/live_races.json   # un cycle
```

### Variables d'environnement
| Var | Rôle | Défaut |
|---|---|---|
| `PPM_BACKEND_URL` | URL du backend Node | `http://localhost:4000` |
| `PPM_MODEL_PATH` | chemin du modèle | `ml/artifacts/turf_ranker.joblib` |
| `PPM_PREDICTIONS_OUT` | sortie JSON | `ml/artifacts/predictions.json` |
| `PPM_PUSH_URL` / `PPM_PUSH_TOKEN` | POST du payload vers le backend | — |
| `PPM_NP_FILE` | override local des non-partants `{race_id:[num]}` | — |

## Intégration backend
Le démon lit `GET /races/full` (carte à venir) et `GET /races/history` (arrivées
réelles + `winners`). Les endpoints de la boucle live sont **désormais en place** :

| Endpoint | Méthode | Auth | Rôle |
|---|---|---|---|
| `/races/:externalId/non-partants` | GET | public | le démon lit les NP avant de re-scorer |
| `/admin/api/non-partants` | POST | Basic (admin) | déclarer les NP `{externalId, nonPartants:[3,7]}` |
| `/ml/predictions` | POST | Bearer `ML_PUSH_TOKEN` | reçoit le payload et l'enregistre dans `Prediction` |

Le POST `/ml/predictions` mappe le payload Python vers le format `topPicks`
existant (`{number, name, aiScore, rank}` + `probaGagnant`/`probaPodium`), donc
l'app mobile et la détection de réussite continuent de fonctionner sans
modification — le modèle LTR **supplante** simplement l'heuristique JS.

### Câblage du démon vers le backend
```bash
export PPM_BACKEND_URL=http://localhost:4000
export PPM_PUSH_URL=http://localhost:4000/ml/predictions
export PPM_PUSH_TOKEN=<valeur de ML_PUSH_TOKEN (ou CRON_TOKEN) côté backend>
python ml/serve.py
```
Côté backend, définir `ML_PUSH_TOKEN` (ou réutiliser `CRON_TOKEN`) dans `.env`.
Sans token configuré, `/ml/predictions` **rejette tout** (401) par sécurité.
La colonne `Race.nonPartants` (JSON) a été ajoutée au schéma Prisma.
```
