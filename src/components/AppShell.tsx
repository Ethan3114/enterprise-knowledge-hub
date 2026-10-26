import { Suspense, useMemo, useState } from 'react';
import {
  AppstoreOutlined,
  BarChartOutlined,
  BookOutlined,
  CommentOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  DeleteOutlined,
  MenuOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { roleLabels, type Role } from '../domain';
import { useAppState } from '../state/AppState';

const { Header, Content, Sider } = Layout;

const roleColors: Record<Role, string> = {
  admin: 'purple',
  manager: 'blue',
  user: 'green',
};

export default function AppShell() {
  const { data, setRole, resetWorkspace, backendOnline } = useAppState();
  const { message: messageApi } = App.useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const items = useMemo<MenuProps['items']>(() => {
    if (!data.role) {
      return [];
    }
    const common = [
      {
        key: '/chat',
        icon: <CommentOutlined />,
        label: <Link to="/chat">在线对话</Link>,
      },
      {
        key: '/apps',
        icon: <AppstoreOutlined />,
        label: <Link to="/apps">应用</Link>,
      },
    ];
    const management = [
      {
        key: '/overview',
        icon: <DashboardOutlined />,
        label: <Link to="/overview">系统概览</Link>,
      },
      {
        key: '/knowledge-bases',
        icon: <BookOutlined />,
        label: <Link to="/knowledge-bases">知识库</Link>,
      },
    ];
    const administration = [
      {
        key: '/models',
        icon: <SettingOutlined />,
        label: <Link to="/models">模型与 OCR</Link>,
      },
      {
        key: '/logs',
        icon: <BarChartOutlined />,
        label: <Link to="/logs">运行日志</Link>,
      },
    ];
    if (data.role === 'user') {
      return common;
    }
    if (data.role === 'manager') {
      return [...management, ...common];
    }
    return [...management, ...common, ...administration];
  }, [data.role]);

  const selectedKey =
    items
      ?.map((item) => String(item?.key))
      .sort((a, b) => b.length - a.length)
      .find((key) => location.pathname.startsWith(key)) ?? '';

  const menu = (
    <Menu
      mode="inline"
      items={items}
      selectedKeys={[selectedKey]}
      onClick={() => setMobileMenuOpen(false)}
      className="primary-navigation"
    />
  );

  const handleRoleChange = (role: Role) => {
    setRole(role);
    navigate(role === 'user' ? '/chat' : '/overview');
  };

  const handleReset = () => {
    Modal.confirm({
      title: '清除原型数据',
      content: '此操作会删除本机保存的知识库、文件、模型和对话记录。密钥也会一并清除。',
      okText: '确认清除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await resetWorkspace();
          navigate('/role');
        } catch (error) {
          messageApi.error(error instanceof ApiError ? error.message : '清除失败');
        }
      },
    });
  };

  return (
    <Layout className="app-layout">
      {isMobile ? (
        <Drawer
          title="功能导航"
          placement="left"
          size={280}
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
        >
          {menu}
        </Drawer>
      ) : (
        <Sider width={232} className="app-sider">
          <Link to="/" className="brand" aria-label="知识库中台首页">
            <span className="brand-mark">
              <DatabaseOutlined />
            </span>
            <span>
              <strong>知识中台</strong>
              <small>Knowledge Hub</small>
            </span>
          </Link>
          {menu}
          <div className="sider-note">
            <Tag color="geekblue">本机演示</Tag>
            <Typography.Text type="secondary">
              数据保存在这台电脑，密钥不会留在浏览器
            </Typography.Text>
          </div>
        </Sider>
      )}
      <Layout>
        <Header className="app-header">
          <Space size={12}>
            {isMobile ? (
              <Button
                type="text"
                icon={<MenuOutlined />}
                aria-label="打开导航"
                onClick={() => setMobileMenuOpen(true)}
              />
            ) : null}
            {isMobile ? (
              <Typography.Text strong>知识中台</Typography.Text>
            ) : (
              <Tag color={backendOnline ? 'success' : 'warning'}>
                {backendOnline ? '本机服务已连接' : '本机服务未连接'}
              </Tag>
            )}
          </Space>
          <Space size={10}>
            {data.role ? <Tag color={roleColors[data.role]}>{roleLabels[data.role]}</Tag> : null}
            <Select<Role>
              aria-label="切换当前角色"
              value={data.role ?? undefined}
              onChange={handleRoleChange}
              options={Object.entries(roleLabels).map(([value, label]) => ({
                value: value as Role,
                label,
              }))}
              popupMatchSelectWidth={180}
              className="role-select"
            />
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'reset',
                    icon: <DeleteOutlined />,
                    label: '清除原型数据',
                    danger: true,
                    onClick: handleReset,
                  },
                ],
              }}
              trigger={['click']}
            >
              <Button type="text" aria-label="打开其他操作">•••</Button>
            </Dropdown>
          </Space>
        </Header>
        <Content className="app-content">
          <Suspense
            fallback={
              <div className="route-loading" role="status" aria-live="polite">
                <Spin size="large" />
                <Typography.Text type="secondary">正在加载页面</Typography.Text>
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}
