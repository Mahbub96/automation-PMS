const { AppError } = require("./errors");

function ensureDateParam(value, fieldName = "date") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new AppError(`${fieldName} must be in YYYY-MM-DD format`, 400);
  }
}

function validateMappingBody(req, res, next) {
  const { whatsappName, employeeId } = req.body || {};
  if (!whatsappName || !employeeId) {
    return next(new AppError("whatsappName and employeeId are required", 400));
  }
  return next();
}

module.exports = { ensureDateParam, validateMappingBody };
