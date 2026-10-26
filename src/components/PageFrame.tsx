import type { ReactNode } from 'react';
import { Space, Typography } from 'antd';

interface PageFrameProps {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}

export default function PageFrame({
  title,
  description,
  actions,
  children,
}: PageFrameProps) {
  return (
    <main className="page-frame">
      <header className="page-heading">
        <Space orientation="vertical" size={4}>
          <Typography.Title level={2}>{title}</Typography.Title>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </Space>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </main>
  );
}

