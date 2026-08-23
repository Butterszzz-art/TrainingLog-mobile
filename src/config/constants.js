const envServerUrl =
  typeof process !== 'undefined' &&
  process.env &&
  typeof process.env.PUBLIC_SERVER_URL === 'string' &&
  process.env.PUBLIC_SERVER_URL
    ? process.env.PUBLIC_SERVER_URL
    : '';

const DEFAULT_SERVER_URL = envServerUrl || 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';

if (typeof window !== 'undefined') {
  window.TrainingLogConfig = {
    ...(window.TrainingLogConfig || {}),
    DEFAULT_SERVER_URL
  };
}

if (typeof module !== 'undefined') {
  module.exports = { DEFAULT_SERVER_URL };
}
