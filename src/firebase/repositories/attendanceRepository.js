class AttendanceRepository {
  constructor(db) {
    this.db = db;
  }

  async upsertDailyUserRecord(date, employeeId, payload) {
    const ref = this.db
      .collection("attendance_logs")
      .doc(date)
      .collection("users")
      .doc(String(employeeId));
    await ref.set(payload, { merge: true });
  }

  async getTodayAttendance(date) {
    const snapshot = await this.db
      .collection("attendance_logs")
      .doc(date)
      .collection("users")
      .get();
    return snapshot.docs.map((doc) => ({ employeeId: doc.id, ...doc.data() }));
  }
}

module.exports = { AttendanceRepository };
