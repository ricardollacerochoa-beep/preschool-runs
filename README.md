# Preschool Runs

Family app for preschool **drop-offs** and **pick-ups**.

**Open it:** https://ricardollacerochoa-beep.github.io/preschool-runs/

- Book the days you'll do drop-off or pick-up; cancel or take over a day.
- Everyone else gets a **push notification** (day + person).
- Subscribe your **calendar** once: bookings appear, cancellations disappear.
- Copy a ready-made **message for the preschool** app.

## Install on a phone
- **iPhone:** open the link in Safari → Share ⬆ → *Add to Home Screen*. Open it from the icon, create an account, confirm the email, then turn on notifications.
- **Android:** open in Chrome → ⋮ → *Install app*.

Only email addresses on the family list can see or book anything.

## How it's built
- `index.html`, `app.js`, `sw.js` – the app (published by `.github/workflows/publish.yml`)
- Backend: Supabase project `cvxzqiaapppniwpbytjf` (database + sign-in + two functions: `notify` for push, `cal` for the calendar feed). Function code lives in Supabase (Edge Functions).
