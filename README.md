# Sports Academy (Badminton)

MVP scaffold for managing classes, coaches, players, registrations, attendance,
and assessments. Imports data from the existing Excel workbook.

## Quick start (DEV)

```bash
npm install
npm run init-db
npm run import:xlsm -- /mnt/d/SportsAcademy/Badminton_Academy_SUPERVISOR_MASTER_COMPLETE2.xlsm
npm run dev
```

Open `http://localhost:3001`.

## Import notes

The importer reads these sheets:

- `LOCATIONS` (LocationID, Location Name)
- `CLASSES` (ClassID, Class Name, Status, Location, Day, Court)
- `COACHES` (CoachID, Coach Name, Phone, Status)
- `PLAYERS` (PlayerID, Player Name, ClassID, Level, Status, Parent Name, Parent Phone, Start Date, Payment Status)
- `PLAYER_REGISTRATION` (PlayerID, Player Name, ClassID, Start Date, Parent Name, Parent Phone, Payment Plan, Payment Status, Notes)
- `ATTENDANCE_LOG`
- `ASSESSMENT_LOG`

Payment plan values such as `Cash-20` are stored as-is in `registrations.payment_plan`.

## Production (PRD)

Set `.env.prd` and run:

```bash
NODE_ENV=prd npm run init-db
NODE_ENV=prd npm run import:xlsm -- /path/to/file.xlsm
NODE_ENV=prd npm start
```
