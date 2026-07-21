const express = require('express');

// Pages légales publiques exigées par le Play Store :
//  - /legal/privacy           : politique de confidentialité (URL à renseigner
//                               dans Play Console -> Contenu de l'application).
//  - /legal/terms             : conditions d'utilisation.
//  - /legal/responsible-gambling : prévention et jeu responsable.
//  - /legal/account-deletion  : page web de suppression de compte (exigence
//                               Google Play pour toute app avec création de
//                               compte ; la suppression in-app existe aussi :
//                               Profil -> « Supprimer mon compte »).
const router = express.Router();

const CONTACT = 'gadiagafrancois@gmail.com';
const ACCOUNT_RECOVERY_CONTACT = 'ftevolt@gmail.com';

function page(title, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} — ParisPromax</title>
<style>
  body{margin:0;background:#0f172a;color:#e2e8f0;font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.6}
  .wrap{max-width:760px;margin:0 auto;padding:32px 20px 64px}
  h1{color:#10b981} h2{color:#f8fafc;margin-top:28px}
  a{color:#10b981} .muted{color:#94a3b8;font-size:14px}
  ul{padding-left:20px}
</style></head><body><div class="wrap">
<p><a href="/">← ParisPromax</a></p>
${body}
<p class="muted">Contact : <a href="mailto:${CONTACT}">${CONTACT}</a></p>
</div></body></html>`;
}

router.get('/privacy', (_req, res) => {
  res.type('html').send(page('Politique de confidentialité', `
<h1>Politique de confidentialité</h1>
<p class="muted">Dernière mise à jour : juillet 2026</p>
<p>ParisPromax est une application d'aide à la décision pour les courses hippiques.
Cette page décrit les données que nous collectons et l'usage que nous en faisons.</p>

<h2>Données collectées</h2>
<ul>
  <li><strong>Numéro de téléphone</strong> — utilisé comme identifiant de compte
      (connexion par mot de passe ; aucun SMS automatique n'est envoyé).</li>
  <li><strong>Pays</strong> — pour proposer les moyens de paiement adaptés.</li>
  <li><strong>Historique de paiements</strong> — montant, formule, statut et référence
      de transaction, pour la gestion de votre abonnement et nos obligations comptables.</li>
  <li><strong>Parrainage</strong> — code utilisé et état de la récompense.</li>
  <li><strong>Portefeuille de suivi</strong> — libellé, type de jeu, mise, gain et date
      uniquement lorsque vous choisissez d'enregistrer ces informations.</li>
</ul>
<p>Aucune adresse e-mail n'est associée au compte. Si vous contactez volontairement
le support de récupération, l'adresse d'expédition et le contenu du message sont
reçus uniquement pour traiter votre demande. Nous ne collectons ni position, ni
contacts, ni identifiant publicitaire. L'application n'affiche pas de publicité.</p>
<p>La date de naissance saisie dans l'écran de contrôle d'âge est vérifiée
localement sur votre appareil. Elle n'est ni transmise ni conservée par notre serveur.</p>

<h2>Utilisation</h2>
<ul>
  <li>Connexion sécurisée par mot de passe (stocké haché, jamais en clair) ;
      récupération par code personnel ou assistance manuelle après vérification.</li>
  <li>Activation et suivi de votre abonnement.</li>
  <li>Aucune vente ni partage de vos données à des tiers à des fins commerciales.</li>
</ul>

<h2>Récupération assistée du compte</h2>
<p>Si vous avez perdu à la fois votre mot de passe et votre code de récupération,
vous pouvez écrire à <a href="mailto:${ACCOUNT_RECOVERY_CONTACT}">${ACCOUNT_RECOVERY_CONTACT}</a>.
Indiquez le numéro du compte et une référence de paiement permettant de vérifier
votre identité. Ne communiquez jamais votre PIN Mobile Money. Les informations de
la demande servent uniquement à rétablir l'accès au compte.</p>

<h2>Paiements</h2>
<p>Les paiements sont traités par le prestataire affiché avant votre validation,
notamment YengaPay. Votre numéro Mobile Money, le pays, le montant et la référence
de transaction lui sont transmis uniquement pour exécuter et vérifier le paiement.
ParisPromax ne collecte jamais votre code PIN Mobile Money ni vos données de carte.</p>

<h2>Notifications et stockage sur l'appareil</h2>
<p>Si vous les autorisez, les rappels sont programmés localement par Android ou iOS.
Le jeton de session est conservé dans le stockage sécurisé chiffré du système.
Le cache des courses et vos préférences restent sur l'appareil.</p>

<h2>Destinataires et sécurité</h2>
<p>Les données sont accessibles uniquement à ParisPromax, à son hébergeur technique
et au prestataire de paiement nécessaire à la transaction. Elles ne sont pas vendues.
Les échanges utilisent HTTPS ; les mots de passe sont hachés et les secrets de paiement
ne sont jamais intégrés à l'application mobile.</p>

<h2>Conservation & suppression</h2>
<p>Les données de compte sont conservées tant que votre compte est actif. Les données
de paiement strictement nécessaires peuvent être conservées après suppression pendant
la durée imposée par les obligations comptables, fiscales, de lutte contre la fraude ou
par la réglementation applicable, après dissociation du compte. Vous pouvez
supprimer votre compte à tout moment : voir
<a href="/legal/account-deletion">Suppression de compte</a>.</p>

<h2>Vos droits et mineurs</h2>
<p>Vous pouvez demander l'accès, la rectification ou la suppression de vos données
à l'adresse indiquée ci-dessous. ParisPromax est réservé aux personnes âgées de
18 ans ou plus et ne cherche pas à collecter les données de mineurs.</p>
`));
});

router.get('/terms', (_req, res) => {
  res.type('html').send(page("Conditions d'utilisation", `
<h1>Conditions d'utilisation</h1>
<p class="muted">Dernière mise à jour : juillet 2026</p>

<h2>Service</h2>
<p>ParisPromax fournit des <strong>pronostics hippiques générés par un modèle
statistique</strong>, à titre purement informatif. L'application ne permet pas de
parier et ne collecte aucune mise.</p>

<h2>Aucune garantie de gain</h2>
<p>Les courses hippiques comportent une part d'aléa irréductible. Les probabilités
affichées sont des estimations : <strong>aucun gain n'est garanti</strong>. Ne
misez jamais d'argent que vous ne pouvez pas vous permettre de perdre. Le jeu
est interdit aux mineurs.</p>

<h2>Abonnement</h2>
<p>L'accès aux pronostics est vendu par abonnement prépayé (sans reconduction
automatique). Les prix sont affichés en XOF avant paiement. L'accès est activé
immédiatement après confirmation du paiement par le prestataire.</p>

<h2>Responsabilité</h2>
<p>ParisPromax ne saurait être tenu responsable des pertes liées à des paris
placés sur la base des pronostics affichés.</p>

<h2>Jeu responsable</h2>
<p>L'accès est réservé aux personnes de 18 ans ou plus. Consultez nos
<a href="/legal/responsible-gambling">conseils de jeu responsable</a> avant toute mise.</p>
`));
});

router.get('/responsible-gambling', (_req, res) => {
  res.type('html').send(page('Jeu responsable', `
<h1>Jeu responsable</h1>
<p class="muted">ParisPromax est strictement réservé aux personnes âgées de 18 ans ou plus.</p>
<p>Un pronostic reste une estimation et ne garantit jamais un gain. Fixez à l'avance
un budget de loisir que vous pouvez perdre sans conséquence et une limite de temps.</p>

<h2>Signaux d'alerte</h2>
<ul>
  <li>chercher à récupérer immédiatement une perte ;</li>
  <li>emprunter ou utiliser l'argent destiné aux dépenses essentielles ;</li>
  <li>cacher ses mises ou ressentir stress, culpabilité ou perte de contrôle ;</li>
  <li>augmenter fréquemment les montants pour retrouver les mêmes sensations.</li>
</ul>

<h2>Que faire ?</h2>
<ul>
  <li>arrêtez de jouer et parlez-en à une personne de confiance ;</li>
  <li>utilisez les limites de dépôt, de mise et l'auto-exclusion proposées par votre opérateur agréé ;</li>
  <li>contactez le service national d'aide aux joueurs ou l'autorité de régulation de votre pays ;</li>
  <li>en cas de détresse immédiate, contactez les services d'urgence locaux.</li>
</ul>
<p>ParisPromax ne prend aucune mise, ne conserve aucun dépôt et ne verse aucun gain.</p>
`));
});

router.get('/account-deletion', (_req, res) => {
  res.type('html').send(page('Suppression de compte', `
<h1>Supprimer votre compte ParisPromax</h1>

<h2>Depuis l'application (immédiat)</h2>
<p>Ouvrez l'application → onglet <strong>Profil</strong> →
<strong>« Supprimer mon compte »</strong> → confirmez. La suppression est
immédiate et définitive.</p>

<h2>Par e-mail</h2>
<p>Envoyez « Suppression de compte » à
<a href="mailto:${CONTACT}">${CONTACT}</a> depuis un message précisant le numéro
de téléphone du compte. Traitement sous 7 jours.</p>

<h2>Données supprimées</h2>
<ul>
  <li>Compte (numéro de téléphone, pays) — supprimé.</li>
  <li>Abonnements et codes de connexion — supprimés.</li>
  <li>Portefeuille de suivi et parrainages — supprimés.</li>
  <li>Historique de paiements — dissocié du compte, données techniques brutes effacées et conservé
      uniquement pour nos obligations comptables légales.</li>
</ul>
<p>Un abonnement en cours n'est pas remboursé au prorata en cas de suppression.</p>
`));
});

module.exports = router;
