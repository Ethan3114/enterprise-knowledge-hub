import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiError, api, readStoredRole, storeRole } from '../api';
import {
  emptyHubData,
  emptyVision,
  type HubData,
  type KnowledgeBase,
  type KnowledgeBaseSettings,
  type ModelCapability,
  type ProviderKind,
  type Role,
  type VisionConfig,
} from '../domain';

interface CreateKnowledgeBaseInput {
  name: string;
  description: string;
}

interface CreateProviderInput {
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  apiKey: string;
}

interface CreateModelInput {
  providerId: string;
  displayName: string;
  modelId: string;
  capability: ModelCapability;
  supportsVision: boolean;
}

interface AppStateContextValue {
  data: HubData;
  ready: boolean;
  backendOnline: boolean;
  setRole: (role: Role) => void;
  refresh: () => Promise<void>;
  createKnowledgeBase: (input: CreateKnowledgeBaseInput) => Promise<string>;
  updateKnowledgeBase: (
    id: string,
    input: { name: string; description: string; settings: KnowledgeBaseSettings },
  ) => Promise<void>;
  deleteKnowledgeBase: (id: string) => Promise<void>;
  uploadDocuments: (knowledgeBaseId: string, files: File[]) => Promise<void>;
  removeDocument: (knowledgeBaseId: string, documentId: string) => Promise<void>;
  buildKnowledgeBase: (knowledgeBaseId: string, rebuild: boolean) => Promise<void>;
  createProvider: (input: CreateProviderInput) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  testProvider: (id: string) => Promise<string>;
  createModel: (input: CreateModelInput) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  testModel: (id: string) => Promise<string>;
  saveVision: (modelConfigId: string | null) => Promise<void>;
  resetWorkspace: () => Promise<void>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: PropsWithChildren) {
  const [data, setData] = useState<HubData>(() => ({ ...emptyHubData, role: readStoredRole() }));
  const [ready, setReady] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);

  const refresh = useCallback(async () => {
    const role = readStoredRole();
    if (!role) {
      setData({ ...emptyHubData, role: null });
      setBackendOnline(false);
      setReady(true);
      return;
    }
    try {
      const [health, knowledgeBases, providers, models, vision] = await Promise.all([
        api<{ status: string }>('/health'),
        api<HubData['knowledgeBases']>('/knowledge-bases'),
        api<HubData['providers']>('/providers'),
        api<HubData['models']>('/models'),
        api<VisionConfig>('/vision'),
      ]);
      setBackendOnline(health.status === 'ok');
      setData({ role, knowledgeBases, providers, models, vision });
    } catch {
      setBackendOnline(false);
      setData((current) => ({ ...current, role }));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.removeItem('enterprise-knowledge-hub-prototype-v1');
    void refresh();
  }, [refresh]);

  const value = useMemo<AppStateContextValue>(
    () => ({
      data,
      ready,
      backendOnline,
      setRole: (role) => {
        storeRole(role);
        setData((current) => ({ ...current, role }));
        void refresh();
      },
      refresh,
      createKnowledgeBase: async (input) => {
        const created = await api<KnowledgeBase>('/knowledge-bases', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        await refresh();
        return created.id;
      },
      updateKnowledgeBase: async (id, input) => {
        await api(`/knowledge-bases/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(input),
        });
        await refresh();
      },
      deleteKnowledgeBase: async (id) => {
        await api(`/knowledge-bases/${id}`, { method: 'DELETE' });
        await refresh();
      },
      uploadDocuments: async (knowledgeBaseId, files) => {
        const form = new FormData();
        files.forEach((file) => form.append('files', file));
        await api(`/knowledge-bases/${knowledgeBaseId}/documents`, {
          method: 'POST',
          body: form,
        });
        await refresh();
      },
      removeDocument: async (knowledgeBaseId, documentId) => {
        await api(`/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`, { method: 'DELETE' });
        await refresh();
      },
      buildKnowledgeBase: async (knowledgeBaseId, rebuild) => {
        await api(`/knowledge-bases/${knowledgeBaseId}/build`, {
          method: 'POST',
          body: JSON.stringify({ rebuild }),
        });
        await refresh();
      },
      createProvider: async (input) => {
        await api('/providers', { method: 'POST', body: JSON.stringify(input) });
        await refresh();
      },
      deleteProvider: async (id) => {
        await api(`/providers/${id}`, { method: 'DELETE' });
        await refresh();
      },
      testProvider: async (id) => {
        try {
          const result = await api<{ message: string; connectionStatus: string }>(`/providers/${id}/test`, {
            method: 'POST',
          });
          if (result.connectionStatus === 'failed') {
            throw new ApiError(result.message, 400);
          }
          return result.message;
        } finally {
          await refresh();
        }
      },
      createModel: async (input) => {
        await api('/models', { method: 'POST', body: JSON.stringify(input) });
        await refresh();
      },
      deleteModel: async (id) => {
        await api(`/models/${id}`, { method: 'DELETE' });
        await refresh();
      },
      testModel: async (id) => {
        const result = await api<{ message: string }>(`/models/${id}/test`, { method: 'POST' });
        return result.message;
      },
      saveVision: async (modelConfigId) => {
        await api('/vision', { method: 'PUT', body: JSON.stringify({ modelConfigId }) });
        await refresh();
      },
      resetWorkspace: async () => {
        await api('/workspace', { method: 'DELETE' });
        storeRole(null);
        setData({ ...emptyHubData, vision: emptyVision });
        setBackendOnline(true);
      },
    }),
    [backendOnline, data, ready, refresh],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) {
    throw new Error('useAppState 必须在 AppStateProvider 内使用');
  }
  return value;
}
