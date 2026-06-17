import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { checkUpdate, deployRelease, listReleases } from './controllers/releaseController';
import { getDashboardSummary } from './controllers/dashboardController';
import { initDb, getUserByToken, getUserByUsername, createUserToken } from './database';
import { verifyPassword } from './utils/auth';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const API_KEY = process.env.API_KEY || 'release-hub-secret-key';

// Resolve data directories – override via DATA_DIR env for Docker volumes
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '..');
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const publicDir = path.resolve(__dirname, '../public');
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

// Token-based Multi-user Authentication Middleware
const authenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  
  // Allow public check-update and login endpoints without auth
  if (
    (req.method === 'GET' && req.path === '/check-update') ||
    (req.method === 'POST' && req.path === '/login')
  ) {
    return next();
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const user = await getUserByToken(token);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return;
    }

    (req as any).user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
};

// Apply auth to all API routes
app.use('/api', authenticate);

// Serve uploads directory as static files
app.use('/uploads', express.static(uploadsDir));

// Serve public directory for frontend dashboard
app.use(express.static(publicDir));

// Routes
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await getUserByUsername(username);
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const isMatch = verifyPassword(password, user.salt, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    // Generate a fresh session token on every login
    const sessionToken = await createUserToken(user.id);

    res.json({
      message: 'Login successful',
      token: sessionToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.get('/api/me', (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  });
});

app.post('/api/tokens', async (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized: User context missing' });
    return;
  }
  try {
    const token = await createUserToken(user.id);
    res.status(201).json({ token });
  } catch (error: any) {
    console.error('Token generation error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

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
