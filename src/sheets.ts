import { google, sheets_v4 } from 'googleapis';

type GoogleAuthClient = any;

export interface SheetService {
  getSheetHeaders(sheetId: string, sheetName: string): Promise<string[]>;
  findSpreadsheetRow(params: FindSpreadsheetRowParams): Promise<number | null>;
  appendSpreadsheetRow(params: AppendSpreadsheetRowParams): Promise<number>;
  updateGcodeLinks(params: UpdateGcodeLinksParams): Promise<void>;
  getRowValues(sheetId: string, sheetName: string, rowNumber: number): Promise<string[]>;
  findColumnByHeader(headers: string[], headerName: string): number;
}

export interface FindSpreadsheetRowParams {
  sheetId: string;
  sheetName: string;
  matchHeader: string;
  matchValue: string;
}

export interface AppendSpreadsheetRowParams {
  sheetId: string;
  sheetName: string;
  headers: string[];
  matchHeader: string;
  matchValue: string;
}

export interface UpdateGcodeLinksParams {
  sheetId: string;
  sheetName: string;
  rowNumber: number;
  gcode3cmHeader: string;
  gcode2cmHeader: string;
  gcode3cmUrl: string;
  gcode2cmUrl: string;
}

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function columnLetter(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function normalizeCell(value: unknown): string {
  return String(value ?? '').trim();
}

function findColumnByHeader(headers: string[], headerName: string): number {
  const index = headers.findIndex((header) => header.trim() === headerName.trim());
  if (index === -1) {
    console.log(`[SHEET] Header not found: ${headerName}`);
    throw new Error(`Header "${headerName}" tidak ditemukan.`);
  }
  return index;
}

export function createSheetsClient(auth: GoogleAuthClient): SheetService {
  const sheets = google.sheets({ version: 'v4', auth });
  const service: SheetService = {
    async getSheetHeaders(sheetId: string, sheetName: string): Promise<string[]> {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${quoteSheetName(sheetName)}!1:1`
      });
      const headers = (response.data.values?.[0] ?? []).map(normalizeCell);
      if (headers.length === 0) {
        throw new Error('Header spreadsheet kosong.');
      }
      return headers;
    },

    async findSpreadsheetRow(params: FindSpreadsheetRowParams): Promise<number | null> {
      const headers = await service.getSheetHeaders(params.sheetId, params.sheetName);
      const matchColumnIndex = findColumnByHeader(headers, params.matchHeader);
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: params.sheetId,
        range: `${quoteSheetName(params.sheetName)}!A:ZZZ`
      });
      const rows = response.data.values ?? [];

      for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        if (normalizeCell(rows[rowIndex]?.[matchColumnIndex]) === params.matchValue.trim()) {
          return rowIndex + 1;
        }
      }

      return null;
    },

    async appendSpreadsheetRow(params: AppendSpreadsheetRowParams): Promise<number> {
      const matchColumnIndex = findColumnByHeader(params.headers, params.matchHeader);
      const row = new Array(params.headers.length).fill('');
      row[matchColumnIndex] = params.matchValue;
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: params.sheetId,
        range: `${quoteSheetName(params.sheetName)}!A:ZZZ`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [row]
        }
      });
      const updatedRange = response.data.updates?.updatedRange ?? '';
      const rowMatch = updatedRange.match(/![A-Z]+(\d+):/);
      return rowMatch ? Number(rowMatch[1]) : (await service.findSpreadsheetRow({
        sheetId: params.sheetId,
        sheetName: params.sheetName,
        matchHeader: params.matchHeader,
        matchValue: params.matchValue
      })) ?? 0;
    },

    async updateGcodeLinks(params: UpdateGcodeLinksParams): Promise<void> {
      const headers = await this.getSheetHeaders(params.sheetId, params.sheetName);
      const gcode3cmColumnIndex = findColumnByHeader(headers, params.gcode3cmHeader);
      const gcode2cmColumnIndex = findColumnByHeader(headers, params.gcode2cmHeader);
      const currentRow = await service.getRowValues(params.sheetId, params.sheetName, params.rowNumber);
      const updates: sheets_v4.Schema$ValueRange[] = [];

      if (normalizeCell(currentRow[gcode3cmColumnIndex]) !== params.gcode3cmUrl) {
        console.log(`[SHEET] Update ${params.gcode3cmHeader}`);
        updates.push({
          range: `${quoteSheetName(params.sheetName)}!${columnLetter(gcode3cmColumnIndex)}${params.rowNumber}`,
          values: [[params.gcode3cmUrl]]
        });
      }

      if (normalizeCell(currentRow[gcode2cmColumnIndex]) !== params.gcode2cmUrl) {
        console.log(`[SHEET] Update ${params.gcode2cmHeader}`);
        updates.push({
          range: `${quoteSheetName(params.sheetName)}!${columnLetter(gcode2cmColumnIndex)}${params.rowNumber}`,
          values: [[params.gcode2cmUrl]]
        });
      }

      if (updates.length === 0) {
        console.log('[SHEET] Links already up to date -> SKIP');
        return;
      }

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: params.sheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: updates
        }
      });
    },

    async getRowValues(sheetId: string, sheetName: string, rowNumber: number): Promise<string[]> {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${quoteSheetName(sheetName)}!${rowNumber}:${rowNumber}`
      });
      return (response.data.values?.[0] ?? []).map(normalizeCell);
    },

    findColumnByHeader
  };

  return service;
}
