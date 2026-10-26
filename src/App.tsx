import { lazy, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import type { Role } from './domain';
import { useAppState } from './state/AppState';
import NoAccessPage from './pages/NoAccessPage';
import NotFoundPage from './pages/NotFoundPage';
import RoleSelectPage from './pages/RoleSelectPage';

const AppsPage = lazy(() => import('./pages/AppsPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const KnowledgeBaseDetailPage = lazy(() => import('./pages/KnowledgeBaseDetailPage'));
const KnowledgeBasesPage = lazy(() => import('./pages/KnowledgeBasesPage'));
const LogsPage = lazy(() => import('./pages/LogsPage'));
const ModelSettingsPage = lazy(() => import('./pages/ModelSettingsPage'));

function RequireRole() {
  const { data } = useAppState();
  return data.role ? <Outlet /> : <Navigate to="/role" replace />;
}

function RoleGuard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { data } = useAppState();
  return data.role && roles.includes(data.role) ? children : <NoAccessPage />;
}

function HomeRedirect() {
  const { data } = useAppState();
  if (!data.role) {
    return <Navigate to="/role" replace />;
  }
  return <Navigate to={data.role === 'user' ? '/chat' : '/overview'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/role" element={<RoleSelectPage />} />
      <Route element={<RequireRole />}>
        <Route element={<AppShell />}>
          <Route index element={<HomeRedirect />} />
          <Route
            path="overview"
            element={
              <RoleGuard roles={['admin', 'manager']}>
                <DashboardPage />
              </RoleGuard>
            }
          />
          <Route path="chat" element={<ChatPage />} />
          <Route path="apps" element={<AppsPage />} />
          <Route path="apps/:appId" element={<AppsPage />} />
          <Route
            path="knowledge-bases"
            element={
              <RoleGuard roles={['admin', 'manager']}>
                <KnowledgeBasesPage />
              </RoleGuard>
            }
          />
          <Route
            path="knowledge-bases/:knowledgeBaseId"
            element={
              <RoleGuard roles={['admin', 'manager']}>
                <KnowledgeBaseDetailPage />
              </RoleGuard>
            }
          />
          <Route
            path="models"
            element={
              <RoleGuard roles={['admin']}>
                <ModelSettingsPage />
              </RoleGuard>
            }
          />
          <Route
            path="logs"
            element={
              <RoleGuard roles={['admin']}>
                <LogsPage />
              </RoleGuard>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

