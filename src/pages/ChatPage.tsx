import { useEffect, useState } from 'react';
import {
  BookOutlined,
  CommentOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { Link } from 'react-router-dom';
import { ApiError, api, apiStream } from '../api';
import PageFrame from '../components/PageFrame';
import type { ChatMessage, Conversation, RetrievalHit } from '../domain';
import { useAppState } from '../state/AppState';

interface StreamEvent {
  type: 'route' | 'citations' | 'token' | 'done' | 'error';
  text?: string;
  items?: RetrievalHit[];
  message?: string;
}

async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (event: StreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((item) => item.startsWith('data:'));
      if (!line) {
        continue;
      }
      onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
    }
  }
}

export default function ChatPage() {
  const { data } = useAppState();
  const { message: messageApi } = App.useApp();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  const [modelId, setModelId] = useState<string>();
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [citations, setCitations] = useState<RetrievalHit[]>([]);
  const llmModels = data.models.filter((model) => model.capability === 'llm');
  const readyKnowledgeBases = data.knowledgeBases.filter((knowledgeBase) =>
    knowledgeBase.documents.some((document) => document.status === 'ready'),
  );

  const loadConversations = async () => {
    const list = await api<Conversation[]>('/conversations');
    setConversations(list);
    return list;
  };

  const openConversation = async (conversationId: string) => {
    const detail = await api<Conversation>(`/conversations/${conversationId}`);
    setActiveId(detail.id);
    setMessages(detail.messages ?? []);
    setKnowledgeBaseIds(detail.knowledgeBaseIds);
    setModelId(detail.modelConfigId ?? undefined);
    const latest = [...(detail.messages ?? [])].reverse().find((message) => message.role === 'assistant');
    setCitations(latest?.citations ?? []);
  };

  useEffect(() => {
    void loadConversations().catch(() => setConversations([]));
  }, []);

  const createConversation = async () => {
    const created = await api<Conversation>('/conversations', { method: 'POST' });
    setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    setActiveId(created.id);
    return created.id;
  };

  const startConversation = async () => {
    await createConversation();
    setMessages([]);
    setCitations([]);
    setDraft('');
  };

  const sendQuestion = async () => {
    const question = draft.trim();
    if (!question || !modelId || !knowledgeBaseIds.length || streaming) {
      return;
    }
    setStreaming(true);
    setDraft('');
    const userMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: question,
      citations: [],
      promptTokens: 0,
      completionTokens: 0,
      durationMs: 0,
      status: 'success',
      createdAt: new Date().toISOString(),
    };
    const assistantMessage: ChatMessage = {
      ...userMessage,
      id: `local-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      status: 'building',
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setCitations([]);
    try {
      const conversationId = activeId ?? await createConversation();
      const body = await apiStream(`/conversations/${conversationId}/messages`, {
        content: question,
        knowledgeBaseIds,
        modelConfigId: modelId,
      });
      await readEvents(body, (event) => {
        if (event.type === 'citations') {
          setCitations(event.items ?? []);
        }
        if (event.type === 'token' && event.text) {
          setMessages((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, content: last.content + event.text };
            }
            return next;
          });
        }
        if (event.type === 'error') {
          messageApi.error(event.message || '回答失败');
        }
      });
      await openConversation(conversationId);
      await loadConversations();
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : '发送失败');
    } finally {
      setStreaming(false);
    }
  };

  const canSend = Boolean(draft.trim() && modelId && knowledgeBaseIds.length && !streaming);

  return (
    <PageFrame
      title="在线对话"
      description="从企业知识库中检索依据，查看回答引用与模型消耗。"
      actions={
        <Button icon={<PlusOutlined />} onClick={() => void startConversation().catch(() => messageApi.error('无法新建对话'))}>
          新建对话
        </Button>
      }
    >
      <Alert
        showIcon
        type="info"
        title="回答会逐字显示，并带上一轮问答"
        description="一次可以选择多个知识库。当前由你手动选择，后续可以改成自动路由。"
        className="page-alert"
      />
      <div className="chat-layout">
        <Card className="chat-sessions-card" styles={{ body: { padding: 0 } }}>
          <div className="chat-panel-heading">
            <Typography.Text strong>会话历史</Typography.Text>
            <Tag>{conversations.length}</Tag>
          </div>
          {conversations.length ? (
            <div className="session-list">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={conversation.id === activeId ? 'session-item session-item-active' : 'session-item'}
                  onClick={() => void openConversation(conversation.id)}
                >
                  {conversation.title}
                </button>
              ))}
            </div>
          ) : (
            <div className="chat-empty-compact">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="完成真实对话后显示历史记录" />
            </div>
          )}
        </Card>

        <Card className="chat-main-card" styles={{ body: { padding: 0 } }}>
          <div className="chat-config-bar">
            <Select
              mode="multiple"
              maxTagCount="responsive"
              value={knowledgeBaseIds}
              onChange={setKnowledgeBaseIds}
              prefix={<BookOutlined />}
              placeholder="选择知识库"
              aria-label="选择对话知识库"
              options={data.knowledgeBases.map((knowledgeBase) => ({
                value: knowledgeBase.id,
                label: knowledgeBase.name,
                disabled: !readyKnowledgeBases.some((item) => item.id === knowledgeBase.id),
              }))}
              className="chat-config-select"
            />
            <Select
              value={modelId}
              onChange={setModelId}
              prefix={<RobotOutlined />}
              placeholder="选择 LLM"
              aria-label="选择对话模型"
              options={llmModels.map((model) => ({
                value: model.id,
                label: model.displayName,
              }))}
              className="chat-config-select"
            />
          </div>
          {messages.length ? (
            <div className="chat-message-area chat-thread" role="log" aria-live="polite">
              {messages.map((message) => (
                <div key={message.id} className={message.role === 'user' ? 'bubble bubble-user' : 'bubble bubble-assistant'}>
                  <Typography.Text>{message.content || (streaming ? '正在组织回答' : '')}</Typography.Text>
                </div>
              ))}
            </div>
          ) : (
            <div className="chat-message-area">
              <div className="chat-welcome-icon"><CommentOutlined /></div>
              <Typography.Title level={3}>从企业知识中获得有依据的回答</Typography.Title>
              <Typography.Paragraph type="secondary" className="chat-welcome-copy">
                每次回答会展示引用文件、位置、Token 消耗和处理时长。
              </Typography.Paragraph>
              <Space wrap size={[8, 8]} className="chat-capabilities">
                <Tag icon={<BookOutlined />}>多知识库检索</Tag>
                <Tag icon={<LinkOutlined />}>引用来源可追溯</Tag>
                <Tag icon={<RobotOutlined />}>记住上一轮</Tag>
              </Space>
            </div>
          )}
          <div className="chat-composer-wrap">
            {!data.knowledgeBases.length ? (
              <div className="chat-requirement">
                <Typography.Text type="secondary">尚未创建知识库。</Typography.Text>
                {data.role === 'user' ? null : <Link to="/knowledge-bases">前往创建</Link>}
              </div>
            ) : null}
            {!llmModels.length ? (
              <div className="chat-requirement">
                <Typography.Text type="secondary">尚未配置 LLM。</Typography.Text>
                {data.role === 'admin' ? <Link to="/models?tab=models">前往配置</Link> : null}
              </div>
            ) : null}
            <div className="chat-composer">
              <Input.TextArea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                autoSize={{ minRows: 2, maxRows: 6 }}
                placeholder="输入问题，按 Enter 发送"
                aria-label="对话问题"
                disabled={streaming}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendQuestion();
                  }
                }}
              />
              <Button
                type="primary"
                shape="circle"
                size="large"
                icon={<SendOutlined />}
                disabled={!canSend}
                aria-label="发送问题"
                onClick={() => void sendQuestion()}
              />
            </div>
            <Typography.Text type="secondary" className="composer-hint">
              回答只依据已构建的知识片段，并记住上一轮问答。
            </Typography.Text>
          </div>
        </Card>

        <Card className="chat-citations-card" styles={{ body: { padding: 0 } }}>
          <div className="chat-panel-heading">
            <Typography.Text strong>引用资料</Typography.Text>
            <Tag>{citations.length}</Tag>
          </div>
          {citations.length ? (
            <div className="citation-list">
              {citations.map((citation, index) => (
                <article key={`${citation.documentName}-${citation.location}-${index}`} className="citation-item">
                  <Typography.Text strong>{citation.documentName}</Typography.Text>
                  <Typography.Text type="secondary">{citation.location}</Typography.Text>
                  <Typography.Paragraph className="hit-content">{citation.content}</Typography.Paragraph>
                </article>
              ))}
            </div>
          ) : (
            <div className="chat-empty-compact">
              <Empty
                image={<FileTextOutlined className="citation-empty-icon" />}
                description={
                  <Space orientation="vertical" size={2}>
                    <Typography.Text type="secondary">暂无引用</Typography.Text>
                    <Typography.Text type="secondary" className="small-text">真实回答完成后显示来源</Typography.Text>
                  </Space>
                }
              />
            </div>
          )}
        </Card>
      </div>
    </PageFrame>
  );
}
