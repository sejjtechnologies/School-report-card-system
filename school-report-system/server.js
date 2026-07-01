require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'my-super-secret-key-12345';

console.log('========================================');
console.log('🚀 SCHOOL REPORT CARD SYSTEM');
console.log('========================================');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 5,
  keepAlive: true,
  keepAliveInitialDelayMillis: 30000,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err.message);
});

let retryCount = 0;
function connectDB() {
  pool.connect((err, client, release) => {
    if (err) {
      console.error('❌ Database connection failed:', err.message);
      if (retryCount < 3) {
        retryCount++;
        console.log(`🔄 Retry ${retryCount}/3 in 5 seconds...`);
        setTimeout(connectDB, 5000);
      }
    } else {
      console.log('✅ Database connected successfully!');
      retryCount = 0;
      release();
    }
  });
}
connectDB();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  next();
});

// ==================== HELPER: Get Settings ====================
async function getSettings() {
  try {
    const result = await pool.query('SELECT setting_key, setting_value FROM settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    return settings;
  } catch (error) {
    console.error('Error fetching settings:', error);
    return {};
  }
}

// ==================== AUTH ====================
app.post('/api/login', async (req, res) => {
  const username = req.body.username ? req.body.username.trim() : '';
  const password = req.body.password ? req.body.password.trim() : '';
  if (!username || !password) {
    return res.json({ success: false, message: 'Username and password required' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'Invalid username or password' });
    }
    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.json({ success: false, message: 'Invalid username or password' });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ==================== CHANGE PASSWORD ====================
app.post('/api/change-password', async (req, res) => {
  const { password } = req.body;
  const username = 'sejjtechnologies';
  
  if (!password || password.length < 6) {
    return res.json({ success: false, message: 'Password must be at least 6 characters' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING username', [hashedPassword, username]);
    
    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'User not found' });
    }
    
    res.json({ success: true, message: 'Password updated successfully!' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.json({ success: false, message: error.message });
  }
});

// ==================== SETTINGS ====================
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT setting_key, setting_value, setting_group FROM settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    res.json({ success: true, settings });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.get('/api/settings/:group', async (req, res) => {
  const { group } = req.params;
  try {
    const result = await pool.query(
      'SELECT setting_key, setting_value FROM settings WHERE setting_group = $1',
      [group]
    );
    const settings = {};
    result.rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    res.json({ success: true, settings });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.json({ success: false, message: 'Invalid settings data' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    for (const [key, value] of Object.entries(settings)) {
      await client.query(
        'INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP',
        [key, value]
      );
    }
    
    await client.query('COMMIT');
    res.json({ success: true, message: 'Settings saved successfully!' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

// ==================== STATS ====================
app.get('/api/students/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM students');
    res.json({ success: true, count: parseInt(result.rows[0].count) });
  } catch (error) {
    res.json({ success: false, count: 0 });
  }
});

app.get('/api/streams/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM streams');
    res.json({ success: true, count: parseInt(result.rows[0].count) });
  } catch (error) {
    res.json({ success: false, count: 0 });
  }
});

app.get('/api/classes/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM classes');
    res.json({ success: true, count: parseInt(result.rows[0].count) });
  } catch (error) {
    res.json({ success: false, count: 0 });
  }
});

app.get('/api/subjects/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM subjects');
    res.json({ success: true, count: parseInt(result.rows[0].count) });
  } catch (error) {
    res.json({ success: false, count: 0 });
  }
});

app.get('/api/reports/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM report_cards');
    res.json({ success: true, count: parseInt(result.rows[0].count) });
  } catch (error) {
    res.json({ success: false, count: 0 });
  }
});

// ==================== CLASSES CRUD ====================
// Get all classes
app.get('/api/classes', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, class_code, class_name FROM classes ORDER BY class_code');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a new class
app.post('/api/classes', async (req, res) => {
  const { class_code, class_name } = req.body;
  if (!class_code || !class_name) {
    return res.status(400).json({ success: false, message: 'Class code and name required' });
  }
  try {
    await pool.query(
      'INSERT INTO classes (class_code, class_name) VALUES ($1, $2)',
      [class_code.toUpperCase(), class_name]
    );
    res.json({ success: true, message: 'Class added successfully' });
  } catch (error) {
    if (error.code === '23505') {
      res.status(400).json({ success: false, message: 'Class code already exists' });
    } else {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

// Update a class
app.put('/api/classes/:id', async (req, res) => {
  const { id } = req.params;
  const { class_code, class_name } = req.body;
  if (!class_code || !class_name) {
    return res.status(400).json({ success: false, message: 'Class code and name required' });
  }
  try {
    const result = await pool.query(
      'UPDATE classes SET class_code = $1, class_name = $2 WHERE id = $3 RETURNING id',
      [class_code.toUpperCase(), class_name, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    res.json({ success: true, message: 'Class updated successfully' });
  } catch (error) {
    if (error.code === '23505') {
      res.status(400).json({ success: false, message: 'Class code already exists' });
    } else {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

// Delete a class
app.delete('/api/classes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM classes WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    res.json({ success: true, message: 'Class deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== STREAMS CRUD ====================
// Get all streams
app.get('/api/streams', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, stream_code, stream_name FROM streams ORDER BY stream_code');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a new stream
app.post('/api/streams', async (req, res) => {
  const { stream_code, stream_name } = req.body;
  if (!stream_code || !stream_name) {
    return res.status(400).json({ success: false, message: 'Stream code and name required' });
  }
  try {
    await pool.query(
      'INSERT INTO streams (stream_code, stream_name) VALUES ($1, $2)',
      [stream_code.toUpperCase(), stream_name]
    );
    res.json({ success: true, message: 'Stream added successfully' });
  } catch (error) {
    if (error.code === '23505') {
      res.status(400).json({ success: false, message: 'Stream code already exists' });
    } else {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

// Update a stream
app.put('/api/streams/:id', async (req, res) => {
  const { id } = req.params;
  const { stream_code, stream_name } = req.body;
  if (!stream_code || !stream_name) {
    return res.status(400).json({ success: false, message: 'Stream code and name required' });
  }
  try {
    const result = await pool.query(
      'UPDATE streams SET stream_code = $1, stream_name = $2 WHERE id = $3 RETURNING id',
      [stream_code.toUpperCase(), stream_name, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Stream not found' });
    }
    res.json({ success: true, message: 'Stream updated successfully' });
  } catch (error) {
    if (error.code === '23505') {
      res.status(400).json({ success: false, message: 'Stream code already exists' });
    } else {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

// Delete a stream
app.delete('/api/streams/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM streams WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Stream not found' });
    }
    res.json({ success: true, message: 'Stream deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== SUBJECTS ====================
app.get('/api/subjects', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, subject_code, subject_name FROM subjects ORDER BY subject_name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== STUDENTS CRUD ====================
app.get('/api/students', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, c.class_name, c.class_code, st.stream_name, st.stream_code
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN streams st ON s.stream_id = st.id
      ORDER BY s.id ASC
    `);
    res.json({ success: true, students: result.rows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/api/students', async (req, res) => {
  const { firstName, lastName, gender, dob, classId, streamId, guardianName, guardianContact, guardianEmail, address } = req.body;
  if (!firstName || !lastName || !classId || !streamId) {
    return res.json({ success: false, message: 'Missing required fields' });
  }
  try {
    const maxResult = await pool.query(`
      SELECT student_id FROM students 
      WHERE student_id ~ '^ID[0-9]+$' 
      ORDER BY CAST(SUBSTRING(student_id, 3) AS INTEGER) DESC 
      LIMIT 1
    `);
    let nextNumber = 1;
    if (maxResult.rows.length > 0) {
      const currentNum = parseInt(maxResult.rows[0].student_id.replace('ID', ''));
      nextNumber = currentNum + 1;
    }
    const studentId = 'ID' + String(nextNumber).padStart(3, '0');
    const result = await pool.query(`
      INSERT INTO students 
      (student_id, first_name, last_name, gender, date_of_birth, class_id, stream_id, 
       guardian_name, guardian_contact, guardian_email, address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING student_id
    `, [studentId, firstName, lastName, gender, dob, classId, streamId, guardianName, guardianContact, guardianEmail, address]);
    res.json({ success: true, student_id: result.rows[0].student_id });
  } catch (error) {
    console.error('Error creating student:', error);
    res.json({ success: false, message: error.message });
  }
});

app.put('/api/students/:id', async (req, res) => {
  const { id } = req.params;
  const { firstName, lastName, gender, dob, classId, streamId, guardianName, guardianContact, guardianEmail, address } = req.body;
  try {
    await pool.query(`
      UPDATE students SET
        first_name = $1, last_name = $2, gender = $3, date_of_birth = $4,
        class_id = $5, stream_id = $6, guardian_name = $7,
        guardian_contact = $8, guardian_email = $9, address = $10
      WHERE id = $11
    `, [firstName, lastName, gender, dob, classId, streamId, guardianName, guardianContact, guardianEmail, address, id]);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM students WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ==================== MARKS CRUD ====================
app.post('/api/marks', async (req, res) => {
  const { student_id, exam_name, term, academic_year, marks } = req.body;
  if (!student_id || !exam_name || !term || !academic_year || !marks || marks.length === 0) {
    return res.json({ success: false, message: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const examResult = await client.query(
      'SELECT id FROM exams WHERE exam_name = $1 AND term = $2 AND academic_year = $3',
      [exam_name, term, academic_year]
    );
    let examId;
    if (examResult.rows.length > 0) {
      examId = examResult.rows[0].id;
    } else {
      const newExam = await client.query(
        'INSERT INTO exams (exam_name, term, academic_year) VALUES ($1, $2, $3) RETURNING id',
        [exam_name, term, academic_year]
      );
      examId = newExam.rows[0].id;
    }

    for (const mark of marks) {
      await client.query(
        `INSERT INTO marks (student_id, subject_id, exam_id, marks_obtained)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, subject_id, exam_id) 
         DO UPDATE SET marks_obtained = $4`,
        [student_id, mark.subject_id, examId, mark.marks_obtained]
      );
    }

    const studentTotals = await client.query(`
      SELECT 
        student_id,
        SUM(marks_obtained) as total_marks,
        AVG(marks_obtained) as average,
        COUNT(*) as subject_count
      FROM marks
      WHERE student_id = $1 AND exam_id = $2
      GROUP BY student_id
    `, [student_id, examId]);

    if (studentTotals.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'No marks found for this student' });
    }

    const totalMarks = parseFloat(studentTotals.rows[0].total_marks);
    const average = parseFloat(studentTotals.rows[0].average);

    let grade = 'F';
    if (average >= 80) grade = 'A';
    else if (average >= 70) grade = 'B';
    else if (average >= 60) grade = 'C';
    else if (average >= 50) grade = 'D';
    else grade = 'F';

    const allTotals = await client.query(`
      SELECT student_id, SUM(marks_obtained) as total
      FROM marks
      WHERE exam_id = $1
      GROUP BY student_id
      ORDER BY total DESC
    `, [examId]);

    let rank = null;
    allTotals.rows.forEach((row, index) => {
      if (row.student_id === parseInt(student_id)) {
        rank = index + 1;
      }
    });

    const streamRankResult = await client.query(`
      SELECT m.student_id, SUM(m.marks_obtained) as total
      FROM marks m
      JOIN students s ON m.student_id = s.id
      WHERE m.exam_id = $1 AND s.stream_id = (SELECT stream_id FROM students WHERE id = $2)
      GROUP BY m.student_id
      ORDER BY total DESC
    `, [examId, student_id]);

    let streamRank = null;
    streamRankResult.rows.forEach((row, index) => {
      if (row.student_id === parseInt(student_id)) {
        streamRank = index + 1;
      }
    });

    const classRankResult = await client.query(`
      SELECT m.student_id, SUM(m.marks_obtained) as total
      FROM marks m
      JOIN students s ON m.student_id = s.id
      WHERE m.exam_id = $1 AND s.class_id = (SELECT class_id FROM students WHERE id = $2)
      GROUP BY m.student_id
      ORDER BY total DESC
    `, [examId, student_id]);

    let classRank = null;
    classRankResult.rows.forEach((row, index) => {
      if (row.student_id === parseInt(student_id)) {
        classRank = index + 1;
      }
    });

    await client.query(`
      INSERT INTO report_cards (student_id, exam_id, total_marks, average, grade, rank, stream_rank, class_rank)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (student_id, exam_id)
      DO UPDATE SET 
        total_marks = $3, 
        average = $4, 
        grade = $5, 
        rank = $6,
        stream_rank = $7,
        class_rank = $8,
        generated_at = CURRENT_TIMESTAMP
    `, [student_id, examId, totalMarks, average, grade, rank, streamRank, classRank]);

    await client.query('COMMIT');
    res.json({ success: true, total_marks: totalMarks, average: average, grade: grade, rank: rank, stream_rank: streamRank, class_rank: classRank });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving marks:', error);
    res.json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/marks', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, 
             s.first_name || ' ' || s.last_name as student_name,
             s.student_id as student_code,
             sub.subject_name,
             e.exam_name, e.term, e.academic_year,
             rc.total_marks, rc.average, rc.grade, rc.rank, rc.stream_rank, rc.class_rank
      FROM marks m
      JOIN students s ON m.student_id = s.id
      JOIN subjects sub ON m.subject_id = sub.id
      JOIN exams e ON m.exam_id = e.id
      LEFT JOIN report_cards rc ON rc.student_id = m.student_id AND rc.exam_id = m.exam_id
      ORDER BY m.id DESC
    `);
    res.json({ success: true, marks: result.rows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.delete('/api/marks/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM marks WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.put('/api/marks/:id', async (req, res) => {
  const { id } = req.params;
  const { marks_obtained, student_id, subject_id, exam_id } = req.body;
  
  if (marks_obtained === undefined || isNaN(marks_obtained)) {
    return res.json({ success: false, message: 'Invalid marks value' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'UPDATE marks SET marks_obtained = $1 WHERE id = $2',
      [marks_obtained, id]
    );

    const studentTotals = await client.query(`
      SELECT 
        student_id,
        SUM(marks_obtained) as total_marks,
        AVG(marks_obtained) as average,
        COUNT(*) as subject_count
      FROM marks
      WHERE student_id = $1 AND exam_id = $2
      GROUP BY student_id
    `, [student_id, exam_id]);

    if (studentTotals.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'No marks found for this student' });
    }

    const totalMarks = parseFloat(studentTotals.rows[0].total_marks);
    const average = parseFloat(studentTotals.rows[0].average);

    let grade = 'F';
    if (average >= 80) grade = 'A';
    else if (average >= 70) grade = 'B';
    else if (average >= 60) grade = 'C';
    else if (average >= 50) grade = 'D';
    else grade = 'F';

    const allTotals = await client.query(`
      SELECT student_id, SUM(marks_obtained) as total
      FROM marks
      WHERE exam_id = $1
      GROUP BY student_id
      ORDER BY total DESC
    `, [exam_id]);

    let rank = null;
    allTotals.rows.forEach((row, index) => {
      if (row.student_id === parseInt(student_id)) {
        rank = index + 1;
      }
    });

    const streamRankResult = await client.query(`
      SELECT m.student_id, SUM(m.marks_obtained) as total
      FROM marks m
      JOIN students s ON m.student_id = s.id
      WHERE m.exam_id = $1 AND s.stream_id = (SELECT stream_id FROM students WHERE id = $2)
      GROUP BY m.student_id
      ORDER BY total DESC
    `, [exam_id, student_id]);

    let streamRank = null;
    streamRankResult.rows.forEach((row, index) => {
      if (row.student_id === parseInt(student_id)) {
        streamRank = index + 1;
      }
    });

    const classRankResult = await client.query(`
      SELECT m.student_id, SUM(m.marks_obtained) as total
      FROM marks m
      JOIN students s ON m.student_id = s.id
      WHERE m.exam_id = $1 AND s.class_id = (SELECT class_id FROM students WHERE id = $2)
      GROUP BY m.student_id
      ORDER BY total DESC
    `, [exam_id, student_id]);

    let classRank = null;
    classRankResult.rows.forEach((row, index) => {
      if (row.student_id === parseInt(student_id)) {
        classRank = index + 1;
      }
    });

    await client.query(`
      UPDATE report_cards 
      SET total_marks = $1, average = $2, grade = $3, rank = $4, stream_rank = $5, class_rank = $6, generated_at = CURRENT_TIMESTAMP
      WHERE student_id = $7 AND exam_id = $8
    `, [totalMarks, average, grade, rank, streamRank, classRank, student_id, exam_id]);

    await client.query('COMMIT');
    res.json({ success: true, total_marks: totalMarks, average: average, grade: grade });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating mark:', error);
    res.json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

// ==================== REPORTS ====================
app.get('/api/reports', async (req, res) => {
  const { class_id, stream_id, academic_year, term } = req.query;
  let query = `
    SELECT 
      rc.*,
      s.id as student_db_id,
      s.student_id, s.first_name || ' ' || s.last_name as student_name,
      c.class_name, st.stream_name,
      e.exam_name, e.term, e.academic_year
    FROM report_cards rc
    JOIN students s ON rc.student_id = s.id
    JOIN classes c ON s.class_id = c.id
    JOIN streams st ON s.stream_id = st.id
    JOIN exams e ON rc.exam_id = e.id
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 1;

  if (class_id) {
    query += ` AND s.class_id = $${paramCount}`;
    params.push(class_id);
    paramCount++;
  }
  if (stream_id) {
    query += ` AND s.stream_id = $${paramCount}`;
    params.push(stream_id);
    paramCount++;
  }
  if (academic_year) {
    query += ` AND e.academic_year = $${paramCount}`;
    params.push(academic_year);
    paramCount++;
  }
  if (term) {
    query += ` AND e.term = $${paramCount}`;
    params.push(term);
    paramCount++;
  }

  query += ` ORDER BY rc.rank ASC, s.first_name ASC`;

  try {
    const result = await pool.query(query, params);
    res.json({ success: true, reports: result.rows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.get('/api/reports/student/:student_id', async (req, res) => {
  const { student_id } = req.params;
  const { exam_name, term, academic_year } = req.query;
  
  try {
    const result = await pool.query(`
      SELECT 
        rc.*,
        s.student_id, s.first_name, s.last_name, s.gender, s.date_of_birth,
        c.class_name, st.stream_name,
        e.exam_name, e.term, e.academic_year,
        json_agg(json_build_object('subject', sub.subject_name, 'marks', m.marks_obtained)) as subjects
      FROM report_cards rc
      JOIN students s ON rc.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      JOIN streams st ON s.stream_id = st.id
      JOIN exams e ON rc.exam_id = e.id
      JOIN marks m ON m.student_id = s.id AND m.exam_id = e.id
      JOIN subjects sub ON m.subject_id = sub.id
      WHERE s.id = $1 AND e.exam_name = $2 AND e.term = $3 AND e.academic_year = $4
      GROUP BY rc.id, s.id, c.id, st.id, e.id
    `, [student_id, exam_name, term, academic_year]);

    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'Report not found' });
    }
    res.json({ success: true, report: result.rows[0] });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ==================== PRINT ROUTES ====================
app.get('/api/reports/print/:student_id', async (req, res) => {
  const { student_id } = req.params;
  const { exam_name, term, academic_year } = req.query;
  
  try {
    const settings = await getSettings();
    const schoolName = settings.school_name || 'ST. JOSEPH\'S PRIMARY SCHOOL';
    const headteacher = settings.headteacher || 'Mr. John Mukasa';
    const phone = settings.school_phone || '+256 700 000 000';
    const email = settings.school_email || 'info@stjosephs.ug';
    const motto = settings.school_motto || 'Education for Excellence';

    let result = await pool.query(`
      SELECT 
        rc.*,
        s.id as student_db_id, s.student_id, s.first_name, s.last_name, s.gender, s.date_of_birth,
        c.class_name, st.stream_name,
        e.exam_name, e.term, e.academic_year
      FROM report_cards rc
      JOIN students s ON rc.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      JOIN streams st ON s.stream_id = st.id
      JOIN exams e ON rc.exam_id = e.id
      WHERE s.student_id = $1 AND e.exam_name = $2 AND e.term = $3 AND e.academic_year = $4
    `, [student_id, exam_name, term, academic_year]);

    if (result.rows.length === 0) {
      result = await pool.query(`
        SELECT 
          rc.*,
          s.id as student_db_id, s.student_id, s.first_name, s.last_name, s.gender, s.date_of_birth,
          c.class_name, st.stream_name,
          e.exam_name, e.term, e.academic_year
        FROM report_cards rc
        JOIN students s ON rc.student_id = s.id
        JOIN classes c ON s.class_id = c.id
        JOIN streams st ON s.stream_id = st.id
        JOIN exams e ON rc.exam_id = e.id
        WHERE s.id = $1 AND e.exam_name = $2 AND e.term = $3 AND e.academic_year = $4
      `, [parseInt(student_id), exam_name, term, academic_year]);
    }

    if (result.rows.length === 0) {
      return res.send('<h3>No report found</h3>');
    }

    const r = result.rows[0];

    const subjectsResult = await pool.query(`
      SELECT sub.subject_name, m.marks_obtained
      FROM marks m
      JOIN subjects sub ON m.subject_id = sub.id
      WHERE m.student_id = $1 AND m.exam_id = (SELECT id FROM exams WHERE exam_name = $2 AND term = $3 AND academic_year = $4)
      ORDER BY sub.subject_name
    `, [r.student_db_id, exam_name, term, academic_year]);

    let subjectsHtml = '';
    subjectsResult.rows.forEach(sub => {
      const marks = sub.marks_obtained || 0;
      let grade = 'F';
      if (marks >= 80) grade = 'A';
      else if (marks >= 70) grade = 'B';
      else if (marks >= 60) grade = 'C';
      else if (marks >= 50) grade = 'D';
      subjectsHtml += `<tr><td>${sub.subject_name}</td><td>${marks}</td><td>${grade}</td></tr>`;
    });

    const avg = parseFloat(r.average);
    const avgDisplay = !isNaN(avg) ? avg.toFixed(2) : '-';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Report Card - ${r.student_id}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Times New Roman', Arial, sans-serif; padding: 40px; background: #f0f0f0; }
          .no-print { text-align: center; margin-bottom: 20px; }
          .no-print button { padding: 12px 30px; background: #667eea; color: white; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; margin: 0 5px; }
          .no-print button:hover { background: #5a6fd6; }
          .report-card { 
            max-width: 900px; 
            margin: 0 auto; 
            background: white; 
            padding: 40px; 
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          }
          .header { 
            text-align: center; 
            border-bottom: 3px solid #1a237e; 
            padding-bottom: 20px; 
            margin-bottom: 25px;
          }
          .header h1 { 
            font-size: 32px; 
            color: #1a237e; 
            letter-spacing: 3px;
            font-weight: 700;
          }
          .header h2 { 
            font-size: 22px; 
            color: #333; 
            margin-top: 5px;
            font-weight: 600;
          }
          .header p { 
            font-size: 15px; 
            color: #666; 
            margin-top: 5px;
          }
          .student-info { 
            display: grid; 
            grid-template-columns: 1fr 1fr 1fr; 
            gap: 10px; 
            margin-bottom: 25px; 
            padding: 15px 20px; 
            background: #f5f5f5; 
            border-radius: 8px;
            border-left: 5px solid #1a237e;
          }
          .student-info p { 
            font-size: 15px; 
            margin: 4px 0; 
          }
          .student-info strong { 
            color: #1a237e; 
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            margin: 20px 0; 
          }
          table th { 
            background: #1a237e; 
            color: white; 
            padding: 12px; 
            text-align: center; 
            font-size: 15px;
            font-weight: 600;
          }
          table td { 
            padding: 10px 12px; 
            text-align: center; 
            border-bottom: 1px solid #e0e0e0; 
            font-size: 14px; 
          }
          table tr:nth-child(even) { 
            background: #f8f9ff; 
          }
          .totals { 
            display: grid; 
            grid-template-columns: repeat(5, 1fr); 
            gap: 12px; 
            margin: 20px 0; 
            padding: 15px; 
            background: #e8eaf6; 
            border-radius: 8px;
          }
          .totals p { 
            font-size: 15px; 
            text-align: center; 
            margin: 3px 0; 
          }
          .totals strong { 
            color: #1a237e; 
          }
          .remarks { 
            margin-top: 20px; 
            padding: 12px 18px; 
            background: #fff8e1; 
            border-radius: 6px;
            border-left: 5px solid #ffa000;
          }
          .remarks p { 
            font-size: 14px; 
            color: #555; 
          }
          .footer { 
            text-align: center; 
            margin-top: 25px; 
            padding-top: 15px; 
            border-top: 1px solid #ddd; 
            font-size: 13px; 
            color: #888;
          }
          @media print {
            .no-print { display: none !important; }
            body { background: white; padding: 20px; }
            .report-card { box-shadow: none !important; border-radius: 0 !important; padding: 20px; }
          }
        </style>
      </head>
      <body>
        <div class="no-print">
          <button onclick="window.print()">🖨️ Print Report</button>
          <button onclick="window.close()" style="background:#999;">Close</button>
        </div>
        <div class="report-card">
          <div class="header">
            <h1>🏫 ${schoolName}</h1>
            <h2>${r.exam_name} REPORT CARD</h2>
            <p>Academic Year: ${r.academic_year} | Term: ${r.term}</p>
            <p style="font-size:12px;color:#666;margin-top:3px;">${motto}</p>
          </div>
          <div class="student-info">
            <p><strong>Student ID:</strong> ${r.student_id}</p>
            <p><strong>Name:</strong> ${r.first_name} ${r.last_name}</p>
            <p><strong>Gender:</strong> ${r.gender || '-'}</p>
            <p><strong>Class:</strong> ${r.class_name}</p>
            <p><strong>Stream:</strong> ${r.stream_name}</p>
            <p><strong>DOB:</strong> ${r.date_of_birth ? new Date(r.date_of_birth).toLocaleDateString() : '-'}</p>
          </div>
          <table>
            <thead><tr><th>Subject</th><th>Marks Obtained</th><th>Grade</th></tr></thead>
            <tbody>${subjectsHtml}</tbody>
          </table>
          <div class="totals">
            <p><strong>Total:</strong> ${r.total_marks}</p>
            <p><strong>Average:</strong> ${avgDisplay}</p>
            <p><strong>Grade:</strong> ${r.grade}</p>
            <p><strong>Class Rank:</strong> ${r.class_rank || '-'}</p>
            <p><strong>Stream Rank:</strong> ${r.stream_rank || '-'}</p>
          </div>
          <div class="remarks">
            <p><strong>Remarks:</strong> ${r.grade === 'A' ? 'Excellent performance! Keep up the great work!' : 
               r.grade === 'B' ? 'Good performance! Aim for even higher.' :
               r.grade === 'C' ? 'Satisfactory. More effort needed to improve.' :
               r.grade === 'D' ? 'Needs improvement. Please work harder.' :
               'Below average. Please seek extra help from teachers.'}</p>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:20px;padding-top:15px;border-top:1px solid #ddd;">
            <div style="text-align:left;font-size:12px;color:#555;">
              <p><strong>Headteacher:</strong> ${headteacher}</p>
            </div>
            <div style="text-align:right;font-size:11px;color:#888;">
              <p>${phone}</p>
              <p>${email}</p>
            </div>
          </div>
          <div class="footer">
            <p>Generated on ${new Date().toLocaleString()} | ${r.class_name} - ${r.stream_name}</p>
            <p style="margin-top:3px;font-size:11px;color:#aaa;">This is a computer-generated report card</p>
          </div>
        </div>
      </body>
      </html>
    `;
    res.send(html);
  } catch (error) {
    console.error('Error generating print:', error);
    res.send('<h3>Error generating report: ' + error.message + '</h3>');
  }
});

app.get('/api/reports/print-all', async (req, res) => {
  const { class_id, stream_id, academic_year, term } = req.query;
  
  try {
    const settings = await getSettings();
    const schoolName = settings.school_name || 'ST. JOSEPH\'S PRIMARY SCHOOL';
    const headteacher = settings.headteacher || 'Mr. John Mukasa';

    let query = `
      SELECT 
        rc.*,
        s.id as student_db_id, s.student_id, s.first_name, s.last_name, s.gender, s.date_of_birth,
        c.class_name, st.stream_name,
        e.exam_name, e.term, e.academic_year
      FROM report_cards rc
      JOIN students s ON rc.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      JOIN streams st ON s.stream_id = st.id
      JOIN exams e ON rc.exam_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (class_id) {
      query += ` AND s.class_id = $${paramCount}`;
      params.push(class_id);
      paramCount++;
    }
    if (stream_id) {
      query += ` AND s.stream_id = $${paramCount}`;
      params.push(stream_id);
      paramCount++;
    }
    if (academic_year) {
      query += ` AND e.academic_year = $${paramCount}`;
      params.push(academic_year);
      paramCount++;
    }
    if (term) {
      query += ` AND e.term = $${paramCount}`;
      params.push(term);
      paramCount++;
    }

    query += ` ORDER BY rc.rank ASC`;

    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.send('<h3>No reports found</h3>');
    }

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>All Report Cards</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Times New Roman', Arial, sans-serif; padding: 20px; background: #f0f0f0; }
          .no-print { text-align: center; margin-bottom: 20px; }
          .no-print button { padding: 12px 30px; background: #667eea; color: white; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; }
          .no-print button:hover { background: #5a6fd6; }
          .report-container { max-width: 900px; margin: 0 auto; }
          .report-card { 
            background: white; 
            padding: 30px; 
            margin-bottom: 30px; 
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            page-break-after: always;
          }
          .header { 
            text-align: center; 
            border-bottom: 3px solid #1a237e; 
            padding-bottom: 15px; 
            margin-bottom: 20px;
          }
          .header h1 { font-size: 28px; color: #1a237e; letter-spacing: 2px; }
          .header h2 { font-size: 20px; color: #333; margin-top: 5px; }
          .header p { font-size: 14px; color: #666; margin-top: 5px; }
          .student-info { 
            display: grid; 
            grid-template-columns: 1fr 1fr 1fr; 
            gap: 8px; 
            margin-bottom: 20px; 
            padding: 12px 15px; 
            background: #f5f5f5; 
            border-radius: 6px;
            border-left: 4px solid #1a237e;
          }
          .student-info p { font-size: 14px; margin: 3px 0; }
          .student-info strong { color: #1a237e; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          table th { 
            background: #1a237e; 
            color: white; 
            padding: 10px; 
            text-align: center; 
            font-size: 14px;
            font-weight: 600;
          }
          table td { 
            padding: 8px 10px; 
            text-align: center; 
            border-bottom: 1px solid #e0e0e0; 
            font-size: 13px; 
          }
          table tr:nth-child(even) { background: #f8f9ff; }
          .totals { 
            display: grid; 
            grid-template-columns: repeat(5, 1fr); 
            gap: 10px; 
            margin: 15px 0; 
            padding: 12px; 
            background: #e8eaf6; 
            border-radius: 6px;
          }
          .totals p { font-size: 14px; text-align: center; margin: 3px 0; }
          .totals strong { color: #1a237e; }
          .footer { 
            text-align: center; 
            margin-top: 20px; 
            padding-top: 15px; 
            border-top: 1px solid #ddd; 
            font-size: 12px; 
            color: #888;
          }
          .remarks { 
            margin-top: 15px; 
            padding: 10px 15px; 
            background: #fff8e1; 
            border-radius: 4px;
            border-left: 4px solid #ffa000;
          }
          .remarks p { font-size: 13px; color: #555; }
          @media print {
            .no-print { display: none !important; }
            body { background: white; padding: 0; }
            .report-card { box-shadow: none !important; border-radius: 0 !important; margin-bottom: 0 !important; page-break-after: always; }
            .report-container { max-width: 100%; }
          }
        </style>
      </head>
      <body>
        <div class="no-print">
          <button onclick="window.print()">🖨️ Print All Reports</button>
          <button onclick="window.close()" style="background:#999;margin-left:10px;">Close</button>
        </div>
        <div class="report-container">
    `;

    for (const r of result.rows) {
      const subjectsResult = await pool.query(`
        SELECT sub.subject_name, m.marks_obtained
        FROM marks m
        JOIN subjects sub ON m.subject_id = sub.id
        WHERE m.student_id = $1 AND m.exam_id = (SELECT id FROM exams WHERE exam_name = $2 AND term = $3 AND academic_year = $4)
        ORDER BY sub.subject_name
      `, [r.student_db_id, r.exam_name, r.term, r.academic_year]);

      let subjectsHtml = '';
      subjectsResult.rows.forEach(sub => {
        const marks = sub.marks_obtained || 0;
        let grade = 'F';
        if (marks >= 80) grade = 'A';
        else if (marks >= 70) grade = 'B';
        else if (marks >= 60) grade = 'C';
        else if (marks >= 50) grade = 'D';
        subjectsHtml += `<tr><td>${sub.subject_name}</td><td>${marks}</td><td>${grade}</td></tr>`;
      });

      const avg = parseFloat(r.average);
      const avgDisplay = !isNaN(avg) ? avg.toFixed(2) : '-';

      html += `
        <div class="report-card">
          <div class="header">
            <h1>🏫 ${schoolName}</h1>
            <h2>${r.exam_name} REPORT CARD</h2>
            <p>Academic Year: ${r.academic_year} | Term: ${r.term}</p>
          </div>
          <div class="student-info">
            <p><strong>Student ID:</strong> ${r.student_id}</p>
            <p><strong>Name:</strong> ${r.first_name} ${r.last_name}</p>
            <p><strong>Gender:</strong> ${r.gender || '-'}</p>
            <p><strong>Class:</strong> ${r.class_name}</p>
            <p><strong>Stream:</strong> ${r.stream_name}</p>
            <p><strong>DOB:</strong> ${r.date_of_birth ? new Date(r.date_of_birth).toLocaleDateString() : '-'}</p>
          </div>
          <table>
            <thead><tr><th>Subject</th><th>Marks Obtained</th><th>Grade</th></tr></thead>
            <tbody>${subjectsHtml}</tbody>
          </table>
          <div class="totals">
            <p><strong>Total:</strong> ${r.total_marks}</p>
            <p><strong>Average:</strong> ${avgDisplay}</p>
            <p><strong>Grade:</strong> ${r.grade}</p>
            <p><strong>Class Rank:</strong> ${r.class_rank || '-'}</p>
            <p><strong>Stream Rank:</strong> ${r.stream_rank || '-'}</p>
          </div>
          <div class="remarks">
            <p><strong>Remarks:</strong> ${r.grade === 'A' ? 'Excellent performance! Keep it up!' : 
               r.grade === 'B' ? 'Good performance! Aim for higher.' :
               r.grade === 'C' ? 'Satisfactory. More effort needed.' :
               r.grade === 'D' ? 'Needs improvement. Please work harder.' :
               'Below average. Please seek extra help.'}</p>
          </div>
          <div style="text-align:center;margin-top:15px;padding-top:10px;border-top:1px solid #ddd;font-size:11px;color:#888;">
            <p><strong>Headteacher:</strong> ${headteacher}</p>
          </div>
          <div class="footer">
            <p>Generated on ${new Date().toLocaleString()} | ${r.class_name} - ${r.stream_name}</p>
          </div>
        </div>
      `;
    }

    html += `
        </div>
      </body>
      </html>
    `;
    res.send(html);
  } catch (error) {
    console.error('Error generating print-all:', error);
    res.send('<h3>Error generating reports: ' + error.message + '</h3>');
  }
});

// ==================== PDF GENERATION ====================
app.get('/api/reports/pdf/:student_id', async (req, res) => {
  const { student_id } = req.params;
  const { exam_name, term, academic_year } = req.query;
  
  try {
    const settings = await getSettings();
    const schoolName = settings.school_name || 'ST. JOSEPH\'S PRIMARY SCHOOL';
    const headteacher = settings.headteacher || 'Mr. John Mukasa';
    const phone = settings.school_phone || '+256 700 000 000';
    const email = settings.school_email || 'info@stjosephs.ug';
    const motto = settings.school_motto || 'Education for Excellence';

    let result = await pool.query(`
      SELECT 
        rc.*,
        s.id as student_db_id, s.student_id, s.first_name, s.last_name, s.gender, s.date_of_birth,
        c.class_name, st.stream_name,
        e.exam_name, e.term, e.academic_year
      FROM report_cards rc
      JOIN students s ON rc.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      JOIN streams st ON s.stream_id = st.id
      JOIN exams e ON rc.exam_id = e.id
      WHERE s.student_id = $1 AND e.exam_name = $2 AND e.term = $3 AND e.academic_year = $4
    `, [student_id, exam_name, term, academic_year]);

    if (result.rows.length === 0) {
      result = await pool.query(`
        SELECT 
          rc.*,
          s.id as student_db_id, s.student_id, s.first_name, s.last_name, s.gender, s.date_of_birth,
          c.class_name, st.stream_name,
          e.exam_name, e.term, e.academic_year
        FROM report_cards rc
        JOIN students s ON rc.student_id = s.id
        JOIN classes c ON s.class_id = c.id
        JOIN streams st ON s.stream_id = st.id
        JOIN exams e ON rc.exam_id = e.id
        WHERE s.id = $1 AND e.exam_name = $2 AND e.term = $3 AND e.academic_year = $4
      `, [parseInt(student_id), exam_name, term, academic_year]);
    }

    if (result.rows.length === 0) {
      return res.status(404).send('Report not found');
    }

    const r = result.rows[0];

    const subjectsResult = await pool.query(`
      SELECT sub.subject_name, m.marks_obtained
      FROM marks m
      JOIN subjects sub ON m.subject_id = sub.id
      WHERE m.student_id = $1 AND m.exam_id = (SELECT id FROM exams WHERE exam_name = $2 AND term = $3 AND academic_year = $4)
      ORDER BY sub.subject_name
    `, [r.student_db_id, exam_name, term, academic_year]);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = 750;

    // Header with dynamic school name
    page.drawText(schoolName, {
      x: 50, y: y, size: 18, font: fontBold, color: rgb(0.1, 0.14, 0.49)
    });
    y -= 25;
    page.drawText(`${r.exam_name} REPORT CARD`, {
      x: 50, y: y, size: 14, font: fontBold, color: rgb(0.2, 0.2, 0.2)
    });
    y -= 20;
    page.drawText(`Academic Year: ${r.academic_year} | Term: ${r.term}`, {
      x: 50, y: y, size: 10, font: font, color: rgb(0.4, 0.4, 0.4)
    });
    y -= 15;
    page.drawText(motto, {
      x: 50, y: y, size: 9, font: font, color: rgb(0.5, 0.5, 0.5)
    });
    y -= 20;

    // Student Info Box
    page.drawRectangle({
      x: 50, y: y - 70, width: 500, height: 70,
      color: rgb(0.96, 0.96, 0.96),
      borderColor: rgb(0.1, 0.14, 0.49),
      borderWidth: 1
    });
    const infoY = y - 30;
    page.drawText('Student ID:', { x: 65, y: infoY, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
    page.drawText(`${r.student_id}`, { x: 150, y: infoY, size: 10, font: font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText('Name:', { x: 65, y: infoY - 18, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
    page.drawText(`${r.first_name} ${r.last_name}`, { x: 150, y: infoY - 18, size: 10, font: font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText('Class:', { x: 65, y: infoY - 36, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
    page.drawText(`${r.class_name}`, { x: 150, y: infoY - 36, size: 10, font: font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText('Stream:', { x: 65, y: infoY - 54, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
    page.drawText(`${r.stream_name}`, { x: 150, y: infoY - 54, size: 10, font: font, color: rgb(0.2, 0.2, 0.2) });
    y = y - 70 - 15;

    // Subjects Table Header
    page.drawRectangle({
      x: 50, y: y - 25, width: 500, height: 25,
      color: rgb(0.1, 0.14, 0.49)
    });
    page.drawText('Subject', { x: 65, y: y - 17, size: 10, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Marks Obtained', { x: 280, y: y - 17, size: 10, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Grade', { x: 450, y: y - 17, size: 10, font: fontBold, color: rgb(1, 1, 1) });
    y = y - 25;

    // Subjects Rows
    let rowCount = 0;
    for (const sub of subjectsResult.rows) {
      const marks = sub.marks_obtained || 0;
      let grade = 'F';
      if (marks >= 80) grade = 'A';
      else if (marks >= 70) grade = 'B';
      else if (marks >= 60) grade = 'C';
      else if (marks >= 50) grade = 'D';
      
      const rowColor = rowCount % 2 === 0 ? rgb(0.97, 0.97, 1) : rgb(1, 1, 1);
      page.drawRectangle({
        x: 50, y: y - 20, width: 500, height: 20,
        color: rowColor
      });
      page.drawText(sub.subject_name, { x: 65, y: y - 14, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(String(marks), { x: 310, y: y - 14, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(grade, { x: 465, y: y - 14, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
      y = y - 20;
      rowCount++;
    }

    // Totals Box
    y = y - 10;
    const avg = parseFloat(r.average);
    const avgDisplay = !isNaN(avg) ? avg.toFixed(2) : '-';
    page.drawRectangle({
      x: 50, y: y - 45, width: 500, height: 45,
      color: rgb(0.91, 0.92, 0.96)
    });
    const totalY = y - 15;
    page.drawText(`Total: ${r.total_marks}`, { x: 70, y: totalY, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
    page.drawText(`Average: ${avgDisplay}`, { x: 200, y: totalY, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
    page.drawText(`Grade: ${r.grade}`, { x: 330, y: totalY, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
    page.drawText(`Class Rank: ${r.class_rank || '-'}`, { x: 70, y: totalY - 18, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(`Stream Rank: ${r.stream_rank || '-'}`, { x: 250, y: totalY - 18, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
    y = y - 45 - 10;

    // Remarks
    let remark = '';
    if (r.grade === 'A') remark = 'Excellent performance! Keep up the great work!';
    else if (r.grade === 'B') remark = 'Good performance! Aim for even higher.';
    else if (r.grade === 'C') remark = 'Satisfactory. More effort needed to improve.';
    else if (r.grade === 'D') remark = 'Needs improvement. Please work harder.';
    else remark = 'Below average. Please seek extra help from teachers.';
    
    page.drawRectangle({
      x: 50, y: y - 35, width: 500, height: 35,
      color: rgb(1, 0.97, 0.88),
      borderColor: rgb(1, 0.63, 0),
      borderWidth: 1
    });
    page.drawText(`Remarks: ${remark}`, { x: 65, y: y - 22, size: 10, font: font, color: rgb(0.3, 0.3, 0.3) });
    y = y - 35 - 10;

    // Headteacher & Footer
    page.drawText(`Headteacher: ${headteacher}`, {
      x: 50, y: y, size: 9, font: font, color: rgb(0.2, 0.2, 0.2)
    });
    page.drawText(`${phone} | ${email}`, {
      x: 350, y: y, size: 9, font: font, color: rgb(0.2, 0.2, 0.2)
    });
    y = y - 20;

    page.drawText(`Generated on ${new Date().toLocaleString()} | ${r.class_name} - ${r.stream_name}`, {
      x: 50, y: y, size: 8, font: font, color: rgb(0.5, 0.5, 0.5)
    });
    page.drawText('This is a computer-generated report card', {
      x: 50, y: y - 15, size: 7, font: font, color: rgb(0.6, 0.6, 0.6)
    });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=report-${r.student_id}.pdf`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send('Error generating PDF: ' + error.message);
  }
});

// PDF for all students
app.get('/api/reports/pdf-all', async (req, res) => {
  const { class_id, stream_id, academic_year, term } = req.query;
  
  try {
    const settings = await getSettings();
    const schoolName = settings.school_name || 'ST. JOSEPH\'S PRIMARY SCHOOL';
    const headteacher = settings.headteacher || 'Mr. John Mukasa';

    let query = `
      SELECT 
        rc.*,
        s.id as student_db_id, s.student_id, s.first_name, s.last_name, s.gender, s.date_of_birth,
        c.class_name, st.stream_name,
        e.exam_name, e.term, e.academic_year
      FROM report_cards rc
      JOIN students s ON rc.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      JOIN streams st ON s.stream_id = st.id
      JOIN exams e ON rc.exam_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (class_id) {
      query += ` AND s.class_id = $${paramCount}`;
      params.push(class_id);
      paramCount++;
    }
    if (stream_id) {
      query += ` AND s.stream_id = $${paramCount}`;
      params.push(stream_id);
      paramCount++;
    }
    if (academic_year) {
      query += ` AND e.academic_year = $${paramCount}`;
      params.push(academic_year);
      paramCount++;
    }
    if (term) {
      query += ` AND e.term = $${paramCount}`;
      params.push(term);
      paramCount++;
    }

    query += ` ORDER BY rc.rank ASC`;

    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).send('No reports found');
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    for (let idx = 0; idx < result.rows.length; idx++) {
      const r = result.rows[idx];
      const page = pdfDoc.addPage([612, 792]);
      let y = 750;

      // Header with dynamic school name
      page.drawText(schoolName, {
        x: 50, y: y, size: 18, font: fontBold, color: rgb(0.1, 0.14, 0.49)
      });
      y -= 25;
      page.drawText(`${r.exam_name} REPORT CARD`, {
        x: 50, y: y, size: 14, font: fontBold, color: rgb(0.2, 0.2, 0.2)
      });
      y -= 20;
      page.drawText(`Academic Year: ${r.academic_year} | Term: ${r.term}`, {
        x: 50, y: y, size: 10, font: font, color: rgb(0.4, 0.4, 0.4)
      });
      y -= 20;

      // Student Info
      page.drawRectangle({
        x: 50, y: y - 70, width: 500, height: 70,
        color: rgb(0.96, 0.96, 0.96),
        borderColor: rgb(0.1, 0.14, 0.49),
        borderWidth: 1
      });
      const infoY = y - 30;
      page.drawText('Student ID:', { x: 65, y: infoY, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
      page.drawText(`${r.student_id}`, { x: 150, y: infoY, size: 10, font: font, color: rgb(0.2, 0.2, 0.2) });
      page.drawText('Name:', { x: 65, y: infoY - 18, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
      page.drawText(`${r.first_name} ${r.last_name}`, { x: 150, y: infoY - 18, size: 10, font: font, color: rgb(0.2, 0.2, 0.2) });
      page.drawText('Class:', { x: 65, y: infoY - 36, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
      page.drawText(`${r.class_name}`, { x: 150, y: infoY - 36, size: 10, font: font, color: rgb(0.2, 0.2, 0.2) });
      page.drawText('Stream:', { x: 65, y: infoY - 54, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
      page.drawText(`${r.stream_name}`, { x: 150, y: infoY - 54, size: 10, font: font, color: rgb(0.2, 0.2, 0.2) });
      y = y - 70 - 15;

      // Get subjects
      const subjectsResult = await pool.query(`
        SELECT sub.subject_name, m.marks_obtained
        FROM marks m
        JOIN subjects sub ON m.subject_id = sub.id
        WHERE m.student_id = $1 AND m.exam_id = (SELECT id FROM exams WHERE exam_name = $2 AND term = $3 AND academic_year = $4)
        ORDER BY sub.subject_name
      `, [r.student_db_id, r.exam_name, r.term, r.academic_year]);

      // Table Header
      page.drawRectangle({
        x: 50, y: y - 25, width: 500, height: 25,
        color: rgb(0.1, 0.14, 0.49)
      });
      page.drawText('Subject', { x: 65, y: y - 17, size: 10, font: fontBold, color: rgb(1, 1, 1) });
      page.drawText('Marks Obtained', { x: 280, y: y - 17, size: 10, font: fontBold, color: rgb(1, 1, 1) });
      page.drawText('Grade', { x: 450, y: y - 17, size: 10, font: fontBold, color: rgb(1, 1, 1) });
      y = y - 25;

      // Subjects Rows
      let rowCount = 0;
      for (const sub of subjectsResult.rows) {
        const marks = sub.marks_obtained || 0;
        let grade = 'F';
        if (marks >= 80) grade = 'A';
        else if (marks >= 70) grade = 'B';
        else if (marks >= 60) grade = 'C';
        else if (marks >= 50) grade = 'D';
        
        const rowColor = rowCount % 2 === 0 ? rgb(0.97, 0.97, 1) : rgb(1, 1, 1);
        page.drawRectangle({
          x: 50, y: y - 20, width: 500, height: 20,
          color: rowColor
        });
        page.drawText(sub.subject_name, { x: 65, y: y - 14, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
        page.drawText(String(marks), { x: 310, y: y - 14, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
        page.drawText(grade, { x: 465, y: y - 14, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
        y = y - 20;
        rowCount++;
      }

      // Totals
      y = y - 10;
      const avg = parseFloat(r.average);
      const avgDisplay = !isNaN(avg) ? avg.toFixed(2) : '-';
      page.drawRectangle({
        x: 50, y: y - 45, width: 500, height: 45,
        color: rgb(0.91, 0.92, 0.96)
      });
      const totalY = y - 15;
      page.drawText(`Total: ${r.total_marks}`, { x: 70, y: totalY, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
      page.drawText(`Average: ${avgDisplay}`, { x: 200, y: totalY, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
      page.drawText(`Grade: ${r.grade}`, { x: 330, y: totalY, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.49) });
      page.drawText(`Class Rank: ${r.class_rank || '-'}`, { x: 70, y: totalY - 18, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(`Stream Rank: ${r.stream_rank || '-'}`, { x: 250, y: totalY - 18, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
      y = y - 45 - 10;

      // Remarks
      let remark = '';
      if (r.grade === 'A') remark = 'Excellent performance! Keep up the great work!';
      else if (r.grade === 'B') remark = 'Good performance! Aim for even higher.';
      else if (r.grade === 'C') remark = 'Satisfactory. More effort needed to improve.';
      else if (r.grade === 'D') remark = 'Needs improvement. Please work harder.';
      else remark = 'Below average. Please seek extra help from teachers.';
      
      page.drawRectangle({
        x: 50, y: y - 35, width: 500, height: 35,
        color: rgb(1, 0.97, 0.88),
        borderColor: rgb(1, 0.63, 0),
        borderWidth: 1
      });
      page.drawText(`Remarks: ${remark}`, { x: 65, y: y - 22, size: 10, font: font, color: rgb(0.3, 0.3, 0.3) });
      y = y - 35 - 10;

      // Headteacher & Footer
      page.drawText(`Headteacher: ${headteacher}`, {
        x: 50, y: y, size: 9, font: font, color: rgb(0.2, 0.2, 0.2)
      });
      y = y - 20;

      page.drawText(`Generated on ${new Date().toLocaleString()} | ${r.class_name} - ${r.stream_name}`, {
        x: 50, y: y, size: 8, font: font, color: rgb(0.5, 0.5, 0.5)
      });
      page.drawText('This is a computer-generated report card', {
        x: 50, y: y - 15, size: 7, font: font, color: rgb(0.6, 0.6, 0.6)
      });
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=all-reports.pdf`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Error generating PDF-all:', error);
    res.status(500).send('Error generating PDF: ' + error.message);
  }
});

// ==================== SERVE PAGES ====================
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/dashboard.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/login.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log('========================================');
});
