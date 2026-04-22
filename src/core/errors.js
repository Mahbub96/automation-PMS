class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: "Route not found" });
}

function errorHandler(logger) {
  return (err, req, res) => {
    const statusCode = err.statusCode || 500;
    logger.error(
      {
        err: err.message,
        stack: err.stack,
        path: req.path,
        details: err.details || null,
      },
      "Unhandled error"
    );

    res.status(statusCode).json({
      error: err.message || "Internal server error",
      details: err.details || undefined,
    });
  };
}

module.exports = { AppError, errorHandler, notFoundHandler };
