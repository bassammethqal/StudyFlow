<div align="center"><h1>StudyFlow <sup>4.1</sup></h1><h3>Your Academic Life, Organized.</h3><p>
A modern academic management platform built to help students organize their courses, manage tasks, track progress, and stay focused.
</p><br><a href="https://study-flow-mu-pearl.vercel.app/">
<img src="https://img.shields.io/badge/LIVE_DEMO-Visit_Project-2563EB?style=for-the-badge" alt="Live Demo">
</a>
&nbsp;
<a href="https://github.com/bassammethqal/StudyFlow">
<img src="https://img.shields.io/badge/SOURCE_CODE-GitHub-18181B?style=for-the-badge&logo=github" alt="GitHub">
</a><br><br>

<img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black">
<img src="https://img.shields.io/badge/Vite-Frontend-646CFF?style=flat-square&logo=vite&logoColor=white">
<img src="https://img.shields.io/badge/Node.js-Backend-339933?style=flat-square&logo=nodedotjs&logoColor=white">
<img src="https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white">
<img src="https://img.shields.io/badge/Neon-PostgreSQL-00E599?style=flat-square&logo=postgresql&logoColor=black"></div><br>---

<h2 align="center">01 — About the Project</h2><p align="center">
<strong>StudyFlow</strong> is a Full-Stack Student Management Platform designed to simplify academic life through a centralized workspace.
</p><p align="center">
From managing assignments and organizing weekly schedules to tracking academic progress and maintaining focus, StudyFlow brings essential student tools together in one application.
</p><br><h2 align="center">02 — Core Features</h2><table>
<tr>
<td width="50%" valign="top">
<h3>📊 Smart Dashboard</h3>
<p>Monitor overdue tasks, upcoming lectures, and daily academic activity.</p>
</td>
<td width="50%" valign="top">
<h3>📝 Task Management</h3>
<p>Organize assignments using priorities, deadlines, and subject associations.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>📚 Subject Tracking</h3>
<p>Track syllabus completion and monitor the progress of tasks associated with each subject.</p>
</td>
<td width="50%" valign="top">
<h3>📅 Weekly Schedule</h3>
<p>Organize lectures, classes, and rooms with automatic current-day highlighting.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>⏱️ Pomodoro Timer</h3>
<p>Manage focus sessions and breaks with audio notifications and automatic study-time tracking.</p>
</td>
<td width="50%" valign="top">
<h3>🔐 Authentication & Security</h3>
<p>JWT authentication, Bcrypt password hashing, and password recovery.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>☁️ Cloud Database</h3>
<p>Neon PostgreSQL integration with automatic local SQLite fallback.</p>
</td>
<td width="50%" valign="top">
<h3>🌙 Dark Mode</h3>
<p>A comfortable interface with instant theme switching.</p>
</td>
</tr>
</table><br><h2 align="center">03 — Technology Stack</h2><table align="center">
<tr>
<th>Layer</th>
<th>Technology</th>
</tr>
<tr>
<td><strong>Frontend</strong></td>
<td>React 18 · Vite · Vanilla CSS</td>
</tr>
<tr>
<td><strong>Backend</strong></td>
<td>Node.js · Express 5</td>
</tr>
<tr>
<td><strong>Security</strong></td>
<td>JWT · Bcrypt · Helmet</td>
</tr>
<tr>
<td><strong>Primary Database</strong></td>
<td>Neon PostgreSQL · pg.Pool</td>
</tr>
<tr>
<td><strong>Local Database</strong></td>
<td>SQLite</td>
</tr>
</table><br><h2 align="center">04 — Getting Started</h2><h3>Prerequisites</h3><ul>
<li>Node.js 18 or later</li>
<li>npm</li>
<li>Git</li>
</ul><h3>Step 1 — Clone the Repository</h3>git clone https://github.com/bassammethqal/StudyFlow.git
cd StudyFlow

<h3>Step 2 — Install Dependencies</h3>Run the following command from the project root:

npm run install-all

<h3>Step 3 — Configure Environment Variables</h3>Create your environment file from the example.

<strong>Windows PowerShell:</strong>

Copy-Item studyflow_v4/server/.env.example studyflow_v4/server/.env

<strong>Linux / macOS:</strong>

cp studyflow_v4/server/.env.example studyflow_v4/server/.env

<h3>Step 4 — Configure Neon PostgreSQL</h3>Open the following file:

studyflow_v4/server/.env

Add your Neon connection string:

DATABASE_URL=your_neon_postgresql_connection_string

<p>
<strong>Note:</strong> If <code>DATABASE_URL</code> is left empty, StudyFlow automatically uses a local SQLite database for development.
</p><h3>Step 5 — Start the Application</h3>npm run dev

<p>
<strong>Windows users:</strong> You can also launch the application using either of these files:
</p><ul>
<li><code>Start-StudyFlow.bat</code></li>
<li><code>تشغيل-StudyFlow.bat</code></li>
</ul><br><h2 align="center">05 — Local Development</h2><table align="center">
<tr>
<th>Service</th>
<th>Local Address</th>
</tr>
<tr>
<td>Frontend</td>
<td><code>http://localhost:5173</code></td>
</tr>
<tr>
<td>Backend API</td>
<td><code>http://localhost:4000</code></td>
</tr>
</table><br><h2 align="center">06 — Security</h2><ul>
<li>JWT-based authentication.</li>
<li>Password hashing using Bcrypt.</li>
<li>Environment variables are stored in local <code>.env</code> files.</li>
<li>Local database files (<code>*.db</code>) and sensitive environment files are excluded through <code>.gitignore</code>.</li>
<li>An <code>.env.example</code> template is provided for configuration.</li>
</ul><p>
<strong>Security reminder:</strong> Never commit database credentials, private keys, or sensitive environment variables to GitHub.
</p><br>---

<div align="center"><h2>Built for Better Academic Productivity.</h2><p>
Designed and developed by
</p><h3><a href="https://github.com/bassammethqal">Bassam Methqal</a></h3><br><a href="https://github.com/bassammethqal/StudyFlow">
View Repository
</a></div>
