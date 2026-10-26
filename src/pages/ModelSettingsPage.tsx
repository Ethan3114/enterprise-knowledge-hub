import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiOutlined,
  CloudOutlined,
  DeleteOutlined,
  EyeOutlined,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import PageFrame from '../components/PageFrame';
import {
  modelCapabilityLabels,
  providerDefaultUrls,
  providerLabels,
  type ModelCapability,
  type ModelConfig,
  type Provider,
  type ProviderKind,
} from '../domain';
import { useAppState } from '../state/AppState';

interface ProviderFormValues {
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  apiKey: string;
}

interface RemoteModel {
  id: string;
  name: string;
}

interface ModelFormValues {
  providerId: string;
  modelId: string;
  capability: ModelCapability;
  supportsVision: boolean;
}

function matchesCapability(modelId: string, capability: ModelCapability) {
  const value = modelId.toLocaleLowerCase('en-US');
  const isEmbedding = value.includes('embed');
  const isRerank = value.includes('rerank');
  if (capability === 'embedding') {
    return isEmbedding;
  }
  if (capability === 'rerank') {
    return isRerank;
  }
  return !isEmbedding && !isRerank;
}

function connectionTag(provider: Provider) {
  if (provider.connectionStatus === 'connected') {
    return <Tag color="success">已连通</Tag>;
  }
  if (provider.connectionStatus === 'failed') {
    return (
      <Tooltip title={provider.connectionMessage || '连接失败'}>
        <Tag color="error">连接失败</Tag>
      </Tooltip>
    );
  }
  return <Tag color="processing">正在检查</Tag>;
}

function ProvidersPanel() {
  const { data, createProvider, deleteProvider, testProvider } = useAppState();
  const { message: messageApi } = App.useApp();
  const [form] = Form.useForm<ProviderFormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const checkedProviders = useRef(new Set<string>());

  useEffect(() => {
    const pending = data.providers.filter(
      (provider) =>
        provider.hasApiKey &&
        provider.connectionStatus === 'unknown' &&
        !checkedProviders.current.has(provider.id),
    );
    pending.forEach((provider) => checkedProviders.current.add(provider.id));
    pending.forEach((provider) => {
      void testProvider(provider.id).catch(() => undefined);
    });
  }, [data.providers, testProvider]);

  const providerColumns: TableColumnsType<Provider> = [
    {
      title: '服务商',
      dataIndex: 'name',
      minWidth: 180,
      render: (name: string, record) => (
        <Space>
          <span className="provider-icon"><ApiOutlined /></span>
          <div>
            <Typography.Text strong>{name}</Typography.Text>
            <br />
            <Typography.Text type="secondary" className="small-text">
              {providerLabels[record.kind]}
            </Typography.Text>
          </div>
        </Space>
      ),
    },
    {
      title: 'Base URL',
      dataIndex: 'baseUrl',
      minWidth: 280,
      ellipsis: true,
    },
    {
      title: '连接状态',
      width: 150,
      render: (_, record) => connectionTag(record),
    },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            onClick={async () => {
              try {
                messageApi.success(await testProvider(record.id));
              } catch (error) {
                messageApi.error(error instanceof ApiError ? error.message : '连接测试失败');
              }
            }}
          >
            测试
          </Button>
          <Popconfirm
            title={`删除“${record.name}”`}
            description="关联的模型配置也会从当前浏览器中移除。"
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              try {
                await deleteProvider(record.id);
              } catch (error) {
                messageApi.error(error instanceof ApiError ? error.message : '删除失败');
              }
            }}
          >
            <Button danger size="small" type="text" icon={<DeleteOutlined />} aria-label={`删除${record.name}`} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const submitProvider = async (values: ProviderFormValues) => {
    try {
      await createProvider({
        ...values,
        name: values.name.trim(),
        baseUrl: values.baseUrl.trim().replace(/\/+$/, ''),
        apiKey: values.apiKey.trim(),
      });
      setModalOpen(false);
      messageApi.success('服务商已保存到本机服务，密钥不会留在浏览器');
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : '保存失败');
    }
  };

  const openModal = () => {
    form.resetFields();
    form.setFieldsValue({
      kind: 'tongyi',
      name: providerLabels.tongyi,
      baseUrl: providerDefaultUrls.tongyi,
    });
    setModalOpen(true);
  };

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <Alert
        showIcon
        type="warning"
        title="密钥只保存在本机服务中"
        description="浏览器不会记住密钥。请只在这台用于验证的电脑上填写。"
      />
      <div className="section-actions">
        <div>
          <Typography.Title level={4}>模型服务商</Typography.Title>
          <Typography.Text type="secondary">管理请求地址和服务商类型。</Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          aria-label="新增服务商"
          onClick={openModal}
        >
          新增服务商
        </Button>
      </div>
      <Table<Provider>
        rowKey="id"
        columns={providerColumns}
        dataSource={data.providers}
        pagination={false}
        scroll={{ x: 820 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置模型服务商" /> }}
      />

      <Modal
        title="新增模型服务商"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText="保存配置"
        cancelText="取消"
        destroyOnHidden
        forceRender
      >
        <Form<ProviderFormValues> form={form} layout="vertical" onFinish={submitProvider}>
          <Form.Item name="kind" label="服务商类型" rules={[{ required: true }]}> 
            <Select
              options={Object.entries(providerLabels).map(([value, label]) => ({ value, label }))}
              onChange={(value: ProviderKind) => {
                form.setFieldsValue({
                  name: providerLabels[value],
                  baseUrl: providerDefaultUrls[value],
                });
              }}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="显示名称"
            rules={[
              { required: true, whitespace: true, message: '请填写显示名称' },
              {
                validator: (_, value: string | undefined) =>
                  data.providers.some((provider) => provider.name === value?.trim())
                    ? Promise.reject(new Error('已存在同名服务商'))
                    : Promise.resolve(),
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[
              { required: true, message: '请填写 Base URL' },
              { type: 'url', message: '请填写有效的 URL' },
              {
                validator: (_, value: string | undefined) => {
                  const normalized = value?.trim().replace(/\/+$/, '');
                  return data.providers.some((provider) => provider.baseUrl === normalized)
                    ? Promise.reject(new Error('该服务地址已经存在'))
                    : Promise.resolve();
                },
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="API 密钥"
            rules={[{ required: true, whitespace: true, message: '请填写 API 密钥' }]}
          >
            <Input.Password
              aria-label="API 密钥"
              prefix={<SafetyCertificateOutlined />}
              placeholder="只发送到本机服务"
              autoComplete="off"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function ModelsPanel() {
  const { data, createModel, deleteModel, testModel } = useAppState();
  const { message: messageApi } = App.useApp();
  const [form] = Form.useForm<ModelFormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const selectedProviderId = Form.useWatch('providerId', form);
  const selectedCapability = Form.useWatch('capability', form);
  const selectedProvider = data.providers.find((provider) => provider.id === selectedProviderId);

  useEffect(() => {
    if (!modalOpen || !selectedProviderId) {
      return;
    }
    let active = true;
    setModelsLoading(true);
    setModelsError('');
    setRemoteModels([]);
    form.setFieldValue('modelId', undefined);
    void api<{ models: RemoteModel[]; error: string | null }>(`/providers/${selectedProviderId}/models`)
      .then((result) => {
        if (!active) {
          return;
        }
        setRemoteModels(result.models);
        setModelsError(result.error ?? '');
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setModelsError(error instanceof ApiError ? error.message : '无法读取模型列表');
      })
      .finally(() => {
        if (active) {
          setModelsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [form, modalOpen, selectedProviderId]);

  const capabilityOptions = useMemo(
    () =>
      (selectedProvider?.kind === 'deepseek'
        ? (['llm'] as ModelCapability[])
        : (['llm', 'embedding', 'rerank'] as ModelCapability[])
      ).map((value) => ({ value, label: modelCapabilityLabels[value] })),
    [selectedProvider?.kind],
  );

  const columns: TableColumnsType<ModelConfig> = [
    {
      title: '模型',
      dataIndex: 'displayName',
      minWidth: 180,
      render: (name: string, record) => (
        <Space>
          <span className="provider-icon"><RobotOutlined /></span>
          <div>
            <Typography.Text strong>{name}</Typography.Text>
            <br />
            <Typography.Text type="secondary" className="small-text">{record.modelId}</Typography.Text>
          </div>
        </Space>
      ),
    },
    {
      title: '能力类型',
      dataIndex: 'capability',
      width: 130,
      render: (capability: ModelCapability) => <Tag color="blue">{modelCapabilityLabels[capability]}</Tag>,
    },
    {
      title: '服务商',
      dataIndex: 'providerId',
      minWidth: 150,
      render: (providerId: string) => data.providers.find((provider) => provider.id === providerId)?.name ?? '已移除',
    },
    {
      title: '视觉能力',
      dataIndex: 'supportsVision',
      width: 110,
      render: (supportsVision: boolean) => supportsVision ? <Tag icon={<EyeOutlined />} color="purple">支持</Tag> : '—',
    },
    {
      title: '连接',
      width: 90,
      render: (_, record) => (
        <Button
          size="small"
          onClick={async () => {
            try {
              messageApi.success(await testModel(record.id));
            } catch (error) {
              messageApi.error(error instanceof ApiError ? error.message : '模型测试失败');
            }
          }}
        >
          测试
        </Button>
      ),
    },
    {
      title: '操作',
      width: 90,
      fixed: 'right',
      render: (_, record) => (
        <Popconfirm
          title={`删除“${record.displayName}”`}
          okText="确认删除"
          cancelText="取消"
          onConfirm={async () => {
            try {
              await deleteModel(record.id);
            } catch (error) {
              messageApi.error(error instanceof ApiError ? error.message : '删除失败');
            }
          }}
        >
          <Button danger type="text" icon={<DeleteOutlined />} aria-label={`删除${record.displayName}`} />
        </Popconfirm>
      ),
    },
  ];

  const modelOptions = useMemo(() => {
    const matched = remoteModels.filter((model) => matchesCapability(model.id, selectedCapability ?? 'llm'));
    const source = matched.length ? matched : remoteModels;
    return {
      showingAll: remoteModels.length > 0 && matched.length === 0,
      options: source.map((model) => ({
        value: model.id,
        label: model.name,
      })),
    };
  }, [remoteModels, selectedCapability]);

  const submitModel = async (values: ModelFormValues) => {
    const selected = remoteModels.find((model) => model.id === values.modelId);
    try {
      await createModel({
        providerId: values.providerId,
        displayName: selected?.name || values.modelId,
        modelId: values.modelId,
        capability: values.capability,
        supportsVision: values.capability === 'llm' && values.supportsVision,
      });
      setModalOpen(false);
      messageApi.success('模型配置已保存');
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : '保存失败');
    }
  };

  const openModal = () => {
    form.resetFields();
    form.setFieldsValue({ supportsVision: false, capability: 'llm' });
    setModalOpen(true);
  };

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <Alert
        showIcon
        type="info"
        title="LLM、Embedding 和 Rerank 可以分别选择服务商"
        description="DeepSeek 当前按 LLM 类型配置；AIHubMix 和通义百炼可配置多种模型能力。"
      />
      <div className="section-actions">
        <div>
          <Typography.Title level={4}>模型配置</Typography.Title>
          <Typography.Text type="secondary">从服务商的模型列表中选择。</Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          aria-label="新增模型"
          disabled={!data.providers.length}
          onClick={openModal}
        >
          新增模型
        </Button>
      </div>
      {!data.providers.length ? (
        <Alert type="warning" showIcon title="请先在“模型服务商”中新增服务商" />
      ) : null}
      <Table<ModelConfig>
        rowKey="id"
        columns={columns}
        dataSource={data.models}
        pagination={false}
        scroll={{ x: 900 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置模型" /> }}
      />

      <Modal
        title="新增模型"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText="保存配置"
        cancelText="取消"
        destroyOnHidden
        forceRender
      >
        <Form<ModelFormValues> form={form} layout="vertical" onFinish={submitModel}>
          <Form.Item name="providerId" label="模型服务商" rules={[{ required: true, message: '请选择模型服务商' }]}>
            <Select
              options={data.providers.map((provider) => ({ value: provider.id, label: provider.name }))}
              onChange={() => {
                form.setFieldValue('capability', 'llm');
                form.setFieldValue('modelId', undefined);
              }}
            />
          </Form.Item>
          <Form.Item name="capability" label="能力类型" rules={[{ required: true }]}>
            <Select
              options={capabilityOptions}
              onChange={(capability: ModelCapability) => {
                if (capability !== 'llm') {
                  form.setFieldValue('supportsVision', false);
                }
                form.setFieldValue('modelId', undefined);
              }}
            />
          </Form.Item>
          {modelsError ? <Alert showIcon type="error" title={modelsError} className="form-alert" /> : null}
          {!modelsError && modelOptions.showingAll ? (
            <Alert showIcon type="info" title="列表里没有按当前能力分出的模型，现在显示全部名称" className="form-alert" />
          ) : null}
          <Form.Item
            name="modelId"
            label="模型"
            rules={[
              { required: true, message: '请选择模型' },
              {
                validator: (_, value: string | undefined) => {
                  const duplicated = data.models.some(
                    (model) => model.providerId === form.getFieldValue('providerId') && model.modelId === value,
                  );
                  return duplicated
                    ? Promise.reject(new Error('该服务商下已经存在相同模型'))
                    : Promise.resolve();
                },
              },
            ]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              loading={modelsLoading}
              placeholder={modelsLoading ? '正在读取模型列表' : '选择模型'}
              options={modelOptions.options}
              notFoundContent={modelsLoading ? '正在读取模型列表' : '没有可选模型'}
              aria-label="模型"
            />
          </Form.Item>
          {selectedCapability === 'llm' ? (
            <Form.Item name="supportsVision" label="支持图片输入" valuePropName="checked">
              <Switch checkedChildren="支持" unCheckedChildren="不支持" />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </Space>
  );
}

function VisionPanel() {
  const { data, saveVision } = useAppState();
  const { message: messageApi } = App.useApp();
  const [form] = Form.useForm<{ modelConfigId: string | null }>();
  const visionModels = data.models.filter((model) => model.capability === 'llm' && model.supportsVision);
  const selected = data.models.find((model) => model.id === data.vision.modelConfigId);

  useEffect(() => {
    form.setFieldsValue({ modelConfigId: data.vision.modelConfigId });
  }, [data.vision.modelConfigId, form]);

  const submitVision = async (values: { modelConfigId: string | null }) => {
    try {
      await saveVision(values.modelConfigId);
      messageApi.success(values.modelConfigId ? '已选择识别模型' : '已清除识别模型');
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : '保存失败');
    }
  };

  return (
    <div className="ocr-layout">
      <Card title={<Space><CloudOutlined />视觉识别</Space>} className="content-card">
        <Alert
          showIcon
          type="info"
          title="扫描页和图片会交给云端视觉模型"
          description="请先在模型配置里打开“支持图片输入”。文字型 PDF、Word 和表格仍在本机提取。"
          className="form-alert"
        />
        {!visionModels.length ? (
          <Alert showIcon type="warning" title="还没有支持图片输入的对话模型" className="form-alert" />
        ) : null}
        <Form form={form} layout="vertical" onFinish={submitVision}>
          <Form.Item name="modelConfigId" label="识别模型">
            <Select
              allowClear
              aria-label="识别模型"
              placeholder="选择支持图片输入的对话模型"
              options={visionModels.map((model) => ({ value: model.id, label: model.displayName }))}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} aria-label="保存配置">
            保存配置
          </Button>
        </Form>
      </Card>
      <Card title="当前状态" className="content-card ocr-status-card">
        <Space orientation="vertical" size={18} className="full-width">
          <div className="status-orb"><CloudOutlined /></div>
          <div className="center-text">
            <Typography.Title level={4}>{selected ? '已选择识别模型' : '等待配置'}</Typography.Title>
            <Typography.Text type="secondary">{selected ? selected.displayName : '尚未选择'}</Typography.Text>
          </div>
          <Alert type="info" showIcon title="识别发生在构建知识库时，不会提前上传样例图片" />
        </Space>
      </Card>
    </div>
  );
}

export default function ModelSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'providers';

  return (
    <PageFrame
      title="模型与 OCR"
      description="管理模型服务商、模型能力，以及扫描页和图片使用的视觉模型。"
    >
      <Card className="tab-card">
        <Tabs
          activeKey={['providers', 'models', 'vision'].includes(activeTab) ? activeTab : 'providers'}
          onChange={(key) => setSearchParams(key === 'providers' ? {} : { tab: key })}
          items={[
            {
              key: 'providers',
              label: <Space><ApiOutlined aria-hidden="true" />模型服务商</Space>,
              children: <ProvidersPanel />,
            },
            {
              key: 'models',
              label: <Space><RobotOutlined aria-hidden="true" />模型配置</Space>,
              children: <ModelsPanel />,
            },
            {
              key: 'vision',
              label: <Space><CloudOutlined aria-hidden="true" />视觉识别</Space>,
              children: <VisionPanel />,
            },
          ]}
        />
      </Card>
    </PageFrame>
  );
}
