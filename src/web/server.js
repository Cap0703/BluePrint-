import 'dotenv/config';
import express from 'express';
import { initializeDatabase } from './db.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.static(path.join(__dirname, "public")));


/*                                  Routes                                  */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'profile.html'));
});

app.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'analytics.html'));
});

app.get('/master_logs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'master_logs.html'));
});

app.get('/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'calendar.html'));
});

app.get('/map', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'current_class_map.html'));
});

app.get('/lookup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'student_lookup.html'));
});

app.get('/scanners', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'connected_scanners.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'settings.html'));
});


await initializeDatabase();

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
