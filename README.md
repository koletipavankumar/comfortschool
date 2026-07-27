# Comfort Grammar School Website

A modern, responsive school website for Comfort Grammar School with:
- dynamic content pages for About, School Information, Academics, Admissions, Facilities, Achievements, Gallery, Staff and Contact
- an admin dashboard for managing site content and uploads
- image uploading for banners, gallery photos, events and staff images
- dynamic gallery and staff sections driven by a SQLite database and uploaded files

## Features
- Responsive navigation and premium UI design
- Floating WhatsApp and call actions
- Admin login protected routes
- Upload, replace and delete media from the admin panel
- Contact form submissions stored in the database

## Folder structure
- `app.js` – Express server, routes, database initialization and upload handling
- `public/` – static assets and uploaded media files
- `views/` – EJS templates for the public pages and admin dashboard
- `data/` – SQLite database file

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the website:
   ```bash
   npm start
   ```
3. Open `http://localhost:3000`

## Admin access
Default admin credentials:
- Username: `admin`
- Password: `comfortschool`

You can override these in the environment:
```bash
ADMIN_USERNAME=yourname ADMIN_PASSWORD=yourpassword npm start
```
