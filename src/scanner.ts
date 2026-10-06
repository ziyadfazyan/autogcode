import type { DriveFile, DriveService } from './drive.js';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export interface SvgCandidate {
  file: DriveFile;
  parentFolderId: string;
  parentFolderName: string;
}

export async function* scanSvgFiles(
  drive: DriveService,
  rootFolderId: string,
  rootFolderName = 'Root'
): AsyncGenerator<SvgCandidate> {
  const children = await drive.listChildren(rootFolderId);

  for (const child of children) {
    if (child.mimeType === FOLDER_MIME_TYPE) {
      console.log(`[SCAN] Folder: ${child.name}`);
      yield* scanSvgFiles(drive, child.id, child.name);
      continue;
    }

    if (child.name.toLowerCase().endsWith('.svg')) {
      console.log(`[SVG] Found: ${child.name}`);
      yield {
        file: child,
        parentFolderId: rootFolderId,
        parentFolderName: rootFolderName
      };
    }
  }
}
