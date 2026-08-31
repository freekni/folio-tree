import type { ProjectConfig } from './project-files';

type DirectoryEntries = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

type GitHubTreeEntry = { path: string; mode: '100644'; type: 'blob'; sha: string };
type GitHubTreeResponse = { tree: { path: string; type: 'blob' | 'tree'; sha: string }[]; truncated: boolean };

export function parseRepository(value: string) {
  const cleaned = value.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const match = cleaned.match(/(?:https?:\/\/github\.com\/)?([^/]+)\/([^/]+)$/i);
  if (!match) throw new Error('GitHub 저장소 주소를 확인해주세요.');
  return { owner: match[1], repo: match[2] };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { message = (await response.json() as { message?: string }).message || message; } catch { /* keep status */ }
    throw new Error(message);
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

async function collectFiles(root: FileSystemDirectoryHandle) {
  const files: { path: string; file: File }[] = [];
  async function visit(directory: FileSystemDirectoryHandle, prefix: string) {
    for await (const [name, entry] of (directory as DirectoryEntries).entries()) {
      if (name === '.git' || name.startsWith('.DS_Store')) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === 'directory') await visit(entry as FileSystemDirectoryHandle, path);
      else {
        const file = await (entry as FileSystemFileHandle).getFile();
        if (file.size > 20 * 1024 * 1024) throw new Error(`${path} 파일이 20MB보다 커서 백업할 수 없습니다.`);
        files.push({ path, file });
      }
    }
  }
  await visit(root, '');
  return files;
}

export async function backupProject(
  root: FileSystemDirectoryHandle,
  config: ProjectConfig,
  token: string,
  progress: (message: string) => void,
) {
  const { owner, repo } = parseRepository(config.githubRepository);
  const branch = config.branch || 'main';
  progress('로컬 파일을 확인하는 중…');
  const files = await collectFiles(root);

  let headSha: string | null = null;
  let baseTree: string | undefined;
  try {
    const ref = await api<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
    headSha = ref.object.sha;
    const commit = await api<{ tree: { sha: string } }>(`/repos/${owner}/${repo}/git/commits/${headSha}`, token);
    baseTree = commit.tree.sha;
  } catch (error) {
    const message = (error as Error).message;
    if (!message.includes('Reference does not exist') && !message.includes('404') && !message.includes('Not Found')) throw error;
  }

  // GitHub does not allow creating a branch reference in a completely empty
  // repository. Initialize it through the Contents API, then continue with a
  // normal single-tree backup commit.
  if (!headSha) {
    if (files.length === 0) throw new Error('백업할 파일이 없습니다.');
    progress('빈 저장소를 초기화하는 중…');
    const first = files[0];
    const firstBytes = new Uint8Array(await first.file.arrayBuffer());
    const encodedPath = first.path.split('/').map(encodeURIComponent).join('/');
    const initialized = await api<{ commit: { sha: string } }>(`/repos/${owner}/${repo}/contents/${encodedPath}`, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Folio Tree 저장소 초기화',
        content: bytesToBase64(firstBytes),
        branch,
      }),
    });
    headSha = initialized.commit.sha;
    const initialCommit = await api<{ tree: { sha: string } }>(`/repos/${owner}/${repo}/git/commits/${headSha}`, token);
    baseTree = initialCommit.tree.sha;
  }

  const entries: GitHubTreeEntry[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const item = files[index];
    progress(`파일 업로드 중 ${index + 1}/${files.length}`);
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const blob = await api<{ sha: string }>(`/repos/${owner}/${repo}/git/blobs`, token, {
      method: 'POST', body: JSON.stringify({ content: bytesToBase64(bytes), encoding: 'base64' }),
    });
    entries.push({ path: item.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  progress('백업 기록을 만드는 중…');
  const tree = await api<{ sha: string }>(`/repos/${owner}/${repo}/git/trees`, token, {
    method: 'POST', body: JSON.stringify({ ...(baseTree ? { base_tree: baseTree } : {}), tree: entries }),
  });
  const commit = await api<{ sha: string }>(`/repos/${owner}/${repo}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({
      message: `Folio Tree 백업 - ${new Date().toLocaleString('ko-KR')}`,
      tree: tree.sha,
      parents: headSha ? [headSha] : [],
    }),
  });

  await api(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, token, {
    method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  return { commitSha: commit.sha, fileCount: files.length };
}

function base64ToBytes(value: string) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function directoryForFile(root: FileSystemDirectoryHandle, path: string) {
  const parts = path.split('/');
  const filename = parts.pop();
  if (!filename || parts.some((part) => !part || part === '.' || part === '..')) throw new Error('GitHub 저장소에 올바르지 않은 파일 경로가 있습니다.');
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  return { directory, filename };
}

export async function restoreProject(
  target: FileSystemDirectoryHandle,
  config: ProjectConfig,
  token: string,
  progress: (message: string) => void,
) {
  const { owner, repo } = parseRepository(config.githubRepository);
  const branch = config.branch || 'main';
  progress('GitHub 백업 목록을 확인하는 중…');
  const ref = await api<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
  const commit = await api<{ tree: { sha: string } }>(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`, token);
  const tree = await api<GitHubTreeResponse>(`/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`, token);
  if (tree.truncated) throw new Error('저장소 파일 수가 너무 많아 다운로드할 수 없습니다.');

  const files = tree.tree.filter((entry) => entry.type === 'blob');
  if (files.length === 0) throw new Error('다운로드할 백업 파일이 없습니다.');
  for (let index = 0; index < files.length; index += 1) {
    const item = files[index];
    progress(`파일 다운로드 중 ${index + 1}/${files.length}`);
    const blob = await api<{ content: string; encoding: string }>(`/repos/${owner}/${repo}/git/blobs/${item.sha}`, token);
    if (blob.encoding !== 'base64') throw new Error(`${item.path} 파일 형식을 읽을 수 없습니다.`);
    const { directory, filename } = await directoryForFile(target, item.path);
    const file = await directory.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(base64ToBytes(blob.content));
    await writable.close();
  }
  return { fileCount: files.length };
}
