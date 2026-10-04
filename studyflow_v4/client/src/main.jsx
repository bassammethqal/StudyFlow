import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const API = import.meta.env.VITE_API_URL || (window.location.protocol.startsWith("http") ? "/api" : "http://localhost:4000/api");

async function api(path, opt = {}) {
  const token = localStorage.getItem("sf_token");
  try {
    const r = await fetch(API + path, {
      ...opt,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(opt.headers || {})
      }
    });
    if (r.status === 401) {
      const err = new Error("UNAUTHORIZED");
      err.status = 401;
      throw err;
    }
    if (!r.ok) {
      const x = await r.json().catch(() => ({ message: "حدث خطأ" }));
      throw new Error(x.message || "حدث خطأ في الخادم");
    }
    return r.status === 204 ? null : r.json();
  } catch (err) {
    throw err;
  }
}

const priorityLabel = { high: "عالية", medium: "متوسطة", low: "منخفضة" };
const ARABIC_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function getTodayArabicDay() {
  const dayIndex = new Date().getDay(); // 0 is Sunday
  return ARABIC_DAYS[dayIndex];
}

function getTodayIsoDate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRelativeDateStr(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTaskDateStatus(dueDate, done) {
  if (!dueDate) return null;
  const today = getTodayIsoDate();
  const tomorrow = getRelativeDateStr(1);
  if (done) {
    return { type: "normal", text: dueDate };
  }
  if (dueDate < today) {
    const d1 = new Date(today);
    const d2 = new Date(dueDate);
    const diffDays = Math.max(1, Math.round((d1 - d2) / (1000 * 60 * 60 * 24)));
    return {
      type: "overdue",
      text: diffDays === 1 ? "متأخرة منذ يوم ⚠️" : diffDays === 2 ? "متأخرة منذ يومين ⚠️" : `متأخرة منذ ${diffDays} أيام ⚠️`
    };
  }
  if (dueDate === today) {
    return { type: "today", text: "تُستحق اليوم 📅" };
  }
  if (dueDate === tomorrow) {
    return { type: "tomorrow", text: "تُستحق غداً" };
  }
  return { type: "future", text: dueDate };
}

function formatTime12(timeStr) {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  let h = parseInt(parts[0], 10);
  const m = parts[1] || "00";
  const ampm = h >= 12 ? "م" : "ص";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function playChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const playTone = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    };
    playTone(523.25, now, 0.5);        // C5
    playTone(659.25, now + 0.15, 0.5); // E5
    playTone(783.99, now + 0.3, 0.8);  // G5
  } catch (e) {
    console.warn("Audio chime:", e);
  }
}

function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const [devCode, setDevCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get("email");
    const codeParam = params.get("code");
    if (emailParam) setResetEmail(emailParam);
    if (codeParam) setResetCode(codeParam);
    if (emailParam && codeParam) {
      setMode("reset");
    }
  }, []);

  function switchMode(newMode) {
    setMode(newMode);
    setErr("");
    setSuccess("");
    setDevCode("");
  }

  async function handleAuth() {
    setErr("");
    setSuccess("");
    setBusy(true);
    try {
      const endpoint = mode === "register" ? "/auth/register" : "/auth/login";
      const x = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(f)
      });
      localStorage.setItem("sf_token", x.token);
      localStorage.setItem("sf_user", JSON.stringify(x.user));
      onLogin(x.user);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    if (!resetEmail.trim()) {
      setErr("الرجاء إدخال البريد الإلكتروني");
      return;
    }
    setErr("");
    setSuccess("");
    setDevCode("");
    setBusy(true);
    try {
      const res = await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: resetEmail.trim() })
      });
      setSuccess(res.message);
      if (res.devCode) {
        setDevCode(res.devCode);
        setResetCode(res.devCode);
      }
      setMode("reset");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword() {
    if (!resetEmail.trim() || !resetCode.trim() || !newPassword) {
      setErr("الرجاء إدخال البريد الإلكتروني ورمز التحقق وكلمة المرور الجديدة");
      return;
    }
    if (newPassword.length < 6) {
      setErr("كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErr("كلمتا المرور غير متطابقتين");
      return;
    }
    setErr("");
    setSuccess("");
    setBusy(true);
    try {
      const res = await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          email: resetEmail.trim(),
          code: resetCode.trim(),
          newPassword
        })
      });
      setSuccess(res.message);
      setF({ ...f, email: resetEmail, password: "" });
      setMode("login");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="authbox">
        <div className="brand">Study<span>Flow</span></div>

        {mode === "login" && (
          <>
            <p>منصة دراسية متكاملة تساعدك على تنظيم يومك ومتابعة تقدمك بذكاء.</p>
            {success && <div className="success-msg">{success}</div>}
            <input
              placeholder="البريد الإلكتروني"
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
            <input
              type="password"
              placeholder="كلمة المرور"
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
            {err && <div className="err">{err}</div>}
            <button className="primary wide" disabled={busy} onClick={handleAuth}>
              {busy ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}
            </button>
            <div className="auth-links">
              <button
                className="link"
                onClick={() => {
                  setResetEmail(f.email);
                  switchMode("forgot");
                }}
              >
                هل نسيت كلمة المرور؟
              </button>
              <button className="link" onClick={() => switchMode("register")}>
                إنشاء حساب جديد
              </button>
            </div>
          </>
        )}

        {mode === "register" && (
          <>
            <p>أنشئ حسابك وابدأ تنظيم دراستك، ومحاضراتك، وجلسات تركيزك اليومية.</p>
            <input
              autoFocus
              placeholder="الاسم الكامل"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
            <input
              placeholder="البريد الإلكتروني"
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
            <input
              type="password"
              placeholder="كلمة المرور (6 أحرف على الأقل)"
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
            {err && <div className="err">{err}</div>}
            <button className="primary wide" disabled={busy} onClick={handleAuth}>
              {busy ? "جارٍ إنشاء الحساب..." : "إنشاء حساب"}
            </button>
            <div className="auth-links">
              <button className="link" onClick={() => switchMode("login")}>
                لدي حساب بالفعل (تسجيل الدخول)
              </button>
            </div>
          </>
        )}

        {mode === "forgot" && (
          <>
            <h3>استعادة كلمة المرور</h3>
            <p>أدخل بريدك الإلكتروني وسنرسل لك رمز تحقق لتغيير كلمة المرور.</p>
            <input
              autoFocus
              placeholder="البريد الإلكتروني"
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleForgotPassword()}
            />
            {err && <div className="err">{err}</div>}
            <button className="primary wide" disabled={busy} onClick={handleForgotPassword}>
              {busy ? "جارٍ إرسال الرمز..." : "إرسال رمز التحقق"}
            </button>
            <div className="auth-links">
              <button className="link" onClick={() => switchMode("login")}>
                ← العودة لتسجيل الدخول
              </button>
            </div>
          </>
        )}

        {mode === "reset" && (
          <>
            <h3>تغيير كلمة المرور</h3>
            <p>أدخل رمز التحقق المكون من 6 أرقام وكلمة المرور الجديدة.</p>
            {success && <div className="success-msg">{success}</div>}
            {devCode && (
              <div className="dev-notice">
                💡 <b>رمز التحقق:</b> {devCode}
              </div>
            )}
            <input
              placeholder="البريد الإلكتروني"
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
            />
            <input
              placeholder="رمز التحقق (6 أرقام)"
              value={resetCode}
              maxLength={6}
              onChange={(e) => setResetCode(e.target.value)}
              style={{ letterSpacing: "4px", textAlign: "center", fontWeight: "bold", fontSize: "16px" }}
            />
            <input
              type="password"
              placeholder="كلمة المرور الجديدة (6 أحرف على الأقل)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              type="password"
              placeholder="تأكيد كلمة المرور الجديدة"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleResetPassword()}
            />
            {err && <div className="err">{err}</div>}
            <button className="primary wide" disabled={busy} onClick={handleResetPassword}>
              {busy ? "جارٍ تحديث كلمة المرور..." : "تأكيد وتغيير كلمة المرور"}
            </button>
            <div className="auth-links">
              <button className="link" onClick={() => switchMode("forgot")}>
                إعادة إرسال رمز جديد
              </button>
              <button className="link" onClick={() => switchMode("login")}>
                إلغاء والعودة
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function App({ user, onLogout }) {
  const [currentUser, setCurrentUser] = useState(user);
  const [page, setPage] = useState("dashboard");
  const [tasks, setTasks] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [stats, setStats] = useState({});
  const [profile, setProfile] = useState(null);
  const [dark, setDark] = useState(localStorage.getItem("sf_dark") === "1");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  // Task form state
  const [task, setTask] = useState({
    name: "",
    tag: "عام",
    priority: "medium",
    dueDate: "",
    estimatedMinutes: 30,
    subjectId: ""
  });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editingTask, setEditingTask] = useState(null);

  // Subject form & edit modal state
  const [subject, setSubject] = useState({ name: "", code: "", progress: 0 });
  const [editingSubject, setEditingSubject] = useState(null);

  // Schedule form & edit modal state
  const [sch, setSch] = useState({
    subject: "",
    day: getTodayArabicDay(),
    startTime: "09:00",
    endTime: "10:30",
    room: ""
  });
  const [editingSchedule, setEditingSchedule] = useState(null);

  // Profile edit states
  const [editName, setEditName] = useState(user.name);
  const [pwdForm, setPwdForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });

  // Focus Pomodoro states
  const [focusMode, setFocusMode] = useState("pomodoro"); // pomodoro | shortBreak | longBreak
  const [focusDuration, setFocusDuration] = useState(25); // minutes
  const [sec, setSec] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [focusSubjectId, setFocusSubjectId] = useState("");
  const [focusTaskId, setFocusTaskId] = useState("");

  const load = async () => {
    try {
      const [a, b, c, d, e] = await Promise.all([
        api("/tasks"),
        api("/subjects"),
        api("/schedule"),
        api("/profile"),
        api("/stats")
      ]);
      setTasks(a);
      setSubjects(b);
      setSchedule(c);
      setProfile(d);
      setStats(e);
      if (d?.name) {
        setEditName(d.name);
        setCurrentUser((prev) => ({ ...prev, name: d.name }));
      }
    } catch (err) {
      if (err.status === 401 || err.message === "UNAUTHORIZED") {
        onLogout();
      } else {
        note(err.message || "تعذر الاتصال بالخادم");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Pomodoro countdown effect
  useEffect(() => {
    if (!running) return;
    const x = setInterval(() => {
      setSec((s) => {
        if (s <= 1) {
          setRunning(false);
          playChime();
          handleFocusSessionComplete();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(x);
  }, [running, focusMode, focusDuration, focusSubjectId, focusTaskId]);

  async function handleFocusSessionComplete() {
    if (focusMode === "pomodoro") {
      note("🎉 أحسنت! اكتملت جلسة التركيز بنجاح وتم تسجيل وقت دراستك!");
      try {
        await api("/focus", {
          method: "POST",
          body: JSON.stringify({
            durationMinutes: focusDuration,
            subjectId: focusSubjectId ? Number(focusSubjectId) : null,
            taskId: focusTaskId ? Number(focusTaskId) : null,
            markTaskDone: false
          })
        });
        refreshStats();
      } catch (e) {
        console.error("Focus log error:", e);
      }
    } else {
      note("☕ انتهت فترة الاستراحة! هل أنت مستعد للتركيز مجدداً؟");
    }
  }

  function changeFocusMode(mode, defaultMins) {
    setRunning(false);
    setFocusMode(mode);
    setFocusDuration(defaultMins);
    setSec(defaultMins * 60);
  }

  function setCustomFocusDuration(mins) {
    setRunning(false);
    setFocusDuration(mins);
    setSec(mins * 60);
  }

  function note(x) {
    setToast(x);
    setTimeout(() => setToast(""), 2600);
  }

  function go(p) {
    setPage(p);
  }

  async function refreshStats() {
    try {
      const [s, p] = await Promise.all([api("/stats"), api("/profile")]);
      setStats(s);
      setProfile(p);
    } catch {}
  }

  // --- Task Handlers ---
  async function addTask() {
    if (!task.name.trim()) return note("اكتب اسم المهمة أولاً");
    try {
      const x = await api("/tasks", {
        method: "POST",
        body: JSON.stringify({
          ...task,
          estimatedMinutes: Number(task.estimatedMinutes) || 30,
          subjectId: task.subjectId ? Number(task.subjectId) : null
        })
      });
      setTasks([x, ...tasks]);
      setTask({
        name: "",
        tag: "عام",
        priority: "medium",
        dueDate: "",
        estimatedMinutes: 30,
        subjectId: ""
      });
      note("تمت إضافة المهمة ✓");
      refreshStats();
    } catch (e) {
      note(e.message);
    }
  }

  async function toggle(t) {
    try {
      const x = await api("/tasks/" + t.id, {
        method: "PATCH",
        body: JSON.stringify({ done: !t.done })
      });
      setTasks(tasks.map((a) => (a.id === t.id ? x : a)));
      refreshStats();
    } catch (e) {
      note(e.message);
    }
  }

  async function removeTask(id) {
    if (!confirm("حذف هذه المهمة نهائياً؟")) return;
    try {
      await api("/tasks/" + id, { method: "DELETE" });
      setTasks(tasks.filter((x) => x.id !== id));
      note("تم حذف المهمة");
      refreshStats();
    } catch (e) {
      note(e.message);
    }
  }

  function startEditTask(t) {
    setEditingTask({
      id: t.id,
      name: t.name,
      tag: t.tag || "عام",
      priority: t.priority || "medium",
      dueDate: t.dueDate || "",
      estimatedMinutes: t.estimatedMinutes || 30,
      subjectId: t.subjectId || ""
    });
  }

  async function updateTask() {
    if (!editingTask || !editingTask.name.trim()) return note("اكتب اسم المهمة أولاً");
    try {
      const x = await api("/tasks/" + editingTask.id, {
        method: "PATCH",
        body: JSON.stringify({
          name: editingTask.name,
          tag: editingTask.tag,
          priority: editingTask.priority,
          dueDate: editingTask.dueDate || null,
          estimatedMinutes: Number(editingTask.estimatedMinutes) || 30,
          subjectId: editingTask.subjectId ? Number(editingTask.subjectId) : null
        })
      });
      setTasks(tasks.map((a) => (a.id === editingTask.id ? x : a)));
      setEditingTask(null);
      note("تم تعديل المهمة ✓");
      refreshStats();
    } catch (e) {
      note(e.message);
    }
  }

  async function clearCompletedTasks() {
    if (!confirm("هل تريد مسح جميع المهام المكتملة؟")) return;
    try {
      const res = await api("/tasks", { method: "DELETE" });
      setTasks(tasks.filter((t) => !t.done));
      note(`تم مسح ${res.removed || 0} مهمة مكتملة`);
      refreshStats();
    } catch (e) {
      note(e.message);
    }
  }

  // --- Subject Handlers ---
  async function addSubject() {
    if (!subject.name.trim()) return note("اكتب اسم المادة");
    try {
      const x = await api("/subjects", {
        method: "POST",
        body: JSON.stringify({
          name: subject.name.trim(),
          code: subject.code.trim(),
          progress: Number(subject.progress) || 0
        })
      });
      setSubjects([...subjects, { ...x, totalTasks: 0, completedTasks: 0, taskProgress: 0 }]);
      setSubject({ name: "", code: "", progress: 0 });
      note("تمت إضافة المادة ✓");
      refreshStats();
    } catch (e) {
      note(e.message);
    }
  }

  function startEditSubject(s) {
    setEditingSubject({
      id: s.id,
      name: s.name,
      code: s.code || "",
      progress: s.progress || 0
    });
  }

  async function saveSubjectEdit() {
    if (!editingSubject || !editingSubject.name.trim()) return note("اسم المادة مطلوب");
    try {
      const x = await api("/subjects/" + editingSubject.id, {
        method: "PATCH",
        body: JSON.stringify({
          name: editingSubject.name.trim(),
          code: editingSubject.code.trim(),
          progress: Number(editingSubject.progress) || 0
        })
      });
      setSubjects(subjects.map((s) => (s.id === editingSubject.id ? { ...s, ...x } : s)));
      setEditingSubject(null);
      note("تم تعديل المادة ✓");
      refreshStats();
    } catch (e) {
      note(e.message);
    }
  }

  async function removeSubject(id) {
    if (!confirm("حذف هذه المادة؟ المهام المرتبطة بها ستبقى بدون مادة.")) return;
    try {
      await api("/subjects/" + id, { method: "DELETE" });
      setSubjects(subjects.filter((x) => x.id !== id));
      setTasks(
        tasks.map((t) =>
          t.subjectId === id ? { ...t, subjectId: null, subjectName: null } : t
        )
      );
      refreshStats();
      note("تم حذف المادة");
    } catch (e) {
      note(e.message);
    }
  }

  // --- Schedule Handlers ---
  async function addSchedule() {
    if (!sch.subject.trim()) return note("اكتب أو اختر اسم المادة للحصة");
    if (sch.startTime >= sch.endTime) return note("وقت النهاية يجب أن يكون بعد وقت البداية");
    try {
      const x = await api("/schedule", {
        method: "POST",
        body: JSON.stringify(sch)
      });
      setSchedule([...schedule, x]);
      setSch({
        subject: "",
        day: sch.day,
        startTime: "09:00",
        endTime: "10:30",
        room: ""
      });
      note("تمت إضافة الحصة في الجدول ✓");
    } catch (e) {
      note(e.message);
    }
  }

  function startEditSchedule(x) {
    setEditingSchedule({
      id: x.id,
      subject: x.subject,
      day: x.day,
      startTime: x.startTime,
      endTime: x.endTime,
      room: x.room || ""
    });
  }

  async function saveScheduleEdit() {
    if (!editingSchedule || !editingSchedule.subject.trim()) return note("اسم المادة مطلوب");
    if (editingSchedule.startTime >= editingSchedule.endTime) {
      return note("وقت النهاية يجب أن يكون بعد وقت البداية");
    }
    try {
      const res = await api("/schedule/" + editingSchedule.id, {
        method: "PATCH",
        body: JSON.stringify(editingSchedule)
      });
      setSchedule(schedule.map((x) => (x.id === editingSchedule.id ? res : x)));
      setEditingSchedule(null);
      note("تم تعديل بيانات الحصة ✓");
    } catch (e) {
      note(e.message);
    }
  }

  async function removeSchedule(id) {
    if (!confirm("حذف هذه الحصة من الجدول؟")) return;
    try {
      await api("/schedule/" + id, { method: "DELETE" });
      setSchedule(schedule.filter((x) => x.id !== id));
      note("تم حذف الحصة");
    } catch (e) {
      note(e.message);
    }
  }

  // --- Profile Handlers ---
  async function saveProfile() {
    if (!editName.trim()) return note("الاسم مطلوب");
    try {
      const x = await api("/profile", {
        method: "PATCH",
        body: JSON.stringify({ name: editName.trim() })
      });
      setProfile({ ...profile, ...x });
      const u = { ...currentUser, name: x.name };
      setCurrentUser(u);
      localStorage.setItem("sf_user", JSON.stringify(u));
      note("تم تحديث الاسم بنجاح ✓");
    } catch (e) {
      note(e.message);
    }
  }

  async function handleChangePassword() {
    if (!pwdForm.currentPassword || !pwdForm.newPassword) {
      return note("الرجاء إدخال كلمة المرور الحالية والجديدة");
    }
    if (pwdForm.newPassword.length < 6) {
      return note("كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف");
    }
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      return note("كلمتا المرور الجديدتان غير متطابقتين");
    }
    try {
      const res = await api("/profile/password", {
        method: "PATCH",
        body: JSON.stringify({
          currentPassword: pwdForm.currentPassword,
          newPassword: pwdForm.newPassword
        })
      });
      note(res.message || "تم تغيير كلمة المرور بنجاح ✓");
      setPwdForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (e) {
      note(e.message);
    }
  }

  // Filtering tasks
  const todayStr = getTodayIsoDate();
  const done = tasks.filter((t) => t.done).length;

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filter === "open" && t.done) return false;
      if (filter === "done" && !t.done) return false;
      if (filter === "overdue" && (t.done || !t.dueDate || t.dueDate >= todayStr)) return false;
      if (filter === "today" && (t.done || t.dueDate !== todayStr)) return false;
      if (["high", "medium", "low"].includes(filter) && t.priority !== filter) return false;

      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        (t.name || "").toLowerCase().includes(q) ||
        (t.tag || "").toLowerCase().includes(q) ||
        (t.subjectName || "").toLowerCase().includes(q)
      );
    });
  }, [tasks, search, filter, todayStr]);

  const nav = [
    ["dashboard", "⌂", "لوحة التحكم"],
    ["tasks", "✓", "المهام"],
    ["subjects", "◫", "المواد"],
    ["schedule", "▦", "الجدول"],
    ["focus", "◷", "التركيز"],
    ["stats", "▣", "الإحصائيات"],
    ["profile", "●", "الملف الشخصي"]
  ];

  if (loading) return <div className="loading">جاري تجهيز StudyFlow...</div>;

  return (
    <div className={dark ? "app dark" : "app"}>
      <aside>
        <div className="logo">
          Study<span>Flow</span>
          <small>Student OS</small>
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n[0]}
              className={page === n[0] ? "active" : ""}
              onClick={() => go(n[0])}
            >
              <b>{n[1]}</b>
              {n[2]}
            </button>
          ))}
        </nav>
        <div className="side">
          <div className="avatar mini">{currentUser.name ? currentUser.name[0] : "؟"}</div>
          <div>
            <b>{currentUser.name}</b>
            <small>{currentUser.email}</small>
          </div>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="eyebrow">STUDYFLOW 4.1</div>
            <h1>
              {page === "dashboard"
                ? `مرحباً، ${currentUser.name} 👋`
                : nav.find((n) => n[0] === page)?.[2]}
            </h1>
            <small>
              {page === "dashboard"
                ? "نظّم دراستك، وخلّ الإنجاز عادة يومية."
                : "كل أدواتك الدراسية في مكان واحد بتنظيم واقعي."}
            </small>
          </div>
          <div className="header-actions">
            <button
              className="ghost"
              title="الوضع الليلي"
              onClick={() => {
                setDark(!dark);
                localStorage.setItem("sf_dark", !dark ? "1" : "0");
              }}
            >
              {dark ? "☀" : "☾"}
            </button>
            <button className="ghost logout" onClick={onLogout}>
              ↪ خروج
            </button>
          </div>
        </header>

        {page === "dashboard" && (
          <Dashboard
            tasks={tasks}
            done={done}
            subjects={subjects}
            schedule={schedule}
            stats={stats}
            go={go}
            toggle={toggle}
          />
        )}

        {page === "tasks" && (
          <section className="card">
            <div className="sectionhead">
              <div>
                <h2>إدارة المهام الدراسية</h2>
                <p>حوّل المطلوب منك إلى خطوات واضحة ومحددة المواعيد والأولويات.</p>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span className="pill">
                  {done}/{tasks.length} مكتملة
                </span>
                {done > 0 && (
                  <button className="ghost" style={{ fontSize: "12px", padding: "6px 10px" }} onClick={clearCompletedTasks}>
                    مسح المكتملة ({done})
                  </button>
                )}
              </div>
            </div>

            <div className="form taskform">
              <input
                value={task.name}
                onChange={(e) => setTask({ ...task, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addTask()}
                placeholder="اسم المهمة — مثلاً: حل واجب قواعد البيانات"
              />
              <input
                value={task.tag}
                onChange={(e) => setTask({ ...task, tag: e.target.value })}
                placeholder="التصنيف (واجب، مذاكرة...)"
              />
              <select
                value={task.priority}
                onChange={(e) => setTask({ ...task, priority: e.target.value })}
              >
                <option value="high">أولوية عالية 🔥</option>
                <option value="medium">أولوية متوسطة ⚡</option>
                <option value="low">أولوية منخفضة ☕</option>
              </select>
              <select
                value={task.subjectId}
                onChange={(e) => setTask({ ...task, subjectId: e.target.value })}
              >
                <option value="">بدون مادة محددة</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.code ? `(${s.code})` : ""}
                  </option>
                ))}
              </select>
              <div>
                <input
                  type="date"
                  value={task.dueDate}
                  onChange={(e) => setTask({ ...task, dueDate: e.target.value })}
                  title="تاريخ الاستحقاق"
                />
                <div className="quick-dates">
                  <span>سريع:</span>
                  <button type="button" className="quick-date-btn" onClick={() => setTask({ ...task, dueDate: getTodayIsoDate() })}>
                    اليوم
                  </button>
                  <button type="button" className="quick-date-btn" onClick={() => setTask({ ...task, dueDate: getRelativeDateStr(1) })}>
                    غداً
                  </button>
                  <button type="button" className="quick-date-btn" onClick={() => setTask({ ...task, dueDate: getRelativeDateStr(3) })}>
                    +3 أيام
                  </button>
                </div>
              </div>
              <input
                type="number"
                min="5"
                max="600"
                value={task.estimatedMinutes}
                onChange={(e) => setTask({ ...task, estimatedMinutes: e.target.value })}
                placeholder="الوقت (دقيقة)"
              />
              <button className="primary" onClick={addTask}>
                + إضافة
              </button>
            </div>

            <div className="toolbar">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="⌕ ابحث في المهام حسب الاسم، المادة، أو التصنيف..."
              />
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">كل المهام ({tasks.length})</option>
                <option value="open">غير مكتملة ({tasks.filter((t) => !t.done).length})</option>
                <option value="overdue">⚠️ متأخرة ({stats.overdueTasks || 0})</option>
                <option value="today">📅 مهام اليوم ({stats.dueToday || 0})</option>
                <option value="done">مكتملة ({done})</option>
                <option value="high">أولوية عالية</option>
                <option value="medium">أولوية متوسطة</option>
                <option value="low">أولوية منخفضة</option>
              </select>
            </div>

            {editingTask && (
              <div className="card edit-modal" style={{ margin: "15px 0", padding: "18px" }}>
                <div className="sectionhead">
                  <h3>تعديل المهمة</h3>
                </div>
                <div className="form taskform">
                  <input
                    value={editingTask.name}
                    onChange={(e) => setEditingTask({ ...editingTask, name: e.target.value })}
                    placeholder="اسم المهمة"
                  />
                  <input
                    value={editingTask.tag}
                    onChange={(e) => setEditingTask({ ...editingTask, tag: e.target.value })}
                    placeholder="التصنيف"
                  />
                  <select
                    value={editingTask.priority}
                    onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value })}
                  >
                    <option value="high">أولوية عالية</option>
                    <option value="medium">أولوية متوسطة</option>
                    <option value="low">أولوية منخفضة</option>
                  </select>
                  <select
                    value={editingTask.subjectId}
                    onChange={(e) => setEditingTask({ ...editingTask, subjectId: e.target.value })}
                  >
                    <option value="">بدون مادة</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={editingTask.dueDate}
                    onChange={(e) => setEditingTask({ ...editingTask, dueDate: e.target.value })}
                  />
                  <input
                    type="number"
                    min="5"
                    max="600"
                    value={editingTask.estimatedMinutes}
                    onChange={(e) => setEditingTask({ ...editingTask, estimatedMinutes: e.target.value })}
                    placeholder="الدقائق"
                  />
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button className="primary" onClick={updateTask}>
                      حفظ
                    </button>
                    <button className="ghost" onClick={() => setEditingTask(null)}>
                      إلغاء
                    </button>
                  </div>
                </div>
              </div>
            )}

            <TaskList
              tasks={filteredTasks}
              toggle={toggle}
              remove={removeTask}
              onEdit={startEditTask}
            />
          </section>
        )}

        {page === "subjects" && (
          <section className="card">
            <div className="sectionhead">
              <div>
                <h2>المواد والمقررات الدراسية</h2>
                <p>متابعة متقدمة تجمع بين تقدم المنهج الدراسي وإنجاز الواجبات والمهام المرتبطة بكل مادة.</p>
              </div>
            </div>
            <div className="form">
              <input
                value={subject.name}
                onChange={(e) => setSubject({ ...subject, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addSubject()}
                placeholder="اسم المادة (مثلاً: قواعد البيانات)"
              />
              <input
                value={subject.code}
                onChange={(e) => setSubject({ ...subject, code: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addSubject()}
                placeholder="رمز المادة (مثلاً: CS201)"
              />
              <input
                type="number"
                min="0"
                max="100"
                value={subject.progress}
                onChange={(e) => setSubject({ ...subject, progress: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addSubject()}
                placeholder="تقدم المنهج %"
              />
              <button className="primary" onClick={addSubject}>
                + إضافة المادة
              </button>
            </div>

            {subjects.length === 0 && (
              <div className="empty large">
                لم تُضف أي مادة بعد. اكتب اسم مقررك الدراسي ورمزه (بحسب قسمك وتخصصك) في النموذج أعلاه ثم اضغط «+ إضافة المادة».
              </div>
            )}

            <div className="subjectgrid">
              {subjects.map((s) => (
                <div className="subjectbox" key={s.id}>
                  <div className="row">
                    <div>
                      <b>{s.name}</b>
                      <small>{s.code ? `رمز: ${s.code}` : "بدون رمز"}</small>
                    </div>
                    <strong>{s.progress}% منهج</strong>
                  </div>

                  <div className="bar" title={`تقدم المنهج: ${s.progress}%`}>
                    <em style={{ width: s.progress + "%" }} />
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--muted)", margin: "4px 0 12px" }}>
                    <span>
                      📋 إنجاز المهام: <b>{s.completedTasks || 0}/{s.totalTasks || 0}</b>
                    </span>
                    <span>{s.taskProgress || 0}% مهام</span>
                  </div>

                  <div className="row actions">
                    <button className="link" onClick={() => startEditSubject(s)}>
                      ✎ تعديل المادة
                    </button>
                    <button
                      className="link"
                      onClick={() => {
                        setSearch(s.name);
                        go("tasks");
                      }}
                    >
                      عرض المهام →
                    </button>
                    <button className="dangerlink" onClick={() => removeSubject(s.id)}>
                      حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {editingSubject && (
              <div className="modal-overlay" onClick={() => setEditingSubject(null)}>
                <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-head">
                    <h3>تعديل بيانات المادة</h3>
                    <button className="ghost" onClick={() => setEditingSubject(null)}>×</button>
                  </div>
                  <div className="modal-body">
                    <div>
                      <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>اسم المادة:</label>
                      <input
                        value={editingSubject.name}
                        onChange={(e) => setEditingSubject({ ...editingSubject, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>رمز المادة (اختياري):</label>
                      <input
                        value={editingSubject.code}
                        onChange={(e) => setEditingSubject({ ...editingSubject, code: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>نسبة تقدم المنهج:</label>
                      <div className="range-wrapper">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={editingSubject.progress}
                          onChange={(e) => setEditingSubject({ ...editingSubject, progress: Number(e.target.value) })}
                        />
                        <span>{editingSubject.progress}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="modal-foot">
                    <button className="secondary-btn" onClick={() => setEditingSubject(null)}>إلغاء</button>
                    <button className="primary" onClick={saveSubjectEdit}>حفظ التعديلات</button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {page === "schedule" && (
          <section className="card">
            <div className="sectionhead">
              <div>
                <h2>الجدول الأسبوعي للمحاضرات</h2>
                <p>رتّب أوقات حصصك ومحاضراتك الأسبوعية، مع إبراز جدول اليوم تلقائياً.</p>
              </div>
            </div>

            <div className="form wrap">
              <div style={{ flex: "2", minWidth: "180px" }}>
                <input
                  list="subjects-datalist"
                  value={sch.subject}
                  onChange={(e) => setSch({ ...sch, subject: e.target.value })}
                  placeholder="المادة (اكتب أو اختر من القائمة)"
                />
                <datalist id="subjects-datalist">
                  {subjects.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </div>

              <select
                value={sch.day}
                onChange={(e) => setSch({ ...sch, day: e.target.value })}
                style={{ flex: "1", minWidth: "120px" }}
              >
                {ARABIC_DAYS.map((x) => (
                  <option key={x} value={x}>
                    {x} {x === getTodayArabicDay() ? "(اليوم)" : ""}
                  </option>
                ))}
              </select>

              <input
                type="time"
                value={sch.startTime}
                onChange={(e) => setSch({ ...sch, startTime: e.target.value })}
                title="وقت البداية"
                style={{ flex: "1", minWidth: "110px" }}
              />

              <input
                type="time"
                value={sch.endTime}
                onChange={(e) => setSch({ ...sch, endTime: e.target.value })}
                title="وقت النهاية"
                style={{ flex: "1", minWidth: "110px" }}
              />

              <input
                value={sch.room}
                onChange={(e) => setSch({ ...sch, room: e.target.value })}
                placeholder="القاعة أو الرابط"
                style={{ flex: "1.2", minWidth: "140px" }}
              />

              <button className="primary" onClick={addSchedule}>
                + إضافة للجدول
              </button>
            </div>

            <div className="weekgrid">
              {ARABIC_DAYS.map((day) => {
                const isToday = day === getTodayArabicDay();
                const daySlots = schedule.filter((x) => x.day === day);
                return (
                  <div className={isToday ? "daycol is-today" : "daycol"} key={day}>
                    <h3>
                      {day}
                      {isToday && <span className="day-badge-today">اليوم</span>}
                    </h3>
                    {daySlots.map((x) => (
                      <div className="slot" key={x.id}>
                        <div className="slot-actions">
                          <button className="slot-btn" title="تعديل الحصة" onClick={() => startEditSchedule(x)}>
                            ✎
                          </button>
                          <button className="slot-btn danger" title="حذف" onClick={() => removeSchedule(x.id)}>
                            ×
                          </button>
                        </div>
                        <strong>{x.subject}</strong>
                        <span>
                          {formatTime12(x.startTime)} — {formatTime12(x.endTime)}
                        </span>
                        <small>{x.room || "بدون قاعة محددة"}</small>
                      </div>
                    ))}
                    {daySlots.length === 0 && <div className="empty">لا توجد حصص</div>}
                  </div>
                );
              })}
            </div>

            {editingSchedule && (
              <div className="modal-overlay" onClick={() => setEditingSchedule(null)}>
                <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-head">
                    <h3>تعديل موعد الحصة</h3>
                    <button className="ghost" onClick={() => setEditingSchedule(null)}>×</button>
                  </div>
                  <div className="modal-body">
                    <div>
                      <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>اسم المادة:</label>
                      <input
                        value={editingSchedule.subject}
                        onChange={(e) => setEditingSchedule({ ...editingSchedule, subject: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>اليوم:</label>
                      <select
                        value={editingSchedule.day}
                        onChange={(e) => setEditingSchedule({ ...editingSchedule, day: e.target.value })}
                      >
                        {ARABIC_DAYS.map((x) => (
                          <option key={x} value={x}>{x}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <div>
                        <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>وقت البداية:</label>
                        <input
                          type="time"
                          value={editingSchedule.startTime}
                          onChange={(e) => setEditingSchedule({ ...editingSchedule, startTime: e.target.value })}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>وقت النهاية:</label>
                        <input
                          type="time"
                          value={editingSchedule.endTime}
                          onChange={(e) => setEditingSchedule({ ...editingSchedule, endTime: e.target.value })}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>القاعة أو الرابط:</label>
                      <input
                        value={editingSchedule.room}
                        onChange={(e) => setEditingSchedule({ ...editingSchedule, room: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="modal-foot">
                    <button className="secondary-btn" onClick={() => setEditingSchedule(null)}>إلغاء</button>
                    <button className="primary" onClick={saveScheduleEdit}>حفظ التعديلات</button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {page === "focus" && (
          <section className="focuspage">
            <div className="card focus">
              <div className="focus-modes">
                <button
                  className={focusMode === "pomodoro" ? "focus-mode-btn active" : "focus-mode-btn"}
                  onClick={() => changeFocusMode("pomodoro", 25)}
                >
                  🎯 تركيز دراسي
                </button>
                <button
                  className={focusMode === "shortBreak" ? "focus-mode-btn active" : "focus-mode-btn"}
                  onClick={() => changeFocusMode("shortBreak", 5)}
                >
                  ☕ استراحة قصيرة (5د)
                </button>
                <button
                  className={focusMode === "longBreak" ? "focus-mode-btn active" : "focus-mode-btn"}
                  onClick={() => changeFocusMode("longBreak", 15)}
                >
                  🌿 استراحة طويلة (15د)
                </button>
              </div>

              <h2>
                {focusMode === "pomodoro"
                  ? `${focusDuration} دقيقة تركيز عميق`
                  : focusMode === "shortBreak"
                  ? "استراحة قصيرة وممتعة"
                  : "استراحة طويلة لتجديد النشاط"}
              </h2>

              <p>
                {focusMode === "pomodoro"
                  ? "اختر مهمة أو مادة، وركز دون أي تشتيت. عند انتهاء المؤقت سينبهك الصوت ويُسجَّل وقتك تلقائياً."
                  : "خذ نفساً عميقاً، اشرب بعض الماء، وابتعد قليلاً عن الشاشة."}
              </p>

              {focusMode === "pomodoro" && (
                <div className="focus-presets">
                  <button
                    className={focusDuration === 25 ? "active" : ""}
                    onClick={() => setCustomFocusDuration(25)}
                  >
                    25 دقيقة
                  </button>
                  <button
                    className={focusDuration === 45 ? "active" : ""}
                    onClick={() => setCustomFocusDuration(45)}
                  >
                    45 دقيقة
                  </button>
                  <button
                    className={focusDuration === 50 ? "active" : ""}
                    onClick={() => setCustomFocusDuration(50)}
                  >
                    50 دقيقة
                  </button>
                </div>
              )}

              {focusMode === "pomodoro" && (
                <div className="focus-link-select">
                  <select
                    value={focusSubjectId}
                    onChange={(e) => setFocusSubjectId(e.target.value)}
                  >
                    <option value="">ربط بمادة (اختياري)</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="timer">
                {String(Math.floor(sec / 60)).padStart(2, "0")}:
                {String(sec % 60).padStart(2, "0")}
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
                <button
                  className="primary"
                  style={{ minWidth: "140px", fontSize: "16px" }}
                  onClick={() => setRunning(!running)}
                >
                  {running ? "⏸ إيقاف مؤقت" : "▶ ابدأ الجلسة"}
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    setRunning(false);
                    setSec(focusDuration * 60);
                  }}
                >
                  ↺ إعادة ضبط
                </button>
              </div>

              <div style={{ marginTop: "32px", borderTop: "1px solid var(--line)", paddingTop: "20px", display: "flex", justifyContent: "space-around" }}>
                <div>
                  <b style={{ fontSize: "20px", color: "var(--brand)" }}>{stats.todayFocusSessions || 0}</b>
                  <small style={{ display: "block", color: "var(--muted)" }}>جلسات تركيز اليوم</small>
                </div>
                <div>
                  <b style={{ fontSize: "20px", color: "var(--brand)" }}>{stats.todayFocusMinutes || 0} د</b>
                  <small style={{ display: "block", color: "var(--muted)" }}>وقت تركيز اليوم</small>
                </div>
                <div>
                  <b style={{ fontSize: "20px", color: "var(--brand)" }}>{stats.studyHours || 0} س</b>
                  <small style={{ display: "block", color: "var(--muted)" }}>إجمالي وقت الدراسة</small>
                </div>
              </div>
            </div>
          </section>
        )}

        {page === "stats" && (
          <Stats stats={stats} tasks={tasks} subjects={subjects} />
        )}

        {page === "profile" && (
          <section className="card profile">
            <div className="avatar">{currentUser.name ? currentUser.name[0] : "؟"}</div>
            <h2>{profile?.name || currentUser.name}</h2>
            <p>{profile?.email || currentUser.email}</p>
            {profile?.createdAt && (
              <small style={{ color: "var(--muted)", display: "block", marginBottom: "15px" }}>
                عضو منذ: {profile.createdAt.slice(0, 10)}
              </small>
            )}
            <div className="form profileform">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveProfile()}
                placeholder="الاسم"
              />
              <button className="primary" onClick={saveProfile}>
                تعديل الاسم
              </button>
            </div>
            <div className="profilegrid">
              <div>
                <b>{stats.completedTasks || 0}</b>
                <small>مهام مكتملة</small>
              </div>
              <div>
                <b>{stats.focusSessionsCount || 0}</b>
                <small>جلسات تركيز منجزة</small>
              </div>
              <div>
                <b>{stats.studyHours || 0}h</b>
                <small>إجمالي ساعات الدراسة</small>
              </div>
              <div>
                <b>{subjects.length}</b>
                <small>مواد مسجلة</small>
              </div>
            </div>

            {/* Change Password Section */}
            <div style={{ marginTop: "35px", borderTop: "1px solid var(--line)", paddingTop: "25px", textAlign: "right" }}>
              <h3 style={{ marginBottom: "14px", fontSize: "16px" }}>🔒 تغيير كلمة المرور</h3>
              <div style={{ display: "grid", gap: "10px", maxWidth: "450px", margin: "0 auto" }}>
                <input
                  type="password"
                  placeholder="كلمة المرور الحالية"
                  value={pwdForm.currentPassword}
                  onChange={(e) => setPwdForm({ ...pwdForm, currentPassword: e.target.value })}
                />
                <input
                  type="password"
                  placeholder="كلمة المرور الجديدة (6 أحرف على الأقل)"
                  value={pwdForm.newPassword}
                  onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
                />
                <input
                  type="password"
                  placeholder="تأكيد كلمة المرور الجديدة"
                  value={pwdForm.confirmPassword}
                  onChange={(e) => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
                />
                <button className="secondary-btn" onClick={handleChangePassword}>
                  تحديث كلمة المرور
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Dashboard({ tasks, done, subjects, schedule, stats, go, toggle }) {
  const next = tasks.find((t) => !t.done);
  const todayArabic = getTodayArabicDay();
  const todayLectures = schedule.filter((x) => x.day === todayArabic);

  return (
    <>
      {stats.overdueTasks > 0 && (
        <div className="alert-banner">
          <div>
            ⚠️ <b>تنبيه المهام:</b> لديك <b>{stats.overdueTasks}</b> مهام متأخرة تجاوزت موعد تسليمها!
          </div>
          <button onClick={() => go("tasks")}>عرض المتأخرات →</button>
        </div>
      )}

      <section className="hero">
        <div>
          <span className="pill light">لوحة اليوم · {todayArabic}</span>
          <h2>{next ? `ابدأ بـ: ${next.name}` : "أحسنت! أنجزت كل مهامك اليوم 🎉"}</h2>
          <p>
            {done} من {tasks.length} مهام مكتملة — لديك اليوم {todayLectures.length} محاضرات مجدولة.
          </p>
          <div style={{ display: "flex", gap: "10px", marginTop: "15px" }}>
            <button className="heroBtn" onClick={() => go(next ? "tasks" : "stats")}>
              {next ? "إدارة المهام" : "عرض الإحصائيات"} →
            </button>
            <button
              className="heroBtn"
              style={{ background: "rgba(255,255,255,0.2)", color: "#fff", border: "1px solid rgba(255,255,255,0.4)" }}
              onClick={() => go("focus")}
            >
              ⏱ جلسة تركيز (Pomodoro)
            </button>
          </div>
        </div>
        <div className="ring">
          <b>{stats.completionRate || 0}%</b>
          <small>إنجاز المهام</small>
        </div>
      </section>

      <div className="stats">
        <Stat icon="✓" value={done} label="مهام مكتملة" />
        <Stat icon="◷" value={(stats.studyHours || 0) + "h"} label="ساعات الدراسة (مهام + تركيز)" />
        <Stat icon="!" value={stats.highPriorityOpen || 0} label="مهام عالية الأولوية" />
        <Stat icon="◫" value={(stats.averageProgress || 0) + "%"} label="متوسط تقدم المناهج" />
      </div>

      <div className="grid">
        {/* Today's Lectures Widget */}
        <section className="card">
          <div className="sectionhead">
            <h3>محاضرات اليوم ({todayArabic})</h3>
            <button className="link" onClick={() => go("schedule")}>
              الجدول الكامل →
            </button>
          </div>
          {todayLectures.length === 0 ? (
            <div className="empty">لا توجد محاضرات مجدولة اليوم — يوم ممتاز للتركيز على المهام! ☕</div>
          ) : (
            <div className="today-schedule-list">
              {todayLectures.map((item) => (
                <div className="today-lecture-item" key={item.id}>
                  <div className="today-lecture-info">
                    <b>{item.subject}</b>
                    <small>{item.room ? `القاعة: ${item.room}` : "بدون قاعة محددة"}</small>
                  </div>
                  <div className="today-lecture-time">
                    {formatTime12(item.startTime)} — {formatTime12(item.endTime)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Priority & Next Tasks */}
        <section className="card">
          <div className="sectionhead">
            <h3>أقرب المهام المطلوبة</h3>
            <button className="link" onClick={() => go("tasks")}>
              كل المهام →
            </button>
          </div>
          <TaskList tasks={tasks.filter((x) => !x.done).slice(0, 4)} toggle={toggle} />
        </section>
      </div>

      {/* Subjects Progress Bar */}
      <section className="card" style={{ marginTop: "17px" }}>
        <div className="sectionhead">
          <h3>تقدم المواد الدراسية</h3>
          <button className="link" onClick={() => go("subjects")}>
            إدارة المواد →
          </button>
        </div>
        <div className="subjectgrid">
          {subjects.slice(0, 4).map((s) => (
            <div className="subject" key={s.id}>
              <div>
                <b>{s.name}</b>
                <small>{s.code ? `رمز: ${s.code}` : ""} · {s.completedTasks || 0}/{s.totalTasks || 0} مهام منجزة</small>
              </div>
              <span>{s.progress}% منهج</span>
              <i>
                <em style={{ width: s.progress + "%" }} />
              </i>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Stat({ icon, value, label }) {
  return (
    <div className="stat">
      <span>{icon}</span>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

function TaskList({ tasks, toggle, remove, onEdit }) {
  if (!tasks.length) return <div className="empty large">لا توجد مهام مطابقة.</div>;
  return (
    <div>
      {tasks.map((t) => {
        const dateStatus = formatTaskDateStatus(t.dueDate, t.done);
        return (
          <div className={"task " + (t.done ? "done" : "")} key={t.id}>
            <button className="check" onClick={() => toggle(t)} title={t.done ? "تحديد كغير منجزة" : "تحديد كمنجزة"}>
              {t.done ? "✓" : ""}
            </button>
            <div className="taskbody">
              <b>{t.name}</b>
              <small>
                {t.subjectName ? <span><b>{t.subjectName}</b> · </span> : ""}
                {t.tag} · {t.estimatedMinutes || 30} دقيقة
                {dateStatus && (
                  <span className={`date-badge ${dateStatus.type}`}>
                    {dateStatus.text}
                  </span>
                )}
              </small>
            </div>
            <span className={"priority " + t.priority}>{priorityLabel[t.priority]}</span>
            <div className="task-actions">
              {onEdit && (
                <button className="edit" onClick={() => onEdit(t)} title="تعديل المهمة">
                  ✎
                </button>
              )}
              {remove && (
                <button className="delete" onClick={() => remove(t.id)} title="حذف المهمة">
                  ×
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stats({ stats, tasks, subjects }) {
  const bars = subjects.map((s) => ({
    name: s.name,
    syllabus: s.progress || 0,
    tasksPct: s.taskProgress || 0,
    completed: s.completedTasks || 0,
    total: s.totalTasks || 0
  }));

  return (
    <section>
      <div className="stats bigstats">
        <Stat icon="✓" value={stats.completedTasks || 0} label="مهام مكتملة" />
        <Stat icon="%" value={(stats.completionRate || 0) + "%"} label="نسبة الإنجاز" />
        <Stat icon="◷" value={(stats.studyHours || 0) + "h"} label="ساعات الدراسة الفعلية" />
        <Stat icon="⏱" value={stats.focusSessionsCount || 0} label="جلسات تركيز منجزة" />
      </div>

      <div className="grid">
        <section className="card">
          <h2>مقارنة تقدم المواد</h2>
          <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "20px" }}>
            مقارنة بين تقدم المنهج الدراسي ونسبة إنجاز المهام لكل مادة
          </p>
          {bars.length === 0 ? (
            <div className="empty">لا توجد مواد مسجلة لعرض إحصائياتها.</div>
          ) : (
            bars.map((x) => (
              <div className="statbar" key={x.name}>
                <div>
                  <b>{x.name}</b>
                  <small style={{ color: "var(--muted)" }}>{x.completed}/{x.total} مهام</small>
                  <span>{x.syllabus}% منهج</span>
                </div>
                <div className="bar" title={`تقدم المنهج: ${x.syllabus}%`}>
                  <em style={{ width: x.syllabus + "%" }} />
                </div>
              </div>
            ))
          )}
        </section>

        <section className="card">
          <h2>ملخص الأداء والدراسة</h2>
          <div className="insight">
            <b style={{ color: (stats.overdueTasks || 0) > 0 ? "var(--danger)" : "var(--brand)" }}>
              {stats.overdueTasks || 0}
            </b>
            <span>مهام متأخرة تجاوزت موعدها</span>
          </div>
          <div className="insight">
            <b>{stats.dueToday || 0}</b>
            <span>مهام تستحق التسليم اليوم</span>
          </div>
          <div className="insight">
            <b>{stats.highPriorityOpen || 0}</b>
            <span>مهام عالية الأولوية مفتوحة</span>
          </div>
          <div className="insight">
            <b>{stats.todayFocusMinutes || 0} د</b>
            <span>وقت تركيز اليوم</span>
          </div>
          <div className="insight">
            <b>{tasks.length - (stats.completedTasks || 0)}</b>
            <span>إجمالي المهام المتبقية</span>
          </div>
        </section>
      </div>
    </section>
  );
}

function Root() {
  const [u, setU] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("sf_user"));
    } catch {
      return null;
    }
  });

  function out() {
    localStorage.removeItem("sf_token");
    localStorage.removeItem("sf_user");
    setU(null);
  }

  return u ? <App user={u} onLogout={out} /> : <Auth onLogin={setU} />;
}

createRoot(document.getElementById("root")).render(<Root />);
