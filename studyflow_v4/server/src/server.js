import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import crypto from "crypto";
import fs from "fs";
import { db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 4000);

// Audit JWT_SECRET: Reject insecure defaults or missing secret in production
const rawJwtSecret = (process.env.JWT_SECRET || "").trim();
const INSECURE_JWT_SECRETS = [
  "dev-secret-change-me",
  "replace-with-a-long-random-secret",
  "secret",
  "changeme"
];

if (isProd) {
  if (!rawJwtSecret || INSECURE_JWT_SECRETS.includes(rawJwtSecret) || rawJwtSecret.length < 16) {
    console.error("\n❌ [FATAL SECURITY ERROR] Insecure or missing JWT_SECRET in production!");
    console.error("In production mode (NODE_ENV=production), you must set a strong, random JWT_SECRET (at least 16 characters) in your environment variables.\n");
    process.exit(1);
  }
}

const SECRET = rawJwtSecret || "dev-secret-change-me";

// Trust first proxy hop when running behind reverse proxies (Render, Railway, Vercel, Fly.io, Nginx)
if (isProd || process.env.TRUST_PROXY) {
  app.set("trust proxy", 1);
}

// Initialize database schema (PostgreSQL / Neon or SQLite fallback)
await db.init();

// Helmet with relaxed policies to avoid blocking resources or client bundle
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
}));

// CORS setup supporting hosted frontends (Vercel, Netlify, custom domain) and local dev
const allowedOriginsRaw = process.env.ALLOWED_ORIGINS || process.env.CLIENT_ORIGIN || process.env.CLIENT_URL || "";
const configuredOrigins = allowedOriginsRaw
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. mobile apps, curl, server-to-server) or same-origin requests
    if (!origin) return callback(null, true);

    // In development mode, allow any origin
    if (!isProd) return callback(null, true);

    // If wildcard or no restricted origins specified, allow
    if (configuredOrigins.length === 0 || configuredOrigins.includes("*")) {
      return callback(null, true);
    }

    const cleanOrigin = origin.replace(/\/+$/, "");
    if (
      configuredOrigins.includes(cleanOrigin) ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));

app.use(express.json({ limit: "20kb" }));
app.use("/api/auth", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
}));

const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const PRIORITIES = ["low", "medium", "high"];
const TASK_SELECT = `SELECT t.id, t.name, t.tag, t.done, t.priority,
  t.due_date as "dueDate",
  t.estimated_minutes as "estimatedMinutes",
  t.subject_id as "subjectId",
  s.name as "subjectName"
FROM tasks t
LEFT JOIN subjects s ON s.id = t.subject_id`;

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

async function taskRow(id) {
  return await db.get(TASK_SELECT + " WHERE t.id = ?", [id]);
}

async function scheduleRow(id) {
  return await db.get(
    `SELECT id, subject, day, start_time as "startTime", end_time as "endTime", room FROM schedules WHERE id = ?`,
    [id]
  );
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
  const clientOrigin = (process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || "http://localhost:5173").replace(/\/+$/, "");
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
    if (isProd) {
      console.warn(`[WARN] Password reset requested for ${email}, but SMTP credentials are not configured in production.`);
    } else {
      console.log("==========================================================");
      console.log(`[STUDYFLOW DEV] طلب استعادة كلمة المرور للبريد: ${email}`);
      console.log(`[STUDYFLOW DEV] رمز التحقق (Verification Code): ${code}`);
      console.log(`[STUDYFLOW DEV] رابط مباشر: ${resetLink}`);
      console.log("==========================================================");
    }
    return { sent: false, simulated: !isProd };
  }
}

app.get("/api/health", (req, res) => res.json({
  ok: true,
  service: "StudyFlow API",
  version: "4.1",
  database: db.isPostgres ? "PostgreSQL (Neon)" : "SQLite"
}));

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
    return res.status(400).json({ message: "أدخل اسمًا وبريدًا وكلمة مرور من 6 أحرف على الأقل" });
  }
  try {
    const normalized = email.trim().toLowerCase();
    const hash = bcrypt.hashSync(password, 10);
    const info = await db.run("INSERT INTO users(name,email,password) VALUES(?,?,?)", [name.trim(), normalized, hash]);
    const u = await db.get("SELECT id,name,email FROM users WHERE id=?", [info.lastInsertRowid]);
    res.status(201).json({ token: token(u), user: u });
  } catch (err) {
    res.status(409).json({ message: "البريد الإلكتروني مستخدم بالفعل" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const u = await db.get("SELECT * FROM users WHERE email=?", [(email || "").trim().toLowerCase()]);
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
  const user = await db.get("SELECT id, name, email FROM users WHERE email=?", [normalized]);
  if (!user) {
    return res.status(404).json({ message: "البريد الإلكتروني المدخل غير مسجل لدينا" });
  }

  // Generate 6-digit verification code and token
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const resetToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins expiry

  await db.run("DELETE FROM password_resets WHERE email=?", [normalized]);
  await db.run("INSERT INTO password_resets(email, token, code, expires_at) VALUES(?,?,?,?)", [normalized, resetToken, code, expiresAt]);

  const emailResult = await sendResetEmail({ email: normalized, code, token: resetToken });

  res.json({
    ok: true,
    message: "تم إرسال رمز التحقق إلى بريدك الإلكتروني بنجاح",
    devCode: (!isProd && emailResult.simulated) ? code : undefined
  });
});

// Reset Password with Code
app.post("/api/auth/reset-password", async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email?.trim() || !code?.trim() || !newPassword) {
    return res.status(400).json({ message: "الرجاء ملء جميع الحقول المطلوبة" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: "كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف" });
  }

  const normalized = email.trim().toLowerCase();
  const cleanCode = code.trim();

  const resetRecord = await db.get(
    "SELECT * FROM password_resets WHERE email=? AND code=? AND expires_at > ?",
    [normalized, cleanCode, Date.now()]
  );

  if (!resetRecord) {
    return res.status(400).json({ message: "رمز التحقق غير صحيح أو انتهت صلاحيته (الصلاحية 15 دقيقة)" });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run("UPDATE users SET password=? WHERE email=?", [hash, normalized]);
  await db.run("DELETE FROM password_resets WHERE email=?", [normalized]);

  res.json({ ok: true, message: "تم تغيير كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول بها." });
});

app.get("/api/tasks", auth, async (req, res) => {
  const rows = await db.all(
    TASK_SELECT +
      " WHERE t.user_id=? ORDER BY t.done ASC, CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, COALESCE(t.due_date,'9999-12-31'), t.id DESC",
    [req.user.id]
  );
  res.json(rows);
});

app.post("/api/tasks", auth, async (req, res) => {
  const body = req.body || {};
  const name = str(body.name);
  if (!name) return res.status(400).json({ message: "اسم المهمة مطلوب" });
  if (name.length > 200) return res.status(400).json({ message: "اسم المهمة طويل جداً (200 حرف كحد أقصى)" });
  const priority = normalizePriority(body.priority);
  const mins = clampInt(body.estimatedMinutes, 5, 600, 30);
  const dueDate = normalizeDueDate(body.dueDate);
  const tag = str(body.tag, "General").slice(0, 40) || "General";
  let sid = null;
  if (body.subjectId) {
    const s = await db.get("SELECT id FROM subjects WHERE id=? AND user_id=?", [body.subjectId, req.user.id]);
    sid = s?.id ?? null;
  }
  const r = await db.run(
    "INSERT INTO tasks(user_id,name,tag,priority,due_date,estimated_minutes,subject_id) VALUES(?,?,?,?,?,?,?)",
    [req.user.id, name, tag, priority, dueDate, mins, sid]
  );
  const row = await taskRow(r.lastInsertRowid);
  res.status(201).json(row);
});

app.patch("/api/tasks/:id", auth, async (req, res) => {
  const t = await db.get("SELECT * FROM tasks WHERE id=? AND user_id=?", [req.params.id, req.user.id]);
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
    const s = await db.get("SELECT id FROM subjects WHERE id=? AND user_id=?", [body.subjectId, req.user.id]);
    subjectId = s?.id ?? null;
  }

  await db.run(
    "UPDATE tasks SET name=?,tag=?,done=?,priority=?,due_date=?,estimated_minutes=?,subject_id=? WHERE id=? AND user_id=?",
    [name, tag, done, priority, dueDate, mins, subjectId, t.id, req.user.id]
  );
  const row = await taskRow(t.id);
  res.json(row);
});

app.delete("/api/tasks/:id", auth, async (req, res) => {
  const info = await db.run("DELETE FROM tasks WHERE id=? AND user_id=?", [req.params.id, req.user.id]);
  if (!info.changes) return res.status(404).json({ message: "المهمة غير موجودة" });
  res.status(204).end();
});

app.delete("/api/tasks", auth, async (req, res) => {
  const info = await db.run("DELETE FROM tasks WHERE user_id=? AND done=1", [req.user.id]);
  res.json({ removed: info.changes || 0 });
});

app.get("/api/subjects", auth, async (req, res) => {
  const rows = await db.all(`
    SELECT s.id, s.name, s.code, s.progress,
      COUNT(t.id) as "totalTasks",
      COALESCE(SUM(CASE WHEN t.done = 1 THEN 1 ELSE 0 END), 0) as "completedTasks"
    FROM subjects s
    LEFT JOIN tasks t ON t.subject_id = s.id AND t.user_id = s.user_id
    WHERE s.user_id = ?
    GROUP BY s.id, s.name, s.code, s.progress
    ORDER BY s.id
  `, [req.user.id]);
  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    code: r.code,
    progress: r.progress,
    totalTasks: Number(r.totalTasks) || 0,
    completedTasks: Number(r.completedTasks) || 0,
    taskProgress: Number(r.totalTasks) > 0 ? Math.round((Number(r.completedTasks) / Number(r.totalTasks)) * 100) : 0
  })));
});

app.post("/api/subjects", auth, async (req, res) => {
  const body = req.body || {};
  const name = str(body.name);
  if (!name) return res.status(400).json({ message: "اسم المادة مطلوب" });
  const p = clampInt(body.progress, 0, 100, 0);
  const code = str(body.code).slice(0, 30);
  const r = await db.run("INSERT INTO subjects(user_id,name,code,progress) VALUES(?,?,?,?)", [req.user.id, name, code, p]);
  const row = await db.get("SELECT id,name,code,progress FROM subjects WHERE id=?", [r.lastInsertRowid]);
  res.status(201).json(row);
});

app.patch("/api/subjects/:id", auth, async (req, res) => {
  const x = await db.get("SELECT * FROM subjects WHERE id=? AND user_id=?", [req.params.id, req.user.id]);
  if (!x) return res.status(404).json({ message: "المادة غير موجودة" });
  const body = req.body || {};
  const p = body.progress === undefined ? x.progress : clampInt(body.progress, 0, 100, x.progress);
  const name = body.name === undefined ? x.name : str(body.name);
  if (!name) return res.status(400).json({ message: "اسم المادة مطلوب" });
  const code = body.code === undefined ? x.code : str(body.code, "").slice(0, 30);
  await db.run("UPDATE subjects SET name=?,code=?,progress=? WHERE id=? AND user_id=?", [name, code, p, x.id, req.user.id]);
  const row = await db.get("SELECT id,name,code,progress FROM subjects WHERE id=?", [x.id]);
  res.json(row);
});

app.delete("/api/subjects/:id", auth, async (req, res) => {
  const info = await db.run("DELETE FROM subjects WHERE id=? AND user_id=?", [req.params.id, req.user.id]);
  if (!info.changes) return res.status(404).json({ message: "المادة غير موجودة" });
  res.status(204).end();
});

const SCHEDULE_ORDER = `ORDER BY CASE day WHEN 'الأحد' THEN 1 WHEN 'الإثنين' THEN 2 WHEN 'الثلاثاء' THEN 3 WHEN 'الأربعاء' THEN 4 WHEN 'الخميس' THEN 5 WHEN 'الجمعة' THEN 6 ELSE 7 END, start_time`;

app.get("/api/schedule", auth, async (req, res) => {
  const rows = await db.all(
    `SELECT id,subject,day,start_time as "startTime",end_time as "endTime",room FROM schedules WHERE user_id=? ` + SCHEDULE_ORDER,
    [req.user.id]
  );
  res.json(rows);
});

app.post("/api/schedule", auth, async (req, res) => {
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
  const r = await db.run("INSERT INTO schedules(user_id,subject,day,start_time,end_time,room) VALUES(?,?,?,?,?,?)", [
    req.user.id, subject, day, startTime, endTime, room
  ]);
  const row = await scheduleRow(r.lastInsertRowid);
  res.status(201).json(row);
});

app.patch("/api/schedule/:id", auth, async (req, res) => {
  const x = await db.get("SELECT * FROM schedules WHERE id=? AND user_id=?", [req.params.id, req.user.id]);
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
  await db.run("UPDATE schedules SET subject=?,day=?,start_time=?,end_time=?,room=? WHERE id=? AND user_id=?", [
    subject, day, startTime, endTime, room, x.id, req.user.id
  ]);
  const row = await scheduleRow(x.id);
  res.json(row);
});

app.delete("/api/schedule/:id", auth, async (req, res) => {
  const info = await db.run("DELETE FROM schedules WHERE id=? AND user_id=?", [req.params.id, req.user.id]);
  if (!info.changes) return res.status(404).json({ message: "الحصة غير موجودة" });
  res.status(204).end();
});

app.post("/api/focus", auth, async (req, res) => {
  const body = req.body || {};
  const duration = clampInt(body.durationMinutes, 1, 300, 25);
  let subjectId = null;
  if (body.subjectId) {
    const s = await db.get("SELECT id FROM subjects WHERE id=? AND user_id=?", [body.subjectId, req.user.id]);
    subjectId = s?.id ?? null;
  }
  let taskId = null;
  if (body.taskId) {
    const t = await db.get("SELECT id FROM tasks WHERE id=? AND user_id=?", [body.taskId, req.user.id]);
    taskId = t?.id ?? null;
  }
  const notes = str(body.notes).slice(0, 200);

  const r = await db.run("INSERT INTO focus_sessions(user_id, duration_minutes, subject_id, task_id, notes) VALUES(?,?,?,?,?)", [
    req.user.id, duration, subjectId, taskId, notes
  ]);

  if (taskId && body.markTaskDone) {
    await db.run("UPDATE tasks SET done=1 WHERE id=? AND user_id=?", [taskId, req.user.id]);
  }

  res.status(201).json({
    id: r.lastInsertRowid,
    durationMinutes: duration,
    subjectId,
    taskId,
    createdAt: new Date().toISOString()
  });
});

app.get("/api/focus/today", auth, async (req, res) => {
  const today = new Date().toLocaleDateString("en-CA");
  let todayRow;
  if (db.isPostgres) {
    todayRow = await db.get(`
      SELECT COALESCE(SUM(duration_minutes), 0) as "minutes", COUNT(*) as "count"
      FROM focus_sessions
      WHERE user_id = ? AND TO_CHAR(created_at, 'YYYY-MM-DD') = ?
    `, [req.user.id, today]);
  } else {
    todayRow = await db.get(`
      SELECT COALESCE(SUM(duration_minutes), 0) as "minutes", COUNT(*) as "count"
      FROM focus_sessions
      WHERE user_id = ? AND date(created_at, 'localtime') = ?
    `, [req.user.id, today]);
  }

  const allRow = await db.get(`
    SELECT COALESCE(SUM(duration_minutes), 0) as "totalMinutes", COUNT(*) as "totalCount"
    FROM focus_sessions
    WHERE user_id = ?
  `, [req.user.id]);

  res.json({
    todayMinutes: Number(todayRow?.minutes) || 0,
    todaySessions: Number(todayRow?.count) || 0,
    totalMinutes: Number(allRow?.totalMinutes) || 0,
    totalSessions: Number(allRow?.totalCount) || 0
  });
});

app.get("/api/profile", auth, async (req, res) => {
  const u = await db.get(`SELECT id,name,email,created_at as "createdAt" FROM users WHERE id=?`, [req.user.id]);
  if (!u) return res.status(404).json({ message: "المستخدم غير موجود" });
  const completedTasksRow = await db.get("SELECT COUNT(*) as n FROM tasks WHERE user_id=? AND done=1", [req.user.id]);
  const totalMinutesRow = await db.get("SELECT COALESCE(SUM(estimated_minutes),0) as n FROM tasks WHERE user_id=? AND done=1", [req.user.id]);
  const focusStats = await db.get(
    `SELECT COALESCE(SUM(duration_minutes),0) as "focusMinutes", COUNT(*) as "focusCount" FROM focus_sessions WHERE user_id=?`,
    [req.user.id]
  );
  res.json({
    ...u,
    completedTasks: Number(completedTasksRow?.n) || 0,
    totalMinutes: Number(totalMinutesRow?.n) || 0,
    focusMinutes: Number(focusStats?.focusMinutes) || 0,
    focusSessionsCount: Number(focusStats?.focusCount) || 0
  });
});

app.patch("/api/profile", auth, async (req, res) => {
  const name = str(req.body?.name);
  if (!name) return res.status(400).json({ message: "الاسم مطلوب" });
  if (name.length > 80) return res.status(400).json({ message: "الاسم طويل جداً (80 حرف كحد أقصى)" });
  await db.run("UPDATE users SET name=? WHERE id=?", [name, req.user.id]);
  const u = await db.get(`SELECT id,name,email,created_at as "createdAt" FROM users WHERE id=?`, [req.user.id]);
  res.json(u);
});

app.patch("/api/profile/password", auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "الرجاء إدخال كلمة المرور الحالية والجديدة" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: "كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف" });
  }
  const u = await db.get("SELECT password FROM users WHERE id=?", [req.user.id]);
  if (!u || !bcrypt.compareSync(currentPassword, u.password)) {
    return res.status(401).json({ message: "كلمة المرور الحالية غير صحيحة" });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run("UPDATE users SET password=? WHERE id=?", [hash, req.user.id]);
  res.json({ ok: true, message: "تم تغيير كلمة المرور بنجاح!" });
});

app.get("/api/stats", auth, async (req, res) => {
  const uid = req.user.id;
  const today = new Date().toLocaleDateString("en-CA");

  const [totalRow, completedRow, minutesRow, highRow, overdueRow, dueTodayRow, subjectsRow, avgRow, focusData] = await Promise.all([
    db.get("SELECT COUNT(*) as n FROM tasks WHERE user_id=?", [uid]),
    db.get("SELECT COUNT(*) as n FROM tasks WHERE user_id=? AND done=1", [uid]),
    db.get("SELECT COALESCE(SUM(estimated_minutes),0) as n FROM tasks WHERE user_id=? AND done=1", [uid]),
    db.get("SELECT COUNT(*) as n FROM tasks WHERE user_id=? AND priority='high' AND done=0", [uid]),
    db.get("SELECT COUNT(*) as n FROM tasks WHERE user_id=? AND done=0 AND due_date IS NOT NULL AND due_date < ?", [uid, today]),
    db.get("SELECT COUNT(*) as n FROM tasks WHERE user_id=? AND done=0 AND due_date = ?", [uid, today]),
    db.get("SELECT COUNT(*) as n FROM subjects WHERE user_id=?", [uid]),
    db.get("SELECT COALESCE(AVG(progress),0) as n FROM subjects WHERE user_id=?", [uid]),
    db.get(`SELECT COALESCE(SUM(duration_minutes),0) as "totalMins", COUNT(*) as "totalSessions" FROM focus_sessions WHERE user_id=?`, [uid])
  ]);

  let todayFocus;
  if (db.isPostgres) {
    todayFocus = await db.get(`
      SELECT COALESCE(SUM(duration_minutes),0) as "todayMins", COUNT(*) as "todaySessions"
      FROM focus_sessions
      WHERE user_id=? AND TO_CHAR(created_at, 'YYYY-MM-DD') = ?
    `, [uid, today]);
  } else {
    todayFocus = await db.get(`
      SELECT COALESCE(SUM(duration_minutes),0) as "todayMins", COUNT(*) as "todaySessions"
      FROM focus_sessions
      WHERE user_id=? AND date(created_at, 'localtime') = ?
    `, [uid, today]);
  }

  const total = Number(totalRow?.n) || 0;
  const completed = Number(completedRow?.n) || 0;
  const minutes = Number(minutesRow?.n) || 0;
  const high = Number(highRow?.n) || 0;
  const overdue = Number(overdueRow?.n) || 0;
  const dueToday = Number(dueTodayRow?.n) || 0;
  const subjects = Number(subjectsRow?.n) || 0;
  const avg = Number(avgRow?.n) || 0;

  const totalStudyMinutes = minutes + (Number(focusData?.totalMins) || 0);
  const studyHours = Math.round(totalStudyMinutes / 60 * 10) / 10;

  res.json({
    totalTasks: total,
    completedTasks: completed,
    completionRate: total ? Math.round(completed / total * 100) : 0,
    studyHours,
    taskMinutes: minutes,
    focusMinutes: Number(focusData?.totalMins) || 0,
    focusSessionsCount: Number(focusData?.totalSessions) || 0,
    todayFocusMinutes: Number(todayFocus?.todayMins) || 0,
    todayFocusSessions: Number(todayFocus?.todaySessions) || 0,
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
  if (err.message && err.message.includes("CORS")) {
    return res.status(403).json({ message: "طلب مرفوض بواسطة سياسة CORS" });
  }
  const status = err.status || 500;
  const message = (isProd && status === 500)
    ? "حدث خطأ غير متوقع في الخادم"
    : (err.message || "حدث خطأ غير متوقع في الخادم");
  res.status(status).json({ message });
});

// Periodic WAL checkpoint for SQLite
setInterval(async () => {
  await db.checkpoint();
}, 30000);

async function shutdown() {
  try {
    await db.close();
    console.log("StudyFlow database connection safely closed.");
  } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen(PORT, () => console.log(`StudyFlow API v4: http://localhost:${PORT}`));
