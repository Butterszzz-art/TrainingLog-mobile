const envServerUrl =
  typeof process !== "undefined" &&
  process.env &&
  typeof process.env.PUBLIC_SERVER_URL === "string" &&
  process.env.PUBLIC_SERVER_URL
    ? process.env.PUBLIC_SERVER_URL
    : "";

// Base URL for the back-end API. Use PUBLIC_SERVER_URL from env if available.
export const DEFAULT_SERVER_URL =
  envServerUrl || "https://traininglog-backend.onrender.com";
