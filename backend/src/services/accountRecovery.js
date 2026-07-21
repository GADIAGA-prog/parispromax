const { normalizeRecoveryAnswer } = require('../security');

const RECOVERY_QUESTIONS = Object.freeze([
  { id: 'first_school', label: 'Quel est le nom de votre première école ?' },
  { id: 'childhood_nickname', label: "Quel était votre surnom d'enfance ?" },
  { id: 'childhood_district', label: "Dans quel quartier avez-vous grandi ?" },
  { id: 'first_teacher', label: 'Quel était le prénom de votre premier enseignant ?' },
]);

const QUESTION_BY_ID = new Map(RECOVERY_QUESTIONS.map((question) => [question.id, question]));

function cleanText(raw, maxLength = 120) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeBirthDate(raw) {
  const value = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function ageOnDate(birthDate, now = new Date()) {
  const [year, month, day] = birthDate.split('-').map(Number);
  let age = now.getUTCFullYear() - year;
  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  return age;
}

function validateRegistrationProfile(body, now = new Date()) {
  const firstName = cleanText(body.firstName, 80);
  const lastName = cleanText(body.lastName, 80);
  const birthDate = normalizeBirthDate(body.birthDate);
  const birthPlace = cleanText(body.birthPlace, 120);
  const recoveryQuestion = cleanText(body.recoveryQuestion, 40);
  const recoveryAnswer = normalizeRecoveryAnswer(body.recoveryAnswer);

  if (firstName.length < 2 || lastName.length < 2) {
    return { ok: false, error: 'Prénom et nom requis (2 caractères minimum)' };
  }
  if (!birthDate) return { ok: false, error: 'Date de naissance invalide (AAAA-MM-JJ)' };
  const age = ageOnDate(birthDate, now);
  if (age < 18 || age > 120) {
    return { ok: false, error: 'ParisPromax est réservé aux personnes majeures' };
  }
  if (birthPlace.length < 2) return { ok: false, error: 'Lieu de naissance requis' };
  if (!QUESTION_BY_ID.has(recoveryQuestion)) {
    return { ok: false, error: 'Question de récupération invalide' };
  }
  if (recoveryAnswer.length < 2) {
    return { ok: false, error: 'Réponse de récupération trop courte' };
  }

  return {
    ok: true,
    data: { firstName, lastName, birthDate, birthPlace, recoveryQuestion, recoveryAnswer },
  };
}

function questionLabel(id) {
  return QUESTION_BY_ID.get(id)?.label || null;
}

module.exports = {
  RECOVERY_QUESTIONS,
  cleanText,
  normalizeBirthDate,
  ageOnDate,
  validateRegistrationProfile,
  questionLabel,
};
