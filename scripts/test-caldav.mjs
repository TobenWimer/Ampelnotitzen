// Testet die CalDAV-Verbindung zu iCloud (Kalender + Erinnerungen).
// Legt NICHTS an, listet nur vorhandene Kalender/Listen auf.
//
// Vorbereitung: APPLE_ID und APPLE_APP_PASSWORD in .env.local eintragen
// (App-spezifisches Passwort von appleid.apple.com, nicht das normale Passwort).
//
// Nutzung:
//   node --env-file=.env.local scripts/test-caldav.mjs

import { createDAVClient } from "tsdav";

const { APPLE_ID, APPLE_APP_PASSWORD } = process.env;

if (!APPLE_ID || !APPLE_APP_PASSWORD) {
  console.error("APPLE_ID oder APPLE_APP_PASSWORD fehlt in .env.local");
  process.exit(1);
}

const client = await createDAVClient({
  serverUrl: "https://caldav.icloud.com",
  credentials: { username: APPLE_ID, password: APPLE_APP_PASSWORD },
  authMethod: "Basic",
  defaultAccountType: "caldav",
});

const calendars = await client.fetchCalendars();

console.log(`Verbunden. ${calendars.length} Kalender/Listen gefunden:\n`);
for (const cal of calendars) {
  const components = cal.components?.join(",") ?? "?";
  console.log(`- ${cal.displayName}  [${components}]  ${cal.url}`);
}
