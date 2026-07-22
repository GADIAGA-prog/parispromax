const express = require('express');
const prisma = require('../db');
const { rateLimit } = require('../security');
const { validateContactSubmission, validateReviewSubmission } = require('../services/feedback');
const { sendContactNotification, sendReviewNotification } = require('../services/feedbackEmail');

const router = express.Router();
const contactLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const reviewLimit = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 3 });

async function reviewSummary() {
  const summary = await prisma.serviceReview.aggregate({
    _avg: { rating: true },
    _count: { rating: true },
  });
  return {
    average: summary._avg.rating ? Math.round(summary._avg.rating * 10) / 10 : 0,
    count: summary._count.rating || 0,
  };
}

router.get('/reviews/summary', async (_req, res) => {
  res.json(await reviewSummary());
});

router.post('/contact', contactLimit, async (req, res) => {
  // Invisible honeypot: acknowledge bots without saving or sending anything.
  if (String(req.body.website || '').trim()) {
    return res.status(202).json({ ok: true, message: 'Message transmis.' });
  }
  const parsed = validateContactSubmission(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const message = await prisma.contactMessage.create({ data: parsed.data });
  try {
    const delivery = await sendContactNotification(message);
    if (delivery.sent) {
      await prisma.contactMessage.update({ where: { id: message.id }, data: { emailSent: true } });
    }
  } catch (error) {
    console.error(`[contact] email delivery failed for ${message.id}:`, error.message);
  }
  res.status(202).json({ ok: true, message: 'Merci. Votre message a bien été transmis.' });
});

router.post('/reviews', reviewLimit, async (req, res) => {
  if (String(req.body.website || '').trim()) {
    return res.status(201).json({ ok: true, message: 'Merci pour votre avis.' });
  }
  const parsed = validateReviewSubmission(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const review = await prisma.serviceReview.create({ data: parsed.data });
  try {
    const delivery = await sendReviewNotification(review);
    if (delivery.sent) {
      await prisma.serviceReview.update({ where: { id: review.id }, data: { emailSent: true } });
    }
  } catch (error) {
    console.error(`[reviews] email delivery failed for ${review.id}:`, error.message);
  }
  res.status(201).json({
    ok: true,
    message: 'Merci pour votre avis.',
    summary: await reviewSummary(),
  });
});

module.exports = router;
