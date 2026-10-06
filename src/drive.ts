import { Readable } from 'node:stream';
import { google, drive_v3 } from 'googleapis';

type GoogleAuthClient = any;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
}

export interface DriveFolder {
  id: string;
  name: string;
  parents: string[];
}

export interface DriveService {
  listChildren(folderId: string): Promise<DriveFile[]>;
  downloadFile(fileId: string): Promise<string>;
  findFileByName(parentFolderId: string, fileName: string): Promise<DriveFile | null>;
  uploadTextFile(parentFolderId: string, fileName: string, content: string, mimeType: string): Promise<DriveFile>;
  updateTextFile(fileId: string, content: string, mimeType: string): Promise<DriveFile>;
  verifyFileInFolder(parentFolderId: string, fileName: string): Promise<DriveFile | null>;
  getFileUrl(fileId: string): string;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function asDriveFile(file: drive_v3.Schema$File): DriveFile {
  if (!file.id || !file.name || !file.mimeType) {
    throw new Error('Google Drive mengembalikan file tanpa id/name/mimeType.');
  }
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents ?? []
  };
}

function bufferToStream(content: string): Readable {
  return Readable.from([Buffer.from(content, 'utf8')]);
}

export function createDriveClient(auth: GoogleAuthClient): DriveService {
  const drive = google.drive({ version: 'v3', auth });
  const service: DriveService = {
    async listChildren(folderId: string): Promise<DriveFile[]> {
      const files: DriveFile[] = [];
      let pageToken: string | undefined;

      do {
        const response = await drive.files.list({
          q: `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id, name, mimeType, parents)',
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });

        for (const file of response.data.files ?? []) {
          files.push(asDriveFile(file));
        }
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);

      return files;
    },

    async downloadFile(fileId: string): Promise<string> {
      const response = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
      );
      return Buffer.from(response.data as ArrayBuffer).toString('utf8');
    },

    async findFileByName(parentFolderId: string, fileName: string): Promise<DriveFile | null> {
      const response = await drive.files.list({
        q: `'${escapeDriveQueryValue(parentFolderId)}' in parents and name = '${escapeDriveQueryValue(fileName)}' and trashed = false`,
        fields: 'files(id, name, mimeType, parents)',
        pageSize: 10,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      const [file] = response.data.files ?? [];
      return file ? asDriveFile(file) : null;
    },

    async uploadTextFile(parentFolderId: string, fileName: string, content: string, mimeType: string): Promise<DriveFile> {
      const response = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [parentFolderId],
          mimeType
        },
        media: {
          mimeType,
          body: bufferToStream(content)
        },
        fields: 'id, name, mimeType, parents',
        supportsAllDrives: true
      });
      return asDriveFile(response.data);
    },

    async updateTextFile(fileId: string, content: string, mimeType: string): Promise<DriveFile> {
      const response = await drive.files.update({
        fileId,
        media: {
          mimeType,
          body: bufferToStream(content)
        },
        fields: 'id, name, mimeType, parents',
        supportsAllDrives: true
      });
      return asDriveFile(response.data);
    },

    async verifyFileInFolder(parentFolderId: string, fileName: string): Promise<DriveFile | null> {
      return service.findFileByName(parentFolderId, fileName);
    },

    getFileUrl(fileId: string): string {
      return `https://drive.google.com/file/d/${fileId}/view`;
    }
  };

  return service;
}
