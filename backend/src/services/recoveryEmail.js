const nodemailer = require('nodemailer');
const config = require('../config');

let transporter;

function getTransporter() {
  if (!config.recoverySupport.configured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.recoverySupport.smtpHost,
      port: config.recoverySupport.smtpPort,
      secure: config.recoverySupport.smtpSecure,
      auth: {
        user: config.recoverySupport.smtpUser,
        pass: config.recoverySupport.smtpPass,
      },
    });
  }
  return transporter;
}

async function sendRecoveryRequestEmail(request) {
  const mailer = getTransporter();
  if (!mailer) return { sent: false, reason: 'not_configured' };

  const lines = [
    'Nouvelle demande de récupération ParisPromax',
    '',
    `Demande : ${request.id}`,
    `Téléphone : ${request.phone}`,
    `Prénom déclaré : ${request.claimedFirstName || '—'}`,
    `Nom déclaré : ${request.claimedLastName || '—'}`,
    `Date de naissance déclarée : ${request.claimedBirthDate || '—'}`,
    `Lieu de naissance déclaré : ${request.claimedBirthPlace || '—'}`,
    `Référence de paiement : ${request.paymentReference || '—'}`,
    `Compte correspondant : ${request.userId ? 'oui' : 'non trouvé'}`,
    '',
    "Vérifiez l'identité et la référence de paiement dans le back-office avant toute réinitialisation.",
    'Ne demandez jamais le PIN Mobile Money du client.',
  ];

  await mailer.sendMail({
    from: config.recoverySupport.smtpFrom,
    to: config.recoverySupport.emailTo,
    subject: `Récupération ParisPromax — ${request.phone}`,
    text: lines.join('\n'),
  });
  return { sent: true };
}

module.exports = { sendRecoveryRequestEmail };
