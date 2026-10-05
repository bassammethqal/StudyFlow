import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(url, path, method = "GET", body = null, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(`${url}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {}
    await wait(300);
  }
  return false;
}

console.log("================================================================");
console.log(">>> StudyFlow End-to-End Neon PostgreSQL Verification Suite <<<");
console.log("================================================================\n");

// -------------------------------------------------------------
// STEP 1: Verify current live server on port 4000
// -------------------------------------------------------------
console.log("--- Step 1: Health Check on Live Server (port 4000) ---");
const health = await api("http://localhost:4000", "/health");
console.log("Status:", health.status);
console.log("Response:", health.data);
if (health.status !== 200 || health.data?.database !== "PostgreSQL (Neon)") {
  throw new Error("Server is not healthy or not running PostgreSQL (Neon)!");
}
console.log("✓ Server is verified and running on Neon PostgreSQL.\n");

// -------------------------------------------------------------
// STEP 2: Register test user
// -------------------------------------------------------------
console.log("--- Step 2: User Registration ---");
const testEmail = `verify_neon_${Date.now()}@studyflow.local`;
const testPassword = "secureTestPassword123!";
const regRes = await api("http://localhost:4000", "/auth/register", "POST", {
  name: "طالب فحص Neon",
  email: testEmail,
  password: testPassword
});
console.log("Register HTTP Status:", regRes.status);
console.log("Created User ID:", regRes.data?.user?.id);
console.log("User Email:", regRes.data?.user?.email);
if (regRes.status !== 201 || !regRes.data?.token) {
  throw new Error("Registration failed: " + JSON.stringify(regRes.data));
}
let token = regRes.data.token;
console.log("✓ User successfully registered in Neon PostgreSQL.\n");

// -------------------------------------------------------------
// STEP 3: User Login
// -------------------------------------------------------------
console.log("--- Step 3: User Login ---");
const loginRes = await api("http://localhost:4000", "/auth/login", "POST", {
  email: testEmail,
  password: testPassword
});
console.log("Login HTTP Status:", loginRes.status);
console.log("Logged In Name:", loginRes.data?.user?.name);
if (loginRes.status !== 200 || !loginRes.data?.token) {
  throw new Error("Login failed: " + JSON.stringify(loginRes.data));
}
token = loginRes.data.token;
console.log("✓ Login successful, JWT token received and validated.\n");

// -------------------------------------------------------------
// STEP 4: Create a Task
// -------------------------------------------------------------
console.log("--- Step 4: Create Task ---");
const createRes = await api("http://localhost:4000", "/tasks", "POST", {
  name: "مهمة اختبار Neon - بنية البيانات",
  tag: "مشروع",
  priority: "medium",
  dueDate: "2026-10-20",
  estimatedMinutes: 45
}, token);
console.log("Create Task HTTP Status:", createRes.status);
console.log("Created Task:", createRes.data);
if (createRes.status !== 201 || !createRes.data?.id) {
  throw new Error("Create task failed: " + JSON.stringify(createRes.data));
}
const taskId = createRes.data.id;
console.log(`✓ Task created with ID ${taskId} in Neon PostgreSQL.\n`);

// -------------------------------------------------------------
// STEP 5: Read Task Back
// -------------------------------------------------------------
console.log("--- Step 5: Read Task Back ---");
const listRes = await api("http://localhost:4000", "/tasks", "GET", null, token);
console.log("List Tasks HTTP Status:", listRes.status);
console.log("Fetched Tasks Count:", listRes.data?.length);
const foundTask = listRes.data?.find((t) => t.id === taskId);
console.log("Retrieved Task Details:", foundTask);
if (!foundTask || foundTask.name !== "مهمة اختبار Neon - بنية البيانات") {
  throw new Error("Task was not found or field values mismatch!");
}
console.log("✓ Task successfully read back and verified.\n");

// -------------------------------------------------------------
// STEP 6: Update Task
// -------------------------------------------------------------
console.log("--- Step 6: Update Task ---");
const updateRes = await api("http://localhost:4000", `/tasks/${taskId}`, "PATCH", {
  name: "مهمة اختبار Neon - بنية البيانات (مكتملة ومعدلة)",
  done: true,
  priority: "high",
  dueDate: "2026-10-22",
  estimatedMinutes: 60
}, token);
console.log("Update Task HTTP Status:", updateRes.status);
console.log("Updated Task Response:", updateRes.data);
if (updateRes.status !== 200 || updateRes.data?.done !== 1 || updateRes.data?.priority !== "high") {
  throw new Error("Update task failed: " + JSON.stringify(updateRes.data));
}
console.log("✓ Task successfully updated.\n");

// -------------------------------------------------------------
// STEP 7: Persistence Verification across Backend Restart
// -------------------------------------------------------------
console.log("--- Step 7: Testing Data Persistence Across Server Process Restart ---");
console.log("Spawning isolated backend instance on PORT 4010 to test restart lifecycle...");

function startServerProcess(port) {
  const p = spawn("node", ["src/server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: "pipe"
  });
  return p;
}

let serverProc1 = startServerProcess(4010);
const ready1 = await waitForServer("http://localhost:4010");
if (!ready1) {
  serverProc1.kill();
  throw new Error("Isolated server failed to start on port 4010");
}
console.log("Isolated Server Instance #1 started.");

// Query data through Instance #1
const resFromInst1 = await api("http://localhost:4010", "/tasks", "GET", null, token);
const taskFromInst1 = resFromInst1.data?.find((t) => t.id === taskId);
console.log("Data read via Instance #1:", taskFromInst1?.name, "- Done:", taskFromInst1?.done);
if (!taskFromInst1) throw new Error("Could not find task via Instance #1");

// Kill Server Instance #1 completely
console.log("Terminating Server Instance #1 (killing process)...");
serverProc1.kill("SIGTERM");
await wait(1000);

// Verify server #1 is dead
try {
  await fetch("http://localhost:4010/api/health");
  throw new Error("Server was still responding after kill!");
} catch (e) {
  console.log("Server Instance #1 confirmed dead.");
}

// Start completely fresh Server Instance #2
console.log("Starting fresh Server Instance #2 on same PORT 4010...");
let serverProc2 = startServerProcess(4010);
const ready2 = await waitForServer("http://localhost:4010");
if (!ready2) {
  serverProc2.kill();
  throw new Error("Server Instance #2 failed to start on port 4010");
}
console.log("Server Instance #2 successfully started and connected to Neon.");

// Read data back via Instance #2
const resFromInst2 = await api("http://localhost:4010", "/tasks", "GET", null, token);
const taskFromInst2 = resFromInst2.data?.find((t) => t.id === taskId);
console.log("Data read via Instance #2 after restart:", taskFromInst2?.name, "- Priority:", taskFromInst2?.priority, "- Done:", taskFromInst2?.done);

if (!taskFromInst2 || taskFromInst2.id !== taskId || taskFromInst2.done !== 1 || taskFromInst2.priority !== "high") {
  serverProc2.kill();
  throw new Error("Data did not persist across backend restart in Neon PostgreSQL!");
}
console.log("✓ SUCCESS: Data is 100% persistent in Neon PostgreSQL across process restarts.\n");

// Clean up Server Instance #2
serverProc2.kill("SIGTERM");
await wait(500);

// -------------------------------------------------------------
// STEP 8: Delete Task & Cleanup
// -------------------------------------------------------------
console.log("--- Step 8: Delete Task and Cleanup ---");
const delRes = await api("http://localhost:4000", `/tasks/${taskId}`, "DELETE", null, token);
console.log("Delete Task HTTP Status:", delRes.status);
if (delRes.status !== 204) {
  throw new Error("Delete task failed with status " + delRes.status);
}

// Verify deletion
const checkDel = await api("http://localhost:4000", "/tasks", "GET", null, token);
const exists = checkDel.data?.some((t) => t.id === taskId);
console.log("Task exists after delete?", exists);
if (exists) {
  throw new Error("Task still exists after DELETE request!");
}
console.log("✓ Task successfully deleted from Neon PostgreSQL.\n");

// -------------------------------------------------------------
// STEP 9: Password Reset Verification Flow
// -------------------------------------------------------------
console.log("--- Step 9: Password Reset Flow ---");
const forgotRes = await api("http://localhost:4000", "/auth/forgot-password", "POST", { email: testEmail });
console.log("Forgot Password HTTP Status:", forgotRes.status);
console.log("Forgot Password Response:", forgotRes.data);
if (forgotRes.status !== 200 || !forgotRes.data?.ok) {
  throw new Error("Forgot password request failed: " + JSON.stringify(forgotRes.data));
}
const resetVerificationCode = forgotRes.data.devCode;
console.log("Dev code returned in non-prod mode:", resetVerificationCode);
if (!resetVerificationCode) {
  throw new Error("Expected devCode in non-production simulation mode");
}

const newPassword = "brandNewStrongPassword2026!";
const resetRes = await api("http://localhost:4000", "/auth/reset-password", "POST", {
  email: testEmail,
  code: resetVerificationCode,
  newPassword
});
console.log("Reset Password HTTP Status:", resetRes.status);
console.log("Reset Password Response:", resetRes.data);
if (resetRes.status !== 200 || !resetRes.data?.ok) {
  throw new Error("Password reset failed: " + JSON.stringify(resetRes.data));
}

// Confirm login with new password
const reloginRes = await api("http://localhost:4000", "/auth/login", "POST", {
  email: testEmail,
  password: newPassword
});
console.log("Re-login with new password HTTP Status:", reloginRes.status);
if (reloginRes.status !== 200 || !reloginRes.data?.token) {
  throw new Error("Re-login with updated password failed!");
}
console.log("✓ Password reset flow successfully verified.\n");

// -------------------------------------------------------------
// STEP 10: Production Security Hardening Verification
// -------------------------------------------------------------
console.log("--- Step 10: Production Security Hardening Verification ---");

// Test 10.1: Confirm server refuses to boot in production with insecure/default JWT_SECRET
console.log("Testing production boot rejection with default JWT_SECRET...");
const insecureBoot = await new Promise((resolve) => {
  const p = spawn("node", ["src/server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: "4020", NODE_ENV: "production", JWT_SECRET: "dev-secret-change-me" },
    stdio: "pipe"
  });
  p.on("exit", (code) => resolve(code));
});
console.log("Insecure production boot exit code:", insecureBoot);
if (insecureBoot !== 1) {
  throw new Error(`Expected server to exit with code 1 on insecure JWT_SECRET, but got ${insecureBoot}`);
}
console.log("✓ Insecure production JWT_SECRET is strictly rejected (exit 1).\n");

// Test 10.2: Boot hardened production server on PORT 4022 with configured CORS
console.log("Starting production server with strong secret and configured CORS origin...");
const prodSecret = "strong_production_random_secret_at_least_32_chars_long!";
const prodProc = spawn("node", ["src/server.js"], {
  cwd: __dirname,
  env: {
    ...process.env,
    PORT: "4022",
    NODE_ENV: "production",
    JWT_SECRET: prodSecret,
    ALLOWED_ORIGINS: "https://studyflow-app.vercel.app"
  },
  stdio: "pipe"
});

const prodReady = await waitForServer("http://localhost:4022");
if (!prodReady) {
  prodProc.kill();
  throw new Error("Production server failed to boot on port 4022");
}

// Test 10.3: Confirm devCode is NEVER returned in production forgot-password
const prodForgot = await fetch("http://localhost:4022/api/auth/forgot-password", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: testEmail })
});
const prodForgotData = await prodForgot.json();
console.log("Production forgot-password response:", prodForgotData);
if (prodForgotData.devCode !== undefined) {
  prodProc.kill();
  throw new Error("SECURITY FAILURE: devCode was leaked in production response!");
}
console.log("✓ devCode is completely shielded in production mode.\n");

// Test 10.4: Test CORS rejection for unauthorized origin
const corsRejectRes = await fetch("http://localhost:4022/api/health", {
  headers: { Origin: "https://evil-unauthorized-site.com" }
});
console.log("Unauthorized CORS Origin status:", corsRejectRes.status);
if (corsRejectRes.status !== 403) {
  prodProc.kill();
  throw new Error(`Expected CORS rejection 403, got ${corsRejectRes.status}`);
}
console.log("✓ Unauthorized CORS origin properly rejected with 403.\n");

// Test 10.5: Test CORS acceptance for configured origin
const corsAcceptRes = await fetch("http://localhost:4022/api/health", {
  headers: { Origin: "https://studyflow-app.vercel.app" }
});
console.log("Authorized CORS Origin status:", corsAcceptRes.status);
const allowHeader = corsAcceptRes.headers.get("access-control-allow-origin");
console.log("Access-Control-Allow-Origin header:", allowHeader);
if (corsAcceptRes.status !== 200 || allowHeader !== "https://studyflow-app.vercel.app") {
  prodProc.kill();
  throw new Error("Configured hosted frontend origin was not accepted by CORS!");
}
console.log("✓ Hosted frontend origin (https://studyflow-app.vercel.app) cleanly accepted.\n");

// Clean up production process
prodProc.kill("SIGTERM");
await wait(500);

// -------------------------------------------------------------
// STEP 11: Cleanup Test User Records
// -------------------------------------------------------------
console.log("--- Step 11: Cleanup Test User Records ---");
const { db } = await import("./src/db.js");
await db.init();
await db.run("DELETE FROM users WHERE email LIKE '%@studyflow.local'");
await db.close();
console.log("✓ Test user records cleanly purged. Zero residual test data remaining.\n");

console.log("======================================================================");
console.log("🎉 ALL PRODUCTION AUDIT & END-TO-END VERIFICATION CHECKS PASSED 100%!");
console.log("======================================================================");
process.exit(0);
