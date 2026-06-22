import { Kafka } from 'kafkajs';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const broker = process.env.KAFKA_BROKER || 'kafka-34f830f1-ay104061-03b5.c.aivencloud.com:20459';
const caPath = process.env.KAFKA_CA_PATH ? path.resolve(process.env.KAFKA_CA_PATH) : null;
const certPath = process.env.KAFKA_CERT_PATH ? path.resolve(process.env.KAFKA_CERT_PATH) : null;
const keyPath = process.env.KAFKA_KEY_PATH ? path.resolve(process.env.KAFKA_KEY_PATH) : null;

let isSslAvailable = false;
let sslConfig = null;

if (caPath && certPath && keyPath) {
  if (fs.existsSync(caPath) && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      sslConfig = {
        rejectUnauthorized: true,
        ca: [fs.readFileSync(caPath, 'utf-8')],
        key: fs.readFileSync(keyPath, 'utf-8'),
        cert: fs.readFileSync(certPath, 'utf-8'),
      };
      isSslAvailable = true;
      console.log('Kafka SSL certificates successfully loaded from disk.');
    } catch (err) {
      console.error('Error reading Kafka SSL certificate files:', err.message);
    }
  } else {
    console.warn('Kafka SSL files defined in .env but some files do not exist on disk.');
    console.warn(`Paths checked:\n - CA: ${caPath} (${fs.existsSync(caPath) ? 'Found' : 'Missing'})\n - Cert: ${certPath} (${fs.existsSync(certPath) ? 'Found' : 'Missing'})\n - Key: ${keyPath} (${fs.existsSync(keyPath) ? 'Found' : 'Missing'})`);
  }
} else {
  console.warn('Kafka SSL certificate environment variables are not fully set in .env.');
}

const kafkaConfig = {
  clientId: 'twms-warehouse-client',
  brokers: [broker],
};

if (isSslAvailable) {
  kafkaConfig.ssl = sslConfig;
} else {
  console.warn('Starting Kafka client WITHOUT SSL encryption (fallback mode).');
}

export const kafka = new Kafka(kafkaConfig);

export const producer = kafka.producer();
export const consumer = kafka.consumer({ groupId: 'twms-group' });

export const connectKafka = async () => {
  if (process.env.ENABLE_KAFKA !== 'true') {
    console.log('ℹ️ Kafka client is disabled. Set ENABLE_KAFKA=true in .env if you need to use Kafka.');
    return;
  }
  try {
    console.log(`Attempting connection to Kafka broker: ${broker}...`);
    await producer.connect();
    console.log('Successfully connected to Aiven Kafka Producer.');
  } catch (err) {
    console.error('Failed to connect to Aiven Kafka Producer:', err.message);
  }
};
