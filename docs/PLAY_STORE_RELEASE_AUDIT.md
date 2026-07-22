# Audit de publication Google Play — ParisPromax

Date de l'audit : 20 juillet 2026

## Verdict

**État technique : prêt pour une build Android de production après déploiement du backend.**

**État Google Play : NO-GO pour une publication publique dans les pays actuellement ciblés.**

Ce blocage n'est pas un défaut de compilation. ParisPromax fournit des pronostics et des cotes hippiques. Le portefeuille de mises/gains et le simulateur de mise ont été retirés. La politique Google Play peut néanmoins classer les pronostics et le suivi des cotes comme des fonctionnalités facilitant les paris. Une application qualifiée ainsi doit être acceptée dans le programme Google dédié, détenir les licences requises et être distribuée uniquement dans les pays et pour les produits autorisés.

Les pays de paiement actuellement proposés par ParisPromax — Burkina Faso, Côte d'Ivoire, Sénégal, Togo, Bénin, Mali, Niger, Congo-Brazzaville et Guinée — ne figurent pas dans la liste Google des pays où une demande d'application de jeux d'argent en argent réel est acceptée. En l'état, soumettre cette application expose le compte développeur à un refus ou à une mesure d'application de la politique.

Références officielles :

- [Politique Google Play relative aux jeux d'argent](https://support.google.com/googleplay/android-developer/answer/9877032?hl=fr)
- [Pays et produits autorisés](https://support.google.com/googleplay/android-developer/answer/12256011?hl=fr)
- [Formulaire de demande Google Play](https://support.google.com/googleplay/android-developer/contact/gambling?hl=fr)

## Corrections techniques réalisées

### Android et Expo

- Migration vers Expo SDK 56, React Native 0.85.3 et React 19.2.3.
- Node.js minimal porté à 22.13.
- Configuration de production EAS en Android App Bundle avec versionCode distant et incrément automatique.
- Permissions publicitaires, superposition système et ancien stockage externe explicitement bloquées.
- Jeton de session déplacé vers le stockage sécurisé Android avec migration de l'ancien stockage.
- Autorisation des notifications demandée uniquement après une action explicite dans le profil.
- Fichiers serveur, IA, secrets, bases et builds locales exclus du contexte EAS.
- Export Android Hermes validé et diagnostic Expo validé sans erreur.

Références : [Expo SDK 56](https://docs.expo.dev/versions/v56.0.0/), [exigence Android API cible](https://support.google.com/googleplay/android-developer/answer/11926878?hl=fr), [compatibilité pages mémoire 16 Ko](https://developer.android.com/guide/practices/page-sizes?hl=fr).

### Comptes, confidentialité et sécurité

- Écran de contrôle local de majorité (18+) avant l'utilisation de l'application.
- Politique de confidentialité, conditions, jeu responsable et page Web de suppression du compte ajoutés.
- Suppression du compte disponible dans l'application ; les données techniques brutes du paiement sont effacées lors de la dissociation.
- Codes de récupération protégés avec scrypt, avec compatibilité de migration des anciens codes.
- Mot de passe utilisateur d'au moins 8 caractères et secret administrateur renforcé en production.
- Modes OTP de développement et paiements simulés interdits en production.
- En-têtes HTTP de sécurité et politique CSP ajoutés.
- Limitation du nombre d'initialisations de paiement par utilisateur.

Références : [suppression des comptes](https://support.google.com/googleplay/android-developer/answer/13327111?hl=fr), [section Sécurité des données](https://support.google.com/googleplay/android-developer/answer/10787469?hl=fr).

### Paiements et abonnements

- YengaPay utilisé en mode réel avec vérification HMAC des webhooks et rapprochement des statuts.
- Validation stricte du pays et de l'opérateur renvoyés par l'intention de paiement.
- Parcours OTP corrigé par opérateur : Orange et Telecel demandent le code client ; Coris et Sank utilisent l'envoi OTP YengaPay ; Moov et MTN suivent le parcours de confirmation sans saisie d'OTP dans l'application.
- Les pays de création de compte sont dérivés des prestataires effectivement configurés.
- Prix : 200 XOF/jour, 1 300 XOF/semaine, 5 400 XOF/mois, 15 300 XOF/trimestre, 54 000 XOF/an.
- La formule journalière reste à 200 XOF même avec parrainage, afin de respecter le minimum de paiement YengaPay.
- Le parrain reçoit une seule fois la moitié de la durée du premier abonnement payé par son filleul, avec protection contre les doubles attributions.
- Historique des paiements masqué sur Android.

Attention : Google Play impose normalement son système de facturation pour un abonnement numérique. Le paiement externe ne peut être conservé que si l'application est légalement et techniquement admissible à l'exception applicable aux applications de jeux d'argent acceptées. Voir [politique de paiement Google Play](https://support.google.com/googleplay/android-developer/answer/9858738?hl=fr).

### Pronostics et historique

- Chaque pronostic contient le nombre de chevaux à l'arrivée plus deux.
- Présentation structurée en base, couplé, chances régulières, tocard et regret.
- Le pronostic complet est figé dans le résultat ; une actualisation ultérieure ne remplace plus l'historique par les trois premiers chevaux.
- Les imports et rafraîchissements font des mises à jour ciblées et ne suppriment plus toutes les courses, prédictions et résultats de la journée.

### Backend et exploitation

- Schéma Prisma PostgreSQL validé et migration ajoutée pour le snapshot du pronostic.
- Déploiement Render sans option de perte de données.
- Installation serveur reproductible avec `npm ci`.
- Routes cron protégées par en-tête secret, sans secret dans l'URL.
- Service IA refusant de démarrer sur Render sans jeton configuré.
- Endpoint de santé vérifiant la base et la présence d'un prestataire de paiement réel en production.

## Vérifications exécutées

- `npx expo-doctor` : 21 contrôles sur 21 réussis.
- Cohérence des dépendances Expo SDK 56 : réussie.
- Export Android/Hermes : réussi, 1 030 modules, bundle HBC généré.
- Tests backend : 29 réussis, 0 échec.
- Audit npm backend : 0 vulnérabilité.
- Audit npm mobile : aucune vulnérabilité élevée ou critique ; 11 avis modérés sont confinés à l'outillage natif Expo. La correction automatique proposée imposerait une rétrogradation incompatible et ne doit pas être appliquée.
- Validation du schéma Prisma de production : réussie.
- Syntaxe JavaScript : 43 fichiers validés.
- Syntaxe Python : 14 fichiers validés.
- Protections de démarrage production : secret JWT absent/court, OTP de développement et mot de passe administrateur faible correctement refusés.
- Contrôle `git diff --check` : réussi.
- Export Android final : réussi, 1 030 modules et bundle Hermes de 2,8 Mo.
- Build EAS production `versionCode 4` : terminée avec succès (`a2ac0a27-3dd0-435d-8fe9-38d022c988de`).
- AAB local : `builds/parispromax-1.0.0-4.aab`, 57 545 287 octets, archive intègre.
- SHA-256 : `567B3D4FFD49D36F877BAE7138EAC813C0646F94F82770135C0413391F02DAF7`.
- Alignement ELF 16 Ko : 36 bibliothèques natives 64 bits contrôlées, toutes conformes.

## État du service réellement déployé

Le backend public répond et YengaPay est configuré en mode réel, mais il exécute encore une révision antérieure. Les nouvelles routes `/payments/countries` et `/legal/responsible-gambling` ne sont pas encore présentes en production. Il faut déployer le backend et appliquer la migration Prisma avant de distribuer la nouvelle application.

## Conditions indispensables avant toute soumission Play

1. Obtenir un avis juridique écrit sur la qualification de ParisPromax et les licences nécessaires dans chaque pays.
2. Obtenir l'acceptation préalable Google Play pour la catégorie concernée et ne cibler que les territoires figurant dans le formulaire Google.
3. Fournir un véritable géoblocage basé sur la position, en plus du pays déclaré sur le compte, si l'application est acceptée comme application de jeux d'argent.
4. Confirmer par écrit les droits de collecte, reproduction et redistribution des données PMU/Geny et des cotes.
5. Déployer le backend corrigé et appliquer la migration de base de données.
6. Renseigner dans Play Console : URL de confidentialité, URL de suppression de compte, classification 18+/Adults Only, jeu responsable, déclaration Sécurité des données et déclaration des fonctionnalités financières.
7. Fournir à l'équipe de validation un compte de test avec abonnement actif et des instructions complètes.
8. Tester le paiement réel avec chaque opérateur et chaque pays activé, puis vérifier le webhook, l'activation et l'idempotence.
9. Exécuter un test fermé Google Play sur appareils 64 bits et vérifier l'AAB final, notamment la compatibilité 16 Ko.

Référence : [déclaration des fonctionnalités financières](https://support.google.com/googleplay/android-developer/answer/13849271?hl=fr).

## Voies de publication possibles

- **Option A — Play Store conforme :** modifier le produit pour retirer toute assistance au pari, suivi de mises/gains, cotes et formulation incitant à parier, puis utiliser Google Play Billing pour l'abonnement numérique.
- **Option B — Application de jeux d'argent autorisée :** licences, acceptation Google préalable, géoblocage et distribution uniquement dans des pays admissibles. Cette option n'est actuellement pas disponible pour les pays visés.
- **Option C — Distribution hors Play :** distribution directe ou boutique alternative, après validation juridique locale et mise en place de ses propres contrôles de conformité.

La build AAB peut servir aux tests internes, mais elle ne constitue pas une autorisation de publication.
