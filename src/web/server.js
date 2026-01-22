import 'dotenv/config';
import express from 'express';
import { initializeDatabase } from './db.js';

const app = express();

await initializeDatabase();

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
