function createApiAuthMiddleware({ token, required }) {
  const authToken = token || "";
  const isRequired = Boolean(required);

  if (!isRequired) {
    return (_req, _res, next) => next();
  }

  if (!authToken) {
    throw new Error("API auth is required but no token was configured.");
  }

  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const apiKeyToken = req.headers["x-api-token"] || "";
    const providedToken = bearerToken || String(apiKeyToken).trim();

    if (providedToken !== authToken) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    return next();
  };
}

module.exports = { createApiAuthMiddleware };
