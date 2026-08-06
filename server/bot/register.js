require('dotenv').config();
const { registerCommands } = require('./index');

registerCommands()
  .then(() => {
    console.log('OK');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
