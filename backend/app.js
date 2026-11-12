import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { config } from './config/config.js';
import { router } from './routes/index.js';
import { isMongoConnected } from './config/mongoConnection.js';

export const app = express();

app.set('trust proxy', 1);
app.use(compression());
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.CORS_ORIGIN === '*' ? '*' : config.CORS_ORIGIN.split(','), credentials: false }));
app.use(express.json({ limit: '5mb' })); // signature images come as data URLs
app.use(express.urlencoded({ extended: true }));
if (config.NODE_ENV !== 'test') app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use('/uploads', express.static(path.resolve('uploads'), { maxAge: '7d' }));

app.get('/api/v1/health', (req, res) =>
  res.json({ status: 'ok', db: isMongoConnected() ? 'connected' : 'down', time: new Date().toISOString(), server: `${config.PRODUCT_NAME} API`, company: config.COMPANY_NAME })
);
app.use('/api/v1', router);

// Serve the built frontend from the same server if it exists (single deploy option)
const web = path.resolve('../frontend/dist');
if (fs.existsSync(web)) {
  app.use(express.static(web));
  app.get(/^\/(?!api|uploads).*/, (req, res) => res.sendFile(path.join(web, 'index.html')));
}

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message || 'Something went wrong';
  if (err.name === 'ValidationError') status = 400;
  if (err.name === 'CastError') { status = 400; message = 'Invalid id'; }
  if (err.code === 11000) { status = 409; message = `Already exists: ${Object.keys(err.keyValue || {}).join(', ')}`; }
  if (err.name === 'MulterError') status = 400;
  if (status >= 500) console.error('❌', err);
  res.status(status).json({ success: false, message, ...(err.extra || {}) });
});
