<div align="center">StudyFlow 4.1

Your Academic Life, Organized.

A full-stack student management platform designed to help university students organize their academic life, manage coursework, track progress, and build productive study habits.

Powered by React, Node.js, Express, and Neon PostgreSQL.

"Live Demo" (https://study-flow-mu-pearl.vercel.app/) · "Report an Issue" (https://github.com/bassammethqal/StudyFlow/issues)

</div>---

Overview

StudyFlow brings essential academic management tools into one platform. It helps students stay organized, monitor their academic progress, manage their schedules, and maintain focused study sessions.

The application uses Neon PostgreSQL as its primary cloud database, with automatic SQLite fallback for local development.

Features

Feature| Description
Dashboard| View academic activity, overdue tasks, and daily schedules.
Task Management| Create and organize tasks with priorities and due dates.
Subject Tracking| Monitor course progress and task completion.
Weekly Schedule| Organize lectures, classes, and rooms.
Pomodoro Timer| Manage focus sessions and breaks with audio notifications.
Authentication| JWT authentication, password hashing, and password recovery.
Dark Mode| Switch to a comfortable dark interface.
Cloud Database| Connect to Neon PostgreSQL through environment configuration.

Technology Stack

Layer| Technologies
Frontend| React 18, Vite, CSS
Backend| Node.js, Express 5
Security| JWT, Bcrypt, Helmet
Database| Neon PostgreSQL, SQLite fallback
Deployment| Vercel

Getting Started

Prerequisites

- Node.js 18 or later
- npm
- Git

1. Clone the repository

git clone https://github.com/bassammethqal/StudyFlow.git
cd StudyFlow

2. Install dependencies

npm run install-all

3. Configure environment variables

Create your environment file from the provided example.

Windows PowerShell:

Copy-Item studyflow_v4/server/.env.example studyflow_v4/server/.env

Linux / macOS:

cp studyflow_v4/server/.env.example studyflow_v4/server/.env

To use Neon PostgreSQL, configure the following variable in:

"studyflow_v4/server/.env"

DATABASE_URL=your_neon_postgresql_connection_string

Replace the placeholder with your actual Neon connection string.

«If "DATABASE_URL" is left empty, the application automatically uses a local SQLite database for development.»

4. Run the application

npm run dev

The application services are available at:

Service| URL
Frontend| http://localhost:5173
Backend API| http://localhost:4000

Windows users: You can also launch the application using "Start-StudyFlow.bat" or "تشغيل-StudyFlow.bat".

Security

StudyFlow follows basic security practices:

- JWT-based authentication.
- Password hashing using Bcrypt.
- Sensitive environment variables are stored in ".env".
- Local database files ("*.db") and environment files (".env") are excluded from Git.
- An ".env.example" template is provided for configuration.

Never commit your database credentials, secrets, or private API keys.

Project Information

Item| Details
Project| StudyFlow
Version| 4.1
Type| Full-Stack Student Management Platform
Primary Database| Neon PostgreSQL
Local Development Database| SQLite
Repository| bassammethqal/StudyFlow

---

<div align="center">Built to make student life more organized.

Developed by "Bassam Methqal" (https://github.com/bassammethqal)

</div>
