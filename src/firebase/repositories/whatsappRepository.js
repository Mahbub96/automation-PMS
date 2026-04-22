class WhatsAppRepository {
  constructor(db) {
    this.db = db;
    this.collection = this.db.collection("whatsapp_logs");
  }

  async upsertDoneMessage(message) {
    const docId = `${message.senderId}_${message.date}`.replace(/[^\w-]/g, "_");
    await this.collection.doc(message.date).collection("messages").doc(docId).set(message, { merge: true });
    return docId;
  }

  async getDoneRecordsByDate(date) {
    const snapshot = await this.collection
      .doc(date)
      .collection("messages")
      .where("keyword", "==", "done")
      .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }
}

module.exports = { WhatsAppRepository };
