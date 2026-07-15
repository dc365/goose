import { useEffect, useRef, useState } from 'react';
import type { IpcRendererEvent } from 'electron';
import {
  HashRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { acpDeleteSession, acpListSessions } from '../../acp/sessions';
import { reconnectAcpAfterSystemResume } from '../../acp/acpConnection';
import { isRecipeParamsCancelled } from '../../acp/errors';
import AnnouncementModal from '../../components/AnnouncementModal';
import AppsView from '../../components/apps/AppsView';
import StandaloneAppView from '../../components/apps/StandaloneAppView';
import { useConfig } from '../../components/ConfigContext';
import { ErrorUI } from '../../components/ErrorBoundary';
import { ExtensionInstallModal } from '../../components/ExtensionInstallModal';
import ExtensionsView, {
  type ExtensionsViewOptions,
} from '../../components/extensions/ExtensionsView';
import Hub from '../../components/Hub';
import LauncherView from '../../components/LauncherView';
import { ModelAndProviderProvider } from '../../components/ModelAndProviderContext';
import OnboardingGuard from '../../components/onboarding/OnboardingGuard';
import RecipeParamsModalContainer from '../../components/RecipeParamsModalContainer';
import RecipesView from '../../components/recipes/RecipesView';
import SchedulesView from '../../components/schedule/SchedulesView';
import SessionsView from '../../components/sessions/SessionsView';
import SettingsView, {
  type SettingsViewOptions,
} from '../../components/settings/SettingsView';
import PermissionSettingsView from '../../components/settings/permission/PermissionSetting';
import ProviderSettings from '../../components/settings/providers/ProviderSettingsPage';
import SkillsView from '../../components/skills/SkillsView';
import TelemetryConsentPrompt from '../../components/TelemetryConsentPrompt';
import { AppEvents } from '../../constants/events';
import { ChatProvider, DEFAULT_CHAT_TITLE } from '../../contexts/ChatContext';
import { FeaturesProvider } from '../../contexts/FeaturesContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { usePageViewTracking } from '../../hooks/useAnalytics';
import { useNavigation } from '../../hooks/useNavigation';
import { createSession } from '../../sessions';
import type { ChatType } from '../../types/chat';
import type { UserInput } from '../../types/message';
import { trackErrorWithContext } from '../../utils/analytics';
import { errorMessage } from '../../utils/conversionUtils';
import type { View, ViewOptions } from '../../utils/navigationUtils';
import { registerPlatformEventHandlers } from '../../utils/platform_events';
import { getInitialWorkingDir } from '../../utils/workingDir';
import {
  MeteoAssistantsPage,
  MeteoAutomationPage,
  MeteoDeskLayout,
  MeteoMarketplacePage,
  MeteoMorePage,
  MeteoProjectsPage,
} from './MeteoDeskWorkspace';

type ActiveSession = {
  sessionId: string;
  initialMessage?: UserInput;
  noAutoSubmit?: boolean;
};

interface PairRouteState {
  resumeSessionId?: string;
  initialMessage?: UserInput;
  noAutoSubmit?: boolean;
}

function PageViewTracker() {
  usePageViewTracking();
  return null;
}

function HubRouteWrapper() {
  const setView = useNavigation();
  return <Hub setView={setView} />;
}

function resolveSessionInitialMessage(
  session: { recipe?: { prompt?: string | null } | null },
  initialMessage?: UserInput
): UserInput | undefined {
  return (
    initialMessage ??
    (session.recipe?.prompt ? { msg: session.recipe.prompt, images: [] } : undefined)
  );
}

function PairRouteWrapper({ activeSessions }: { activeSessions: ActiveSession[] }) {
  const { extensionsList } = useConfig();
  const location = useLocation();
  const routeState =
    (location.state as PairRouteState) || (window.history.state as PairRouteState) || {};
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isCreatingSessionRef = useRef(false);

  const resumeSessionId = searchParams.get('resumeSessionId') ?? undefined;
  const recipeDeeplinkFromConfig = window.appConfig?.get('recipeDeeplink') as string | undefined;
  const recipeIdFromConfig = window.appConfig?.get('recipeId') as string | undefined;
  const initialMessage = routeState.initialMessage;
  const noAutoSubmit = routeState.noAutoSubmit;

  useEffect(() => {
    if (
      (initialMessage || recipeDeeplinkFromConfig || recipeIdFromConfig) &&
      !resumeSessionId &&
      !isCreatingSessionRef.current
    ) {
      isCreatingSessionRef.current = true;

      void (async () => {
        try {
          const newSession = await createSession(getInitialWorkingDir(), {
            recipeDeeplink: recipeDeeplinkFromConfig,
            recipeId: recipeIdFromConfig,
            allExtensions: extensionsList,
          });
          const sessionInitialMessage = resolveSessionInitialMessage(newSession, initialMessage);

          window.dispatchEvent(
            new CustomEvent(AppEvents.ADD_ACTIVE_SESSION, {
              detail: {
                sessionId: newSession.id,
                initialMessage: sessionInitialMessage,
                noAutoSubmit,
              },
            })
          );

          setSearchParams((previous) => {
            previous.set('resumeSessionId', newSession.id);
            return previous;
          });
        } catch (error) {
          if (isRecipeParamsCancelled(error)) {
            navigate('/');
            return;
          }
          console.error('Failed to create MeteoDesk session:', error);
          trackErrorWithContext(error, {
            component: 'MeteoDeskPairRouteWrapper',
            action: 'create_session',
            recoverable: true,
          });
        } finally {
          isCreatingSessionRef.current = false;
        }
      })();
    }
  }, [
    extensionsList,
    initialMessage,
    navigate,
    noAutoSubmit,
    recipeDeeplinkFromConfig,
    recipeIdFromConfig,
    resumeSessionId,
    setSearchParams,
  ]);

  useEffect(() => {
    if (resumeSessionId && !activeSessions.some((session) => session.sessionId === resumeSessionId)) {
      window.dispatchEvent(
        new CustomEvent(AppEvents.ADD_ACTIVE_SESSION, {
          detail: {
            sessionId: resumeSessionId,
            initialMessage,
            noAutoSubmit,
          },
        })
      );
    }
  }, [activeSessions, initialMessage, noAutoSubmit, resumeSessionId]);

  return null;
}

function SettingsRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setView = useNavigation();
  const viewOptions =
    (location.state as SettingsViewOptions) || (window.history.state as SettingsViewOptions) || {};
  const sectionFromUrl = searchParams.get('section');

  if (sectionFromUrl) {
    viewOptions.section = sectionFromUrl;
  }

  return <SettingsView onClose={() => navigate('/more')} setView={setView} viewOptions={viewOptions} />;
}

function SchedulesRoute() {
  const navigate = useNavigate();
  return <SchedulesView onClose={() => navigate('/automation')} />;
}

function ConfigureProvidersRoute() {
  const navigate = useNavigate();
  return (
    <div className="h-screen w-screen bg-background-primary">
      <ProviderSettings
        onClose={() => navigate('/settings', { state: { section: 'models' } })}
        isOnboarding={false}
      />
    </div>
  );
}

function ExtensionsRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const viewOptions =
    (location.state as ExtensionsViewOptions) ||
    (window.history.state as ExtensionsViewOptions) ||
    {};

  return (
    <ExtensionsView
      onClose={() => navigate('/marketplace')}
      setView={(view, options) => {
        switch (view) {
          case 'chat':
            navigate('/');
            break;
          case 'pair':
            navigate('/pair', { state: options });
            break;
          case 'settings':
            navigate('/settings', { state: options });
            break;
          default:
            navigate('/marketplace');
        }
      }}
      viewOptions={viewOptions}
    />
  );
}

function PermissionRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const parentView = location.state?.parentView as View;
  const parentViewOptions = location.state?.parentViewOptions as ViewOptions;

  return (
    <PermissionSettingsView
      onClose={() => {
        switch (parentView) {
          case 'pair':
            navigate('/pair');
            break;
          case 'settings':
            navigate('/settings', { state: parentViewOptions });
            break;
          case 'sessions':
            navigate('/sessions');
            break;
          case 'schedules':
            navigate('/schedules');
            break;
          case 'recipes':
            navigate('/recipes');
            break;
          case 'skills':
            navigate('/skills');
            break;
          default:
            navigate('/more');
        }
      }}
    />
  );
}

function MeteoDeskAppInner() {
  const [fatalError, setFatalError] = useState<string | null>(null);
  const navigate = useNavigate();
  const setView = useNavigation();
  const { addExtension } = useConfig();
  const [chat, setChat] = useState<ChatType>({
    sessionId: '',
    name: DEFAULT_CHAT_TITLE,
    messages: [],
    recipe: null,
  });
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const isProcessingInitialMessageRef = useRef(false);

  useEffect(() => {
    const handleAddActiveSession = (event: Event) => {
      const detail = (event as CustomEvent<ActiveSession>).detail;
      setActiveSessions((previous) => {
        const existingIndex = previous.findIndex((session) => session.sessionId === detail.sessionId);
        if (existingIndex >= 0) {
          const existing = previous[existingIndex];
          return [
            ...previous.slice(0, existingIndex),
            ...previous.slice(existingIndex + 1),
            { ...existing, ...detail },
          ];
        }
        return [...previous, detail].slice(-10);
      });
    };

    const handleClearInitialMessage = (event: Event) => {
      const { sessionId } = (event as CustomEvent<{ sessionId: string }>).detail;
      setActiveSessions((previous) =>
        previous.map((session) =>
          session.sessionId === sessionId ? { ...session, initialMessage: undefined } : session
        )
      );
    };

    const handleSessionDeleted = (event: Event) => {
      const { sessionId } = (event as CustomEvent<{ sessionId: string }>).detail;
      setActiveSessions((previous) =>
        previous.filter((session) => session.sessionId !== sessionId)
      );
    };

    window.addEventListener(AppEvents.ADD_ACTIVE_SESSION, handleAddActiveSession);
    window.addEventListener(AppEvents.CLEAR_INITIAL_MESSAGE, handleClearInitialMessage);
    window.addEventListener(AppEvents.SESSION_DELETED, handleSessionDeleted);
    return () => {
      window.removeEventListener(AppEvents.ADD_ACTIVE_SESSION, handleAddActiveSession);
      window.removeEventListener(AppEvents.CLEAR_INITIAL_MESSAGE, handleClearInitialMessage);
      window.removeEventListener(AppEvents.SESSION_DELETED, handleSessionDeleted);
    };
  }, []);

  useEffect(() => {
    try {
      window.electron.reactReady();
    } catch (error) {
      console.error('Error sending reactReady:', error);
      setFatalError(`React ready notification failed: ${errorMessage(error, 'Unknown error')}`);
    }
  }, []);

  useEffect(() => {
    const handleSystemResume = () => reconnectAcpAfterSystemResume();
    window.electron.on('system-resume', handleSystemResume);
    return () => window.electron.off('system-resume', handleSystemResume);
  }, []);

  useEffect(() => {
    void acpListSessions()
      .then(({ sessions }) => {
        sessions
          .filter((session) => session.messageCount === 0 && !session.userSetName && !session.hasRecipe)
          .forEach((session) => {
            void acpDeleteSession(session.id).catch(() => undefined);
          });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleFatalError = (_event: IpcRendererEvent, ...args: unknown[]) => {
      const message = args[0] as string;
      console.error('MeteoDesk fatal error:', message);
      setFatalError(message);
    };
    window.electron.on('fatal-error', handleFatalError);
    return () => window.electron.off('fatal-error', handleFatalError);
  }, []);

  useEffect(() => {
    const handleSetView = (_event: IpcRendererEvent, ...args: unknown[]) => {
      const newView = args[0] as View;
      const section = args[1] as string | undefined;
      if (section && newView === 'settings') {
        navigate(`/settings?section=${section}`);
      } else if (newView === 'chat') {
        navigate('/');
      } else {
        navigate(`/${newView}`);
      }
    };
    const handleNewChat = () => navigate('/');
    const handleFocusInput = () => {
      const input = document.querySelector('input[type="text"], textarea') as HTMLInputElement | null;
      input?.focus();
    };
    const handleSetInitialMessage = (_event: IpcRendererEvent, ...args: unknown[]) => {
      const initialMessage = args[0] as string;
      const options = (args[1] as { noAutoSubmit?: boolean } | undefined) || {};
      if (!initialMessage || isProcessingInitialMessageRef.current) return;
      isProcessingInitialMessageRef.current = true;
      navigate('/pair', {
        state: {
          initialMessage: { msg: initialMessage, images: [] },
          noAutoSubmit: options.noAutoSubmit,
        },
      });
      window.setTimeout(() => {
        isProcessingInitialMessageRef.current = false;
      }, 1000);
    };

    window.electron.on('set-view', handleSetView);
    window.electron.on('new-chat', handleNewChat);
    window.electron.on('focus-input', handleFocusInput);
    window.electron.on('set-initial-message', handleSetInitialMessage);
    return () => {
      window.electron.off('set-view', handleSetView);
      window.electron.off('new-chat', handleNewChat);
      window.electron.off('focus-input', handleFocusInput);
      window.electron.off('set-initial-message', handleSetInitialMessage);
    };
  }, [navigate]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = window.electron.platform === 'darwin';
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        window.electron.createChatWindow({ dir: getInitialWorkingDir() });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => registerPlatformEventHandlers(), []);

  useEffect(() => {
    const preventDrop = (event: globalThis.DragEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-drop-zone="true"]')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const allowDragOver = (event: globalThis.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('dragenter', preventDrop, false);
    document.addEventListener('dragleave', preventDrop, false);
    document.addEventListener('dragover', allowDragOver, false);
    document.addEventListener('drop', preventDrop, false);
    return () => {
      document.removeEventListener('dragenter', preventDrop, false);
      document.removeEventListener('dragleave', preventDrop, false);
      document.removeEventListener('dragover', allowDragOver, false);
      document.removeEventListener('drop', preventDrop, false);
    };
  }, []);

  if (fatalError) {
    return <ErrorUI error={errorMessage(fatalError)} />;
  }

  return (
    <>
      <PageViewTracker />
      <ToastContainer
        aria-label="Toast notifications"
        className="mt-6"
        position="top-right"
        autoClose={3000}
        closeOnClick
        pauseOnHover
        style={{ width: '450px' }}
        toastClassName={() =>
          'relative min-h-16 mb-4 p-2 rounded-lg flex justify-between overflow-hidden cursor-pointer text-text-inverse bg-background-inverse'
        }
      />
      <ExtensionInstallModal addExtension={addExtension} setView={setView} />
      <RecipeParamsModalContainer />
      <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background-secondary">
        <div className="titlebar-drag-region" />
        <div className="relative h-full w-full">
          <Routes>
            <Route path="launcher" element={<LauncherView />} />
            <Route path="configure-providers" element={<ConfigureProvidersRoute />} />
            <Route path="standalone-app" element={<StandaloneAppView />} />
            <Route
              path="/"
              element={
                <OnboardingGuard>
                  <ChatProvider chat={chat} setChat={setChat} contextKey="meteodesk">
                    <MeteoDeskLayout activeSessions={activeSessions} />
                  </ChatProvider>
                </OnboardingGuard>
              }
            >
              <Route index element={<HubRouteWrapper />} />
              <Route path="assistants" element={<MeteoAssistantsPage />} />
              <Route path="projects" element={<MeteoProjectsPage />} />
              <Route path="marketplace" element={<MeteoMarketplacePage />} />
              <Route path="automation" element={<MeteoAutomationPage />} />
              <Route path="more" element={<MeteoMorePage />} />
              <Route path="pair" element={<PairRouteWrapper activeSessions={activeSessions} />} />
              <Route path="settings" element={<SettingsRoute />} />
              <Route
                path="extensions"
                element={
                  <ChatProvider chat={chat} setChat={setChat} contextKey="meteodesk-extensions">
                    <ExtensionsRoute />
                  </ChatProvider>
                }
              />
              <Route path="apps" element={<AppsView />} />
              <Route path="sessions" element={<SessionsView />} />
              <Route path="schedules" element={<SchedulesRoute />} />
              <Route path="recipes" element={<RecipesView />} />
              <Route path="skills" element={<SkillsView />} />
              <Route path="permission" element={<PermissionRoute />} />
            </Route>
          </Routes>
        </div>
      </div>
    </>
  );
}

export default function MeteoDeskApp() {
  return (
    <ThemeProvider>
      <FeaturesProvider>
        <ModelAndProviderProvider>
          <HashRouter>
            <MeteoDeskAppInner />
          </HashRouter>
          <AnnouncementModal />
          <TelemetryConsentPrompt />
        </ModelAndProviderProvider>
      </FeaturesProvider>
    </ThemeProvider>
  );
}
