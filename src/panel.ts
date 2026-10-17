import { connectHost, type GuestProject, type SessionSnapshot } from '@openchamber/sdk';
import { applyHostReady, GUEST_UI_LOOK_CSS, mountButton, mountList } from '@openchamber/sdk/ui';

const host = connectHost();
const $ = (id: string) => document.getElementById(id)!;
const select = $('project') as HTMLSelectElement;
const style = document.createElement('style'); style.textContent = GUEST_UI_LOOK_CSS; document.head.append(style);
let projects: GuestProject[] = [], selected = '', directory: string | null = null, session: SessionSnapshot | null = null;
let unsubscribe: (() => void) | undefined, revision = 0;
const history = mountList($('history'), { items: [], emptyText: '选择聊天项目后显示原生会话历史', onSelect: id => { void host.openSession(id).catch(fail); } });
function fail(error: unknown) { $('error').textContent = error instanceof Error ? error.message : String(error); }
function status() {
  const project = projects.find(p => p.id === selected);
  $('status').textContent = !project ? '请绑定已部署的独立聊天项目' : directory !== project.directory ? '当前不在所选聊天项目' : session?.agent?.toLowerCase() === 'chat' ? '当前项目 · Chat Agent' : session ? `当前项目 · ${session.agent ?? '未知'} Agent（请切换 Chat）` : '当前项目 · 尚未创建会话';
}
async function subscribe() {
  const current = ++revision;
  unsubscribe?.(); unsubscribe = undefined;
  history.update({ items: [], emptyText: selected ? '正在加载…' : '请选择聊天项目', onSelect: id => { void host.openSession(id).catch(fail); } });
  if (!selected) return;
  const project = projects.find(p => p.id === selected);
  if (!project) return;
  const dispose = await host.onSessions(selected, snapshot => {
    if (current !== revision) return;
    history.update({
      items: snapshot.sessions.filter(s => !s.archivedAt && s.directory === project.directory && !s.parentId).sort((a,b) => b.updatedAt-a.updatedAt).map(s => ({ id: s.id, title: s.title, meta: new Date(s.updatedAt).toLocaleDateString(), subtitle: s.activity === 'running' ? '正在回复' : undefined })),
      emptyText: snapshot.state === 'error' ? '历史加载失败，请刷新' : snapshot.state === 'loading' ? '正在加载…' : '还没有聊天记录',
      onSelect: id => { void host.openSession(id).catch(fail); },
    });
  });
  if (current === revision) unsubscribe = dispose; else dispose();
}
async function refresh() {
  $('error').textContent = '';
  const snapshot = await host.listProjects();
  if (snapshot.state === 'error') throw new Error('无法加载项目列表');
  projects = snapshot.projects;
  select.replaceChildren(new Option('请选择已部署的聊天项目', ''), ...projects.map(p => new Option(`${p.name} — ${p.directory}`, p.id)));
  if (!projects.some(p => p.id === selected)) selected = '';
  // Never identify a safe project merely by its display name.
  select.value = selected; status(); await subscribe();
}
select.addEventListener('change', () => {
  selected = select.value; status();
  void host.storage.set('chat-project-id', selected).then(subscribe).catch(fail);
});
mountButton($('refresh'), { label: '刷新项目与历史', variant: 'outline', size: 'sm', onClick: () => { void refresh().catch(fail); } });
host.onDirectory(value => { directory = value; status(); });
host.onSession(value => { session = value; status(); });
host.onReady(context => {
  applyHostReady(context, document.documentElement); directory = context.directory; session = context.session;
  void host.storage.get('chat-project-id').then(value => { selected = typeof value === 'string' ? value : ''; return refresh(); }).catch(fail);
});
window.addEventListener('pagehide', () => { revision++; unsubscribe?.(); host.dispose(); });
