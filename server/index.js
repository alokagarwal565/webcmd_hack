import express from 'express';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { sessionsRouter } from './routes/sessions.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use(requestId);

app.get('/', (req, res) => {
  res.json({ name: 'SeatSync API', status: 'ok' });
});

app.use('/api', healthRouter);
app.use('/api', sessionsRouter);

if (config.NODE_ENV !== 'production') {
  app.get('/api/_throw', () => {
    throw new Error('deliberate test error');
  });
}

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`SeatSync API listening on :${config.PORT}`);
});
