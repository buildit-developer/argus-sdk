'use strict'
// Loaded via: NODE_OPTIONS="--require @buildit-developer/argus-node/register"
if (process.env.ARGUS_KEY) {
  require('./auto.js').patchAll()
  require('./otel.js').setupArgusOtel()
}
