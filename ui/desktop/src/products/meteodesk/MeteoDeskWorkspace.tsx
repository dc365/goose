import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  CloudRain,
  CloudSun,
  Database,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  FolderOpen,
  Gauge,
  History,
  Layers,
  Link2,
  Map,
  MoreHorizontal,
  Play,
  Presentation,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react';
import ChatSessionsContainer from '../../components/ChatSessionsContainer';
import { useChatContext } from '../../contexts/ChatContext';
import { useNavigationSessions } from '../../hooks/useNavigationSessions';
import type { UserInput } from '../../types/message';
import { cn } from '../../utils';

type IconType = React.ComponentType<{ className?: string }>;

type ActiveSession = {
  sessionId: string;
  initialMessage?: UserInput;
  noAutoSubmit?: boolean;
};

type PromptStarter = {
  title: string;
  prompt: string;
};

type Expert = {
  id: string;
  name: string;
  author: string;
  icon: IconType;
  iconClassName: string;
  category: string;
  description: string;
  tags: string[];
  prompt: string;
};

type CatalogItem = {
  id: string;
  name: string;
  icon: IconType;
  iconClassName: string;
  description: string;
  tags: string[];
  status?: string;
};

const NAV_ITEMS: Array<{ label: string; path: string; icon: IconType }> = [
  { label: '新建任务', path: '/', icon: CirclePlus },
  { label: '助理', path: '/assistants', icon: Bot },
  { label: '项目', path: '/projects', icon: FolderKanban },
  { label: '专家·技能·连接器', path: '/marketplace', icon: Sparkles },
  { label: '自动化', path: '/automation', icon: Workflow },
  { label: '更多', path: '/more', icon: MoreHorizontal },
];

const MARKET_TABS: Array<{
  value: 'experts' | 'skills' | 'connectors';
  label: string;
  icon: IconType;
}> = [
  { value: 'experts', label: '专家', icon: Users },
  { value: 'skills', label: '技能', icon: Zap },
  { value: 'connectors', label: '连接器', icon: Link2 },
];

const SCENES = [
  {
    title: '天气形势分析',
    subtitle: '从模式、实况到综合研判',
    icon: CloudSun,
    className: 'from-sky-50 via-blue-50 to-indigo-100',
    items: ['天气形势分析专家', '强降水诊断专家', '强对流研判专家'],
    prompt:
      '请作为天气形势分析专家，先询问我分析区域、时次和可用数据，再给出分析计划。暂时不要直接下结论。',
  },
  {
    title: '气象内容创作',
    subtitle: '预报稿、专题材料与汇报',
    icon: FileText,
    className: 'from-amber-50 via-orange-50 to-rose-100',
    items: ['气象公报写作专家', '灾害性天气材料专家', '短视频文案助手'],
    prompt:
      '请作为气象内容创作专家，帮助我整理一份气象稿件需求清单，包括数据、图片、受众、篇幅和模板。',
  },
  {
    title: '数据与图表',
    subtitle: '表格统计、图形与 GIS 制图',
    icon: FileSpreadsheet,
    className: 'from-emerald-50 via-teal-50 to-cyan-100',
    items: ['Excel 数据分析助手', '气象图表助手', 'GIS 制图助手'],
    prompt:
      '请作为气象数据分析助手，先了解我的数据格式和目标，设计一个可复用的统计与制图流程。',
  },
  {
    title: '办公材料',
    subtitle: 'Word、PPT、PDF 成果物',
    icon: Presentation,
    className: 'from-violet-50 via-purple-50 to-fuchsia-100',
    items: ['Word 材料助手', 'PPT 汇报助手', 'PDF 摘要助手'],
    prompt:
      '请作为气象办公材料助手，先向我确认材料类型、模板、受众和交付格式，再给出制作步骤。',
  },
];

const EXPERTS: Expert[] = [
  {
    id: 'synoptic',
    name: '天气形势分析专家',
    author: 'MeteoDesk',
    icon: CloudSun,
    iconClassName: 'bg-sky-100 text-sky-700',
    category: '天气分析',
    description: '综合高空、地面、模式和实况信息，形成结构化天气形势分析与证据清单。',
    tags: ['天气系统', '模式分析', '综合研判'],
    prompt:
      '你是天气形势分析专家。请先向我确认区域、起报时间、预报时效、模式来源和可用图片，然后生成分析计划。',
  },
  {
    id: 'heavy-rain',
    name: '强降水诊断专家',
    author: 'MeteoDesk',
    icon: CloudRain,
    iconClassName: 'bg-blue-100 text-blue-700',
    category: '灾害天气',
    description: '围绕水汽、动力、热力和地形条件，组织强降水诊断、风险区与不确定性说明。',
    tags: ['强降水', '物理量', '风险研判'],
    prompt:
      '你是强降水诊断专家。请先列出完成诊断所需的数据和物理量，并询问我当前已具备哪些资料。',
  },
  {
    id: 'writer',
    name: '气象公报写作专家',
    author: 'MeteoDesk',
    icon: FileText,
    iconClassName: 'bg-orange-100 text-orange-700',
    category: '内容创作',
    description: '根据结构化气象结论和业务模板，生成短期预报、专题材料、周报和服务稿件。',
    tags: ['预报稿', '专题材料', '模板写作'],
    prompt:
      '你是气象公报写作专家。请先确认稿件类型、发布对象、时间范围、模板和可用数据，再开始写作。',
  },
  {
    id: 'spreadsheet',
    name: 'Excel 数据分析助手',
    author: 'MeteoDesk',
    icon: FileSpreadsheet,
    iconClassName: 'bg-emerald-100 text-emerald-700',
    category: '数据智能',
    description: '面向站点、降水、温度和业务统计表，设计清洗、统计、质检和图表输出流程。',
    tags: ['Excel', '统计分析', '图表'],
    prompt:
      '你是 Excel 数据分析助手。请询问我的工作簿结构、字段含义和目标输出，然后给出处理方案。',
  },
  {
    id: 'gis',
    name: '气象 GIS 制图助手',
    author: 'MeteoDesk',
    icon: Map,
    iconClassName: 'bg-teal-100 text-teal-700',
    category: '数据智能',
    description: '组织等值线、色斑图、天气系统、站点标注和地图版式等气象制图任务。',
    tags: ['GIS', '气象制图', '地图图层'],
    prompt:
      '你是气象 GIS 制图助手。请先确认数据格式、区域、投影、配色标准和输出尺寸。',
  },
  {
    id: 'office',
    name: '气象办公材料助手',
    author: 'MeteoDesk',
    icon: Presentation,
    iconClassName: 'bg-violet-100 text-violet-700',
    category: '办公材料',
    description: '将分析结论、图表和图片组织为 Word、PPT、PDF 或网页成果物。',
    tags: ['Word', 'PPT', 'PDF'],
    prompt:
      '你是气象办公材料助手。请确认我要制作 Word、PPT 还是 PDF，并了解模板、页数和受众。',
  },
];

const SKILLS: CatalogItem[] = [
  {
    id: 'synoptic-skill',
    name: '天气形势研判',
    icon: Gauge,
    iconClassName: 'bg-sky-100 text-sky-700',
    description: '规范天气系统识别、证据引用、形势演变和不确定性表达。',
    tags: ['SKILL.md', '天气分析'],
    status: 'MVP 预置',
  },
  {
    id: 'forecast-writing',
    name: '气象稿件写作',
    icon: Sparkles,
    iconClassName: 'bg-orange-100 text-orange-700',
    description: '将结构化结论转换为短期预报、专题材料和服务提示。',
    tags: ['模板', '写稿'],
    status: 'MVP 预置',
  },
  {
    id: 'quality-review',
    name: '稿件质量检查',
    icon: ShieldCheck,
    iconClassName: 'bg-emerald-100 text-emerald-700',
    description: '检查时次、地名、量级、前后一致性、证据完整性和风险措辞。',
    tags: ['质检', '审核'],
    status: '规划中',
  },
  {
    id: 'data-workflow',
    name: '气象数据处理流程',
    icon: Database,
    iconClassName: 'bg-teal-100 text-teal-700',
    description: '定义 NetCDF、GRIB、站点表格和图片资料的标准处理步骤。',
    tags: ['数据', '流程'],
    status: '规划中',
  },
];

const CONNECTORS: CatalogItem[] = [
  {
    id: 'weather-data',
    name: '气象数据连接器',
    icon: Database,
    iconClassName: 'bg-sky-100 text-sky-700',
    description: '接入模式、实况、站点、雷达和卫星等内部数据服务。',
    tags: ['MCP', '内部接口'],
    status: '待配置',
  },
  {
    id: 'diagnosis',
    name: '天气诊断连接器',
    icon: Wrench,
    iconClassName: 'bg-indigo-100 text-indigo-700',
    description: '接入槽线、切变线、锋面、高低压和强天气评分算法。',
    tags: ['MCP', '算法'],
    status: '待配置',
  },
  {
    id: 'office-artifact',
    name: 'Office 成果物连接器',
    icon: Presentation,
    iconClassName: 'bg-violet-100 text-violet-700',
    description: '根据模板生成 Word、Excel、PPT、PDF 和预览文件。',
    tags: ['MCP', '成果物'],
    status: '待配置',
  },
  {
    id: 'knowledge',
    name: '气象知识库连接器',
    icon: Layers,
    iconClassName: 'bg-amber-100 text-amber-700',
    description: '检索规范、历史过程、预报经验、服务材料和业务知识。',
    tags: ['MCP', '知识库'],
    status: '待配置',
  },
];

function ProductMark() {
  return (
    <div className="flex items-center gap-2.5 px-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
        <CloudSun className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-900">MeteoDesk</div>
        <div className="truncate text-[11px] text-slate-400">气象智办 · MVP</div>
      </div>
    </div>
  );
}

function SidebarButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: IconType;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
        active
          ? 'bg-white font-semibold text-slate-950 shadow-sm ring-1 ring-slate-200/80'
          : 'font-medium text-slate-600 hover:bg-white/70 hover:text-slate-950'
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function MeteoDeskLayout({ activeSessions }: { activeSessions: ActiveSession[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const chatContext = useChatContext();
  const { recentSessions, fetchSessions, handleSessionClick } = useNavigationSessions();
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [spacesExpanded, setSpacesExpanded] = useState(true);
  const isPairRoute = location.pathname === '/pair';

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  if (!chatContext) {
    throw new Error('MeteoDeskLayout must be used inside ChatProvider');
  }

  const isNavActive = (path: string) => {
    if (path === '/') return location.pathname === '/' || location.pathname === '/pair';
    return location.pathname === path;
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#f6f6f4] text-slate-900">
      <aside className="flex h-full w-[286px] shrink-0 flex-col border-r border-slate-200/80 bg-[#f1f1ef] px-3 pb-3 pt-14">
        <ProductMark />

        <nav className="mt-6 space-y-1">
          {NAV_ITEMS.map((item) => (
            <SidebarButton
              key={item.path}
              label={item.label}
              icon={item.icon}
              active={isNavActive(item.path)}
              onClick={() => navigate(item.path)}
            />
          ))}
        </nav>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => setTasksExpanded((value) => !value)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-700"
          >
            <span>任务 ({recentSessions.length})</span>
            {tasksExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>

          {tasksExpanded && (
            <div className="mt-1 space-y-0.5">
              {recentSessions.length === 0 ? (
                <div className="rounded-lg px-3 py-2 text-xs text-slate-400">暂无任务记录</div>
              ) : (
                recentSessions.slice(0, 7).map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => handleSessionClick(session.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-600 hover:bg-white hover:text-slate-950"
                    title={session.name}
                  >
                    <History className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{session.name || '未命名任务'}</span>
                  </button>
                ))
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSpacesExpanded((value) => !value)}
            className="mt-4 flex w-full items-center justify-between px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-700"
          >
            <span>空间 (1)</span>
            {spacesExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>

          {spacesExpanded && (
            <button
              type="button"
              onClick={() => navigate('/projects')}
              className="mt-1 flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-white"
            >
              <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-slate-700">气象办公空间</span>
                <span className="mt-1 block truncate text-[11px] text-slate-400">
                  数据、模板与项目工作区
                </span>
              </span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-900"
        >
          <Settings className="h-4 w-4" />
          设置与模型
        </button>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden bg-[#fbfbfa]">
        <Outlet />
        <div className={isPairRoute ? 'contents' : 'hidden'}>
          <ChatSessionsContainer setChat={chatContext.setChat} activeSessions={activeSessions} />
        </div>
      </main>
    </div>
  );
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto px-8 pb-12 pt-14 lg:px-10">{children}</div>;
}

function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  icon: Icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  icon?: IconType;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

function startPrompt(navigate: ReturnType<typeof useNavigate>, prompt: string) {
  navigate('/pair', {
    state: {
      initialMessage: { msg: prompt, images: [] },
      noAutoSubmit: true,
    },
  });
}

function ExpertCard({ expert, onUse }: { expert: Expert; onUse: () => void }) {
  const Icon = expert.icon;
  return (
    <article className="group flex min-h-[205px] flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
            expert.iconClassName
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-slate-950">{expert.name}</h3>
          <p className="mt-0.5 text-xs text-slate-400">{expert.author}</p>
        </div>
      </div>
      <p className="mt-4 line-clamp-3 flex-1 text-sm leading-6 text-slate-600">
        {expert.description}
      </p>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {expert.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-500"
            >
              {tag}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={onUse}
          className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-700 opacity-0 transition group-hover:opacity-100"
        >
          使用
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}

function CatalogCard({ item, onOpen }: { item: CatalogItem; onOpen: () => void }) {
  const Icon = item.icon;
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl',
              item.iconClassName
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-950">{item.name}</h3>
            {item.status && <p className="mt-1 text-[11px] text-slate-400">{item.status}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-800"
          aria-label={`打开${item.name}`}
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{item.description}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {item.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-500"
          >
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}

export function MeteoMarketplacePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'experts' | 'skills' | 'connectors'>('experts');
  const [category, setCategory] = useState('全部');
  const [query, setQuery] = useState('');

  const categories = ['全部', ...Array.from(new Set(EXPERTS.map((expert) => expert.category)))];
  const filteredExperts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return EXPERTS.filter((expert) => {
      const categoryMatches = category === '全部' || expert.category === category;
      const keywordMatches =
        keyword.length === 0 ||
        [expert.name, expert.description, expert.category, ...expert.tags]
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      return categoryMatches && keywordMatches;
    });
  }, [category, query]);

  return (
    <PageFrame>
      <header className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          {MARKET_TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setTab(item.value)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
                  tab === item.value
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-950'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <label className="flex min-w-[280px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索专家、技能或连接器"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </label>
          <button
            type="button"
            onClick={() => setCategory('全部')}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            我的专家
          </button>
        </div>
      </header>

      {tab === 'experts' && (
        <>
          <section className="mt-10">
            <h2 className="text-xl font-semibold text-slate-950">精选场景</h2>
            <div className="mt-4 grid gap-4 xl:grid-cols-4">
              {SCENES.map((scene) => {
                const Icon = scene.icon;
                return (
                  <button
                    key={scene.title}
                    type="button"
                    onClick={() => startPrompt(navigate, scene.prompt)}
                    className={cn(
                      'group min-h-[218px] rounded-3xl bg-gradient-to-br p-6 text-left shadow-sm ring-1 ring-slate-200/60 transition hover:-translate-y-0.5 hover:shadow-md',
                      scene.className
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/80 text-slate-700 shadow-sm">
                        <Icon className="h-5 w-5" />
                      </div>
                      <ArrowRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
                    </div>
                    <h3 className="mt-5 text-lg font-semibold text-slate-950">{scene.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">{scene.subtitle}</p>
                    <div className="mt-5 space-y-2">
                      {scene.items.map((item) => (
                        <div key={item} className="flex items-center gap-2 text-sm text-slate-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                          {item}
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">专家</h2>
                <p className="mt-1 text-sm text-slate-500">
                  MVP 预置的气象分析、写稿与办公助手。
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setCategory(item)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-medium transition',
                      category === item
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-500 hover:text-slate-900'
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {filteredExperts.map((expert) => (
                <ExpertCard
                  key={expert.id}
                  expert={expert}
                  onUse={() => startPrompt(navigate, expert.prompt)}
                />
              ))}
            </div>
          </section>
        </>
      )}

      {tab === 'skills' && (
        <section className="mt-10">
          <PageTitle
            title="技能"
            description="通过 SKILL.md 固化气象业务知识、工作步骤、模板和校验规则。"
            action={
              <PrimaryButton onClick={() => navigate('/skills')} icon={Zap}>
                打开技能管理
              </PrimaryButton>
            }
          />
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {SKILLS.filter((item) =>
              [item.name, item.description, ...item.tags]
                .join(' ')
                .toLowerCase()
                .includes(query.trim().toLowerCase())
            ).map((item) => (
              <CatalogCard key={item.id} item={item} onOpen={() => navigate('/skills')} />
            ))}
          </div>
        </section>
      )}

      {tab === 'connectors' && (
        <section className="mt-10">
          <PageTitle
            title="连接器"
            description="使用 MCP 将 Goose 与气象数据、诊断算法、知识库和 Office 成果物连接起来。"
            action={
              <PrimaryButton onClick={() => navigate('/extensions')} icon={Link2}>
                打开连接器管理
              </PrimaryButton>
            }
          />
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {CONNECTORS.filter((item) =>
              [item.name, item.description, ...item.tags]
                .join(' ')
                .toLowerCase()
                .includes(query.trim().toLowerCase())
            ).map((item) => (
              <CatalogCard
                key={item.id}
                item={item}
                onOpen={() => navigate('/extensions')}
              />
            ))}
          </div>
        </section>
      )}
    </PageFrame>
  );
}

const ASSISTANTS: Array<{
  title: string;
  description: string;
  icon: IconType;
  iconClassName: string;
  starters: PromptStarter[];
}> = [
  {
    title: '气象办公助理',
    description: '处理日常写稿、摘要、材料整理和文件任务。',
    icon: Bot,
    iconClassName: 'bg-sky-100 text-sky-700',
    starters: [
      {
        title: '整理今天的工作清单',
        prompt: '请帮助我整理今天的气象办公工作清单，先询问现有任务和截止时间。',
      },
      {
        title: '总结一份业务材料',
        prompt: '我要总结一份气象业务材料，请先询问文件类型、读者和摘要长度。',
      },
    ],
  },
  {
    title: '预报业务助理',
    description: '围绕天气形势、灾害风险和服务重点组织任务。',
    icon: CloudRain,
    iconClassName: 'bg-blue-100 text-blue-700',
    starters: [
      {
        title: '开始天气形势分析',
        prompt: '请带我完成一次天气形势分析，先列出需要提供的数据和图片。',
      },
      {
        title: '准备强降水会商',
        prompt: '我要准备强降水会商材料，请先给出资料清单和分析框架。',
      },
    ],
  },
  {
    title: '数据分析助理',
    description: '处理表格、站点、模式数据和图表输出需求。',
    icon: FileSpreadsheet,
    iconClassName: 'bg-emerald-100 text-emerald-700',
    starters: [
      {
        title: '分析 Excel 数据',
        prompt: '我要分析一个 Excel 气象数据表，请先询问字段、样例和目标输出。',
      },
      {
        title: '设计统计图表',
        prompt: '请帮助我设计一套气象统计图表，先确认数据指标、时间范围和展示对象。',
      },
    ],
  },
  {
    title: '材料创作助理',
    description: '制作 Word、PPT、PDF 和图文服务产品。',
    icon: Presentation,
    iconClassName: 'bg-violet-100 text-violet-700',
    starters: [
      {
        title: '制作 PPT 大纲',
        prompt: '我要制作一份气象专题汇报 PPT，请先确认主题、页数、受众和已有素材。',
      },
      {
        title: '生成 Word 材料',
        prompt: '我要生成一份 Word 气象材料，请先确认模板、章节和图片要求。',
      },
    ],
  },
];

export function MeteoAssistantsPage() {
  const navigate = useNavigate();
  return (
    <PageFrame>
      <PageTitle
        title="助理"
        description="按工作角色进入常用任务。后续可由团队发布和共享专属助理。"
        action={
          <PrimaryButton onClick={() => navigate('/marketplace')} icon={Sparkles}>
            浏览专家
          </PrimaryButton>
        }
      />

      <div className="mt-8 grid gap-5 xl:grid-cols-2">
        {ASSISTANTS.map((assistant) => {
          const Icon = assistant.icon;
          return (
            <article
              key={assistant.title}
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-start gap-4">
                <div
                  className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-2xl',
                    assistant.iconClassName
                  )}
                >
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">{assistant.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{assistant.description}</p>
                </div>
              </div>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {assistant.starters.map((starter) => (
                  <button
                    key={starter.title}
                    type="button"
                    onClick={() => startPrompt(navigate, starter.prompt)}
                    className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950"
                  >
                    {starter.title}
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </PageFrame>
  );
}

const PROJECTS = [
  {
    name: '日常天气形势分析',
    description: '汇集模式资料、天气图、会商结论和历史任务。',
    icon: CloudSun,
    status: '本地空间',
    updated: '今天',
  },
  {
    name: '强降水算法与诊断',
    description: '管理算法说明、测试样例、诊断结果和优化记录。',
    icon: Gauge,
    status: '本地空间',
    updated: '近期',
  },
  {
    name: '气象材料模板库',
    description: '整理公报、专题材料、Word、PPT 和图片模板。',
    icon: Briefcase,
    status: '待连接',
    updated: '未同步',
  },
];

export function MeteoProjectsPage() {
  const navigate = useNavigate();
  return (
    <PageFrame>
      <PageTitle
        title="项目"
        description="以工作目录为边界组织会话、数据、文件、模板和成果物。"
        action={
          <PrimaryButton
            onClick={() =>
              startPrompt(
                navigate,
                '请帮助我创建一个新的气象办公项目。先询问项目名称、工作目录、目标、数据来源和交付物。'
              )
            }
            icon={CirclePlus}
          >
            新建项目
          </PrimaryButton>
        }
      />

      <div className="mt-8 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {PROJECTS.map((project) => {
          const Icon = project.icon;
          return (
            <button
              key={project.name}
              type="button"
              onClick={() =>
                startPrompt(
                  navigate,
                  `我们要继续“${project.name}”项目。请先帮助我梳理本次任务目标和所需文件。`
                )
              }
              className="rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-500">
                  {project.status}
                </span>
              </div>
              <h2 className="mt-5 text-base font-semibold text-slate-950">{project.name}</h2>
              <p className="mt-2 min-h-[48px] text-sm leading-6 text-slate-500">
                {project.description}
              </p>
              <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-400">
                <span>{project.updated}</span>
                <span className="flex items-center gap-1 text-slate-600">
                  打开
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-600 shadow-sm">
            <FolderKanban className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">MVP 项目能力</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              当前复用 Goose 的工作目录和会话能力。下一阶段增加项目清单、文件索引、成果物、团队空间和权限同步。
            </p>
          </div>
        </div>
      </div>
    </PageFrame>
  );
}

const AUTOMATIONS = [
  {
    name: '每日天气材料准备',
    description: '按计划收集指定时次资料，生成待审核的分析任务。',
    icon: CalendarClock,
    enabled: true,
  },
  {
    name: '强天气过程资料归档',
    description: '将任务、图片、结论和成果物按过程归档到项目空间。',
    icon: FolderKanban,
    enabled: false,
  },
  {
    name: '稿件发布前质检',
    description: '检查时次、量级、区域、前后一致性和风险表达。',
    icon: ShieldCheck,
    enabled: false,
  },
];

export function MeteoAutomationPage() {
  const navigate = useNavigate();
  return (
    <PageFrame>
      <PageTitle
        title="自动化"
        description="使用 Recipe 固化流程，使用 Schedule 定时运行；涉及发布和写操作时保留人工审批。"
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate('/recipes')}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              流程模板
            </button>
            <PrimaryButton onClick={() => navigate('/schedules')} icon={CalendarClock}>
              定时任务
            </PrimaryButton>
          </div>
        }
      />

      <div className="mt-8 grid gap-5 xl:grid-cols-3">
        {AUTOMATIONS.map((automation) => {
          const Icon = automation.icon;
          return (
            <article
              key={automation.name}
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <Icon className="h-5 w-5" />
                </div>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium',
                    automation.enabled
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                  )}
                >
                  {automation.enabled ? '示例已启用' : '待配置'}
                </span>
              </div>
              <h2 className="mt-5 text-base font-semibold text-slate-950">{automation.name}</h2>
              <p className="mt-2 min-h-[72px] text-sm leading-6 text-slate-500">
                {automation.description}
              </p>
              <button
                type="button"
                onClick={() => navigate(automation.enabled ? '/schedules' : '/recipes')}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
              >
                {automation.enabled ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Wrench className="h-4 w-4" />
                )}
                {automation.enabled ? '查看计划' : '配置流程'}
              </button>
            </article>
          );
        })}
      </div>
    </PageFrame>
  );
}

const MORE_LINKS: Array<{
  title: string;
  description: string;
  path: string;
  icon: IconType;
}> = [
  { title: '任务历史', description: '查看、恢复和整理历史会话。', path: '/sessions', icon: History },
  { title: '流程模板', description: '管理可复用的 Recipe。', path: '/recipes', icon: FileText },
  { title: '技能管理', description: '查看和加载 Agent Skills。', path: '/skills', icon: Zap },
  { title: '连接器管理', description: '配置 MCP 与内置扩展。', path: '/extensions', icon: Link2 },
  { title: 'MCP 应用', description: '打开支持交互界面的 MCP Apps。', path: '/apps', icon: Layers },
  {
    title: '模型与权限',
    description: '配置模型、Provider、权限和安全策略。',
    path: '/settings',
    icon: Settings,
  },
];

export function MeteoMorePage() {
  const navigate = useNavigate();
  return (
    <PageFrame>
      <PageTitle title="更多" description="进入 Goose 原有的会话、技能、连接器、应用和设置能力。" />
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {MORE_LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <Icon className="h-5 w-5" />
                </div>
                <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
              </div>
              <h2 className="mt-4 text-sm font-semibold text-slate-950">{item.title}</h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">{item.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {[
          { label: '桌面底座', value: 'Goose', icon: CheckCircle2 },
          { label: '业务扩展', value: 'Skills + MCP', icon: Link2 },
          { label: '下一阶段', value: '安全文件与成果物', icon: ShieldCheck },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-2xl bg-slate-100 px-5 py-4"
            >
              <Icon className="h-5 w-5 text-slate-500" />
              <div>
                <p className="text-xs text-slate-400">{item.label}</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-800">{item.value}</p>
              </div>
            </div>
          );
        })}
      </div>
    </PageFrame>
  );
}
