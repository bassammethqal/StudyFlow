import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import crypto from "crypto";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const dbPath = path.resolve(__dirname, "../studyflow.db");
const db = new Database(dbPath);
const PORT = Number(process.env.PORT || 4000);
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Helmet with relaxed policies to avoid blocking resources or client bundle
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
}));

// Comprehensive CORS setup allowing any local development origins and configured origin
app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "20kb" }));
app.use("/api/auth", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
}));

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,name TEXT NOT NULL,tag TEXT NOT NULL DEFAULT 'General',done INTEGER DEFAULT 0,priority TEXT NOT NULL DEFAULT 'medium',due_date TEXT,estimated_minutes INTEGER DEFAULT 30,subject_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS subjects(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,name TEXT NOT NULL,code TEXT,progress INTEGER DEFAULT 0,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS schedules(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,subject TEXT NOT NULL,day TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,room TEXT,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS password_resets(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL,token TEXT NOT NULL,code TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS focus_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,duration_minutes INTEGER NOT NULL,subject_id INTEGER,task_id INTEGER,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL,FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, done);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_subjects_user ON subjects(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_user ON schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_day ON schedules(user_id, day, start_time);
CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
CREATE INDEX IF NOT EXISTS idx_focus_user ON focus_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_focus_created ON focus_sessions(user_id, created_at);
`);

// Remove legacy demo subjects from existing databases (one time only, tracked in meta table).
try {
  db.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)");
  const done = db.prepare("SELECT value FROM meta WHERE key='legacy_subjects_purged'").get();
  if (!done) {
    db.prepare("DELETE FROM subjects WHERE code IN ('DB201','CS202','WEB203','IS204')").run();
    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('legacy_subjects_purged','1')").run();
  }
} catch {}

// Upgrade schema safely
for (const sql of [
  "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'",
  "ALTER TABLE tasks ADD COLUMN due_date TEXT",
  "ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER DEFAULT 30",
  "ALTER TABLE tasks ADD COLUMN subject_id INTEGER"
]) {
  try { db.exec(sql); } catch {}
}

const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const PRIORITIES = ["low", "medium", "high"];
const TASK_SELECT = `SELECT t.id,t.name,t.tag,t.done,t.priority,t.due_date as dueDate,t.estimated_minutes as estimatedMinutes,t.subject_id as subjectId,s.name as subjectName FROM tasks t LEFT JOIN subjects s ON s.id=t.subject_id`;

// ---------------------------------------------------------------------------
// Prepared statement cache: better-sqlite3 compiles SQL on prepare(), so we
// compile each hot-path statement exactly once instead of on every request.
// ---------------------------------------------------------------------------
const stmtCache = new Map();
function stmt(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

function token(u) {
  return jwt.sign({ id: u.id, name: u.name, email: u.email }, SECRET, { expiresIn: "30d" });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const raw = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!raw) {
    return res.status(401).json({ message: "جلسة غير صالحة، سجّل الدخول من جديد" });
  }
  try {
    req.user = jwt.verify(raw, SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "جلسة غير صالحة، سجّل الدخول من جديد" });
  }
}

function taskRow(id) {
  return stmt(TASK_SELECT + " WHERE t.id=?").get(id);
}

function scheduleRow(id) {
  return stmt("SELECT id,subject,day,start_time as startTime,end_time as endTime,room FROM schedules WHERE id=?").get(id);
}

// --- Input normalisation helpers (never trust req.body types) ---------------
function str(v, fallback = "") {
  return typeof v === "string" ? v.trim() : v === undefined || v === null ? fallback : String(v).trim();
}
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clampInt(v, min, max, fallback) {
  const n = Math.round(num(v, fallback));
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}
function normalizePriority(v, fallback = "medium") {
  return PRIORITIES.includes(v) ? v : fallback;
}
function normalizeDueDate(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function normalizeTime(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const s = str(v).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : fallback;
}

// Nodemailer transporter helper
function createEmailTransporter() {
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return null;
}

// Send password reset email
async function sendResetEmail({ email, code, token }) {
  const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  const resetLink = `${clientOrigin}/?email=${encodeURIComponent(email)}&code=${code}`;

  const transporter = createEmailTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"StudyFlow" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "إعادة تعيين كلمة المرور - StudyFlow",
        html: `
        <div dir="rtl" style="font-family: Arial, Tahoma, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; color: #1e293b;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #4f46e5; margin: 0; font-size: 28px; letter-spacing: -0.5px;">Study<span style="color: #818cf8;">Flow</span></h1>
            <p style="color: #64748b; font-size: 13px; margin-top: 4px;">نظام إدارة ومتابعة الدراسة</p>
          </div>
          <div style="background: #f8fafc; border-radius: 14px; padding: 22px; text-align: center; margin-bottom: 22px; border: 1px solid #edf2f7;">
            <h2 style="color: #0f172a; font-size: 18px; margin-top: 0; margin-bottom: 12px;">طلب استعادة كلمة المرور</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك (<strong>${email}</strong>). رمز التحقق الخاص بك هو:</p>
            <div style="display: inline-block; background: #4f46e5; color: #ffffff; font-size: 34px; font-weight: 800; letter-spacing: 8px; padding: 12px 30px; border-radius: 12px; margin: 10px 0; box-shadow: 0 4px 14px rgba(79,70,229,0.3);">
              ${code}
            </div>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 14px; margin-bottom: 0;">⏳ صلاحية هذا الرمز هي 15 دقيقة فقط.</p>
          </div>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${resetLink}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 13px 28px; border-radius: 10px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(79,70,229,0.25);">أو اضغط هنا للمتابعة وتغيير كلمة المرور</a>
          </div>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0; line-height: 1.5;">إذا لم تكن أنت من طلب هذا التغيير، فيمكنك تجاهل هذه الرسالة بأمان ولن يتم إجراء أي تعديل على حسابك.</p>
        </div>
        `
      });
      console.log(`[EMAIL] تم إرسال رسالة استعادة كلمة المرور إلى ${email}`);
      return { sent: true };
    } catch (err) {
      console.error("[EMAIL ERROR] فشل إرسال البريد:", err.message);
      return { sent: false, error: err.message };
    }
  } else {
    console.log("==========================================================");
    console.log(`[STUDYFLOW] طلب استعادة كلمة المرور للبريد: ${email}`);
    console.log(`[STUDYFLOW] رمز التحقق (Verification Code): ${code}`);
    console.log(`[STUDYFLOW] رابط مباشر: ${resetLink}`);
    console.log("==========================================================");
    return { sent: false, simulated: true };
  }
}

app.get("/api/health", (req, res) => res.json({ ok: true, service: "StudyFlow API", version: "4.0" }));

app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
    return res.status(400).json({ message: "أدخل اسمًا وبريدًا وكلمة مرور من 6 أحرف على الأقل" });
  }
  try {
    const normalized = email.trim().toLowerCase();
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare("INSERT INTO users(name,email,password) VALUES(?,?,?)").run(name.trim(), normalized, hash);
    const u = db.prepare("SELECT id,name,email FROM users WHERE id=?").get(info.lastInsertRowid);
    
    // Start with a clean, personalized slate: student adds their own subjects based on their specific college and major
    res.status(201).json({ token: token(u), user: u });
  } catch {
    res.status(409).json({ message: "البريد الإلكتروني مستخدم بالفعل" });
  }
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE email=?").get((email || "").trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password || "", u.password)) {
    return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
  }
  res.json({ token: token(u), user: { id: u.id, name: u.name, email: u.email } });
});

// Request Password Reset Code
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  if (!email?.trim()) {
    return res.status(400).json({ message: "الرجاء إدخال البريد الإلكتروني" });
  }
  const normalized = email.trim().toLowerCase();
  const user = db.prepare("SELECT id, name, email FROM users WHERE email=?").get(normalized);
  if (!user) {
    return res.status(404).json({ message: "البريد الإلكتروني المدخل غير مسجل لدينا" });
  }

  // Generate 6-digit verification code and token
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const resetToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins expiry

  db.prepare("DELETE FROM password_resets WHERE email=?").run(normalized);
  db.prepare("INSERT INTO password_resets(email, token, code, expires_at) VALUES(?,?,?,?)").run(normalized, resetToken, code, expiresAt);

  const emailResult = await sendResetEmail({ email: normalized, code, token: resetToken });

  res.json({
    ok: true,
    message: "تم إرسال رمز التحقق إلى بريدك الإلكتروني بنجاح",
    devCode: emailResult.simulated ? code : undefined
  });
});

// Reset Password with Code
app.post("/api/auth/reset-password", (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email?.trim() || !code?.trim() || !newPassword) {
    return res.status(400).json({ message: "الرجاء ملء جميع الحقول المطلوبة" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: "كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف" });
  }

  const normalized = email.trim().toLowerCase();
  const cleanCode = code.trim();

  const resetRecord = db.prepare("SELECT * FROM password_resets WHERE email=? AND code=? AND expires_at > ?").get(normalized, cleanCode, Date.now());

  if (!resetRecord) {
    return res.status(400).json({ message: "رمز التحقق غير صحيح أو انتهت صلاحيته (الصلاحية 15 دقيقة)" });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password=? WHERE email=?").run(hash, normalized);
  db.prepare("DELETE FROM password_resets WHERE email=?").run(normalized);

  res.json({ ok: true, message: "تم تغيير كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول بها." });
});

app.get("/api/tasks", auth, (req, res) => {
  const rows = stmt(
    TASK_SELECT +
      " WHERE t.user_id=? ORDER BY t.done ASC, CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, COALESCE(t.due_date,'9999-12-31'), t.id DESC"
  ).all(req.user.id);
  res.json(rows);
});

app.post("/api/tasks", auth, (req, res) => {
  const body = req.body || {};
  const name = str(body.name);
  if (!name) return res.status(400).json({ message: "اسم المهمة مطلوب" });
  if (name.length > 200) return res.status(400).json({ message: "اسم المهمة طويل جداً (200 حرف كحد أقصى)" });
  const priority = normalizePriority(body.priority);
  const mins = clampInt(body.estimatedMinutes, 5, 600, 30);
  const dueDate = normalizeDueDate(body.dueDate);
  const tag = str(body.tag, "General").slice(0, 40) || "General";
  const sid = body.subjectId ? stmt("SELECT id FROM subjects WHERE id=? AND user_id=?").get(body.subjectId, req.user.id)?.id ?? null : null;
  const r = stmt(
    "INSERT INTO tasks(user_id,name,tag,priority,due_date,estimated_minutes,subject_id) VALUES(?,?,?,?,?,?,?)"
  ).run(req.user.id, name, tag, priority, dueDate, mins, sid);
  res.status(201).json(taskRow(r.lastInsertRowid));
});

app.patch("/api/tasks/:id", auth, (req, res) => {
  const t = stmt("SELECT * FROM tasks WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!t) return res.status(404).json({ message: "المهمة غير موجودة" });
  const body = req.body || {};

  const done = body.done === undefined ? t.done : body.done ? 1 : 0;
  const priority = body.priority === undefined ? t.priority : normalizePriority(body.priority, t.priority);
  const name = body.name === undefined ? t.name : str(body.name);
  if (!name) return res.status(400).json({ message: "اسم المهمة مطلوب" });
  if (name.length > 200) return res.status(400).json({ message: "اسم المهمة طويل جداً (200 حرف كحد أقصى)" });
  const tag = body.tag === undefined ? t.tag : str(body.tag, t.tag).slice(0, 40) || t.tag;
  const dueDate = body.dueDate === undefined ? t.due_date : normalizeDueDate(body.dueDate);
  const mins = body.estimatedMinutes === undefined ? t.estimated_minutes : clampInt(body.estimatedMinutes, 5, 600, 30);

  let subjectId;
  if (body.subjectId === undefined) {
    subjectId = t.subject_id;
  } else if (body.subjectId === null || body.subjectId === "" || body.subjectId === 0) {
    subjectId = null;
  } else {
    subjectId = stmt("SELECT id FROM subjects WHERE id=? AND user_id=?").get(body.subjectId, req.user.id)?.id ?? null;
  }

  stmt("UPDATE tasks SET name=?,tag=?,done=?,priority=?,due_date=?,estimated_minutes=?,subject_id=? WHERE id=? AND user_id=?").run(
    name, tag, done, priority, dueDate, mins, subjectId, t.id, req.user.id
  );
  res.json(taskRow(t.id));
});

app.delete("/api/tasks/:id", auth, (req, res) => {
  const info = stmt("DELETE FROM tasks WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ message: "المهمة غير موجودة" });
  res.status(204).end();
});

app.delete("/api/tasks", auth, (req, res) => {
  // Bulk clear of finished tasks (used by the "clear completed" action).
  const info = stmt("DELETE FROM tasks WHERE user_id=? AND done=1").run(req.user.id);
  res.json({ removed: info.changes });
});

app.get("/api/subjects", auth, (req, res) => {
  const rows = stmt(`
    SELECT s.id, s.name, s.code, s.progress,
      COUNT(t.id) as totalTasks,
      COALESCE(SUM(CASE WHEN t.done = 1 THEN 1 ELSE 0 END), 0) as completedTasks
    FROM subjects s
    LEFT JOIN tasks t ON t.subject_id = s.id AND t.user_id = s.user_id
    WHERE s.user_id = ?
    GROUP BY s.id
    ORDER BY s.id
  `).all(req.user.id);
  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    code: r.code,
    progress: r.progress,
    totalTasks: Number(r.totalTasks) || 0,
    completedTasks: Number(r.completedTasks) || 0,
    taskProgress: r.totalTasks > 0 ? Math.round((Number(r.completedTasks) / Number(r.totalTasks)) * 100) : 0
  })));
});

app.post("/api/subjects", auth, (req, res) => {
  const body = req.body || {};
  const name = str(body.name);
  if (!name) return res.status(400).json({ message: "اسم المادة مطلوب" });
  const p = clampInt(body.progress, 0, 100, 0);
  const code = str(body.code).slice(0, 30);
  const r = stmt("INSERT INTO subjects(user_id,name,code,progress) VALUES(?,?,?,?)").run(req.user.id, name, code, p);
  res.status(201).json(stmt("SELECT id,name,code,progress FROM subjects WHERE id=?").get(r.lastInsertRowid));
});

app.patch("/api/subjects/:id", auth, (req, res) => {
  const x = stmt("SELECT * FROM subjects WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!x) return res.status(404).json({ message: "المادة غير موجودة" });
  const body = req.body || {};
  const p = body.progress === undefined ? x.progress : clampInt(body.progress, 0, 100, x.progress);
  const name = body.name === undefined ? x.name : str(body.name);
  if (!name) return res.status(400).json({ message: "اسم المادة مطلوب" });
  const code = body.code === undefined ? x.code : str(body.code, "").slice(0, 30);
  stmt("UPDATE subjects SET name=?,code=?,progress=? WHERE id=? AND user_id=?").run(name, code, p, x.id, req.user.id);
  res.json(stmt("SELECT id,name,code,progress FROM subjects WHERE id=?").get(x.id));
});

app.delete("/api/subjects/:id", auth, (req, res) => {
  const info = stmt("DELETE FROM subjects WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ message: "المادة غير موجودة" });
  res.status(204).end();
});

const SCHEDULE_ORDER = `ORDER BY CASE day WHEN 'الأحد' THEN 1 WHEN 'الإثنين' THEN 2 WHEN 'الثلاثاء' THEN 3 WHEN 'الأربعاء' THEN 4 WHEN 'الخميس' THEN 5 WHEN 'الجمعة' THEN 6 ELSE 7 END, start_time`;

app.get("/api/schedule", auth, (req, res) => {
  res.json(
    stmt("SELECT id,subject,day,start_time as startTime,end_time as endTime,room FROM schedules WHERE user_id=? " + SCHEDULE_ORDER).all(
      req.user.id
    )
  );
});

app.post("/api/schedule", auth, (req, res) => {
  const body = req.body || {};
  const subject = str(body.subject);
  const day = days.includes(body.day) ? body.day : null;
  const startTime = normalizeTime(body.startTime);
  const endTime = normalizeTime(body.endTime);
  const room = str(body.room).slice(0, 60);
  if (!subject) return res.status(400).json({ message: "اسم المادة للحصة مطلوب" });
  if (!day) return res.status(400).json({ message: "اليوم غير صالح" });
  if (!startTime || !endTime) return res.status(400).json({ message: "أوقات البداية والنهاية مطلوبة" });
  if (startTime >= endTime) return res.status(400).json({ message: "وقت النهاية يجب أن يكون بعد وقت البداية" });
  const r = stmt("INSERT INTO schedules(user_id,subject,day,start_time,end_time,room) VALUES(?,?,?,?,?,?)").run(
    req.user.id, subject, day, startTime, endTime, room
  );
  res.status(201).json(scheduleRow(r.lastInsertRowid));
});

app.patch("/api/schedule/:id", auth, (req, res) => {
  const x = stmt("SELECT * FROM schedules WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!x) return res.status(404).json({ message: "الحصة غير موجودة" });
  const b = req.body || {};
  const subject = b.subject === undefined ? x.subject : str(b.subject);
  if (!subject) return res.status(400).json({ message: "اسم المادة للحصة مطلوب" });
  const day = days.includes(b.day) ? b.day : x.day;
  const startTime = b.startTime === undefined ? x.start_time : normalizeTime(b.startTime, x.start_time);
  const endTime = b.endTime === undefined ? x.end_time : normalizeTime(b.endTime, x.end_time);
  const room = b.room === undefined ? x.room : str(b.room, "").slice(0, 60);
  if (!startTime || !endTime || startTime >= endTime) {
    return res.status(400).json({ message: "وقت النهاية يجب أن يكون بعد وقت البداية" });
  }
  stmt("UPDATE schedules SET subject=?,day=?,start_time=?,end_time=?,room=? WHERE id=? AND user_id=?").run(
    subject, day, startTime, endTime, room, x.id, req.user.id
  );
  res.json(scheduleRow(x.id));
});

app.delete("/api/schedule/:id", auth, (req, res) => {
  const info = stmt("DELETE FROM schedules WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ message: "الحصة غير موجودة" });
  res.status(204).end();
});

app.post("/api/focus", auth, (req, res) => {
  const body = req.body || {};
  const duration = clampInt(body.durationMinutes, 1, 300, 25);
  const subjectId = body.subjectId ? stmt("SELECT id FROM subjects WHERE id=? AND user_id=?").get(body.subjectId, req.user.id)?.id ?? null : null;
  const taskId = body.taskId ? stmt("SELECT id FROM tasks WHERE id=? AND user_id=?").get(body.taskId, req.user.id)?.id ?? null : null;
  const notes = str(body.notes).slice(0, 200);

  const r = stmt("INSERT INTO focus_sessions(user_id, duration_minutes, subject_id, task_id, notes) VALUES(?,?,?,?,?)")
    .run(req.user.id, duration, subjectId, taskId, notes);

  if (taskId && body.markTaskDone) {
    stmt("UPDATE tasks SET done=1 WHERE id=? AND user_id=?").run(taskId, req.user.id);
  }

  res.status(201).json({
    id: r.lastInsertRowid,
    durationMinutes: duration,
    subjectId,
    taskId,
    createdAt: new Date().toISOString()
  });
});

app.get("/api/focus/today", auth, (req, res) => {
  const todayRow = stmt(`
    SELECT COALESCE(SUM(duration_minutes), 0) as minutes, COUNT(*) as count
    FROM focus_sessions
    WHERE user_id=? AND date(created_at, 'localtime') = date('now', 'localtime')
  `).get(req.user.id);
  const allRow = stmt(`
    SELECT COALESCE(SUM(duration_minutes), 0) as totalMinutes, COUNT(*) as totalCount
    FROM focus_sessions
    WHERE user_id=?
  `).get(req.user.id);
  res.json({
    todayMinutes: todayRow.minutes || 0,
    todaySessions: todayRow.count || 0,
    totalMinutes: allRow.totalMinutes || 0,
    totalSessions: allRow.totalCount || 0
  });
});

app.get("/api/profile", auth, (req, res) => {
  const u = stmt("SELECT id,name,email,created_at as createdAt FROM users WHERE id=?").get(req.user.id);
  if (!u) return res.status(404).json({ message: "المستخدم غير موجود" });
  const completedTasks = stmt("SELECT COUNT(*) n FROM tasks WHERE user_id=? AND done=1").get(req.user.id).n;
  const totalMinutes = stmt("SELECT COALESCE(SUM(estimated_minutes),0) n FROM tasks WHERE user_id=? AND done=1").get(req.user.id).n;
  const focusStats = stmt("SELECT COALESCE(SUM(duration_minutes),0) as focusMinutes, COUNT(*) as focusCount FROM focus_sessions WHERE user_id=?").get(req.user.id);
  res.json({
    ...u,
    completedTasks,
    totalMinutes,
    focusMinutes: focusStats.focusMinutes || 0,
    focusSessionsCount: focusStats.focusCount || 0
  });
});

app.patch("/api/profile", auth, (req, res) => {
  const name = str(req.body?.name);
  if (!name) return res.status(400).json({ message: "الاسم مطلوب" });
  if (name.length > 80) return res.status(400).json({ message: "الاسم طويل جداً (80 حرف كحد أقصى)" });
  stmt("UPDATE users SET name=? WHERE id=?").run(name, req.user.id);
  const u = stmt("SELECT id,name,email,created_at as createdAt FROM users WHERE id=?").get(req.user.id);
  res.json(u);
});

app.patch("/api/profile/password", auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "الرجاء إدخال كلمة المرور الحالية والجديدة" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: "كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف" });
  }
  const u = stmt("SELECT password FROM users WHERE id=?").get(req.user.id);
  if (!u || !bcrypt.compareSync(currentPassword, u.password)) {
    return res.status(401).json({ message: "كلمة المرور الحالية غير صحيحة" });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  stmt("UPDATE users SET password=? WHERE id=?").run(hash, req.user.id);
  res.json({ ok: true, message: "تم تغيير كلمة المرور بنجاح!" });
});

app.get("/api/stats", auth, (req, res) => {
  const uid = req.user.id;
  const total = stmt("SELECT COUNT(*) n FROM tasks WHERE user_id=?").get(uid).n;
  const completed = stmt("SELECT COUNT(*) n FROM tasks WHERE user_id=? AND done=1").get(uid).n;
  const minutes = stmt("SELECT COALESCE(SUM(estimated_minutes),0) n FROM tasks WHERE user_id=? AND done=1").get(uid).n;
  const high = stmt("SELECT COUNT(*) n FROM tasks WHERE user_id=? AND priority='high' AND done=0").get(uid).n;
  const overdue = stmt("SELECT COUNT(*) n FROM tasks WHERE user_id=? AND done=0 AND due_date IS NOT NULL AND due_date < date('now', 'localtime')").get(uid).n;
  const dueToday = stmt("SELECT COUNT(*) n FROM tasks WHERE user_id=? AND done=0 AND due_date = date('now', 'localtime')").get(uid).n;
  const subjects = stmt("SELECT COUNT(*) n FROM subjects WHERE user_id=?").get(uid).n;
  const avg = stmt("SELECT COALESCE(AVG(progress),0) n FROM subjects WHERE user_id=?").get(uid).n;

  const focusData = stmt("SELECT COALESCE(SUM(duration_minutes),0) as totalMins, COUNT(*) as totalSessions FROM focus_sessions WHERE user_id=?").get(uid);
  const todayFocus = stmt("SELECT COALESCE(SUM(duration_minutes),0) as todayMins, COUNT(*) as todaySessions FROM focus_sessions WHERE user_id=? AND date(created_at, 'localtime') = date('now', 'localtime')").get(uid);

  const totalStudyMinutes = minutes + (focusData.totalMins || 0);
  const studyHours = Math.round(totalStudyMinutes / 60 * 10) / 10;

  res.json({
    totalTasks: total,
    completedTasks: completed,
    completionRate: total ? Math.round(completed / total * 100) : 0,
    studyHours,
    taskMinutes: minutes,
    focusMinutes: focusData.totalMins || 0,
    focusSessionsCount: focusData.totalSessions || 0,
    todayFocusMinutes: todayFocus.todayMins || 0,
    todayFocusSessions: todayFocus.todaySessions || 0,
    highPriorityOpen: high,
    overdueTasks: overdue,
    dueToday,
    subjects,
    averageProgress: Math.round(avg)
  });
});

// Serve frontend production build if available
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Centralized error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(err.status || 500).json({ message: err.message || "حدث خطأ غير متوقع في الخادم" });
});

// Periodic WAL checkpoint to guarantee data persistence on disk
setInterval(() => {
  try {
    db.pragma("wal_checkpoint(PASSIVE)");
  } catch {}
}, 30000);

function shutdown() {
  try {
    db.pragma("wal_checkpoint(FULL)");
    db.close();
    console.log("StudyFlow database safely closed and flushed to disk.");
  } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen(PORT, () => console.log(`StudyFlow API v4: http://localhost:${PORT}`));
