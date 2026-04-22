const express = require("express");
const { dateKeyDhaka } = require("../../core/timezone");
const { ensureDateParam } = require("../../core/validators");

function createAttendanceRoutes({ attendanceRepository }) {
  const router = express.Router();

  router.get("/today", async (req, res, next) => {
    try {
      const date = dateKeyDhaka();
      const data = await attendanceRepository.getTodayAttendance(date);
      res.json({ date, records: data });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:date", async (req, res, next) => {
    try {
      const { date } = req.params;
      ensureDateParam(date, "date");
      const data = await attendanceRepository.getTodayAttendance(date);
      res.json({ date, records: data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createAttendanceRoutes };
