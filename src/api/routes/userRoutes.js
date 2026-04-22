const express = require("express");

function createUserRoutes({ mappingService }) {
  const router = express.Router();

  router.get("/", async (req, res, next) => {
    try {
      const users = await mappingService.getAllMappings();
      res.json({ users });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createUserRoutes };
