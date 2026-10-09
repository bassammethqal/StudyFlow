import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("=================================================================");
console.log(">>> StudyFlow Frontend Dialog & Notification System Test Suite <<<");
console.log("=================================================================\n");

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`✓ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`✗ FAIL: ${testName}`);
    throw new Error(`Test failed: ${testName}`);
  }
}

// -------------------------------------------------------------
// TEST 1: Audit main.jsx for absence of native browser dialogs
// -------------------------------------------------------------
console.log("--- 1. Static Audit for Native Dialog Invocations ---");
const mainPath = path.join(__dirname, "src", "main.jsx");
const mainCode = fs.readFileSync(mainPath, "utf8");

// Check that no calls to confirm(, alert(, prompt( exist
const confirmMatches = mainCode.match(/(?<![a-zA-Z0-9_])confirm\s*\(/g) || [];
assert(confirmMatches.length === 0, `No active native confirm() calls found (found: ${confirmMatches.length})`);

const alertMatches = mainCode.match(/(?<![a-zA-Z0-9_])alert\s*\(/g) || [];
assert(alertMatches.length === 0, `No active native alert() calls found (found: ${alertMatches.length})`);

const promptMatches = mainCode.match(/(?<![a-zA-Z0-9_])prompt\s*\(/g) || [];
assert(promptMatches.length === 0, `No active native prompt() calls found (found: ${promptMatches.length})`);

// -------------------------------------------------------------
// TEST 2: Verify custom UI context and hook features
// -------------------------------------------------------------
console.log("\n--- 2. Custom Dialog System Interface & Hook Verification ---");
assert(mainCode.includes("showToast"), "UIContext provides showToast");
assert(mainCode.includes("showSuccess"), "UIContext provides showSuccess helper");
assert(mainCode.includes("showError"), "UIContext provides showError helper");
assert(mainCode.includes("showWarning"), "UIContext provides showWarning helper");
assert(mainCode.includes("showInfo"), "UIContext provides showInfo helper");
assert(mainCode.includes("askConfirm"), "UIContext provides askConfirm modal method");
assert(mainCode.includes("askPrompt"), "UIContext provides askPrompt modal method");

// -------------------------------------------------------------
// TEST 3: Verify safety-net overrides on window
// -------------------------------------------------------------
console.log("\n--- 3. Safety Net Window Dialog Overrides ---");
assert(mainCode.includes("window.alert ="), "window.alert is overridden to show in-app toasts");
assert(mainCode.includes("window.confirm ="), "window.confirm is overridden to prevent native browser modal popups");
assert(mainCode.includes("window.prompt ="), "window.prompt is overridden to prevent native browser prompt popups");

// -------------------------------------------------------------
// TEST 4: Verify Component System RTL & Accessibility
// -------------------------------------------------------------
console.log("\n--- 4. Component System Accessibility & RTL Compliance ---");
assert(mainCode.includes('role="alertdialog"'), "ConfirmModal uses role='alertdialog' for destructive notifications");
assert(mainCode.includes('role="dialog"'), "PromptModal uses role='dialog'");
assert(mainCode.includes('aria-modal="true"'), "Modals include aria-modal='true'");
assert(mainCode.includes('aria-labelledby'), "Modals include aria-labelledby");
assert(mainCode.includes('aria-describedby'), "Modals include aria-describedby");
assert(mainCode.includes('Escape'), "Modals support Escape key dismissal");
assert(mainCode.includes('sf-toast-progress'), "Toasts include animated progress indicator");
assert(mainCode.includes('onMouseEnter'), "Toasts pause on mouse hover for accessibility reading");

// -------------------------------------------------------------
// TEST 5: Verify CSS Design & RTL Integration
// -------------------------------------------------------------
console.log("\n--- 5. CSS Stylesheet Audit ---");
const stylePath = path.join(__dirname, "src", "style.css");
const styleCode = fs.readFileSync(stylePath, "utf8");

assert(styleCode.includes(".sf-toast-container"), ".sf-toast-container defined in style.css");
assert(styleCode.includes(".sf-toast-success"), ".sf-toast-success variant styled");
assert(styleCode.includes(".sf-toast-error"), ".sf-toast-error variant styled");
assert(styleCode.includes(".sf-toast-warning"), ".sf-toast-warning variant styled");
assert(styleCode.includes(".sf-toast-info"), ".sf-toast-info variant styled");
assert(styleCode.includes(".sf-toast-progress"), ".sf-toast-progress styled");
assert(styleCode.includes(".confirm-modal-card"), ".confirm-modal-card styled");
assert(styleCode.includes("body.dark,"), "Dark mode variables synchronized to document body");

// -------------------------------------------------------------
// TEST 6: Production Build Verification
// -------------------------------------------------------------
console.log("\n--- 6. Vite Production Build Verification ---");
try {
  const buildOutput = execSync("npm run build", { cwd: __dirname, stdio: "pipe" }).toString();
  assert(buildOutput.includes("built in") || buildOutput.includes("dist/index.html"), "Vite production bundle successfully built");
} catch (err) {
  console.error("Build failed:", err.message);
  throw err;
}

console.log("\n=================================================================");
console.log(`🎉 ALL ${passedTests}/${totalTests} FRONTEND IN-APP DIALOG TESTS PASSED!`);
console.log("=================================================================\n");
process.exit(0);
