import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
    database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT)
});

export async function initializeDatabase() {
    await initUsers();
    await initLogs();
    await initScanners();
}

async function initUsers() {
  const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Web user table initialized.');
    } catch (err) {
        console.error('Error initializing web user table:', err);
    } finally {
        client.release();
    }
}

async function initLogs() {
  const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                period TEXT,
                scanner_location TEXT,
                scanner_id TEXT,
                student_id TEXT,
                class_late TEXT,
                first_name TEXT,
                last_name TEXT,
                time_scanned TEXT,
                date_scanned TEXT,
                marked TEXT
            );
        `);
        console.log('Logs table initialized.');
    }
    catch (err) {
        console.error('Error initializing logs table:', err);
    }
    finally {
        client.release();
    }
}

async function initScanners() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS scanners (
                id SERIAL PRIMARY KEY,
                scanner_id TEXT UNIQUE,
                scanner_location TEXT,
                scanner_status TEXT,
                last_sync TEXT,
                battery_level TEXT
            );
            `);
        console.log('Scanners table initialized.');
    }
    catch (err) {
        console.error('Error initializing scanners table:', err);
    }
    finally {
        client.release();
    }
}
