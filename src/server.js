import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import app from './app.js';
import sequelize from './config/db.js';
import { seedDatabase } from './config/seed.js';
import { connectKafka } from './config/kafka.js';

dotenv.config();

const PORT = process.env.PORT || 5001;

const ensureDatabaseExists = async () => {
  try {
    const dbHost = process.env.DB_HOST || '127.0.0.1';
    const connConfig = {
      host: dbHost,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: (process.env.DB_PASSWORD || '').trim(),
    };

    if (dbHost !== '127.0.0.1' && dbHost !== 'localhost') {
      connConfig.ssl = {
        rejectUnauthorized: false,
      };
    }

    console.log('Env variables loaded - HOST:', dbHost, 'USER:', connConfig.user);
    const connection = await mysql.createConnection(connConfig);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'twms_db'}\`;`);
    await connection.end();
    console.log('Database ensured/created successfully');
  } catch (err) {
    console.error('Failed to ensure/create database:', err);
    throw err; // re‑throw to stop server start
  }
};

const startServer = async () => {
  try {
    // Ensure the database exists on the MySQL server
    await ensureDatabaseExists();
    console.log('Database verification complete.');

    // Test database connection
    await sequelize.authenticate();
    console.log('Successfully connected to MySQL database.');

    // Sync models (creates MySQL tables if they do not exist)
    // NOTE: NEVER pass { force: true } or { alter: true } here to avoid deleting or corrupting existing database data.
    await sequelize.sync();
    console.log('Database tables synchronized.');

    // Seed defaults if database tables are empty
    await seedDatabase();

    // Connect to Kafka
    await connectKafka();

    // Start Express listener
    app.listen(PORT, () => {
      console.log(`TWMS Backend Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to launch TWMS backend server:', error);
    process.exit(1);
  }
};

startServer();

// nodemon trigger comment
