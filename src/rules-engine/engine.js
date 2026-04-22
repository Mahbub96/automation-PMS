const { cutoffTimeDhaka, dayjs } = require("../core/timezone");

class RulesEngine {
  constructor({ mappingService, attendanceRepository, penaltyRepository, logger }) {
    this.mappingService = mappingService;
    this.attendanceRepository = attendanceRepository;
    this.penaltyRepository = penaltyRepository;
    this.logger = logger;
  }

  async evaluateDailyCompliance({ date, presentUsers, doneRecords }) {
    const cutoff = cutoffTimeDhaka(date);
    const doneByEmployee = new Set();
    const timestampsByEmployee = new Map();
    const whatsappNameByEmployee = new Map();

    for (const record of doneRecords) {
      const sentAt = dayjs(record.timestampIso).tz("Asia/Dhaka");
      if (sentAt.isAfter(cutoff)) {
        continue;
      }
      const resolved = await this.mappingService.resolveWhatsAppNameToEmployeeId(
        record.whatsappName,
        presentUsers
      );
      if (resolved.employeeId) {
        doneByEmployee.add(resolved.employeeId);
        const existing = timestampsByEmployee.get(resolved.employeeId) || [];
        if (!existing.includes(record.timestampIso)) {
          existing.push(record.timestampIso);
          timestampsByEmployee.set(resolved.employeeId, existing);
        }
        if (!whatsappNameByEmployee.has(resolved.employeeId)) {
          whatsappNameByEmployee.set(resolved.employeeId, record.whatsappName);
        }
      }
    }

    const results = presentUsers.map((user) => {
      const done = doneByEmployee.has(user.employeeId);
      return {
        employeeId: user.employeeId,
        officialName: user.officialName,
        present: true,
        done,
        penalty: !done,
        whatsappName: whatsappNameByEmployee.get(user.employeeId) || null,
        timestamps: timestampsByEmployee.get(user.employeeId) || [],
        updatedAt: new Date().toISOString(),
      };
    });

    await Promise.all(
      results.map((entry) =>
        this.attendanceRepository.upsertDailyUserRecord(date, entry.employeeId, entry)
      )
    );
    await Promise.all(
      results
        .filter((entry) => entry.penalty)
        .map((entry) =>
          this.penaltyRepository.upsertPenalty(date, entry.employeeId, {
            employeeId: entry.employeeId,
            reason: "Present but no done message before cutoff",
            createdAt: new Date().toISOString(),
          })
        )
    );
    this.logger.info(
      { date, totalPresent: presentUsers.length, penalties: results.filter((r) => r.penalty).length },
      "Daily compliance evaluated"
    );

    return { results };
  }
}

module.exports = { RulesEngine };
