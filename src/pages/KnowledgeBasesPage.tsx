import { useMemo, useState } from 'react';
import {
  BookOutlined,
  DeleteOutlined,
  FileTextOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
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
  Tag,
  Typography,
} from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import PageFrame from '../components/PageFrame';
import { knowledgeBaseStatusLabels, type KnowledgeBaseStatus } from '../domain';
import { useAppState } from '../state/AppState';

interface KnowledgeBaseFormValues {
  name: string;
  description?: string;
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export default function KnowledgeBasesPage() {
  const { data, createKnowledgeBase, deleteKnowledgeBase } = useAppState();
  const { message: messageApi } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<KnowledgeBaseFormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | KnowledgeBaseStatus>('all');

  const filteredKnowledgeBases = useMemo(
    () =>
      data.knowledgeBases.filter((knowledgeBase) => {
        const matchesSearch = `${knowledgeBase.name}${knowledgeBase.description}`
          .toLocaleLowerCase('zh-CN')
          .includes(search.trim().toLocaleLowerCase('zh-CN'));
        const matchesStatus = status === 'all' || knowledgeBase.status === status;
        return matchesSearch && matchesStatus;
      }),
    [data.knowledgeBases, search, status],
  );

  const openCreateModal = () => {
    form.resetFields();
    setModalOpen(true);
  };

  const submitCreate = async (values: KnowledgeBaseFormValues) => {
    try {
      const id = await createKnowledgeBase({
        name: values.name.trim(),
        description: values.description?.trim() ?? '',
      });
      setModalOpen(false);
      messageApi.success('知识库已创建');
      navigate(`/knowledge-bases/${id}`);
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : '创建失败');
    }
  };

  return (
    <PageFrame
      title="知识库"
      description="组织企业文档，检查解析结果并配置检索方式。"
      actions={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          aria-label="创建知识库"
          onClick={openCreateModal}
        >
          创建知识库
        </Button>
      }
    >
      <Card className="filter-card">
        <div className="filter-row">
          <Input
            allowClear
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            prefix={<SearchOutlined />}
            placeholder="搜索知识库名称或说明"
            aria-label="搜索知识库"
            className="search-input"
          />
          <Select
            value={status}
            onChange={setStatus}
            aria-label="按状态筛选知识库"
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'draft', label: '待构建' },
              { value: 'building', label: '构建中' },
              { value: 'ready', label: '可检索' },
              { value: 'failed', label: '构建失败' },
            ]}
            className="status-select"
          />
        </div>
      </Card>

      {filteredKnowledgeBases.length ? (
        <div className="knowledge-grid">
          {filteredKnowledgeBases.map((knowledgeBase) => (
            <Card key={knowledgeBase.id} className="knowledge-card">
              <div className="knowledge-card-topline">
                <span className="knowledge-icon"><BookOutlined /></span>
                <Tag color={knowledgeBase.status === 'ready' ? 'green' : knowledgeBase.status === 'failed' ? 'red' : 'gold'}>
                  {knowledgeBaseStatusLabels[knowledgeBase.status]}
                </Tag>
              </div>
              <Typography.Title level={4}>{knowledgeBase.name}</Typography.Title>
              <Typography.Paragraph
                type="secondary"
                ellipsis={{ rows: 2 }}
                className="knowledge-description"
              >
                {knowledgeBase.description || '暂未填写说明'}
              </Typography.Paragraph>
              <Space size={18} className="knowledge-meta">
                <span><FileTextOutlined /> {knowledgeBase.documents.length} 个文件</span>
                <span>更新于 {dateFormatter.format(new Date(knowledgeBase.updatedAt))}</span>
              </Space>
              <div className="knowledge-card-actions">
                <Link to={`/knowledge-bases/${knowledgeBase.id}`}>
                  <Button type="primary">打开知识库</Button>
                </Link>
                <Popconfirm
                  title={`删除“${knowledgeBase.name}”`}
                  description="删除后会移除知识库、原始文件和已经构建的片段。"
                  okText="确认删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={async () => {
                    try {
                      await deleteKnowledgeBase(knowledgeBase.id);
                      messageApi.success('知识库已删除');
                    } catch (error) {
                      messageApi.error(error instanceof ApiError ? error.message : '删除失败');
                    }
                  }}
                >
                  <Button danger type="text" icon={<DeleteOutlined />} aria-label={`删除${knowledgeBase.name}`} />
                </Popconfirm>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="empty-card">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space orientation="vertical" size={4}>
                <Typography.Text strong>
                  {data.knowledgeBases.length ? '没有符合条件的知识库' : '还没有知识库'}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {data.knowledgeBases.length
                    ? '请调整搜索文字或状态筛选。'
                    : '创建后即可导入企业资料。'}
                </Typography.Text>
              </Space>
            }
          >
            {!data.knowledgeBases.length ? (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                aria-label="创建知识库"
                onClick={openCreateModal}
              >
                创建知识库
              </Button>
            ) : null}
          </Empty>
        </Card>
      )}

      <Modal
        title="创建知识库"
        open={modalOpen}
        okText="创建并继续"
        cancelText="取消"
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnHidden
        forceRender
      >
        <Form<KnowledgeBaseFormValues>
          form={form}
          layout="vertical"
          onFinish={submitCreate}
          requiredMark="optional"
        >
          <Form.Item
            name="name"
            label="知识库名称"
            rules={[
              { required: true, whitespace: true, message: '请填写知识库名称' },
              { max: 40, message: '名称不能超过 40 个字符' },
              {
                validator: (_, value: string | undefined) => {
                  const duplicated = data.knowledgeBases.some(
                    (knowledgeBase) => knowledgeBase.name === value?.trim(),
                  );
                  return duplicated
                    ? Promise.reject(new Error('已存在同名知识库'))
                    : Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="例如：人力资源制度库" autoFocus />
          </Form.Item>
          <Form.Item name="description" label="知识库说明">
            <Input.TextArea
              rows={4}
              maxLength={200}
              showCount
              placeholder="说明资料范围、使用对象和问答目标"
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageFrame>
  );
}
