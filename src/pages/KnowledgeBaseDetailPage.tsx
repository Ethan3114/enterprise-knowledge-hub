import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  InboxOutlined,
  SaveOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { TableColumnsType, TabsProps, UploadProps } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import PageFrame from '../components/PageFrame';
import {
  documentStatusLabels,
  knowledgeBaseStatusLabels,
  type DocumentMetadata,
  type DocumentStatus,
  type KnowledgeBaseSettings,
  type RetrievalHit,
} from '../domain';
import { useAppState } from '../state/AppState';

const { Dragger } = Upload;

const supportedExtensions = new Set([
  'pdf',
  'doc',
  'docx',
  'md',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'tiff',
  'csv',
  'xls',
  'xlsx',
]);

interface SettingsFormValues {
  name: string;
  description: string;
  settings: KnowledgeBaseSettings;
}

interface KnowledgeChunkRow {
  id: string;
  documentId: string;
  documentName: string;
  location: string;
  content: string;
  tokenCount: number;
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function DocumentsPanel({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { data, uploadDocuments, removeDocument, buildKnowledgeBase, refresh } = useAppState();
  const { message: messageApi } = App.useApp();
  const knowledgeBase = data.knowledgeBases.find((item) => item.id === knowledgeBaseId)!;
  const pendingFiles = useRef<File[]>([]);
  const flushTimer = useRef<number>(0);
  const isBuilding = knowledgeBase.documents.some((document) => document.status === 'building')
    || knowledgeBase.status === 'building';
  const rebuild = knowledgeBase.documents.length > 0
    && knowledgeBase.documents.every((document) => document.status === 'ready');

  useEffect(() => {
    if (!isBuilding) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [isBuilding, refresh]);

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    const extension = file.name.split('.').pop()?.toLocaleLowerCase('en-US') ?? '';
    if (!supportedExtensions.has(extension)) {
      messageApi.error(`不支持 .${extension || '未知'} 文件，请选择页面列出的格式`);
      return Upload.LIST_IGNORE;
    }
    pendingFiles.current.push(file);
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      const files = pendingFiles.current.splice(0);
      void uploadDocuments(knowledgeBaseId, files)
        .then(() => messageApi.success(files.length > 1 ? `已上传 ${files.length} 个文件` : `已上传“${files[0]?.name ?? '文件'}”`))
        .catch((error: unknown) => {
          messageApi.error(error instanceof ApiError ? error.message : '上传失败');
          void refresh();
        });
    }, 0);
    return Upload.LIST_IGNORE;
  };

  const columns: TableColumnsType<DocumentMetadata> = [
    {
      title: '文件',
      dataIndex: 'name',
      minWidth: 220,
      render: (name: string, record) => (
        <Space>
          <span className="file-icon"><FileTextOutlined /></span>
          <div>
            <Typography.Text strong>{name}</Typography.Text>
            <br />
            <Typography.Text type="secondary" className="small-text">
              {record.mimeType || '未提供 MIME 类型'}
            </Typography.Text>
          </div>
        </Space>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 110,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 150,
      render: (status: DocumentStatus, record) => (
        <Tooltip title={record.error || undefined}>
          <Tag color={status === 'ready' ? 'green' : status === 'failed' ? 'red' : status === 'building' ? 'blue' : 'gold'}>
            {documentStatusLabels[status]}
          </Tag>
        </Tooltip>
      ),
    },
    {
      title: '知识片段',
      width: 120,
      render: (_, record) => record.chunkCount || '—',
    },
    {
      title: '操作',
      width: 80,
      fixed: 'right',
      render: (_, record) => (
        <Popconfirm
          title={`移除“${record.name}”`}
          description="此操作会删除本机保存的文件和已构建片段。"
          okText="确认移除"
          cancelText="取消"
          onConfirm={() => {
            void removeDocument(knowledgeBaseId, record.id).catch((error: unknown) => {
              messageApi.error(error instanceof ApiError ? error.message : '移除失败');
            });
          }}
        >
          <Button danger type="text" icon={<DeleteOutlined />} aria-label={`移除${record.name}`} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <Card className="workflow-card">
        <Steps
          current={0}
          items={[
            { title: '选择文件', content: '读取文件元数据' },
            { title: '云端解析', content: 'OCR 与表格识别' },
            { title: '分块与索引', content: '生成知识片段' },
            { title: '数据预览', content: '检查处理结果' },
          ]}
          responsive
        />
      </Card>
      <Dragger
        multiple
        accept=".pdf,.doc,.docx,.md,.png,.jpg,.jpeg,.webp,.tiff,.csv,.xls,.xlsx"
        beforeUpload={beforeUpload}
        showUploadList={false}
        className="knowledge-uploader"
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">选择文件或将文件拖到此处</p>
        <p className="ant-upload-hint">
          支持 PDF、Word（docx）、Markdown、PNG/JPG/WEBP/TIFF、CSV 和 Excel（xlsx）。一次最多 32 个。
        </p>
      </Dragger>
      <Alert
        showIcon
        type="info"
        title="文件会保存到本机，管理员手动构建后才能检索"
        description="旧版 .doc 和 .xls 请先另存为 .docx、.xlsx 或 .csv。超过大小或页数限制的文件不会开始构建。"
      />
      <Button
        type="primary"
        icon={<SaveOutlined />}
        aria-label={rebuild ? '重新构建' : '开始构建'}
        disabled={!knowledgeBase.documents.length || isBuilding}
        loading={isBuilding}
        onClick={() => {
          void buildKnowledgeBase(knowledgeBaseId, rebuild)
            .then(() => messageApi.success(rebuild ? '已开始重新构建' : '已开始构建'))
            .catch((error: unknown) => {
              messageApi.error(error instanceof ApiError ? error.message : '构建失败');
            });
        }}
      >
        {isBuilding ? '正在构建' : rebuild ? '重新构建' : '开始构建'}
      </Button>
      <Card className="content-card" title={`文件列表（${knowledgeBase.documents.length}）`}>
        <Table<DocumentMetadata>
          rowKey="id"
          columns={columns}
          dataSource={knowledgeBase.documents}
          pagination={false}
          scroll={{ x: 760 }}
          locale={{ emptyText: <Empty description="尚未选择文件" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </Card>
    </Space>
  );
}

function ChunksPanel({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const [rows, setRows] = useState<KnowledgeChunkRow[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let active = true;
    void api<{ total: number; items: KnowledgeChunkRow[] }>(`/knowledge-bases/${knowledgeBaseId}/chunks`)
      .then((result) => {
        if (!active) {
          return;
        }
        setRows(result.items);
        setTotal(result.total);
      })
      .catch(() => {
        if (active) {
          setRows([]);
          setTotal(0);
        }
      });
    return () => {
      active = false;
    };
  }, [knowledgeBaseId]);

  const columns: TableColumnsType<KnowledgeChunkRow> = [
    { title: '来源文件', dataIndex: 'documentName', width: 180 },
    { title: '页码或位置', dataIndex: 'location', width: 140 },
    { title: '正文', dataIndex: 'content', minWidth: 360 },
    { title: 'Token', dataIndex: 'tokenCount', width: 90 },
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <Alert
        showIcon
        type="info"
        title="知识片段保留来源文件和位置"
        description="这里展示已经构建完成的正文。修改分块设置后，需要重新构建才会更新。"
      />
      <Card title={`知识片段（${total}）`} className="content-card">
        <Table<KnowledgeChunkRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 860 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="文档完成构建后显示知识片段"
              />
            ),
          }}
        />
      </Card>
    </Space>
  );
}

function RetrievalPanel({
  knowledgeBaseId,
  settings,
  canSearch,
}: {
  knowledgeBaseId: string;
  settings: KnowledgeBaseSettings;
  canSearch: boolean;
}) {
  const { message: messageApi } = App.useApp();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RetrievalHit[]>([]);
  const [searching, setSearching] = useState(false);

  const runSearch = async () => {
    setSearching(true);
    try {
      const result = await api<{ items: RetrievalHit[] }>(`/knowledge-bases/${knowledgeBaseId}/retrieve`, {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      setHits(result.items);
      if (!result.items.length) {
        messageApi.info('没有找到足够相关的内容');
      }
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : '检索失败');
    } finally {
      setSearching(false);
    }
  };

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={9}>
        <Card title="检索设置" className="content-card">
          <Form layout="vertical">
            <Form.Item label="测试问题">
              <Input.TextArea
                rows={5}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="输入需要查找依据的问题"
                aria-label="测试问题"
              />
            </Form.Item>
            <Form.Item label="检索方式">
              <Select
                disabled
                value={settings.retrievalMode}
                options={[
                  { value: 'hybrid', label: '混合检索' },
                  { value: 'semantic', label: '语义检索' },
                  { value: 'keyword', label: '关键词检索' },
                ]}
              />
            </Form.Item>
            <Form.Item label="候选数量">
              <InputNumber disabled value={settings.retrievalCount} className="full-width" />
            </Form.Item>
            <Form.Item label="最低相关度">
              <InputNumber disabled value={settings.scoreThreshold} className="full-width" />
            </Form.Item>
            <Form.Item label="引用 Token 上限">
              <InputNumber disabled value={settings.maxContextTokens} className="full-width" />
            </Form.Item>
            <Button
              type="primary"
              block
              icon={<FileSearchOutlined />}
              disabled={!canSearch || !query.trim()}
              loading={searching}
              onClick={() => void runSearch()}
            >
              开始测试
            </Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={15}>
        <Card title="检索结果" className="content-card retrieval-results-card">
          {hits.length ? (
            <Space orientation="vertical" size={12} className="full-width">
              {hits.map((hit, index) => (
                <div key={`${hit.documentName}-${hit.location}-${index}`} className="hit-card">
                  <Space>
                    <Typography.Text strong>{hit.documentName}</Typography.Text>
                    <Tag>{hit.location}</Tag>
                    {hit.semanticScore !== null ? <Tag>语义 {hit.semanticScore}</Tag> : null}
                    {hit.rerankScore !== null ? <Tag color="purple">重排 {hit.rerankScore}</Tag> : null}
                  </Space>
                  <Typography.Paragraph className="hit-content">{hit.content}</Typography.Paragraph>
                </div>
              ))}
            </Space>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Space orientation="vertical" size={4}>
                  <Typography.Text strong>{canSearch ? '输入问题后开始测试' : '构建完成后可测试检索'}</Typography.Text>
                  <Typography.Text type="secondary">结果包含来源文件、位置、语义得分和重排得分。</Typography.Text>
                </Space>
              }
            />
          )}
        </Card>
      </Col>
    </Row>
  );
}

function SettingsPanel({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { data, updateKnowledgeBase } = useAppState();
  const { message: messageApi } = App.useApp();
  const [form] = Form.useForm<SettingsFormValues>();
  const knowledgeBase = data.knowledgeBases.find((item) => item.id === knowledgeBaseId)!;
  const embeddingModels = data.models.filter((model) => model.capability === 'embedding');
  const rerankModels = data.models.filter((model) => model.capability === 'rerank');
  const rerankEnabled = Form.useWatch(['settings', 'rerankEnabled'], form);
  const chunkMethod = Form.useWatch(['settings', 'chunkMethod'], form);

  useEffect(() => {
    form.setFieldsValue({
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      settings: knowledgeBase.settings,
    });
  }, [form, knowledgeBase]);

  const saveSettings = async (values: SettingsFormValues) => {
    if (values.settings.chunkOverlap >= values.settings.chunkSize) {
      messageApi.error('分块重叠长度必须小于分块大小');
      return;
    }
    try {
      await updateKnowledgeBase(knowledgeBaseId, {
        ...values,
        name: values.name.trim(),
        description: values.description.trim(),
      });
      messageApi.success('知识库配置已保存');
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : '保存失败');
    }
  };

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={16}>
        <Card title="知识库配置" className="content-card">
          <Form<SettingsFormValues>
            form={form}
            layout="vertical"
            onFinish={saveSettings}
            requiredMark="optional"
          >
            <Form.Item
              name="name"
              label="知识库名称"
              rules={[{ required: true, whitespace: true, message: '请填写知识库名称' }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="description" label="知识库说明">
              <Input.TextArea rows={3} maxLength={200} showCount />
            </Form.Item>
            <Typography.Title level={5}>文档解析</Typography.Title>
            <div className="form-switch-grid">
              <Form.Item name={['settings', 'ocrEnabled']} label="扫描页 OCR" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="关闭" />
              </Form.Item>
              <Form.Item name={['settings', 'tableRecognition']} label="表格结构识别" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="关闭" />
              </Form.Item>
              <Form.Item name={['settings', 'imageTextRecognition']} label="图片文字识别" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="关闭" />
              </Form.Item>
            </div>
            <Typography.Title level={5}>分块与检索</Typography.Title>
            {knowledgeBase.embeddingLocked ? (
              <Alert
                showIcon
                type="warning"
                title="Embedding 模型已锁定"
                description="已有构建结果。要更换向量模型，请先移除全部文件。"
                className="form-alert"
              />
            ) : (
              <Alert
                showIcon
                type="info"
                title="修改分块后需要重新构建"
                className="form-alert"
              />
            )}
            {!embeddingModels.length ? (
              <Alert
                showIcon
                type="warning"
                title="管理员配置 Embedding 模型后才能构建索引"
                className="form-alert"
              />
            ) : null}
            <Form.Item name={['settings', 'embeddingModelId']} label="Embedding 模型">
              <Select
                allowClear
                placeholder={embeddingModels.length ? '选择生成向量的模型' : '等待管理员配置'}
                disabled={!embeddingModels.length || knowledgeBase.embeddingLocked}
                options={embeddingModels.map((model) => ({
                  value: model.id,
                  label: model.displayName,
                }))}
              />
            </Form.Item>
            <Form.Item
              name={['settings', 'chunkMethod']}
              label="切分方式"
              extra={
                chunkMethod === 'fixed'
                  ? '按设定的 Token 数连续切开，不照顾句子边界。'
                  : chunkMethod === 'parent_child'
                    ? '用较小的子块检索，回答时附上对应的父块。'
                    : chunkMethod === 'semantic'
                      ? '按相邻句子的语义接近程度分组，不使用重叠长度。'
                      : '按段落、句号等边界拼到目标长度。'
              }
              rules={[{ required: true, message: '请选择切分方式' }]}
            >
              <Select
                options={[
                  { value: 'fixed', label: '固定长度' },
                  { value: 'parent_child', label: '父子切分' },
                  { value: 'semantic', label: '语义切分' },
                  { value: 'recursive', label: '递归切分' },
                ]}
              />
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} md={chunkMethod === 'parent_child' ? 8 : 12}>
                <Form.Item
                  name={['settings', 'chunkSize']}
                  label={chunkMethod === 'parent_child' ? '父块大小（Token）' : '分块大小（Token）'}
                  rules={[{ required: true, message: '请填写分块大小' }]}
                >
                  <InputNumber min={100} max={4000} step={50} className="full-width" />
                </Form.Item>
              </Col>
              {chunkMethod === 'parent_child' ? (
                <Col xs={24} md={8}>
                  <Form.Item
                    name={['settings', 'childChunkSize']}
                    label="子块大小（Token）"
                    dependencies={[['settings', 'chunkSize']]}
                    rules={[
                      { required: true, message: '请填写子块大小' },
                      ({ getFieldValue }) => ({
                        validator: (_, value: number | undefined) => {
                          const chunkSize = getFieldValue(['settings', 'chunkSize']) as number | undefined;
                          return value !== undefined && chunkSize !== undefined && value >= chunkSize
                            ? Promise.reject(new Error('子块大小必须小于父块大小'))
                            : Promise.resolve();
                        },
                      }),
                    ]}
                  >
                    <InputNumber min={50} max={2000} step={10} className="full-width" />
                  </Form.Item>
                </Col>
              ) : null}
              <Col xs={24} md={chunkMethod === 'parent_child' ? 8 : 12}>
                <Form.Item
                  name={['settings', 'chunkOverlap']}
                  label="重叠长度（Token）"
                  dependencies={[['settings', 'chunkSize']]}
                  rules={[
                    { required: true, message: '请填写重叠长度' },
                    ({ getFieldValue }) => ({
                      validator: (_, value: number | undefined) => {
                        const chunkSize = getFieldValue(['settings', 'chunkSize']) as number | undefined;
                        return value !== undefined && chunkSize !== undefined && value >= chunkSize
                          ? Promise.reject(new Error('重叠长度必须小于分块大小'))
                          : Promise.resolve();
                      },
                    }),
                  ]}
                >
                  <InputNumber min={0} max={1000} step={10} className="full-width" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name={['settings', 'retrievalMode']}
              label="默认检索方式"
              rules={[{ required: true, message: '请选择默认检索方式' }]}
            >
              <Select
                options={[
                  { value: 'hybrid', label: '混合检索' },
                  { value: 'semantic', label: '语义检索' },
                  { value: 'keyword', label: '关键词检索' },
                ]}
              />
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item
                  name={['settings', 'retrievalCount']}
                  label="候选片段数量"
                  rules={[{ required: true, message: '请填写候选片段数量' }]}
                >
                  <InputNumber min={1} max={100} className="full-width" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name={['settings', 'scoreThreshold']}
                  label="最低相关度"
                  rules={[{ required: true, message: '请填写最低相关度' }]}
                >
                  <InputNumber min={0} max={1} step={0.05} className="full-width" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name={['settings', 'maxContextTokens']}
                  label="引用 Token 上限"
                  rules={[{ required: true, message: '请填写引用 Token 上限' }]}
                >
                  <InputNumber min={256} max={100000} step={256} className="full-width" />
                </Form.Item>
              </Col>
            </Row>
            <div className="form-switch-grid">
              <Form.Item name={['settings', 'queryOptimization']} label="问题优化" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="关闭" />
              </Form.Item>
              <Form.Item name={['settings', 'rerankEnabled']} label="结果重排" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="关闭" />
              </Form.Item>
            </div>
            <Form.Item name={['settings', 'rerankModelId']} label="Rerank 模型">
              <Select
                allowClear
                placeholder={rerankModels.length ? '选择结果重排模型' : '等待管理员配置'}
                disabled={!rerankEnabled || !rerankModels.length}
                options={rerankModels.map((model) => ({
                  value: model.id,
                  label: model.displayName,
                }))}
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              aria-label="保存配置"
            >
              保存配置
            </Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={8}>
        <Card title="配置说明" className="content-card">
          <Space orientation="vertical" size={16}>
            <div>
              <Typography.Text strong>切分方式</Typography.Text>
              <Typography.Paragraph type="secondary">
                固定长度按窗口切开，递归照顾句子边界，父子用小块检索、大块回答，语义按句子相似度分组。
              </Typography.Paragraph>
            </div>
            <div>
              <Typography.Text strong>混合检索</Typography.Text>
              <Typography.Paragraph type="secondary">
                同时使用语义和关键词召回。
              </Typography.Paragraph>
            </div>
            <div>
              <Typography.Text strong>结果重排</Typography.Text>
              <Typography.Paragraph type="secondary">
                重新计算候选片段与问题的相关程度。
              </Typography.Paragraph>
            </div>
          </Space>
        </Card>
      </Col>
    </Row>
  );
}

export default function KnowledgeBaseDetailPage() {
  const { knowledgeBaseId } = useParams();
  const { data } = useAppState();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const knowledgeBase = data.knowledgeBases.find((item) => item.id === knowledgeBaseId);

  if (!knowledgeBaseId || !knowledgeBase) {
    return (
      <div className="state-page">
        <Empty
          description={
            <Space orientation="vertical" size={4}>
              <Typography.Text strong>知识库不存在</Typography.Text>
              <Typography.Text type="secondary">该记录可能已被移除。</Typography.Text>
            </Space>
          }
        >
          <Button type="primary" onClick={() => navigate('/knowledge-bases')}>返回知识库</Button>
        </Empty>
      </div>
    );
  }

  const tabKey = searchParams.get('tab') ?? 'documents';
  const tabItems: TabsProps['items'] = [
    {
      key: 'documents',
      label: <Space><CloudUploadOutlined aria-hidden="true" />文件</Space>,
      children: <DocumentsPanel knowledgeBaseId={knowledgeBaseId} />,
    },
    {
      key: 'chunks',
      label: <Space><FileTextOutlined aria-hidden="true" />知识片段</Space>,
      children: <ChunksPanel knowledgeBaseId={knowledgeBaseId} />,
    },
    {
      key: 'retrieval',
      label: <Space><FileSearchOutlined aria-hidden="true" />检索测试</Space>,
      children: (
        <RetrievalPanel
          knowledgeBaseId={knowledgeBaseId}
          settings={knowledgeBase.settings}
          canSearch={knowledgeBase.documents.some((document) => document.status === 'ready')}
        />
      ),
    },
    {
      key: 'settings',
      label: <Space><SettingOutlined aria-hidden="true" />知识库设置</Space>,
      children: <SettingsPanel knowledgeBaseId={knowledgeBaseId} />,
    },
  ];

  return (
    <PageFrame
      title={knowledgeBase.name}
      description={knowledgeBase.description || '管理文件、知识片段和检索配置。'}
      actions={
        <Link to="/knowledge-bases">
          <Button icon={<ArrowLeftOutlined />}>返回列表</Button>
        </Link>
      }
    >
      <div className="detail-status-row">
        <Tag color={knowledgeBase.status === 'ready' ? 'green' : knowledgeBase.status === 'failed' ? 'red' : 'gold'}>
          {knowledgeBaseStatusLabels[knowledgeBase.status]}
        </Tag>
        <Typography.Text type="secondary">
          {knowledgeBase.documents.length} 个文件 · {knowledgeBase.documents.reduce((total, document) => total + document.chunkCount, 0)} 个知识片段
        </Typography.Text>
      </div>
      <Card className="tab-card">
        <Tabs
          activeKey={tabItems.some((item) => item.key === tabKey) ? tabKey : 'documents'}
          onChange={(key) => setSearchParams(key === 'documents' ? {} : { tab: key })}
          items={tabItems}
        />
      </Card>
    </PageFrame>
  );
}
