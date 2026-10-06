import path from 'node:path';
import type { AppConfig } from './index.js';
import type { DriveFile, DriveService } from './drive.js';
import type { SheetService } from './sheets.js';
import { generateGcode } from './gcode.js';
import { scanSvgFiles, type SvgCandidate } from './scanner.js';
import { parseSvgGeometry } from './svg.js';

export interface ProcessDependencies {
  config: AppConfig;
  drive: DriveService;
  sheets: SheetService;
}

export interface ProcessSummary {
  processed: number;
  generated: number;
  skipped: number;
  failed: number;
}

interface GcodeFileResult {
  file: DriveFile;
  generated: boolean;
}

function outputName(svgName: string, suffix: '3cm' | '2cm'): string {
  const parsed = path.posix.parse(svgName);
  return `${parsed.name}-${suffix}.gcode`;
}

async function ensureGcodeFile(params: {
  drive: DriveService;
  parentFolderId: string;
  fileName: string;
  content: string;
  forceRegenerate: boolean;
}): Promise<GcodeFileResult> {
  const existing = await params.drive.findFileByName(params.parentFolderId, params.fileName);

  if (existing && !params.forceRegenerate) {
    console.log(`[DRIVE] ${params.fileName} already exists -> SKIP`);
    return { file: existing, generated: false };
  }

  if (existing && params.forceRegenerate) {
    console.log(`[DRIVE] Update ${params.fileName}`);
    const file = await params.drive.updateTextFile(existing.id, params.content, 'text/plain');
    return { file, generated: true };
  }

  console.log(`[DRIVE] Upload ${params.fileName}`);
  const file = await params.drive.uploadTextFile(params.parentFolderId, params.fileName, params.content, 'text/plain');
  return { file, generated: true };
}

async function findOrCreateSheetRow(
  candidate: SvgCandidate,
  { config, sheets }: Pick<ProcessDependencies, 'config' | 'sheets'>
): Promise<number | null> {
  const rowNumber = await sheets.findSpreadsheetRow({
    sheetId: config.sheetId,
    sheetName: config.sheetName,
    matchHeader: config.sheetMatchHeader,
    matchValue: candidate.parentFolderName
  });

  if (rowNumber) {
    console.log(`[SHEET] Matching row found: ${rowNumber}`);
    return rowNumber;
  }

  console.log(`[SHEET] Row not found: ${candidate.parentFolderName}`);
  if (!config.createMissingRow) {
    return null;
  }

  const headers = await sheets.getSheetHeaders(config.sheetId, config.sheetName);
  const createdRow = await sheets.appendSpreadsheetRow({
    sheetId: config.sheetId,
    sheetName: config.sheetName,
    headers,
    matchHeader: config.sheetMatchHeader,
    matchValue: candidate.parentFolderName
  });
  console.log(`[SHEET] Created row: ${createdRow}`);
  return createdRow || null;
}

async function processSvg(candidate: SvgCandidate, deps: ProcessDependencies): Promise<{ generated: number; skipped: number }> {
  const { config, drive, sheets } = deps;
  const gcode3cmName = outputName(candidate.file.name, '3cm');
  const gcode2cmName = outputName(candidate.file.name, '2cm');
  const existing3cm = await drive.findFileByName(candidate.parentFolderId, gcode3cmName);
  const existing2cm = await drive.findFileByName(candidate.parentFolderId, gcode2cmName);

  let gcode3cm = '';
  let gcode2cm = '';
  const needsGeneration = config.forceRegenerate || !existing3cm || !existing2cm;

  if (needsGeneration) {
    const svgContent = await drive.downloadFile(candidate.file.id);
    const geometry = parseSvgGeometry(svgContent);

    console.log('[GCODE] Generate 30mm');
    gcode3cm = generateGcode(geometry, 30, config);

    console.log('[GCODE] Generate 20mm');
    gcode2cm = generateGcode(geometry, 20, config);
  }

  const result3cm = await ensureGcodeFile({
    drive,
    parentFolderId: candidate.parentFolderId,
    fileName: gcode3cmName,
    content: gcode3cm,
    forceRegenerate: config.forceRegenerate
  });

  const result2cm = await ensureGcodeFile({
    drive,
    parentFolderId: candidate.parentFolderId,
    fileName: gcode2cmName,
    content: gcode2cm,
    forceRegenerate: config.forceRegenerate
  });

  const verified3cm = await drive.verifyFileInFolder(candidate.parentFolderId, gcode3cmName);
  const verified2cm = await drive.verifyFileInFolder(candidate.parentFolderId, gcode2cmName);
  if (!verified3cm || !verified2cm) {
    throw new Error(`Verify gagal untuk ${candidate.file.name}. Spreadsheet tidak di-update.`);
  }

  const gcode3cmUrl = drive.getFileUrl(verified3cm.id);
  const gcode2cmUrl = drive.getFileUrl(verified2cm.id);
  const rowNumber = await findOrCreateSheetRow(candidate, { config, sheets });

  if (rowNumber) {
    try {
      await sheets.updateGcodeLinks({
        sheetId: config.sheetId,
        sheetName: config.sheetName,
        rowNumber,
        gcode3cmHeader: config.sheetGcode3cmHeader,
        gcode2cmHeader: config.sheetGcode2cmHeader,
        gcode3cmUrl,
        gcode2cmUrl
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Google Sheets update failed: ${message}`);
    }
  }

  console.log(`[DONE] ${candidate.file.name}`);
  return {
    generated: Number(result3cm.generated) + Number(result2cm.generated),
    skipped: Number(!result3cm.generated) + Number(!result2cm.generated)
  };
}

export async function processDriveSvgs(deps: ProcessDependencies): Promise<ProcessSummary> {
  const summary: ProcessSummary = {
    processed: 0,
    generated: 0,
    skipped: 0,
    failed: 0
  };

  console.log('[SCAN] DRIVE');
  for await (const candidate of scanSvgFiles(deps.drive, deps.config.driveRootFolderId)) {
    summary.processed += 1;
    console.log('');
    console.log(`[SCAN] Folder: ${candidate.parentFolderName}`);

    try {
      const result = await processSvg(candidate, deps);
      summary.generated += result.generated;
      summary.skipped += result.skipped;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ERROR] ${candidate.file.name}: ${message}`);
    }
  }

  return summary;
}
