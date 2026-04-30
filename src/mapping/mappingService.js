const Fuse = require("fuse.js");

class MappingService {
  constructor(mappingRepository) {
    this.mappingRepository = mappingRepository;
  }

  normalizeName(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  getNameAliases(mappingRow) {
    return [
      mappingRow?.whatsappName,
      mappingRow?.attendanceName,
      mappingRow?.pmsName,
      mappingRow?.officialName,
    ]
      .map((item) => this.normalizeName(item))
      .filter(Boolean);
  }

  async upsertMapping(payload) {
    return this.mappingRepository.upsertMapping(payload);
  }

  async resolveWhatsAppNameToEmployeeId(whatsappName, attendanceUsers = []) {
    const allMappings = await this.mappingRepository.getAllMappings();
    const normalizedInput = this.normalizeName(whatsappName);

    const direct = allMappings.find((m) =>
      this.getNameAliases(m).includes(normalizedInput),
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

  async resolveAttendanceNameToEmployeeId(attendanceName) {
    const allMappings = await this.mappingRepository.getAllMappings();
    const normalizedInput = this.normalizeName(attendanceName);
    if (!normalizedInput) {
      return { employeeId: null, confidence: "none" };
    }

    const direct = allMappings.find((m) =>
      this.getNameAliases(m).includes(normalizedInput),
    );
    if (direct?.employeeId) {
      return { employeeId: direct.employeeId, confidence: "direct-attendance" };
    }

    return { employeeId: null, confidence: "none" };
  }

  async getAllMappings() {
    return this.mappingRepository.getAllMappings();
  }
}

module.exports = { MappingService };
