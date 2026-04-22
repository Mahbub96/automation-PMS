const express = require("express");
const { ensureDateParam } = require("../../core/validators");

function createPenaltyRoutes({ penaltyRepository }) {
  const router = express.Router();

  router.get("/:date", async (req, res, next) => {
    try {
      const { date } = req.params;
      ensureDateParam(date, "date");
      const penalties = await penaltyRepository.getPenaltiesByDate(date);
      res.json({ date, penalties });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPenaltyRoutes };
