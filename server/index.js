import express from 'express';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ name: 'SeatSync API', status: 'ok' });
});

app.use('/api', healthRouter);

app.listen(config.PORT, () => {
  console.log(`SeatSync API listening on :${config.PORT}`);
});
