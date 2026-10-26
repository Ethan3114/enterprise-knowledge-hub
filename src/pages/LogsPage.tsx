import { useEffect, useState } from 'react';
import {
  ClockCircleOutlined,
  CommentOutlined,
  DatabaseOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Card,
  Col,
  DatePicker,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import PageFrame from '../components/PageFrame';
import type { LogQuery, LogSummary, Role } from '../domain';
import { roleLabels } from '../domain';
import { useAppState } from '../state/AppState';

const { RangePicker } = DatePicker;

const emptySummary: LogSummary = {
  queries: 0,
  tokens: 0,
  averageDurationMs: 0,
  errors: 0,
  daily: [],
};

function queryString(filters: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

function MetricsPanel({ summary }: { summary: LogSummary }) {
  const maxQueries = Math.max(...summary.daily.map((item) => item.queries), 1);
  return (
    <Space orientation="vertical" size={16} className="full-width">
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card compact-metric">
            <span className="metric-icon metric-icon-purple"><CommentOutlined /></span>
            <Typography.Text type="secondary">对话查询</Typography.Text>
            <Typography.Title level={2}>{summary.queries}</Typography.Title>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card compact-metric">
            <span className="metric-icon metric-icon-blue"><DatabaseOutlined /></span>
            <Typography.Text type="secondary">Token 消耗</Typography.Text>
            <Typography.Title level={2}>{summary.tokens.toLocaleString('zh-CN')}</Typography.Title>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card compact-metric">
            <span className="metric-icon metric-icon-green"><ClockCircleOutlined /></span>
            <Typography.Text type="secondary">平均时长</Typography.Text>
            <Typography.Title level={2}>{summary.averageDurationMs} ms</Typography.Title>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card compact-metric">
            <span className="metric-icon metric-icon-orange"><ExclamationCircleOutlined /></span>
            <Typography.Text type="secondary">错误数量</Typography.Text>
            <Typography.Title level={2}>{summary.errors}</Typography.Title>
          </Card>
        </Col>
      </Row>
      <Card title="查询趋势" className="content-card log-chart-placeholder">
        {summary.daily.length ? (
          <div className="log-bars" aria-label="每日查询数量">
            {summary.daily.map((item) => (
              <div key={item.date} className="log-bar-item">
                <span>{item.queries}</span>
                <div className="log-bar" style={{ height: `${Math.max(8, (item.queries / maxQueries) * 140)}px` }} />
                <small>{item.date.slice(5)}</small>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space orientation="vertical" size={4}>
                <Typography.Text strong>暂无可视化数据</Typography.Text>
                <Typography.Text type="secondary">完成真实对话后，此处将显示查询数量、Token 和耗时趋势。</Typography.Text>
              </Space>
            }
          />
        )}
      </Card>
    </Space>
  );
}

export default function LogsPage() {
  const { data } = useAppState();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'metrics';
  const [summary, setSummary] = useState<LogSummary>(emptySummary);
  const [queries, setQueries] = useState<LogQuery[]>([]);
  const [filters, setFilters] = useState<{
    from?: string;
    to?: string;
    knowledgeBaseId?: string;
    role?: Role;
    model?: string;
    status?: string;
    q?: string;
  }>({});

  useEffect(() => {
    const suffix = queryString(filters);
    let active = true;
    void Promise.all([
      api<LogSummary>(`/logs/summary${suffix}`),
      api<LogQuery[]>(`/logs/queries${suffix}`),
    ]).then(([nextSummary, nextQueries]) => {
      if (!active) {
        return;
      }
      setSummary(nextSummary);
      setQueries(nextQueries);
    }).catch(() => {
      if (!active) {
        return;
      }
      setSummary(emptySummary);
      setQueries([]);
    });
    return () => {
      active = false;
    };
  }, [filters]);

  return (
    <PageFrame
      title="运行日志"
      description="跟踪对话查询、Token 消耗、处理时长和各阶段调用状态。"
    >
      <Alert
        showIcon
        type="info"
        title="日志页面只显示真实调用数据"
        description="对话和检索测试都会记在本机。没有调用时，指标保持为零。"
        className="page-alert"
      />
      <Card className="tab-card">
        <Tabs
          activeKey={activeTab === 'queries' ? 'queries' : 'metrics'}
          onChange={(key) => setSearchParams(key === 'metrics' ? {} : { tab: key })}
          items={[
            { key: 'metrics', label: '数据看板', children: <MetricsPanel summary={summary} /> },
            {
              key: 'queries',
              label: '查询明细',
              children: (
                <Space orientation="vertical" size={16} className="full-width">
                  <Card className="filter-card">
                    <div className="log-filter-grid">
                      <RangePicker
                        aria-label="筛选日志时间"
                        onChange={(values) => {
                          const start = values?.[0];
                          const end = values?.[1];
                          setFilters((current) => ({
                            ...current,
                            from: start ? start.format('YYYY-MM-DD') : undefined,
                            to: end ? end.format('YYYY-MM-DD') : undefined,
                          }));
                        }}
                      />
                      <Select
                        allowClear
                        placeholder="全部知识库"
                        aria-label="按知识库筛选日志"
                        options={data.knowledgeBases.map((knowledgeBase) => ({ value: knowledgeBase.id, label: knowledgeBase.name }))}
                        onChange={(value) => setFilters((current) => ({ ...current, knowledgeBaseId: value }))}
                      />
                      <Select
                        allowClear
                        placeholder="全部角色"
                        aria-label="按角色筛选日志"
                        options={(Object.keys(roleLabels) as Role[]).map((role) => ({ value: role, label: roleLabels[role] }))}
                        onChange={(value) => setFilters((current) => ({ ...current, role: value }))}
                      />
                      <Select
                        allowClear
                        placeholder="全部模型"
                        aria-label="按模型筛选日志"
                        options={data.models.map((model) => ({ value: model.displayName, label: model.displayName }))}
                        onChange={(value) => setFilters((current) => ({ ...current, model: value }))}
                      />
                      <Select
                        allowClear
                        placeholder="全部状态"
                        aria-label="按状态筛选日志"
                        options={[
                          { value: 'success', label: '调用成功' },
                          { value: 'failed', label: '调用失败' },
                          { value: 'cancelled', label: '用户终止' },
                        ]}
                        onChange={(value) => setFilters((current) => ({ ...current, status: value }))}
                      />
                      <Input
                        prefix={<FileSearchOutlined />}
                        placeholder="搜索查询内容或调用编号"
                        aria-label="搜索日志"
                        onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value.trim() }))}
                      />
                    </div>
                  </Card>
                  <Table<LogQuery>
                    rowKey="id"
                    columns={[
                      { title: '查询内容', dataIndex: 'query', minWidth: 240 },
                      {
                        title: '类型',
                        dataIndex: 'kind',
                        width: 110,
                        render: (kind: LogQuery['kind']) =>
                          kind === 'chat' ? <Tag color="blue">对话</Tag> : kind === 'app' ? <Tag color="purple">应用</Tag> : <Tag>检索测试</Tag>,
                      },
                      { title: '知识库', dataIndex: 'knowledgeBaseNames', width: 160 },
                      { title: '模型', dataIndex: 'modelName', width: 160 },
                      {
                        title: 'Token',
                        width: 100,
                        render: (_, record) => record.promptTokens + record.completionTokens,
                      },
                      { title: '耗时', dataIndex: 'durationMs', width: 100, render: (value: number) => `${value} ms` },
                      { title: '状态', dataIndex: 'status', width: 100 },
                      { title: '时间', dataIndex: 'createdAt', width: 210 },
                    ]}
                    dataSource={queries}
                    pagination={false}
                    scroll={{ x: 1180 }}
                    locale={{
                      emptyText: (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={
                            <Space orientation="vertical" size={4}>
                              <Typography.Text strong>暂无查询记录</Typography.Text>
                              <Typography.Text type="secondary">完成真实对话后，此处将显示 Token、耗时和调用过程。</Typography.Text>
                            </Space>
                          }
                        />
                      ),
                    }}
                  />
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </PageFrame>
  );
}
