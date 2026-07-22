const SUBJECTS = Object.freeze({
  general: 'Question générale',
  account: 'Compte et connexion',
  subscription: 'Abonnement',
  payment: 'Paiement',
  partnership: 'Partenariat',
  other: 'Autre demande',
});

function cleanLine(value, max) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanBody(value, max) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function validateContactSubmission(body = {}) {
  const name = cleanLine(body.name, 80);
  const contact = cleanLine(body.contact, 120);
  const subject = cleanLine(body.subject, 40);
  const message = cleanBody(body.message, 2000);
  if (name.length < 2) return { ok: false, error: 'Indiquez votre nom.' };
  if (contact.length < 5) return { ok: false, error: 'Indiquez un téléphone ou un e-mail valide.' };
  if (!Object.hasOwn(SUBJECTS, subject)) return { ok: false, error: 'Choisissez un sujet valide.' };
  if (message.length < 10) return { ok: false, error: 'Votre message doit contenir au moins 10 caractères.' };
  return { ok: true, data: { name, contact, subject, message } };
}

function validateReviewSubmission(body = {}) {
  const name = cleanLine(body.name, 80);
  const rating = Number(body.rating);
  const comment = cleanBody(body.comment, 1000);
  if (name && name.length < 2) return { ok: false, error: 'Le nom indiqué est trop court.' };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'Choisissez une note entre 1 et 5 étoiles.' };
  }
  if (comment.length < 3) return { ok: false, error: 'Ajoutez un court commentaire.' };
  return { ok: true, data: { name: name || null, rating, comment } };
}

module.exports = {
  SUBJECTS,
  cleanLine,
  cleanBody,
  validateContactSubmission,
  validateReviewSubmission,
};
