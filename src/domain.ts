import { z } from 'zod';

export const roleSchema = z.enum(['admin', 'manager', 'user']);
export type Role = z.infer<typeof roleSchema>;

export const documentStatusSchema = z.enum(['uploaded', 'building', 'ready', 'failed']);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const knowledgeBaseStatusSchema = z.enum(['draft', 'building', 'ready', 'failed']);
export type KnowledgeBaseStatus = z.infer<typeof knowledgeBaseStatusSchema>;

export const modelCapabilitySchema = z.enum(['llm', 'embedding', 'rerank']);
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;

export const providerKindSchema = z.enum(['aihubmix', 'tongyi', 'deepseek']);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const documentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  mimeType: z.string(),
  selectedAt: z.string(),
  status: documentStatusSchema,
  error: z.string().nullable(),
  chunkCount: z.number(),
});
export type DocumentMetadata = z.infer<typeof documentSchema>;

export const knowledgeBaseSettingsSchema = z.object({
  ocrEnabled: z.boolean(),
  tableRecognition: z.boolean(),
  imageTextRecognition: z.boolean(),
  embeddingModelId: z.string().nullable(),
  rerankModelId: z.string().nullable(),
  chunkSize: z.number(),
  chunkOverlap: z.number(),
  chunkMethod: z.enum(['fixed', 'parent_child', 'semantic', 'recursive']),
  childChunkSize: z.number(),
  retrievalMode: z.enum(['hybrid', 'semantic', 'keyword']),
  retrievalCount: z.number(),
  scoreThreshold: z.number(),
  maxContextTokens: z.number(),
  queryOptimization: z.boolean(),
  rerankEnabled: z.boolean(),
});
export type KnowledgeBaseSettings = z.infer<typeof knowledgeBaseSettingsSchema>;

export const knowledgeBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: knowledgeBaseStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  embeddingLocked: z.boolean(),
  documents: z.array(documentSchema),
  settings: knowledgeBaseSettingsSchema,
});
export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;

export const providerSchema = z.object({
  id: z.string(),
  kind: providerKindSchema,
  name: z.string(),
  baseUrl: z.string(),
  hasApiKey: z.boolean(),
  connectionStatus: z.enum(['unknown', 'connected', 'failed']),
  connectionMessage: z.string(),
  createdAt: z.string(),
});
export type Provider = z.infer<typeof providerSchema>;

export const modelConfigSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  displayName: z.string(),
  modelId: z.string(),
  capability: modelCapabilitySchema,
  supportsVision: z.boolean(),
  createdAt: z.string(),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const visionConfigSchema = z.object({
  modelConfigId: z.string().nullable(),
  savedAt: z.string().nullable(),
});
export type VisionConfig = z.infer<typeof visionConfigSchema>;

export interface HubData {
  role: Role | null;
  knowledgeBases: KnowledgeBase[];
  providers: Provider[];
  models: ModelConfig[];
  vision: VisionConfig;
}

export const roleLabels: Record<Role, string> = {
  admin: '管理员',
  manager: '知识库管理人员',
  user: '使用者',
};

export const providerLabels: Record<ProviderKind, string> = {
  aihubmix: 'AIHubMix',
  tongyi: '通义百炼',
  deepseek: 'DeepSeek',
};

export const providerDefaultUrls: Record<ProviderKind, string> = {
  aihubmix: 'https://aihubmix.com/v1',
  tongyi: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  deepseek: 'https://api.deepseek.com',
};

export const modelCapabilityLabels: Record<ModelCapability, string> = {
  llm: 'LLM',
  embedding: 'Embedding',
  rerank: 'Rerank',
};

export const documentStatusLabels: Record<DocumentStatus, string> = {
  uploaded: '待构建',
  building: '构建中',
  ready: '可检索',
  failed: '构建失败',
};

export const knowledgeBaseStatusLabels: Record<KnowledgeBaseStatus, string> = {
  draft: '待构建',
  building: '构建中',
  ready: '可检索',
  failed: '构建失败',
};

export const emptyVision: VisionConfig = {
  modelConfigId: null,
  savedAt: null,
};

export const emptyHubData: HubData = {
  role: null,
  knowledgeBases: [],
  providers: [],
  models: [],
  vision: emptyVision,
};

export interface RetrievalHit {
  documentName: string;
  knowledgeBaseName: string;
  location: string;
  content: string;
  semanticScore: number | null;
  rerankScore: number | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: RetrievalHit[];
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  status: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  knowledgeBaseIds: string[];
  modelConfigId: string | null;
  routeMode: 'manual';
  createdAt: string;
  updatedAt: string;
  messages?: ChatMessage[];
}

export interface LogQuery {
  id: string;
  kind: 'chat' | 'retrieval' | 'app';
  query: string;
  knowledgeBaseNames: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  status: string;
  error: string | null;
  role: Role;
  createdAt: string;
}

export interface LogSummary {
  queries: number;
  tokens: number;
  averageDurationMs: number;
  errors: number;
  daily: Array<{ date: string; queries: number; tokens: number }>;
}
