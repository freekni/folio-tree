'use client';

import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useGroupRef } from 'react-resizable-panels';
import {
  AlertCircle, Bold, Check, ChevronDown, ChevronRight, CloudUpload, File,
  Folder, FolderOpen, FolderPlus, Italic, Link, List, ListOrdered, MoreHorizontal,
  Paperclip, Pencil, Plus, Redo2, Settings, Trash2, Underline, Undo2, Upload,
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
import { backupProject } from '@/lib/github-backup';
import {
  addAttachments, Attachment, createChild, ensurePermission, listAttachments, loadDocument,
  loadProjectConfig, moveChild, ProjectConfig, readTree, recentProject, rememberProject, renameChild,
  saveDocument, saveProjectConfig, setChildPosition, TreeNode, validNodeName,
} from '@/lib/project-files';

type NodeAction = { kind: 'add' | 'rename' | 'delete'; node: TreeNode } | null;
type DropPosition = 'before' | 'inside' | 'after';
type DropTarget = { path: string; position: DropPosition } | null;

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
  return <>
    <ContextMenu>
      <ContextMenuTrigger
        render={<div />}
        className={`tree-row ${selectedPath === node.path ? 'selected' : ''} ${draggingPath === node.path ? 'dragging' : ''} ${dropTarget?.path === node.path ? `drop-${dropTarget.position}` : ''}`}
        style={{ paddingLeft: 8 + depth * 20 }}
        onClick={() => onSelect(node)}
        draggable={depth > 0}
        onDragStart={(event) => onDragStart(node, event)}
        onDragOver={(event) => onDragOver(node, event)}
        onDrop={(event) => onDrop(node, event)}
        onDragEnd={onDragEnd}
        title={depth > 0 ? '위·아래에 놓아 순서 변경, 가운데에 놓아 하위로 이동' : undefined}
      >
        <span className="tree-toggle" onClick={(event) => { event.stopPropagation(); if (hasChildren) onToggle(node.path); }}>
          {hasChildren ? (isExpanded ? <ChevronDown /> : <ChevronRight />) : null}
        </span>
        {isExpanded && hasChildren ? <FolderOpen /> : <Folder />}
        <span className="tree-name">{node.name}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<button type="button" className="tree-more-button" aria-label={`${node.name} 메뉴`} />}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom">
            <DropdownMenuItem onClick={() => onAction({ kind: 'add', node })}><FolderPlus />하위 항목 추가</DropdownMenuItem>
            {depth > 0 && <DropdownMenuItem onClick={() => onAction({ kind: 'rename', node })}><Pencil />이름 변경</DropdownMenuItem>}
            {depth > 0 && <DropdownMenuSeparator />}
            {depth > 0 && <DropdownMenuItem variant="destructive" onClick={() => onAction({ kind: 'delete', node })}><Trash2 />삭제</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onAction({ kind: 'add', node })}><FolderPlus />하위 항목 추가</ContextMenuItem>
        {depth > 0 && <ContextMenuItem onClick={() => onAction({ kind: 'rename', node })}><Pencil />이름 변경</ContextMenuItem>}
        {depth > 0 && <ContextMenuSeparator />}
        {depth > 0 && <ContextMenuItem variant="destructive" onClick={() => onAction({ kind: 'delete', node })}><Trash2 />삭제</ContextMenuItem>}
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
  const [repositoryInput, setRepositoryInput] = useState('');
  const [branchInput, setBranchInput] = useState('main');
  const [backupOpen, setBackupOpen] = useState(false);
  const [token, setToken] = useState('');
  const [backupStatus, setBackupStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; message: string } | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceGroupRef = useGroupRef();

  useEffect(() => { recentProject().then(setRecent); }, []);
  useEffect(() => {
    if (!root) return;
    try {
      const saved = localStorage.getItem('folio-tree:workspace-layout');
      if (!saved) return;
      const layout = JSON.parse(saved) as { tree?: number; editor?: number };
      if (typeof layout.tree === 'number' && typeof layout.editor === 'number') {
        workspaceGroupRef.current?.setLayout({ tree: layout.tree, editor: layout.editor });
      }
    } catch { /* Use the default layout when stored preferences are invalid. */ }
  }, [root, workspaceGroupRef]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const refresh = useCallback(async (directory: FileSystemDirectoryHandle, selectedPath = '') => {
    const nextTree = await readTree(directory);
    const nextSelected = findNode(nextTree, selectedPath) || nextTree;
    setTree(nextTree); setSelected(nextSelected);
    setAttachments(await listAttachments(nextSelected.handle));
    if (editorRef.current) editorRef.current.innerHTML = await loadDocument(nextSelected.handle);
  }, []);

  async function connectProject(handle: FileSystemDirectoryHandle) {
    if (!await ensurePermission(handle)) throw new Error('선택한 폴더에 대한 읽기·쓰기 권한이 필요합니다.');
    const nextConfig = await loadProjectConfig(handle);
    setRoot(handle); setConfig(nextConfig); setRepositoryInput(nextConfig.githubRepository); setBranchInput(nextConfig.branch);
    await rememberProject(handle); setRecent(handle); await refresh(handle);
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
    try { await saveDocument(selected.handle, selected.name, editorRef.current.innerHTML); setSaveState('saved'); }
    catch { setSaveState('error'); }
  }

  function scheduleSave() {
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveCurrent, 650);
  }

  async function selectNode(node: TreeNode) {
    await saveCurrent(); setSelected(node);
    if (editorRef.current) editorRef.current.innerHTML = await loadDocument(node.handle);
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

  async function handleAttachments(files: FileList | null) {
    if (!files || !selected) return;
    try { await addAttachments(selected.handle, files); setAttachments(await listAttachments(selected.handle)); setNotice({ type: 'ok', message: `${files.length}개 파일을 첨부했습니다.` }); }
    catch (error) { setNotice({ type: 'error', message: (error as Error).message }); }
  }

  async function openAttachment(item: Attachment) {
    const url = URL.createObjectURL(await item.handle.getFile());
    window.open(url, '_blank', 'noopener,noreferrer'); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault(); if (!root || !config) return;
    const next = { ...config, githubRepository: repositoryInput.trim(), branch: branchInput.trim() || 'main' };
    await saveProjectConfig(root, next); setConfig(next); setSettingsOpen(false); setNotice({ type: 'ok', message: '프로젝트 설정을 저장했습니다.' });
  }

  async function startBackup(event: FormEvent) {
    event.preventDefault(); if (!root || !config || !token.trim()) return;
    setBusy(true);
    const previousConfig = config;
    try {
      await saveCurrent();
      const next = { ...config, lastBackupAt: new Date().toISOString() };
      await saveProjectConfig(root, next);
      const result = await backupProject(root, next, token.trim(), setBackupStatus);
      setConfig(next); setToken(''); setBackupOpen(false);
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
        <span className={`save-state ${saveState}`}><span />{saveState === 'saved' ? '로컬에 저장됨' : saveState === 'saving' ? '저장 중…' : '저장 실패'}</span>
        <Button variant="outline" onClick={requestBackup}><CloudUpload /> GitHub에 백업</Button>
        <Button variant="ghost" size="icon" aria-label="설정" onClick={() => setSettingsOpen(true)}><Settings /></Button>
      </div>
    </header>

    <ResizablePanelGroup
      id="folio-workspace"
      className="workspace"
      orientation="horizontal"
      groupRef={workspaceGroupRef}
      defaultLayout={{ tree: 28, editor: 72 }}
      onLayoutChanged={(layout) => localStorage.setItem('folio-tree:workspace-layout', JSON.stringify(layout))}
    >
      <ResizablePanel id="tree" defaultSize="292px" minSize="220px" maxSize="520px" className="tree-resizable-panel">
        <aside className="tree-panel">
        <div className="panel-heading"><div><p className="eyebrow">PROJECT</p><strong>{config.name}</strong></div><Button variant="ghost" size="icon-sm" aria-label="하위 항목 추가" onClick={() => openNodeAction({ kind: 'add', node: tree })}><Plus /></Button></div>
        <nav aria-label="프로젝트 항목" className="tree"><TreeItem node={tree} depth={0} selectedPath={selected.path} expanded={expanded} draggingPath={draggingPath} dropTarget={dropTarget} onSelect={selectNode} onToggle={(path) => setExpanded((current) => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next; })} onAction={openNodeAction} onDragStart={startTreeDrag} onDragOver={dragOverTreeNode} onDrop={dropTreeNode} onDragEnd={endTreeDrag} /></nav>
        <div className="attachment-panel">
          <div className="attachment-heading"><strong>첨부파일</strong><Button variant="ghost" size="icon-xs" aria-label="파일 첨부" onClick={() => attachmentInput.current?.click()}><Plus /></Button></div>
          <input ref={attachmentInput} className="sr-only" type="file" multiple onChange={(event) => handleAttachments(event.target.files)} />
          {attachments.length === 0 ? <p>이 항목에 첨부된 파일이 없습니다.</p> : attachments.map((item) => <button key={item.name} className="attachment-row" onClick={() => openAttachment(item)}><File /><span>{item.name}<small>{formatBytes(item.size)}</small></span></button>)}
        </div>
        </aside>
      </ResizablePanel>

      <ResizableHandle withHandle className="tree-resize-handle" aria-label="트리 영역 너비 조절" />

      <ResizablePanel id="editor" minSize="460px" className="editor-resizable-panel">
        <article className="editor-panel">
        <div className="document-head"><div><p className="breadcrumb">{selected.path ? `${config.name} / ${selected.path.split('/').join(' / ')}` : config.name}</p><h2>{selected.name}</h2></div><div className="document-actions"><Button variant="outline" size="sm" onClick={() => attachmentInput.current?.click()}><Paperclip />첨부</Button><span className="file-label">content.html</span></div></div>
        <div className="toolbar" aria-label="문서 서식">
          <select aria-label="문단 스타일" defaultValue="p" onChange={(event) => runCommand('formatBlock', event.target.value)}><option value="p">본문</option><option value="h1">제목 1</option><option value="h2">제목 2</option><option value="blockquote">인용문</option></select>
          <select aria-label="글꼴" defaultValue="Malgun Gothic" onChange={(event) => runCommand('fontName', event.target.value)}><option>Malgun Gothic</option><option>Arial</option><option>Georgia</option><option>Batang</option></select>
          <select aria-label="글자 크기" defaultValue="16" onChange={(event) => setFontSize(event.target.value)}><option value="10">10</option><option value="12">12</option><option value="14">14</option><option value="16">16</option><option value="18">18</option><option value="24">24</option></select>
          <span className="toolbar-rule" />
          <button onClick={() => runCommand('bold')} aria-label="굵게"><Bold /></button><button onClick={() => runCommand('italic')} aria-label="기울임"><Italic /></button><button onClick={() => runCommand('underline')} aria-label="밑줄"><Underline /></button><button onClick={() => runCommand('insertUnorderedList')} aria-label="글머리표"><List /></button><button onClick={() => runCommand('insertOrderedList')} aria-label="번호 목록"><ListOrdered /></button><button onClick={() => { const url = window.prompt('링크 주소를 입력하세요.'); if (url) runCommand('createLink', url); }} aria-label="링크"><Link /></button><span className="toolbar-rule" /><button onClick={() => runCommand('undo')} aria-label="실행 취소"><Undo2 /></button><button onClick={() => runCommand('redo')} aria-label="다시 실행"><Redo2 /></button>
        </div>
        <div className="paper-wrap"><div ref={editorRef} className="paper editable" contentEditable suppressContentEditableWarning onInput={scheduleSave} data-placeholder="이 항목의 내용을 입력하세요…" /></div>
        <footer className="editor-footer"><span>{config.lastBackupAt ? `마지막 GitHub 백업: ${new Date(config.lastBackupAt).toLocaleString('ko-KR')}` : 'GitHub 백업 기록 없음'}</span><span>첨부파일 {attachments.length}개</span></footer>
        </article>
      </ResizablePanel>
    </ResizablePanelGroup>

    <Dialog open={!!nodeAction} onOpenChange={(open) => !open && setNodeAction(null)}><DialogContent><form onSubmit={submitNodeAction}><DialogHeader><DialogTitle>{nodeAction?.kind === 'add' ? '하위 항목 추가' : nodeAction?.kind === 'rename' ? '이름 변경' : '항목 삭제'}</DialogTitle><DialogDescription>{nodeAction?.kind === 'delete' ? `“${nodeAction.node.name}”과 모든 하위 내용 및 첨부파일을 삭제합니다.` : '트리에 표시할 이름을 입력하세요.'}</DialogDescription></DialogHeader>{nodeAction?.kind !== 'delete' && <Input className="dialog-input" autoFocus value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="새 항목 이름" />}<DialogFooter><Button type="button" variant="outline" onClick={() => setNodeAction(null)}>취소</Button><Button type="submit" variant={nodeAction?.kind === 'delete' ? 'destructive' : 'default'}>{nodeAction?.kind === 'delete' ? '삭제' : '확인'}</Button></DialogFooter></form></DialogContent></Dialog>

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="settings-dialog"><form onSubmit={saveSettings}><DialogHeader><DialogTitle>프로젝트 설정</DialogTitle><DialogDescription>GitHub 저장소 주소는 프로젝트의 project.json 파일에 저장됩니다.</DialogDescription></DialogHeader><label className="field-label">GitHub 저장소<Input value={repositoryInput} onChange={(event) => setRepositoryInput(event.target.value)} placeholder="https://github.com/사용자/저장소" /></label><label className="field-label">브랜치<Input value={branchInput} onChange={(event) => setBranchInput(event.target.value)} placeholder="main" /></label><DialogFooter><Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>취소</Button><Button type="submit">저장</Button></DialogFooter></form></DialogContent></Dialog>

    <Dialog open={backupOpen} onOpenChange={(open) => { if (!busy) setBackupOpen(open); }}><DialogContent><form onSubmit={startBackup}><DialogHeader><DialogTitle>GitHub에 백업</DialogTitle><DialogDescription>{config.githubRepository}<br />토큰은 이번 백업에만 사용되며 저장하지 않습니다.</DialogDescription></DialogHeader><label className="field-label">GitHub 접근 토큰<Input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_…" disabled={busy} /></label><p className="token-help"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">토큰 만들기</a>에서 해당 저장소의 Contents 읽기/쓰기 권한을 허용하세요.</p>{backupStatus && <div className="backup-progress"><Upload />{backupStatus}</div>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setBackupOpen(false)}>취소</Button><Button type="submit" disabled={busy || !token.trim()}>{busy ? '백업 중…' : '백업 시작'}</Button></DialogFooter></form></DialogContent></Dialog>
    {notice && <div className={`notice ${notice.type}`}>{notice.type === 'ok' ? <Check /> : <AlertCircle />}{notice.message}</div>}
  </main>;
}
