const express = require("express");
const { validateMappingBody } = require("../../core/validators");

function createMappingRoutes({ mappingService }) {
  const router = express.Router();

  router.post("/", validateMappingBody, async (req, res, next) => {
    try {
      const { whatsappName, employeeId, officialName } = req.body;
      const mapping = await mappingService.upsertMapping({
        whatsappName,
        employeeId,
        officialName,
      });
      res.status(201).json({ mapping });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createMappingRoutes };
