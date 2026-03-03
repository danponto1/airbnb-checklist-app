# Airbnb Cleaning Checklist App (MVP)

## What this does
- Cleaner-facing checklist form with 3 sections:
  - Interior
  - Exterior
  - Before You Leave
- Photo uploads per configured items
- Condition fields on key assets
- Automatic enforcement:
  - if condition = Damaged/Not Working, issue note + issue photo are required
- Admin pages to view all submissions and photos

## Run locally
```bash
cd projects/airbnb-checklist-app
npm install
npm run dev
```

Open:
- Cleaner form: `http://localhost:3030/form`
- Admin list: `http://localhost:3030/admin`

## Files
- `checklist.schema.json` – form structure and rules
- `app.js` – server/routes/db logic
- `views/` – form/admin pages
- `data/checklists.db` – SQLite database
- `uploads/` – uploaded images

## Render persistent storage (Disk + SQLite/uploads)
Use this for quick reliable persistence on Render.

1. In Render service settings, add a **Disk**:
   - Name: `checklist-data`
   - Mount path: `/var/data`
   - Size: 1 GB (or more)
2. Add environment variables:
   - `DATA_DIR=/var/data`
   - `UPLOAD_DIR=/var/data/uploads`
3. Redeploy the service.

With this setup:
- SQLite DB path becomes `/var/data/checklists.db`
- Uploaded photos are saved in `/var/data/uploads`
- Data survives deploys/restarts (as long as disk is attached)

## Next build steps
1. Add admin auth for `/admin`
2. Add export CSV
3. Optional migration to Supabase for multi-service scaling
