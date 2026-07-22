const nodemailer = require('nodemailer');
const config = require('../config');
const { SUBJECTS } = require('./feedback');

let transporter;

function getTransporter() {
  if (!config.recoverySupport.configured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.recoverySupport.smtpHost,
      port: config.recoverySupport.smtpPort,
      secure: config.recoverySupport.smtpSecure,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: {
        user: config.recoverySupport.smtpUser,
        pass: config.recoverySupport.smtpPass,
      },
    });
  }
  return transporter;
}

async function sendContactNotification(message) {
  const mailer = getTransporter();
  if (!mailer) return { sent: false, reason: 'not_configured' };
  const subjectLabel = SUBJECTS[message.subject] || message.subject;
  const replyTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.contact) ? message.contact : undefined;
  await mailer.sendMail({
    from: config.recoverySupport.smtpFrom,
    to: config.recoverySupport.emailTo,
    replyTo,
    subject: `Contact ParisPromax — ${subjectLabel}`,
    text: [
      'Nouveau message reçu depuis le site ParisPromax',
      '',
      `Nom : ${message.name}`,
      `Contact : ${message.contact}`,
      `Sujet : ${subjectLabel}`,
      '',
      message.message,
    ].join('\n'),
  });
  return { sent: true };
}

async function sendReviewNotification(review) {
  const mailer = getTransporter();
  if (!mailer) return { sent: false, reason: 'not_configured' };
  await mailer.sendMail({
    from: config.recoverySupport.smtpFrom,
    to: config.recoverySupport.emailTo,
    subject: `Nouvel avis ParisPromax — ${review.rating}/5`,
    text: [
      'Nouvel avis reçu depuis le site ParisPromax',
      '',
      `Nom : ${review.name || 'Anonyme'}`,
      `Note : ${review.rating}/5`,
      '',
      review.comment,
    ].join('\n'),
  });
  return { sent: true };
}

module.exports = { sendContactNotification, sendReviewNotification };
