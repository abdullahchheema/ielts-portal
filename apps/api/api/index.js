// Vercel function entry: the compiled Nest app lives in dist/ (built by `npm run build`).
module.exports = require('../dist/serverless').default;
