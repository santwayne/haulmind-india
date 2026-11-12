import mongoose from 'mongoose';
import { config } from './config.js';

export const connectDB = async (uri = config.MONGO_URI) => {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 30000,
    maxPoolSize: 10,
  });
  console.log(`✅ MongoDB connected (${config.NODE_ENV})`);
};

export const isMongoConnected = () => mongoose.connection.readyState === 1;
