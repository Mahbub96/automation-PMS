const { AppError } = require("./errors");

function ensureDateParam(value, fieldName = "date") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new AppError(`${fieldName} must be in YYYY-MM-DD format`, 400);
  }
}

function validateMappingBody(req, res, next) {
  const { whatsappName, employeeId, attendanceName, pmsName } = req.body || {};
  if (!whatsappName || !employeeId) {
    return next(
      new AppError(
        "whatsappName and employeeId are required (attendanceName/pmsName optional)",
        400,
      ),
    );
  }
  if (attendanceName != null && !String(attendanceName).trim()) {
    return next(new AppError("attendanceName cannot be empty when provided", 400));
  }
  if (pmsName != null && !String(pmsName).trim()) {
    return next(new AppError("pmsName cannot be empty when provided", 400));
  }
  return next();
}

module.exports = { ensureDateParam, validateMappingBody };
