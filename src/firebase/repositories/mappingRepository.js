class MappingRepository {
  constructor(db) {
    this.db = db;
    this.collection = this.db.collection("mapping");
  }

  async upsertMapping({ whatsappName, employeeId, officialName }) {
    const key = this.normalizeKey(whatsappName);
    await this.collection.doc(key).set(
      {
        whatsappName,
        employeeId,
        officialName: officialName || null,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return { key, whatsappName, employeeId, officialName: officialName || null };
  }

  async getAllMappings() {
    const snapshot = await this.collection.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  normalizeKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
  }
}

module.exports = { MappingRepository };
