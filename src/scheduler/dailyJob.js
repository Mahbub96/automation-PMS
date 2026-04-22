const cron = require("node-cron");
const { dateKeyDhaka } = require("../core/timezone");

function createDailyAttendanceJob({
  cronExpression,
  timezone,
  attendanceApiService,
  whatsappRepository,
  rulesEngine,
  logger,
}) {
  return cron.schedule(
    cronExpression,
    async () => {
      const date = dateKeyDhaka();
      logger.info({ date }, "Running daily attendance compliance job");

      try {
        const presentUsers = await attendanceApiService.fetchPresentUsers();
        const doneRecords = await whatsappRepository.getDoneRecordsByDate(date);
        await rulesEngine.evaluateDailyCompliance({
          date,
          presentUsers,
          doneRecords,
        });
      } catch (err) {
        logger.error({ err: err.message }, "Daily attendance job failed");
      }
    },
    { timezone }
  );
}

module.exports = { createDailyAttendanceJob };
