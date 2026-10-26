import { useEffect, useState } from 'react';
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  BookOutlined,
  CalendarOutlined,
  FileTextOutlined,
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
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, apiStream } from '../api';
import ChunkTags from '../components/ChunkTags';
import PageFrame from '../components/PageFrame';
import type { RetrievalHit } from '../domain';
import { useAppState } from '../state/AppState';

interface AppField {
  key: string;
  label: string;
  type: 'text' | 'textarea';
  required: boolean;
  placeholder: string;
}

interface ScenarioApp {
  id: string;
  name: string;
  summary: string;
  category: string;
  fields: AppField[];
}

interface StreamEvent {
  type: 'route' | 'citations' | 'token' | 'done' | 'error';
  text?: string;
  items?: RetrievalHit[];
  message?: string;
}

const appIcons: Record<string, typeof FileTextOutlined> = {
  article: FileTextOutlined,
  'weekly-report': CalendarOutlined,
};

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

export default function AppsPage() {
  const { appId } = useParams();
  return appId ? <AppRunner appId={appId} /> : <AppStore />;
}

function AppStore() {
  const [apps, setApps] = useState<ScenarioApp[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void api<ScenarioApp[]>('/apps')
      .then(setApps)
      .catch(() => setFailed(true));
  }, []);

  return (
    <PageFrame
      title="应用"
      description="把知识库用到不同场景。写文章、写周报都从这里进入，以后还可以继续增加。"
    >
      {failed ? <Alert showIcon type="error" title="暂时没有读到应用列表" className="page-alert" /> : null}
      {apps.length ? (
        <div className="knowledge-grid">
          {apps.map((app) => {
            const Icon = appIcons[app.id] ?? AppstoreOutlined;
            return (
              <Card key={app.id} className="knowledge-card">
                <div className="knowledge-card-topline">
                  <span className="knowledge-icon"><Icon /></span>
                  <Tag color="purple">{app.category}</Tag>
                </div>
                <Typography.Title level={4}>{app.name}</Typography.Title>
                <Typography.Paragraph type="secondary" className="knowledge-description">
                  {app.summary}
                </Typography.Paragraph>
                <Link to={`/apps/${app.id}`}>
                  <Button type="primary">打开应用</Button>
                </Link>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="empty-card">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正在读取应用" />
        </Card>
      )}
    </PageFrame>
  );
}

function AppRunner({ appId }: { appId: string }) {
  const { data } = useAppState();
  const { message: messageApi } = App.useApp();
  const navigate = useNavigate();
  const [app, setApp] = useState<ScenarioApp | null>(null);
  const [missing, setMissing] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  const [modelId, setModelId] = useState<string>();
  const [output, setOutput] = useState('');
  const [citations, setCitations] = useState<RetrievalHit[]>([]);
  const [running, setRunning] = useState(false);
  const llmModels = data.models.filter((model) => model.capability === 'llm');
  const readyKnowledgeBases = data.knowledgeBases.filter((knowledgeBase) =>
    knowledgeBase.documents.some((document) => document.status === 'ready'),
  );

  useEffect(() => {
    let active = true;
    void api<ScenarioApp>(`/apps/${appId}`)
      .then((result) => {
        if (active) {
          setApp(result);
        }
      })
      .catch(() => {
        if (active) {
          setMissing(true);
        }
      });
    return () => {
      active = false;
    };
  }, [appId]);

  const requiredReady = app?.fields.filter((field) => field.required).every((field) => fields[field.key]?.trim()) ?? false;
  const canRun = Boolean(requiredReady && knowledgeBaseIds.length && modelId && !running);

  const run = async () => {
    if (!app || !modelId || !canRun) {
      return;
    }
    setRunning(true);
    setOutput('');
    setCitations([]);
    try {
      const body = await apiStream(`/apps/${app.id}/run`, {
        knowledgeBaseIds,
        modelConfigId: modelId,
        fields,
      });
      await readEvents(body, (event) => {
        if (event.type === 'citations') {
          setCitations(event.items ?? []);
        }
        if (event.type === 'token' && event.text) {
          setOutput((current) => current + event.text);
        }
        if (event.type === 'error') {
          messageApi.error(event.message || '生成失败');
        }
      });
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : '生成失败');
    } finally {
      setRunning(false);
    }
  };

  if (missing) {
    return (
      <PageFrame title="应用" description="这个应用不存在。">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/apps')}>返回应用</Button>
      </PageFrame>
    );
  }

  if (!app) {
    return (
      <PageFrame title="应用" description="正在打开应用。">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正在读取应用" />
      </PageFrame>
    );
  }

  return (
    <PageFrame
      title={app.name}
      description={app.summary}
      actions={
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/apps')}>返回应用</Button>
      }
    >
      <div className="app-run-layout">
        <Card title="任务" className="content-card">
          <Space orientation="vertical" size={14} className="full-width">
            {app.fields.map((field) => (
              <div key={field.key}>
                <Typography.Text>
                  {field.label}
                  {field.required ? '' : '（可选）'}
                </Typography.Text>
                {field.type === 'textarea' ? (
                  <Input.TextArea
                    className="app-field"
                    value={fields[field.key] ?? ''}
                    placeholder={field.placeholder}
                    aria-label={field.label}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                ) : (
                  <Input
                    className="app-field"
                    value={fields[field.key] ?? ''}
                    placeholder={field.placeholder}
                    aria-label={field.label}
                    onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                )}
              </div>
            ))}
            <div>
              <Typography.Text>知识库</Typography.Text>
              <Select
                mode="multiple"
                className="app-field"
                value={knowledgeBaseIds}
                onChange={setKnowledgeBaseIds}
                prefix={<BookOutlined />}
                placeholder="选择知识库"
                aria-label="选择应用知识库"
                options={data.knowledgeBases.map((knowledgeBase) => ({
                  value: knowledgeBase.id,
                  label: knowledgeBase.name,
                  disabled: !readyKnowledgeBases.some((item) => item.id === knowledgeBase.id),
                }))}
              />
            </div>
            <div>
              <Typography.Text>对话模型</Typography.Text>
              <Select
                className="app-field"
                value={modelId}
                onChange={setModelId}
                prefix={<RobotOutlined />}
                placeholder="选择 LLM"
                aria-label="选择应用模型"
                options={llmModels.map((model) => ({ value: model.id, label: model.displayName }))}
              />
            </div>
            <Button type="primary" icon={<SendOutlined />} disabled={!canRun} loading={running} onClick={() => void run()}>
              开始生成
            </Button>
          </Space>
        </Card>
        <Card title="结果" className="content-card app-result-card">
          {output ? (
            <Typography.Paragraph className="app-output">{output}</Typography.Paragraph>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={running ? '正在根据资料生成' : '填写任务后开始生成'} />
          )}
          {citations.length ? (
            <div className="citation-list">
              {citations.map((citation, index) => (
                <article key={`${citation.documentName}-${citation.location}-${index}`} className="citation-item">
                  <Typography.Text strong>{citation.documentName}</Typography.Text>
                  <Typography.Text type="secondary">{citation.location}</Typography.Text>
                  <ChunkTags metadata={citation.metadata} />
                  <Typography.Paragraph className="hit-content">{citation.content}</Typography.Paragraph>
                </article>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </PageFrame>
  );
}
