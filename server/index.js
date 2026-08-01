import express from 'express';
import { config } from './config.js';

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ name: 'SeatSync API', status: 'ok' });
});

app.listen(config.PORT, () => {
  console.log(`SeatSync API listening on :${config.PORT}`);
});
