# Migrations ParisPromax

Le schéma versionné `schema.prisma` utilise SQLite pour le développement local.
Le script `scripts/gen-prod-schema.js` en génère une copie PostgreSQL au moment
du déploiement.

Les migrations de `prisma/migrations` sont donc la chaîne SQLite locale. Elles
ne doivent pas être exécutées avec `prisma migrate deploy` contre PostgreSQL :
les premières migrations contiennent notamment le type SQLite `DATETIME`.

La base Render existante a été créée et synchronisée historiquement avec
`prisma db push`. Pour préserver cet historique sans baseline destructive :

1. `npm run build:prod` génère le client PostgreSQL ;
2. le service Render payant exécute `npm run db:sync:prod` avec
   `preDeployCommand`, avant le basculement du nouveau déploiement ;
3. Prisma compare la base PostgreSQL réelle au schéma généré et applique
   uniquement les changements compatibles ;
4. aucune option `--accept-data-loss` n'est autorisée.

La modification du 20 juillet 2026 ajoute uniquement la colonne nullable
`Result.predictionSnapshot`. Elle conserve toutes les lignes existantes et le
script devient un no-op si la colonne est déjà présente.

La modification du 21 juillet 2026 ajoute des champs d'identité et de
récupération tous nullables sur `User`, ainsi que la table
`RecoveryRequest`. Les comptes et abonnements existants sont conservés ; les
anciens utilisateurs peuvent continuer à utiliser leur mot de passe et leur
code, puis compléter leur récupération via l'assistance si nécessaire.

La modification du 24 juillet 2026 ajoute `User.authVersion` avec une valeur
par défaut à zéro. Une réinitialisation de mot de passe incrémente cette valeur
et invalide ainsi les anciens jetons sans supprimer le compte.

Une conversion future vers `prisma migrate deploy` exigera d'abord une baseline
PostgreSQL explicite sur une copie de la production. Il ne faut pas réutiliser
directement la chaîne SQLite.
