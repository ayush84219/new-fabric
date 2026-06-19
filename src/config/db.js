import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const dbHost = process.env.DB_HOST || '127.0.0.1';
const dialectOptions = {};

// Automatically enable SSL when connecting to a remote cloud database (like Aiven)
if (dbHost !== '127.0.0.1' && dbHost !== 'localhost') {
  dialectOptions.ssl = {
    rejectUnauthorized: false, // Connects securely over SSL without requiring additional CA certificate uploads
  };
}

const sequelize = new Sequelize(
  process.env.DB_NAME || 'twms_db',
  process.env.DB_USER || 'root',
  (process.env.DB_PASSWORD || '').trim(),
  {
    host: dbHost,
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    dialectOptions: dialectOptions,
    logging: false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

// --- DATABASE SAFETY INTERCEPTORS ---
// Safeguard: Override sync and drop methods to prevent any accidental deletion or modification of data.
const originalSync = sequelize.sync.bind(sequelize);
sequelize.sync = async function (options = {}) {
  if (options.force) {
    console.warn('CRITICAL WARNING: Intercepted and blocked an attempt to call sequelize.sync({ force: true }) to prevent database deletion!');
    options.force = false;
  }
  if (options.alter) {
    console.warn('CRITICAL WARNING: Intercepted and blocked an attempt to call sequelize.sync({ alter: true }) to prevent database schema modification!');
    options.alter = false;
  }
  return originalSync(options);
};

sequelize.drop = async function () {
  console.error('CRITICAL ERROR: Intercepted and blocked an attempt to call sequelize.drop()!');
  throw new Error('Database drop operation is strictly forbidden in this application to prevent data loss.');
};

export default sequelize;
