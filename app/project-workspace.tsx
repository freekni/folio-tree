'use client';

import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useGroupRef } from 'react-resizable-panels';
import {
  AlertCircle, Bold, CalendarDays, Check, ChevronDown, ChevronRight, CloudUpload, Download, File,
  Folder, FolderOpen, FolderPlus, Italic, Link, List, ListOrdered, MoreHorizontal,
  GitBranch, LogIn, Paperclip, Pencil, Plus, Redo2, Settings, Settings2, Trash2, Underline, Undo2, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { authorizeGitHub, githubAppInstallUrl, githubAuthConfigured, GitHubSession, sessionIsValid } from '@/lib/github-auth';
import { backupProject, restoreProject } from '@/lib/github-backup';
import {
  addAttachments, Attachment, childDirectory, createChild, DAILY_NOTES_FOLDER, dailyNotePath,
  ensureDailyMonthFolder, ensurePermission, findDailyNote, listAttachments, loadDocument,
  loadProjectConfig, localDateName, moveChild, organizeDailyNotes, ProjectConfig, readTree,
  recentProject, rememberProject, renameChild, saveDocument, saveProjectConfig, setChildPosition,
  TreeNode, validNodeName,
} from '@/lib/project-files';

type NodeAction = { kind: 'add' | 'rename' | 'delete'; node: TreeNode } | null;
type DropPosition = 'before' | 'inside' | 'after';
type DropTarget = { path: string; position: DropPosition } | null;
type EditorDefaults = { fontFamily: string; fontSize: string; lineHeight: string };
const EDITOR_DEFAULTS_KEY = 'folio-tree:editor-defaults';
const DEFAULT_EDITOR_DEFAULTS: EditorDefaults = { fontFamily: 'Malgun Gothic', fontSize: '16', lineHeight: '1.8' };
const EDITOR_FONTS = ['Malgun Gothic', 'Arial', 'Georgia', 'Batang'];
const EDITOR_SIZES = ['10', '12', '14', '16', '18', '24'];
const EDITOR_LINE_HEIGHTS = ['1', '1.2', '1.4', '1.6', '1.8', '2'];

function loadEditorDefaults(): EditorDefaults {
  if (typeof window === 'undefined') return DEFAULT_EDITOR_DEFAULTS;
  try {
    const saved = JSON.parse(localStorage.getItem(EDITOR_DEFAULTS_KEY) || 'null') as Partial<EditorDefaults> | null;
    if (saved && EDITOR_FONTS.includes(saved.fontFamily || '') && EDITOR_SIZES.includes(saved.fontSize || '') && EDITOR_LINE_HEIGHTS.includes(saved.lineHeight || '')) {
      return { fontFamily: saved.fontFamily!, fontSize: saved.fontSize!, lineHeight: saved.lineHeight! };
    }
  } catch { /* Invalid preferences use the built-in defaults. */ }
  return DEFAULT_EDITOR_DEFAULTS;
}

function findNode(root: TreeNode | null, path: string): TreeNode | null {
  if (!root) return null;
  if (root.path === path) return root;
  for (const child of root.children) {
    const found = findNode(child, path);
    if (found) return found;
  }
  return null;
}

function parentPath(path: string) {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function expandedStorageKey(projectName: string) {
  return `folio-tree:expanded:${encodeURIComponent(projectName)}`;
}

function selectedStorageKey(projectName: string) {
  return `folio-tree:selected:${encodeURIComponent(projectName)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function TreeItem({
  node, depth, selectedPath, expanded, draggingPath, dropTarget,
  onSelect, onToggle, onAction, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  node: TreeNode; depth: number; selectedPath: string; expanded: Set<string>;
  draggingPath: string | null; dropTarget: DropTarget;
  onSelect: (node: TreeNode) => void; onToggle: (path: string) => void;
  onAction: (action: NodeAction) => void;
  onDragStart: (node: TreeNode, event: DragEvent<HTMLElement>) => void;
  onDragOver: (node: TreeNode, event: DragEvent<HTMLElement>) => void;
  onDrop: (node: TreeNode, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const isExpanded = expanded.has(node.path);
  const hasChildren = node.children.length > 0;
  const isDailyNotesRoot = node.path === DAILY_NOTES_FOLDER;
  return <>
    <ContextMenu>
      <ContextMenuTrigger
        render={<div />}
        className={`tree-row ${selectedPath === node.path ? 'selected' : ''} ${draggingPath === node.path ? 'dragging' : ''} ${dropTarget?.path === node.path ? `drop-${dropTarget.position}` : ''}`}
        style={{ paddingLeft: 8 + depth * 20 }}
        onClick={() => onSelect(node)}
        draggable={depth > 0 && !isDailyNotesRoot}
        onDragStart={(event) => onDragStart(node, event)}
        onDragOver={(event) => onDragOver(node, event)}
        onDrop={(event) => onDrop(node, event)}
        onDragEnd={onDragEnd}
        title={depth > 0 && !isDailyNotesRoot ? '위·아래에 놓아 순서 변경, 가운데에 놓아 하위로 이동' : undefined}
      >
        <span className="tree-toggle" onClick={(event) => { event.stopPropagation(); if (hasChildren) onToggle(node.path); }}>
          {hasChildren ? (isExpanded ? <ChevronDown /> : <ChevronRight />) : null}
        </span>
        {isExpanded && hasChildren ? <FolderOpen /> : <Folder />}
        <span className="tree-name">{node.name}</span>
        <span className="tree-row-actions">
          {node.attachmentCount > 0 && <span className="tree-attachment-badge" title={`첨부파일 ${node.attachmentCount}개`}><Paperclip /><span>{node.attachmentCount}</span></span>}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<button type="button" className="tree-more-button" aria-label={`${node.name} 메뉴`} />}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="tree-action-menu" align="end" side="bottom">
              <DropdownMenuItem onClick={() => onAction({ kind: 'add', node })}><FolderPlus />하위 항목 추가</DropdownMenuItem>
              {depth > 0 && !isDailyNotesRoot && <DropdownMenuItem onClick={() => onAction({ kind: 'rename', node })}><Pencil />이름 변경</DropdownMenuItem>}
              {depth > 0 && !isDailyNotesRoot && <DropdownMenuSeparator />}
              {depth > 0 && !isDailyNotesRoot && <DropdownMenuItem variant="destructive" onClick={() => onAction({ kind: 'delete', node })}><Trash2 />삭제</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="tree-action-menu">
        <ContextMenuItem onClick={() => onAction({ kind: 'add', node })}><FolderPlus />하위 항목 추가</ContextMenuItem>
        {depth > 0 && !isDailyNotesRoot && <ContextMenuItem onClick={() => onAction({ kind: 'rename', node })}><Pencil />이름 변경</ContextMenuItem>}
        {depth > 0 && !isDailyNotesRoot && <ContextMenuSeparator />}
        {depth > 0 && !isDailyNotesRoot && <ContextMenuItem variant="destructive" onClick={() => onAction({ kind: 'delete', node })}><Trash2 />삭제</ContextMenuItem>}
      </ContextMenuContent>
    </ContextMenu>
    {isExpanded && node.children.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} expanded={expanded} draggingPath={draggingPath} dropTarget={dropTarget} onSelect={onSelect} onToggle={onToggle} onAction={onAction} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />)}
  </>;
}

export default function ProjectWorkspace() {
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recent, setRecent] = useState<FileSystemDirectoryHandle | null>(null);
  const [nodeAction, setNodeAction] = useState<NodeAction>(null);
  const [nodeName, setNodeName] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [editorDefaults, setEditorDefaults] = useState<EditorDefaults>(() => loadEditorDefaults());
  const [preferenceDraft, setPreferenceDraft] = useState<EditorDefaults>(() => loadEditorDefaults());
  const [repositoryInput, setRepositoryInput] = useState('');
  const [branchInput, setBranchInput] = useState('main');
  const [backupOpen, setBackupOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreFolderName, setRestoreFolderName] = useState('');
  const [restoreParent, setRestoreParent] = useState<FileSystemDirectoryHandle | null>(null);
  const [githubSession, setGithubSession] = useState<GitHubSession | null>(null);
  const [backupStatus, setBackupStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; message: string } | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [todaySaveState, setTodaySaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [todayDate] = useState(() => localDateName());
  const [todayHandle, setTodayHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [todayHtml, setTodayHtml] = useState('');
  const [documentHtml, setDocumentHtml] = useState('');
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const todayEditorRef = useRef<HTMLDivElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todaySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todayDirty = useRef(false);
  const todayRevision = useRef(0);
  const autoOpenAttempted = useRef(false);
  const workspaceGroupRef = useGroupRef();
  const todayYear = todayDate.slice(0, 4);
  const todayMonth = todayDate.slice(0, 7);
  const todayPath = dailyNotePath(todayDate);

  useEffect(() => {
    if (autoOpenAttempted.current) return;
    autoOpenAttempted.current = true;
    recentProject().then(async (handle) => {
      setRecent(handle);
      if (!handle || !await ensurePermission(handle, false)) return;
      try {
        await connectProject(handle);
      } catch (error) {
        setNotice({ type: 'error', message: `최근 프로젝트를 열지 못했습니다: ${(error as Error).message}` });
      }
    });
  }, []);
  useEffect(() => {
    if (!root) return;
    try {
      const saved = localStorage.getItem('folio-tree:workspace-layout');
      if (!saved) return;
      const layout = JSON.parse(saved) as { tree?: number; editor?: number; daily?: number };
      if (typeof layout.tree === 'number' && typeof layout.editor === 'number' && typeof layout.daily === 'number') {
        workspaceGroupRef.current?.setLayout({ tree: layout.tree, editor: layout.editor, daily: layout.daily });
      }
    } catch { /* Use the default layout when stored preferences are invalid. */ }
  }, [root, workspaceGroupRef]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (todayEditorRef.current) todayEditorRef.current.innerHTML = todayHtml;
  }, [todayHtml, root]);
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = documentHtml;
  }, [documentHtml, root]);
  // Re-read the current day's note after the workspace mounts. This also covers
  // reopening a remembered project where the editor DOM did not exist yet when
  // the project connection started.
  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    findDailyNote(root, todayDate).then(async (handle) => {
      if (cancelled) return;
      const html = handle ? await loadDocument(handle) : '';
      if (cancelled) return;
      setTodayHandle(handle);
      setTodayHtml(html);
      if (todayEditorRef.current) todayEditorRef.current.innerHTML = html;
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [root, todayDate]);
  useEffect(() => {
    for (const editor of [editorRef.current, todayEditorRef.current]) {
      if (!editor) continue;
      editor.style.fontFamily = editorDefaults.fontFamily;
      editor.style.fontSize = `${editorDefaults.fontSize}px`;
      editor.style.lineHeight = editorDefaults.lineHeight;
    }
  }, [editorDefaults, selected, root, todayHtml]);
  useEffect(() => {
    if (!root) return;
    localStorage.setItem(expandedStorageKey(root.name), JSON.stringify(Array.from(expanded)));
  }, [expanded, root]);
  useEffect(() => {
    if (!root || !selected) return;
    localStorage.setItem(selectedStorageKey(root.name), selected.path);
  }, [root, selected]);

  const refresh = useCallback(async (directory: FileSystemDirectoryHandle, selectedPath = '') => {
    const nextTree = await readTree(directory);
    const nextSelected = findNode(nextTree, selectedPath) || nextTree;
    const html = await loadDocument(nextSelected.handle);
    setTree(nextTree); setSelected(nextSelected); setDocumentHtml(html);
    setAttachments(await listAttachments(nextSelected.handle));
    if (editorRef.current) editorRef.current.innerHTML = html;
  }, []);

  async function connectProject(handle: FileSystemDirectoryHandle) {
    if (!await ensurePermission(handle)) throw new Error('선택한 폴더에 대한 읽기·쓰기 권한이 필요합니다.');
    const nextConfig = await loadProjectConfig(handle);
    await organizeDailyNotes(handle);
    const existingToday = await findDailyNote(handle, todayDate);
    setTodayHandle(existingToday);
    setTodayHtml(existingToday ? await loadDocument(existingToday) : '');
    setTodaySaveState('saved');
    todayDirty.current = false;
    todayRevision.current = 0;
    let restoredExpanded: Set<string> | null = null;
    let restoredSelectedPath = '';
    try {
      const saved = localStorage.getItem(expandedStorageKey(handle.name));
      if (saved !== null) {
        const paths = JSON.parse(saved);
        if (Array.isArray(paths)) restoredExpanded = new Set(paths.filter((path): path is string => typeof path === 'string'));
      }
      restoredSelectedPath = localStorage.getItem(selectedStorageKey(handle.name)) || '';
    } catch { /* Invalid saved state falls back to the default expansion. */ }
    if (restoredExpanded) {
      setExpanded(restoredExpanded);
    } else {
      const initialExpanded = new Set(['', DAILY_NOTES_FOLDER]);
      if (existingToday) {
        initialExpanded.add(`${DAILY_NOTES_FOLDER}/${todayYear}`);
        initialExpanded.add(`${DAILY_NOTES_FOLDER}/${todayYear}/${todayMonth}`);
      }
      setExpanded(initialExpanded);
    }
    await refresh(handle, restoredSelectedPath);
    setRoot(handle); setConfig(nextConfig); setRepositoryInput(nextConfig.githubRepository); setBranchInput(nextConfig.branch);
    await rememberProject(handle); setRecent(handle);
  }

  async function chooseFolder() {
    try {
      if (!window.showDirectoryPicker) throw new Error('Edge 또는 Chrome 최신 버전에서 열어주세요.');
      await connectProject(await window.showDirectoryPicker({ mode: 'readwrite' }));
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setNotice({ type: 'error', message: (error as Error).message });
    }
  }

  async function saveCurrent() {
    if (!selected || !editorRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    const html = editorRef.current.innerHTML;
    const todayRevisionAtSave = todayRevision.current;
    try {
      await saveDocument(selected.handle, selected.name, html);
      setSaveState('saved');
      if (selected.path === todayPath) {
        if (todayRevision.current === todayRevisionAtSave) {
          if (todayEditorRef.current) todayEditorRef.current.innerHTML = html;
          todayDirty.current = false;
          setTodaySaveState('saved');
        }
      }
    }
    catch { setSaveState('error'); }
  }

  function scheduleSave() {
    setSaveState('saving');
    if (selected?.path === todayPath && editorRef.current && todayEditorRef.current) {
      todayEditorRef.current.innerHTML = editorRef.current.innerHTML;
      todayDirty.current = true;
      todayRevision.current += 1;
      setTodaySaveState('saving');
      if (todaySaveTimer.current) clearTimeout(todaySaveTimer.current);
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveCurrent, 650);
  }

  async function saveToday() {
    if (!root || !todayEditorRef.current || !todayDirty.current) return;
    if (todaySaveTimer.current) clearTimeout(todaySaveTimer.current);
    setTodaySaveState('saving');
    const html = todayEditorRef.current.innerHTML;
    const revisionAtSave = todayRevision.current;
    try {
      const monthFolder = await ensureDailyMonthFolder(root, todayDate);
      const existing = todayHandle || await childDirectory(monthFolder, todayDate);
      const noteHandle = existing || await createChild(monthFolder, todayDate);
      await saveDocument(noteHandle, todayDate, html);
      setTodayHandle(noteHandle);
      if (todayRevision.current === revisionAtSave) {
        todayDirty.current = false;
        setTodaySaveState('saved');
      }
      if (selected?.path === todayPath && editorRef.current && todayRevision.current === revisionAtSave) {
        editorRef.current.innerHTML = html;
        setSaveState('saved');
      }
      if (!existing) {
        const nextTree = await readTree(root);
        setTree(nextTree);
        setSelected((current) => current ? findNode(nextTree, current.path) || nextTree : nextTree);
        setExpanded((current) => {
          const next = new Set(current);
          next.add(DAILY_NOTES_FOLDER);
          next.add(`${DAILY_NOTES_FOLDER}/${todayYear}`);
          next.add(`${DAILY_NOTES_FOLDER}/${todayYear}/${todayMonth}`);
          return next;
        });
      }
    } catch {
      setTodaySaveState('error');
    }
  }

  function scheduleTodaySave() {
    todayDirty.current = true;
    todayRevision.current += 1;
    setTodaySaveState('saving');
    if (selected?.path === todayPath && editorRef.current && todayEditorRef.current) {
      editorRef.current.innerHTML = todayEditorRef.current.innerHTML;
      setSaveState('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
    }
    if (todaySaveTimer.current) clearTimeout(todaySaveTimer.current);
    todaySaveTimer.current = setTimeout(saveToday, 650);
  }

  async function selectNode(node: TreeNode) {
    await saveCurrent();
    await saveToday();
    setSelected(node);
    const html = await loadDocument(node.handle);
    setDocumentHtml(html);
    if (editorRef.current) editorRef.current.innerHTML = html;
    if (node.path === todayPath && todayEditorRef.current) todayEditorRef.current.innerHTML = html;
    setAttachments(await listAttachments(node.handle));
  }

  function openNodeAction(action: NodeAction) {
    setNodeAction(action); setNodeName(action?.kind === 'rename' ? action.node.name : '');
  }

  function dropPosition(node: TreeNode, event: DragEvent<HTMLElement>): DropPosition {
    if (!node.path) return 'inside';
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    if (ratio < 0.28) return 'before';
    if (ratio > 0.72) return 'after';
    return 'inside';
  }

  function destinationParentPath(targetPath: string, position: DropPosition) {
    return position === 'inside' ? targetPath : parentPath(targetPath);
  }

  function canDropNode(sourcePath: string, targetPath: string, position: DropPosition) {
    if (!sourcePath || sourcePath === targetPath) return false;
    const destinationPath = destinationParentPath(targetPath, position);
    if (destinationPath === sourcePath || destinationPath.startsWith(`${sourcePath}/`)) return false;
    if (position === 'inside' && parentPath(sourcePath) === destinationPath) return false;
    return true;
  }

  function startTreeDrag(node: TreeNode, event: DragEvent<HTMLElement>) {
    if (!node.path) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', node.path);
    setDraggingPath(node.path);
    setDropTarget(null);
  }

  function dragOverTreeNode(node: TreeNode, event: DragEvent<HTMLElement>) {
    event.stopPropagation();
    const position = dropPosition(node, event);
    if (!draggingPath || !canDropNode(draggingPath, node.path, position)) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget({ path: node.path, position });
  }

  async function dropTreeNode(target: TreeNode, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const sourcePath = draggingPath || event.dataTransfer.getData('text/plain');
    const position = dropTarget?.path === target.path ? dropTarget.position : dropPosition(target, event);
    setDropTarget(null);
    if (!root || !tree || !selected || !canDropNode(sourcePath, target.path, position)) {
      setDraggingPath(null);
      return;
    }

    const source = findNode(tree, sourcePath);
    const sourceParent = findNode(tree, parentPath(sourcePath));
    const destinationPath = destinationParentPath(target.path, position);
    const destinationParent = findNode(tree, destinationPath);
    if (!source || !sourceParent || !destinationParent) { setDraggingPath(null); return; }

    try {
      await saveCurrent();
      const changesParent = sourceParent.path !== destinationParent.path;
      if (changesParent) await moveChild(sourceParent.handle, source.name, destinationParent.handle);
      if (position === 'before' || position === 'after') {
        await setChildPosition(destinationParent.handle, source.name, target.name, position);
      }
      const movedPath = destinationParent.path ? `${destinationParent.path}/${source.name}` : source.name;
      const selectedPath = selected.path === source.path || selected.path.startsWith(`${source.path}/`)
        ? `${movedPath}${selected.path.slice(source.path.length)}`
        : selected.path;
      setExpanded((current) => {
        const next = new Set<string>();
        for (const path of current) {
          next.add(changesParent && (path === source.path || path.startsWith(`${source.path}/`))
            ? `${movedPath}${path.slice(source.path.length)}`
            : path);
        }
        next.add(destinationParent.path);
        next.add(movedPath);
        return next;
      });
      await refresh(root, selectedPath);
      setNotice({
        type: 'ok',
        message: changesParent
          ? `“${source.name}” 항목과 하위 내용을 이동했습니다.`
          : `“${source.name}” 항목의 순서를 변경했습니다.`,
      });
    } catch (error) {
      setNotice({ type: 'error', message: `이동 실패: ${(error as Error).message}` });
    } finally {
      setDraggingPath(null);
    }
  }

  function endTreeDrag() {
    setDraggingPath(null);
    setDropTarget(null);
  }

  async function submitNodeAction(event: FormEvent) {
    event.preventDefault();
    if (!nodeAction || !root) return;
    try {
      if (nodeAction.kind === 'delete') {
        const parent = findNode(tree, parentPath(nodeAction.node.path));
        if (!parent) return;
        await parent.handle.removeEntry(nodeAction.node.name, { recursive: true });
        setNodeAction(null); await refresh(root, parent.path); setNotice({ type: 'ok', message: '항목을 삭제했습니다.' }); return;
      }
      if (!validNodeName(nodeName)) throw new Error('폴더 이름에 사용할 수 없는 문자가 있습니다.');
      if (nodeAction.kind === 'add') {
        await createChild(nodeAction.node.handle, nodeName.trim());
        setExpanded((current) => new Set(current).add(nodeAction.node.path));
        await refresh(root, nodeAction.node.path ? `${nodeAction.node.path}/${nodeName.trim()}` : nodeName.trim());
      } else {
        const parent = findNode(tree, parentPath(nodeAction.node.path));
        if (!parent) return;
        await renameChild(parent.handle, nodeAction.node.name, nodeName.trim());
        await refresh(root, parent.path ? `${parent.path}/${nodeName.trim()}` : nodeName.trim());
      }
      setNodeAction(null);
    } catch (error) { setNotice({ type: 'error', message: (error as Error).message }); }
  }

  function runCommand(command: string, value?: string) {
    editorRef.current?.focus(); document.execCommand(command, false, value); scheduleSave();
  }

  function setFontSize(size: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand('fontSize', false, '7');
    editor.querySelectorAll('font[size="7"]').forEach((font) => {
      const span = document.createElement('span');
      span.style.fontSize = `${size}px`;
      while (font.firstChild) span.appendChild(font.firstChild);
      font.replaceWith(span);
    });
    scheduleSave();
  }

  function setLineHeight(lineHeight: string) {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    editor.focus();
    const blockSelector = 'p, div, h1, h2, h3, blockquote, li';
    let blocks = Array.from(editor.querySelectorAll<HTMLElement>(blockSelector)).filter((block) => {
      try { return range.intersectsNode(block); } catch { return false; }
    });

    if (blocks.length === 0) {
      document.execCommand('formatBlock', false, 'p');
      const anchor = selection.anchorNode;
      const anchorElement = anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
      const block = anchorElement?.closest<HTMLElement>(blockSelector);
      if (block && editor.contains(block)) blocks = [block];
    }

    blocks.forEach((block) => { block.style.lineHeight = lineHeight; });
    scheduleSave();
  }

  async function handleAttachments(files: FileList | null) {
    if (!files || !selected) return;
    try {
      await addAttachments(selected.handle, files);
      setAttachments(await listAttachments(selected.handle));
      if (root) {
        const nextTree = await readTree(root);
        setTree(nextTree);
        setSelected(findNode(nextTree, selected.path) || nextTree);
      }
      setNotice({ type: 'ok', message: `${files.length}개 파일을 첨부했습니다.` });
    }
    catch (error) { setNotice({ type: 'error', message: (error as Error).message }); }
  }

  async function downloadAttachment(item: Attachment) {
    const url = URL.createObjectURL(await item.handle.getFile());
    const link = document.createElement('a');
    link.href = url;
    link.download = item.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault(); if (!root || !config) return;
    const next = { ...config, githubRepository: repositoryInput.trim(), branch: branchInput.trim() || 'main' };
    await saveProjectConfig(root, next); setConfig(next); setSettingsOpen(false); setNotice({ type: 'ok', message: '프로젝트 설정을 저장했습니다.' });
  }

  function openPreferences() {
    setPreferenceDraft(editorDefaults);
    setPreferencesOpen(true);
  }

  function savePreferences(event: FormEvent) {
    event.preventDefault();
    localStorage.setItem(EDITOR_DEFAULTS_KEY, JSON.stringify(preferenceDraft));
    setEditorDefaults(preferenceDraft);
    setPreferencesOpen(false);
    setNotice({ type: 'ok', message: '기본 편집 설정을 저장했습니다.' });
  }

  async function connectGitHub() {
    setBusy(true);
    setBackupStatus('GitHub 인증을 기다리는 중…');
    try {
      const session = await authorizeGitHub();
      setGithubSession(session);
      setBackupStatus(`${session.login} 계정으로 연결되었습니다.`);
      return session;
    } catch (error) {
      setBackupStatus('');
      setNotice({ type: 'error', message: (error as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startBackup(event: FormEvent) {
    event.preventDefault(); if (!root || !config) return;
    let session = githubSession;
    if (!sessionIsValid(session)) {
      session = await connectGitHub();
      if (!session) return;
    }
    if (!session) return;
    setBusy(true);
    const previousConfig = config;
    try {
      await saveCurrent();
      await saveToday();
      const next = { ...config, lastBackupAt: new Date().toISOString() };
      await saveProjectConfig(root, next);
      const result = await backupProject(root, next, session.token, setBackupStatus);
      setConfig(next); setBackupOpen(false);
      setNotice({ type: 'ok', message: `GitHub 백업 완료 · ${result.fileCount}개 파일` });
    } catch (error) {
      await saveProjectConfig(root, previousConfig);
      setBackupStatus(''); setNotice({ type: 'error', message: `백업 실패: ${(error as Error).message}` });
    }
    finally { setBusy(false); }
  }

  function requestBackup() {
    if (!config?.githubRepository) { setSettingsOpen(true); return; }
    setBackupStatus(''); setBackupOpen(true);
  }

  function requestRestore() {
    if (!config?.githubRepository) { setSettingsOpen(true); return; }
    setRestoreFolderName(`${config.name} GitHub 복원`);
    setRestoreParent(null);
    setBackupStatus('');
    setRestoreOpen(true);
  }

  async function chooseRestoreParent() {
    try {
      if (!window.showDirectoryPicker) throw new Error('Edge 또는 Chrome 최신 버전에서 열어주세요.');
      setRestoreParent(await window.showDirectoryPicker({ mode: 'readwrite' }));
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setNotice({ type: 'error', message: (error as Error).message });
    }
  }

  async function startRestore(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    const folderName = restoreFolderName.trim();
    if (!validNodeName(folderName)) {
      setNotice({ type: 'error', message: '새 폴더 이름에 사용할 수 없는 문자가 있습니다.' });
      return;
    }
    let session = githubSession;
    if (!sessionIsValid(session)) {
      session = await connectGitHub();
      if (!session) return;
    }
    if (!session) return;
    try {
      if (!restoreParent) throw new Error('먼저 저장할 상위 폴더를 선택해주세요.');
      const parent = restoreParent;
      if (await childDirectory(parent, folderName)) throw new Error(`“${folderName}” 폴더가 이미 있습니다. 다른 이름을 입력해주세요.`);
      setBusy(true);
      const destination = await parent.getDirectoryHandle(folderName, { create: true });
      const result = await restoreProject(destination, config, session.token, setBackupStatus);
      await connectProject(destination);
      setRestoreOpen(false);
      setNotice({ type: 'ok', message: `GitHub 백업을 새 폴더에 불러왔습니다 · ${result.fileCount}개 파일` });
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setNotice({ type: 'error', message: `다운로드 실패: ${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const overallSaveState = saveState === 'error' || todaySaveState === 'error'
    ? 'error'
    : saveState === 'saving' || todaySaveState === 'saving' ? 'saving' : 'saved';
  const todayLabel = new Intl.DateTimeFormat('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'short',
  }).format(new Date(`${todayDate}T00:00:00`));

  if (!root || !tree || !selected || !config) {
    return <main className="welcome-shell">
      <div className="welcome-brand"><span>F</span>Folio Tree</div>
      <section className="welcome-card">
        <p className="eyebrow">LOCAL-FIRST PROJECT NOTES</p>
        <h1>프로젝트를 폴더처럼,<br />내용은 문서처럼.</h1>
        <p className="welcome-copy">PC의 폴더를 선택하면 각 폴더가 내용과 하위 항목을 함께 가지는 프로젝트 공간이 됩니다.</p>
        <div className="welcome-actions">
          <Button size="lg" onClick={chooseFolder}><FolderOpen />프로젝트 폴더 열기</Button>
          {recent && <Button size="lg" variant="outline" onClick={() => connectProject(recent).catch((error) => setNotice({ type: 'error', message: error.message }))}>최근 프로젝트: {recent.name}</Button>}
        </div>
        <div className="welcome-points"><span><Check />실제 로컬 파일</span><span><Check />자동 저장</span><span><Check />수동 GitHub 백업</span></div>
      </section>
      {notice && <div className={`notice ${notice.type}`}><AlertCircle />{notice.message}</div>}
    </main>;
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">F</div><div><p className="eyebrow">LOCAL PROJECT SPACE</p><h1>Folio Tree</h1></div>
      <div className="topbar-actions">
        <span className={`save-state ${overallSaveState}`}><span />{overallSaveState === 'saved' ? '로컬에 저장됨' : overallSaveState === 'saving' ? '저장 중…' : '저장 실패'}</span>
        <Button variant="outline" onClick={requestBackup}><CloudUpload /> GitHub에 백업</Button>
        <Button variant="outline" onClick={requestRestore}><Download /> GitHub에서 불러오기</Button>
        <Button variant="ghost" size="icon" aria-label="기본 편집 설정" onClick={openPreferences}><Settings2 /></Button>
        <Button variant="ghost" size="icon" aria-label="프로젝트 설정" onClick={() => setSettingsOpen(true)}><Settings /></Button>
      </div>
    </header>

    <ResizablePanelGroup
      id="folio-workspace"
      className="workspace"
      orientation="horizontal"
      groupRef={workspaceGroupRef}
      defaultLayout={{ tree: 22, editor: 58, daily: 20 }}
      onLayoutChanged={(layout) => localStorage.setItem('folio-tree:workspace-layout', JSON.stringify(layout))}
    >
      <ResizablePanel id="tree" defaultSize="292px" minSize="220px" maxSize="520px" className="tree-resizable-panel">
        <aside className="tree-panel">
        <div className="panel-heading"><div><p className="eyebrow">PROJECT</p><strong>{config.name}</strong></div><Button variant="ghost" size="icon-sm" aria-label="하위 항목 추가" onClick={() => openNodeAction({ kind: 'add', node: tree })}><Plus /></Button></div>
        <nav aria-label="프로젝트 항목" className="tree"><TreeItem node={tree} depth={0} selectedPath={selected.path} expanded={expanded} draggingPath={draggingPath} dropTarget={dropTarget} onSelect={selectNode} onToggle={(path) => setExpanded((current) => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next; })} onAction={openNodeAction} onDragStart={startTreeDrag} onDragOver={dragOverTreeNode} onDrop={dropTreeNode} onDragEnd={endTreeDrag} /></nav>
        <div className="attachment-panel">
          <div className="attachment-heading"><strong>첨부파일</strong><Button variant="ghost" size="icon-xs" aria-label="파일 첨부" onClick={() => attachmentInput.current?.click()}><Plus /></Button></div>
          <input ref={attachmentInput} className="sr-only" type="file" multiple onChange={(event) => handleAttachments(event.target.files)} />
          {attachments.length === 0 ? <p>이 항목에 첨부된 파일이 없습니다.</p> : attachments.map((item) => <button key={item.name} className="attachment-row" title={`${item.name} 다운로드`} onClick={() => downloadAttachment(item)}><File /><span>{item.name}<small>{formatBytes(item.size)}</small></span><Download className="attachment-download" /></button>)}
        </div>
        </aside>
      </ResizablePanel>

      <ResizableHandle withHandle className="tree-resize-handle" aria-label="트리 영역 너비 조절" />

      <ResizablePanel id="editor" minSize="420px" className="editor-resizable-panel">
        <article className="editor-panel">
        <div className="document-head"><div><p className="breadcrumb">{selected.path ? `${config.name} / ${selected.path.split('/').join(' / ')}` : config.name}</p><h2>{selected.name}</h2></div><div className="document-actions"><Button variant="outline" size="sm" onClick={() => attachmentInput.current?.click()}><Paperclip />첨부</Button><span className="file-label">content.html</span></div></div>
        <div className="toolbar" aria-label="문서 서식">
          <select aria-label="문단 스타일" defaultValue="p" onChange={(event) => runCommand('formatBlock', event.target.value)}><option value="p">본문</option><option value="h1">제목 1</option><option value="h2">제목 2</option><option value="blockquote">인용문</option></select>
          <select aria-label="글꼴" defaultValue="Malgun Gothic" onChange={(event) => runCommand('fontName', event.target.value)}><option>Malgun Gothic</option><option>Arial</option><option>Georgia</option><option>Batang</option></select>
          <select aria-label="글자 크기" defaultValue="16" onChange={(event) => setFontSize(event.target.value)}><option value="10">10</option><option value="12">12</option><option value="14">14</option><option value="16">16</option><option value="18">18</option><option value="24">24</option></select>
          <select aria-label="줄 간격" defaultValue="1.8" onChange={(event) => setLineHeight(event.target.value)}><option value="1">줄 1.0</option><option value="1.2">줄 1.2</option><option value="1.4">줄 1.4</option><option value="1.6">줄 1.6</option><option value="1.8">줄 1.8</option><option value="2">줄 2.0</option></select>
          <span className="toolbar-rule" />
          <button onClick={() => runCommand('bold')} aria-label="굵게"><Bold /></button><button onClick={() => runCommand('italic')} aria-label="기울임"><Italic /></button><button onClick={() => runCommand('underline')} aria-label="밑줄"><Underline /></button><button onClick={() => runCommand('insertUnorderedList')} aria-label="글머리표"><List /></button><button onClick={() => runCommand('insertOrderedList')} aria-label="번호 목록"><ListOrdered /></button><button onClick={() => { const url = window.prompt('링크 주소를 입력하세요.'); if (url) runCommand('createLink', url); }} aria-label="링크"><Link /></button><span className="toolbar-rule" /><button onClick={() => runCommand('undo')} aria-label="실행 취소"><Undo2 /></button><button onClick={() => runCommand('redo')} aria-label="다시 실행"><Redo2 /></button>
        </div>
        <div className="paper-wrap"><div ref={editorRef} className="paper editable" contentEditable suppressContentEditableWarning onInput={scheduleSave} data-placeholder="이 항목의 내용을 입력하세요…" /></div>
        <footer className="editor-footer"><span>{config.lastBackupAt ? `마지막 GitHub 백업: ${new Date(config.lastBackupAt).toLocaleString('ko-KR')}` : 'GitHub 백업 기록 없음'}</span><span>첨부파일 {attachments.length}개</span></footer>
        </article>
      </ResizablePanel>

      <ResizableHandle withHandle className="tree-resize-handle" aria-label="오늘 확인사항 영역 너비 조절" />

      <ResizablePanel id="daily" defaultSize="320px" minSize="280px" maxSize="480px" className="daily-resizable-panel">
        <aside className="today-panel">
          <header className="today-head">
            <div className="today-title"><CalendarDays /><div><p className="eyebrow">DAILY CHECK</p><h2>오늘 확인사항</h2></div></div>
            <span className={`today-save-state ${todaySaveState}`}>{todaySaveState === 'saved' ? '저장됨' : todaySaveState === 'saving' ? '저장 중…' : '저장 실패'}</span>
          </header>
          <div className="today-date"><strong>{todayLabel}</strong><span>{todayDate}</span></div>
          <div className="today-body">
            <div
              ref={todayEditorRef}
              className="today-editor editable"
              contentEditable
              suppressContentEditableWarning
              onInput={scheduleTodaySave}
              data-placeholder="오늘 확인하거나 기억할 내용을 입력하세요…"
            />
          </div>
          <footer className="today-footer">{DAILY_NOTES_FOLDER} / {todayYear} / {todayMonth} / {todayDate}에 자동 저장됩니다.</footer>
        </aside>
      </ResizablePanel>
    </ResizablePanelGroup>

    <Dialog open={!!nodeAction} onOpenChange={(open) => !open && setNodeAction(null)}><DialogContent><form onSubmit={submitNodeAction}><DialogHeader><DialogTitle>{nodeAction?.kind === 'add' ? '하위 항목 추가' : nodeAction?.kind === 'rename' ? '이름 변경' : '항목 삭제'}</DialogTitle><DialogDescription>{nodeAction?.kind === 'delete' ? `“${nodeAction.node.name}”과 모든 하위 내용 및 첨부파일을 삭제합니다.` : '트리에 표시할 이름을 입력하세요.'}</DialogDescription></DialogHeader>{nodeAction?.kind !== 'delete' && <Input className="dialog-input" autoFocus value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="새 항목 이름" />}<DialogFooter><Button type="button" variant="outline" onClick={() => setNodeAction(null)}>취소</Button><Button type="submit" variant={nodeAction?.kind === 'delete' ? 'destructive' : 'default'}>{nodeAction?.kind === 'delete' ? '삭제' : '확인'}</Button></DialogFooter></form></DialogContent></Dialog>

    <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}><DialogContent className="settings-dialog"><form onSubmit={savePreferences}><DialogHeader><DialogTitle>기본 편집 설정</DialogTitle><DialogDescription>항목을 열 때 적용할 글꼴, 글자 크기, 줄 간격입니다. 문서에서 직접 지정한 서식은 유지됩니다.</DialogDescription></DialogHeader><label className="field-label">기본 글꼴<select className="preference-select" value={preferenceDraft.fontFamily} onChange={(event) => setPreferenceDraft((current) => ({ ...current, fontFamily: event.target.value }))}>{EDITOR_FONTS.map((font) => <option key={font}>{font}</option>)}</select></label><label className="field-label">기본 글자 크기<select className="preference-select" value={preferenceDraft.fontSize} onChange={(event) => setPreferenceDraft((current) => ({ ...current, fontSize: event.target.value }))}>{EDITOR_SIZES.map((size) => <option key={size} value={size}>{size}px</option>)}</select></label><label className="field-label">기본 줄 간격<select className="preference-select" value={preferenceDraft.lineHeight} onChange={(event) => setPreferenceDraft((current) => ({ ...current, lineHeight: event.target.value }))}>{EDITOR_LINE_HEIGHTS.map((height) => <option key={height} value={height}>줄 {height}</option>)}</select></label><DialogFooter><Button type="button" variant="outline" onClick={() => setPreferencesOpen(false)}>취소</Button><Button type="submit">저장</Button></DialogFooter></form></DialogContent></Dialog>

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="settings-dialog"><form onSubmit={saveSettings}><DialogHeader><DialogTitle>프로젝트 설정</DialogTitle><DialogDescription>GitHub 저장소 주소는 프로젝트의 project.json 파일에 저장됩니다.</DialogDescription></DialogHeader><label className="field-label">GitHub 저장소<Input value={repositoryInput} onChange={(event) => setRepositoryInput(event.target.value)} placeholder="https://github.com/사용자/저장소" /></label><label className="field-label">브랜치<Input value={branchInput} onChange={(event) => setBranchInput(event.target.value)} placeholder="main" /></label><DialogFooter><Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>취소</Button><Button type="submit">저장</Button></DialogFooter></form></DialogContent></Dialog>

    <Dialog open={restoreOpen} onOpenChange={(open) => { if (!busy) setRestoreOpen(open); }}><DialogContent className="settings-dialog"><form onSubmit={startRestore}><DialogHeader><DialogTitle>GitHub에서 불러오기</DialogTitle><DialogDescription>{config.githubRepository}의 {config.branch} 브랜치 내용을 새 폴더에 다운로드합니다. 현재 열어 둔 로컬 프로젝트는 변경하지 않습니다.</DialogDescription></DialogHeader><label className="field-label">새 프로젝트 폴더 이름<Input value={restoreFolderName} onChange={(event) => setRestoreFolderName(event.target.value)} placeholder="GitHub 복원 프로젝트" /></label><div className="restore-location"><div><strong>저장할 위치</strong><p>{restoreParent ? `${restoreParent.name} 아래` : '아직 선택되지 않았습니다.'}</p></div><Button type="button" variant="outline" size="sm" disabled={busy} onClick={chooseRestoreParent}><FolderOpen />폴더 선택</Button></div><div className="github-auth-card"><GitBranch /><div><strong>{sessionIsValid(githubSession) ? `${githubSession?.login} 계정 연결됨` : 'GitHub 계정 연결 필요'}</strong><p>선택한 위치 아래에 입력한 이름의 새 폴더가 만들어집니다.</p></div>{!sessionIsValid(githubSession) && <Button type="button" variant="outline" disabled={busy || !githubAuthConfigured()} onClick={connectGitHub}><LogIn />인증</Button>}</div>{backupStatus && <div className="backup-progress"><Download />{backupStatus}</div>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setRestoreOpen(false)}>취소</Button><Button type="submit" disabled={busy || !githubAuthConfigured()}>{busy ? '다운로드 중…' : sessionIsValid(githubSession) ? '새 폴더에 불러오기' : '인증 후 불러오기'}</Button></DialogFooter></form></DialogContent></Dialog>

    <Dialog open={backupOpen} onOpenChange={(open) => { if (!busy) setBackupOpen(open); }}><DialogContent><form onSubmit={startBackup}><DialogHeader><DialogTitle>GitHub에 백업</DialogTitle><DialogDescription>{config.githubRepository}<br />GitHub App으로 인증하며 접근 권한은 브라우저 메모리에만 유지됩니다.</DialogDescription></DialogHeader><div className="github-auth-card"><GitBranch /><div><strong>{sessionIsValid(githubSession) ? `${githubSession?.login} 계정 연결됨` : 'GitHub 계정 연결 필요'}</strong><p>{sessionIsValid(githubSession) ? '현재 창을 닫으면 연결 정보가 삭제됩니다.' : 'GitHub에서 로그인하고 Folio Tree 접근을 승인해주세요.'}</p></div>{!sessionIsValid(githubSession) && <Button type="button" variant="outline" disabled={busy || !githubAuthConfigured()} onClick={connectGitHub}><LogIn />인증</Button>}</div>{!githubAuthConfigured() && <p className="auth-warning">GitHub App 연결 설정이 아직 배포되지 않았습니다.</p>}<p className="token-help">백업 저장소가 허용되지 않았다면 <a href={githubAppInstallUrl || '#'} target="_blank" rel="noreferrer">GitHub App 설치 설정</a>에서 해당 저장소를 선택하세요.</p>{backupStatus && <div className="backup-progress"><Upload />{backupStatus}</div>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setBackupOpen(false)}>취소</Button><Button type="submit" disabled={busy || !githubAuthConfigured()}>{busy ? '처리 중…' : sessionIsValid(githubSession) ? '백업 시작' : '인증 후 백업'}</Button></DialogFooter></form></DialogContent></Dialog>
    {notice && <div className={`notice ${notice.type}`}>{notice.type === 'ok' ? <Check /> : <AlertCircle />}{notice.message}</div>}
  </main>;
}
