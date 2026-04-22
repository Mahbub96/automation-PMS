const express = require("express");
const { ensureDateParam } = require("../../core/validators");

function createWhatsAppRoutes({ whatsappRepository }) {
  const router = express.Router();

  router.get("/logs/:date", async (req, res, next) => {
    try {
      const { date } = req.params;
      ensureDateParam(date, "date");
      const logs = await whatsappRepository.getDoneRecordsByDate(date);
      res.json({ date, logs });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createWhatsAppRoutes };
