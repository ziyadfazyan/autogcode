import 'dotenv/config';
import { google } from 'googleapis';
import { createDriveClient } from './drive.js';
import { createSheetsClient } from './sheets.js';
import { processDriveSvgs } from './processor.js';
import type { ToolMode } from './gcode.js';

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
  drawFeedRate: number;
  travelFeedRate: number;
  safeZ: number;
  toolMode: ToolMode;
  toolOnCommand: string;
  toolOffCommand: string;
  laserOnCommand: string;
  laserOffCommand: string;
  laserDelay: number;
  laserPower: number;
  penUpZ: number;
  penDownZ: number;
  penUpCommand: string;
  penDownCommand: string;
  penDelay: number;
  passes: number;
  passDepth: number;
  offsetX: number;
  offsetY: number;
  mirrorX: boolean;
  mirrorY: boolean;
  returnToOrigin: boolean;
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

function optionalString(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function optionalToolMode(): ToolMode {
  const value = optionalString('TOOL_MODE', 'pen').toLowerCase();
  if (value === 'laser' || value === 'pen' || value === 'spindle') {
    return value;
  }
  throw new Error('Environment variable TOOL_MODE harus laser, pen, atau spindle.');
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
    drawFeedRate: optionalNumber('DRAW_FEED_RATE', optionalNumber('FEED_RATE', 2500)),
    travelFeedRate: optionalNumber('TRAVEL_FEED_RATE', 10000),
    safeZ: optionalNumber('SAFE_Z', 5),
    toolMode: optionalToolMode(),
    toolOnCommand: optionalString('TOOL_ON_COMMAND', 'M03 S0'),
    toolOffCommand: optionalString('TOOL_OFF_COMMAND', 'M03 S200'),
    laserOnCommand: optionalString('LASER_ON_COMMAND', optionalString('TOOL_ON_COMMAND', 'M03 S0')),
    laserOffCommand: optionalString('LASER_OFF_COMMAND', optionalString('TOOL_OFF_COMMAND', 'M03 S200')),
    laserDelay: optionalNumber('LASER_DELAY', 0.2),
    laserPower: optionalNumber('LASER_POWER', 1000),
    penUpZ: optionalNumber('PEN_UP_Z', 5),
    penDownZ: optionalNumber('PEN_DOWN_Z', 0),
    penUpCommand: optionalString('PEN_UP_COMMAND', 'M03 S200'),
    penDownCommand: optionalString('PEN_DOWN_COMMAND', 'M03 S0'),
    penDelay: optionalNumber('PEN_DELAY', 0.2),
    passes: optionalNumber('PASSES', 1),
    passDepth: optionalNumber('PASS_DEPTH', 2.0),
    offsetX: optionalNumber('OFFSET_X', 0),
    offsetY: optionalNumber('OFFSET_Y', 0),
    mirrorX: optionalBoolean('MIRROR_X', false),
    mirrorY: optionalBoolean('MIRROR_Y', false),
    returnToOrigin: optionalBoolean('RETURN_TO_ORIGIN', true)
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
