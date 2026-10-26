import {
  AuditOutlined,
  BookOutlined,
  DatabaseOutlined,
  MessageOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { roleLabels, type Role } from '../domain';
import { useAppState } from '../state/AppState';

const roleOptions: Array<{
  role: Role;
  icon: ReactNode;
  description: string;
  permissions: string[];
  color: string;
}> = [
  {
    role: 'admin',
    icon: <SafetyCertificateOutlined />,
    description: '配置模型与 OCR，管理全部知识库和运行日志。',
    permissions: ['模型配置', '知识库管理', '运行日志'],
    color: 'purple',
  },
  {
    role: 'manager',
    icon: <BookOutlined />,
    description: '导入企业资料，管理知识片段并执行检索测试。',
    permissions: ['知识导入', '分块设置', '检索测试'],
    color: 'blue',
  },
  {
    role: 'user',
    icon: <MessageOutlined />,
    description: '选择可用知识库，进行在线对话并查看引用资料。',
    permissions: ['在线对话', '应用', '引用资料'],
    color: 'green',
  },
];

export default function RoleSelectPage() {
  const { setRole } = useAppState();
  const navigate = useNavigate();

  const selectRole = (role: Role) => {
    setRole(role);
    navigate(role === 'user' ? '/chat' : '/overview');
  };

  return (
    <main className="role-page">
      <section className="role-hero">
        <Space orientation="vertical" size={18} align="center">
          <span className="role-brand-mark">
            <DatabaseOutlined />
          </span>
          <Space orientation="vertical" size={4} align="center">
            <Typography.Title level={1}>企业知识库中台</Typography.Title>
            <Typography.Text type="secondary" className="role-subtitle">
              从知识导入、结构化处理到有依据的在线问答
            </Typography.Text>
          </Space>
        </Space>
      </section>

      <section className="role-panel" aria-labelledby="role-title">
        <div className="role-panel-heading">
          <div>
            <Typography.Title id="role-title" level={3}>
              选择当前角色
            </Typography.Title>
            <Typography.Text type="secondary">
              选择后将显示该角色可使用的功能。
            </Typography.Text>
          </div>
          <Tag color="geekblue">本机演示</Tag>
        </div>

        <div className="role-grid">
          {roleOptions.map((option) => (
            <Card key={option.role} className={`role-card role-card-${option.role}`}>
              <Space orientation="vertical" size={18} className="role-card-content">
                <span className="role-card-icon">{option.icon}</span>
                <div>
                  <Typography.Title level={4}>{roleLabels[option.role]}</Typography.Title>
                  <Typography.Paragraph type="secondary">
                    {option.description}
                  </Typography.Paragraph>
                </div>
                <Space wrap size={[6, 8]}>
                  {option.permissions.map((permission) => (
                    <Tag key={permission} color={option.color}>
                      {permission}
                    </Tag>
                  ))}
                </Space>
                <Button
                  type="primary"
                  block
                  size="large"
                  onClick={() => selectRole(option.role)}
                >
                  以{roleLabels[option.role]}身份进入
                </Button>
              </Space>
            </Card>
          ))}
        </div>

        <Alert
          showIcon
          icon={<AuditOutlined />}
          type="warning"
          title="角色选择只用于区分演示中的职责"
          description="当前版本不提供身份认证，适用于受信任的企业内网。"
        />
      </section>

      <footer className="role-footer">
        <Space separator={<span>·</span>}>
          <span><SettingOutlined /> 模型自主配置</span>
          <span><BookOutlined /> 多格式知识导入</span>
          <span><MessageOutlined /> 回答引用可追溯</span>
        </Space>
      </footer>
    </main>
  );
}

