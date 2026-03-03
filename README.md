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

## Next build steps
1. Rename second property in `checklist.schema.json`
2. Add final item-by-item wording for all 104 points
3. Add auth for admin route
4. Deploy to cloud storage/DB (Supabase) + hosting (Vercel/Railway)
