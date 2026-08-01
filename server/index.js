import express from 'express';

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ name: 'SeatSync API', status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SeatSync API listening on :${PORT}`);
});
