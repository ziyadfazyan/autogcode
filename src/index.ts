import 'dotenv/config';
import { google } from 'googleapis';
import { createDriveClient } from './drive.js';
import { createSheetsClient } from './sheets.js';
import { processDriveSvgs } from './processor.js';

export interface AppConfig {
  driveRootFolderId: string;
  sheetId: string;
  sheetName: string;
  sheetMatchHeader: string;
  sheetGcode3cmHeader: string;
  sheetGcode2cmHeader: string;
  forceRegenerate: boolean;
  createMissingRow: boolean;
  feedRate: number;
  travelFeedRate: number;
  safeZ: number;
  laserMode: boolean;
  laserPower: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Environment variable ${name} wajib diisi.`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} harus berupa angka.`);
  }
  return value;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['true', '1', 'yes', 'y'].includes(raw)) return true;
  if (['false', '0', 'no', 'n'].includes(raw)) return false;
  throw new Error(`Environment variable ${name} harus true atau false.`);
}

function loadConfig(): AppConfig {
  return {
    driveRootFolderId: requiredEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID'),
    sheetId: requiredEnv('SHEET_ID'),
    sheetName: requiredEnv('SHEET_NAME'),
    sheetMatchHeader: requiredEnv('SHEET_MATCH_HEADER'),
    sheetGcode3cmHeader: requiredEnv('SHEET_GCODE_3CM_HEADER'),
    sheetGcode2cmHeader: requiredEnv('SHEET_GCODE_2CM_HEADER'),
    forceRegenerate: optionalBoolean('FORCE_REGENERATE', false),
    createMissingRow: optionalBoolean('CREATE_MISSING_ROW', false),
    feedRate: optionalNumber('FEED_RATE', 1000),
    travelFeedRate: optionalNumber('TRAVEL_FEED_RATE', 3000),
    safeZ: optionalNumber('SAFE_Z', 5),
    laserMode: optionalBoolean('LASER_MODE', false),
    laserPower: optionalNumber('LASER_POWER', 1000)
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const auth = await google.auth.getClient({
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });

  const drive = createDriveClient(auth);
  const sheets = createSheetsClient(auth);
  const summary = await processDriveSvgs({ config, drive, sheets });

  console.log('');
  console.log(`Processed: ${summary.processed}`);
  console.log(`Generated: ${summary.generated}`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`Failed: ${summary.failed}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ERROR] ${message}`);
  process.exitCode = 1;
});
