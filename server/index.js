import express from 'express';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { sessionsRouter } from './routes/sessions.js';
import { participantsRouter } from './routes/participants.js';
import { preferencesRouter } from './routes/preferences.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { startRunner } from './runner/index.js';

const app = express();
app.use(express.json());
app.use(requestId);

// CORS locked to the known dev web origin (§21.3) — never a wildcard.
// Necessary because the React app (:5173) and API (:3000) are separate dev
// servers by design (§8.1); Phase 5 collapses this onto one Vercel origin.
const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', WEB_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Organizer-Token, X-Participant-Token, X-Request-Id'
  );
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (req, res) => {
  res.json({ name: 'SeatSync API', status: 'ok' });
});

app.use('/api', healthRouter);
app.use('/api', sessionsRouter);
app.use('/api/sessions/:shareToken/participants', participantsRouter);
app.use('/api/sessions/:shareToken/preferences', preferencesRouter);

if (config.NODE_ENV !== 'production') {
  app.get('/api/_throw', () => {
    throw new Error('deliberate test error');
  });
}

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`SeatSync API listening on :${config.PORT}`);
});

startRunner();
