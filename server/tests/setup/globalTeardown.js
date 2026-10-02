'use strict';

/** Stop the shared MongoDB instance started by globalSetup. */
module.exports = async () => {
  if (global.__MONGOD__) {
    await global.__MONGOD__.stop();
  }
};
