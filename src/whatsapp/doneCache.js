class DoneCache {
  constructor() {
    this.seen = new Set();
  }

  buildKey({ senderId, date }) {
    return `${senderId || "unknown"}::${date}`;
  }

  has(record) {
    return this.seen.has(this.buildKey(record));
  }

  add(record) {
    this.seen.add(this.buildKey(record));
  }
}

module.exports = { DoneCache };
