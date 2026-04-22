class PenaltyRepository {
  constructor(db) {
    this.db = db;
    this.collection = this.db.collection("penalties");
  }

  async upsertPenalty(date, employeeId, payload) {
    await this.collection
      .doc(date)
      .collection("records")
      .doc(String(employeeId))
      .set(payload, { merge: true });
  }

  async getPenaltiesByDate(date) {
    const snapshot = await this.collection.doc(date).collection("records").get();
    return snapshot.docs.map((doc) => ({ employeeId: doc.id, ...doc.data() }));
  }
}

module.exports = { PenaltyRepository };
