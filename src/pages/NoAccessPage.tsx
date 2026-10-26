import { LockOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function NoAccessPage() {
  const navigate = useNavigate();
  return (
    <div className="state-page">
      <Result
        status="403"
        icon={<LockOutlined className="state-icon" />}
        title="当前角色无法访问此页面"
        subTitle="请切换具有相应职责的角色。"
        extra={
          <Button type="primary" onClick={() => navigate('/role')}>
            重新选择角色
          </Button>
        }
      />
    </div>
  );
}

