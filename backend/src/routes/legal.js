const express = require('express');

// Pages légales publiques exigées par le Play Store :
//  - /legal/privacy           : politique de confidentialité (URL à renseigner
//                               dans Play Console -> Contenu de l'application).
//  - /legal/terms             : conditions d'utilisation.
//  - /legal/account-deletion  : page web de suppression de compte (exigence
//                               Google Play pour toute app avec création de
//                               compte ; la suppression in-app existe aussi :
//                               Profil -> « Supprimer mon compte »).
const router = express.Router();

const CONTACT = 'gadiagafrancois@gmail.com';

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
      (connexion par mot de passe ; aucun SMS ni email n'est envoyé).</li>
  <li><strong>Pays</strong> — pour proposer les moyens de paiement adaptés.</li>
  <li><strong>Historique de paiements</strong> — montant, formule, statut et référence
      de transaction, pour la gestion de votre abonnement et nos obligations comptables.</li>
</ul>
<p>Nous ne collectons ni nom, ni e-mail, ni position, ni contacts, ni identifiant
publicitaire. L'application n'affiche pas de publicité.</p>

<h2>Utilisation</h2>
<ul>
  <li>Connexion sécurisée par mot de passe (stocké haché, jamais en clair) ;
      récupération de compte par code de récupération personnel.</li>
  <li>Activation et suivi de votre abonnement.</li>
  <li>Aucune vente ni partage de vos données à des tiers à des fins commerciales.</li>
</ul>

<h2>Paiements</h2>
<p>Les paiements sont traités par des prestataires agréés (FeexPay, etc.). Votre
numéro Mobile Money est transmis au prestataire uniquement pour exécuter la
transaction ; nous ne stockons aucune donnée de carte bancaire.</p>

<h2>Conservation & suppression</h2>
<p>Vos données sont conservées tant que votre compte est actif. Vous pouvez
supprimer votre compte à tout moment : voir
<a href="/legal/account-deletion">Suppression de compte</a>.</p>
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
  <li>Historique de paiements — anonymisé (détaché du compte) et conservé
      uniquement pour nos obligations comptables légales.</li>
</ul>
<p>Un abonnement en cours n'est pas remboursé au prorata en cas de suppression.</p>
`));
});

module.exports = router;
