const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const mongoUrl = process.env.MONGODB_URI || process.env.MONGODB_URI_TEST;

module.exports = {
  mongodb: {
    url: mongoUrl,
    databaseName: "shop_with_seye",
    options: {}
  },
  migrationsDir: path.join(__dirname, "migrations"),
  changelogCollectionName: "migrations_changelog",
  migrationFileExtension: ".js",
  useFileHash: false,
  moduleSystem: "commonjs"
};
