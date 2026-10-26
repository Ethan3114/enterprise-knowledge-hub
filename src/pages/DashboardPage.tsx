import {
  ApiOutlined,
  ArrowRightOutlined,
  BookOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  FileTextOutlined,
  LoadingOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Progress, Row, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import PageFrame from '../components/PageFrame';
import { useAppState } from '../state/AppState';

export default function DashboardPage() {
  const { data, backendOnline } = useAppState();
  const documentCount = data.knowledgeBases.reduce(
    (total, knowledgeBase) => total + knowledgeBase.documents.length,
    0,
  );
  const checks = [
    {
      label: '配置模型服务商',
      done: data.providers.length > 0,
      href: '/models',
      adminOnly: true,
    },
    {
      label: '配置视觉识别',
      done: Boolean(data.vision.modelConfigId),
      href: '/models?tab=vision',
      adminOnly: true,
    },
    {
      label: '创建知识库',
      done: data.knowledgeBases.length > 0,
      href: '/knowledge-bases',
      adminOnly: false,
    },
    {
      label: '选择知识文件',
      done: documentCount > 0,
      href: '/knowledge-bases',
      adminOnly: false,
    },
  ].filter((item) => data.role === 'admin' || !item.adminOnly);
  const completedChecks = checks.filter((item) => item.done).length;
  const completion = checks.length
    ? Math.round((completedChecks / checks.length) * 100)
    : 0;

  return (
    <PageFrame
      title="系统概览"
      description="查看这台电脑上已经保存的配置和待完成事项。"
      actions={
        <Link to="/knowledge-bases">
          <Button type="primary" icon={<BookOutlined />}>
            管理知识库
          </Button>
        </Link>
      }
    >
      <Row gutter={[16, 16]} className="metric-grid">
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card">
            <span className="metric-icon metric-icon-purple"><BookOutlined /></span>
            <Typography.Text type="secondary">知识库</Typography.Text>
            <Typography.Title level={2}>{data.knowledgeBases.length}</Typography.Title>
            <Typography.Text type="secondary">已在本机创建</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card">
            <span className="metric-icon metric-icon-blue"><FileTextOutlined /></span>
            <Typography.Text type="secondary">已选文件</Typography.Text>
            <Typography.Title level={2}>{documentCount}</Typography.Title>
            <Typography.Text type="secondary">上传后保存在本机</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card">
            <span className="metric-icon metric-icon-green"><RobotOutlined /></span>
            <Typography.Text type="secondary">模型配置</Typography.Text>
            <Typography.Title level={2}>{data.models.length}</Typography.Title>
            <Typography.Text type="secondary">可在模型页测试连接</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card">
            <span className="metric-icon metric-icon-orange"><CloudServerOutlined /></span>
            <Typography.Text type="secondary">视觉识别</Typography.Text>
            <Typography.Title level={2} className="metric-status-title">
              {data.vision.modelConfigId ? '已选择' : '待配置'}
            </Typography.Title>
            <Typography.Text type="secondary">用于扫描页和图片</Typography.Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="dashboard-panels">
        <Col xs={24} xl={15}>
          <Card title="准备进度" className="content-card">
            <Space orientation="vertical" size={22} className="full-width">
              <div className="progress-heading">
                <div>
                  <Typography.Title level={4}>{completion}%</Typography.Title>
                  <Typography.Text type="secondary">
                    已完成 {completedChecks} / {checks.length} 项准备
                  </Typography.Text>
                </div>
                <Tag color={completion === 100 ? 'success' : 'processing'}>
                  {completion === 100 ? '前端配置完整' : '继续配置'}
                </Tag>
              </div>
              <Progress percent={completion} showInfo={false} strokeColor="#6757e8" />
              <div className="setup-list">
                {checks.map((item) => (
                  <Link to={item.href} key={item.label} className="setup-item">
                    <Space>
                      {item.done ? (
                        <CheckCircleFilled className="setup-done" />
                      ) : (
                        <LoadingOutlined className="setup-pending" />
                      )}
                      <Typography.Text>{item.label}</Typography.Text>
                    </Space>
                    <ArrowRightOutlined />
                  </Link>
                ))}
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title="服务状态" className="content-card">
            <div className="service-list">
              <div className="service-item">
                <Space><ApiOutlined /><span>本机服务</span></Space>
                <Tag color={backendOnline ? 'success' : 'warning'}>{backendOnline ? '已连接' : '未连接'}</Tag>
              </div>
              <div className="service-item">
                <Space><CloudServerOutlined /><span>文档解析</span></Space>
                <Tag color={backendOnline ? 'success' : 'default'}>{backendOnline ? '可在本机处理' : '等待服务'}</Tag>
              </div>
              <div className="service-item">
                <Space><RobotOutlined /><span>模型服务</span></Space>
                <Tag>{data.models.length ? `${data.models.length} 个配置` : '待配置'}</Tag>
              </div>
            </div>
            <Typography.Paragraph type="secondary" className="service-note">
              密钥只保存在本机服务中。真正调用模型时才会访问你配置的服务商。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </PageFrame>
  );
}

