import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { checkUpdate, deployRelease, listReleases } from './controllers/releaseController';
import { getDashboardSummary } from './controllers/dashboardController';
import { initDb } from './database';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const API_KEY = process.env.API_KEY || 'release-hub-secret-key';

// Ensure uploads and public directories exist
const uploadsDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const publicDir = path.resolve(__dirname, '../../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Save with temporary name, controller will rename it to its hash
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `temp-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());

// API Key Authentication Middleware
const authenticate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  
  // Allow read-only endpoints without auth (dashboard and client app checks)
  if (
    req.method === 'GET' && 
    (req.path === '/check-update' || req.path === '/dashboard-summary' || req.path === '/releases')
  ) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    return;
  }

  const token = authHeader.split(' ')[1];
  if (token !== API_KEY) {
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
    return;
  }

  next();
};

// Apply auth to all API routes
app.use('/api', authenticate);

// Serve uploads directory as static files
app.use('/uploads', express.static(uploadsDir));

// Serve public directory for frontend dashboard
app.use(express.static(publicDir));

// Routes
app.post('/api/deploy', upload.single('package'), deployRelease);
app.get('/api/check-update', checkUpdate);
app.get('/api/releases', listReleases);
app.get('/api/dashboard-summary', getDashboardSummary);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Start server
async function start() {
  try {
    await initDb();
    console.log('Database initialized successfully.');
    
    app.listen(PORT, () => {
      console.log(`ReleaseHub Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
