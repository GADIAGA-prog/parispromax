const express = require('express');
const { PLANS } = require('../plans');

const router = express.Router();

// GET /plans — public list of subscription plans.
router.get('/', (_req, res) => {
  res.json({ plans: PLANS });
});

module.exports = router;
