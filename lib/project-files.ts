export type ProjectConfig = {
  version: 1;
  name: string;
  githubRepository: string;
  branch: string;
  lastBackupAt?: string;
};

export type TreeNode = {
  name: string;
  path: string;
  handle: FileSystemDirectoryHandle;
  children: TreeNode[];
};

export type Attachment = {
  name: string;
  handle: FileSystemFileHandle;
  size: number;
};

type DirectoryEntries = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}

const CONFIG_FILE = 'project.json';
const CONTENT_FILE = 'content.html';
const DB_NAME = 'folio-tree';

export async function ensurePermission(handle: FileSystemDirectoryHandle, request = true) {
  const permissionHandle = handle as PermissionHandle;
  if (await permissionHandle.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
  return request && await permissionHandle.requestPermission({ mode: 'readwrite' }) === 'granted';
}

export async function writeText(directory: FileSystemDirectoryHandle, name: string, contents: string) {
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
}

export async function readText(directory: FileSystemDirectoryHandle, name: string) {
  try {
    return await (await (await directory.getFileHandle(name)).getFile()).text();
  } catch (error) {
    if ((error as DOMException).name === 'NotFoundError') return null;
    throw error;
  }
}

export async function loadProjectConfig(root: FileSystemDirectoryHandle): Promise<ProjectConfig> {
  const raw = await readText(root, CONFIG_FILE);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
      return {
        version: 1,
        name: parsed.name || root.name,
        githubRepository: parsed.githubRepository || '',
        branch: parsed.branch || 'main',
        lastBackupAt: parsed.lastBackupAt,
      };
    } catch { /* A valid config is recreated below. */ }
  }
  const config: ProjectConfig = { version: 1, name: root.name, githubRepository: '', branch: 'main' };
  await saveProjectConfig(root, config);
  return config;
}

export async function saveProjectConfig(root: FileSystemDirectoryHandle, config: ProjectConfig) {
  await writeText(root, CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
}

export async function readTree(root: FileSystemDirectoryHandle): Promise<TreeNode> {
  async function visit(handle: FileSystemDirectoryHandle, path: string): Promise<TreeNode> {
    const children: TreeNode[] = [];
    for await (const [name, entry] of (handle as DirectoryEntries).entries()) {
      if (entry.kind === 'directory' && !name.startsWith('.')) {
        children.push(await visit(entry as FileSystemDirectoryHandle, path ? `${path}/${name}` : name));
      }
    }
    children.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return { name: handle.name, path, handle, children };
  }
  return visit(root, '');
}

export async function loadDocument(directory: FileSystemDirectoryHandle) {
  const raw = await readText(directory, CONTENT_FILE);
  if (!raw) return '';
  const parsed = new DOMParser().parseFromString(raw, 'text/html');
  parsed.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove());
  parsed.body.querySelectorAll('*').forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.toLowerCase().startsWith('on')) node.removeAttribute(attribute.name);
    }
  });
  return parsed.body.innerHTML;
}

export async function saveDocument(directory: FileSystemDirectoryHandle, title: string, bodyHtml: string) {
  const safeTitle = title.replace(/[<>&"]/g, '');
  const documentHtml = `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${safeTitle}</title>\n<style>body{max-width:820px;margin:48px auto;padding:0 28px;color:#252820;font:16px/1.8 "Malgun Gothic",sans-serif}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px}</style>\n</head>\n<body>${bodyHtml}</body>\n</html>\n`;
  await writeText(directory, CONTENT_FILE, documentHtml);
}

export async function createChild(parent: FileSystemDirectoryHandle, name: string) {
  const child = await parent.getDirectoryHandle(name, { create: true });
  await saveDocument(child, name, '');
  return child;
}

async function copyFile(source: FileSystemFileHandle, target: FileSystemDirectoryHandle, name: string) {
  const file = await source.getFile();
  const targetFile = await target.getFileHandle(name, { create: true });
  const writable = await targetFile.createWritable();
  await writable.write(file);
  await writable.close();
}

async function copyDirectory(source: FileSystemDirectoryHandle, target: FileSystemDirectoryHandle) {
  for await (const [name, entry] of (source as DirectoryEntries).entries()) {
    if (entry.kind === 'file') await copyFile(entry as FileSystemFileHandle, target, name);
    else {
      const childTarget = await target.getDirectoryHandle(name, { create: true });
      await copyDirectory(entry as FileSystemDirectoryHandle, childTarget);
    }
  }
}

export async function renameChild(parent: FileSystemDirectoryHandle, oldName: string, newName: string) {
  const source = await parent.getDirectoryHandle(oldName);
  const target = await parent.getDirectoryHandle(newName, { create: true });
  await copyDirectory(source, target);
  await parent.removeEntry(oldName, { recursive: true });
}

export async function listAttachments(directory: FileSystemDirectoryHandle): Promise<Attachment[]> {
  const items: Attachment[] = [];
  for await (const [name, entry] of (directory as DirectoryEntries).entries()) {
    if (entry.kind !== 'file' || name === CONTENT_FILE || name === CONFIG_FILE || name.startsWith('.')) continue;
    const handle = entry as FileSystemFileHandle;
    const file = await handle.getFile();
    items.push({ name, handle, size: file.size });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export async function addAttachments(directory: FileSystemDirectoryHandle, files: FileList) {
  for (const file of Array.from(files)) {
    const handle = await directory.getFileHandle(file.name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
  }
}

export async function rememberProject(handle: FileSystemDirectoryHandle) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('handles', 'readwrite');
      transaction.objectStore('handles').put(handle, 'recent');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

export async function recentProject(): Promise<FileSystemDirectoryHandle | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const result = request.result.transaction('handles').objectStore('handles').get('recent');
      result.onsuccess = () => resolve((result.result as FileSystemDirectoryHandle | undefined) || null);
      result.onerror = () => resolve(null);
    };
  });
}

export function validNodeName(name: string) {
  return !!name.trim() && !/[\\/:*?"<>|]/.test(name) && name !== '.' && name !== '..';
}
