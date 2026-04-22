const Fuse = require("fuse.js");

class MappingService {
  constructor(mappingRepository) {
    this.mappingRepository = mappingRepository;
  }

  async upsertMapping(payload) {
    return this.mappingRepository.upsertMapping(payload);
  }

  async resolveWhatsAppNameToEmployeeId(whatsappName, attendanceUsers = []) {
    const allMappings = await this.mappingRepository.getAllMappings();
    const normalizedInput = String(whatsappName || "").trim().toLowerCase();

    const direct = allMappings.find(
      (m) => String(m.whatsappName || "").trim().toLowerCase() === normalizedInput
    );
    if (direct?.employeeId) {
      return { employeeId: direct.employeeId, confidence: "direct" };
    }

    const enriched = attendanceUsers.map((u) => ({
      employeeId: u.employeeId,
      officialName: u.officialName,
    }));

    const fuse = new Fuse(enriched, {
      includeScore: true,
      threshold: 0.3,
      keys: ["officialName"],
    });
    const best = fuse.search(whatsappName)[0];
    if (best?.item?.employeeId) {
      return { employeeId: best.item.employeeId, confidence: "fuzzy" };
    }

    return { employeeId: null, confidence: "none" };
  }

  async getAllMappings() {
    return this.mappingRepository.getAllMappings();
  }
}

module.exports = { MappingService };
