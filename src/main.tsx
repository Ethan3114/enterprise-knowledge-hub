import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import { AppStateProvider } from './state/AppState';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#6757e8',
          colorInfo: '#6757e8',
          colorSuccess: '#1b9a6c',
          colorWarning: '#d9822b',
          colorError: '#d14343',
          colorBgLayout: '#f6f7fb',
          colorText: '#1f2533',
          colorTextSecondary: '#697386',
          borderRadius: 10,
          borderRadiusLG: 16,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: {
            controlHeight: 38,
            fontWeight: 600,
          },
          Card: {
            headerFontSize: 16,
          },
          Layout: {
            bodyBg: '#f6f7fb',
            headerBg: 'rgba(255, 255, 255, 0.92)',
            siderBg: '#ffffff',
          },
          Menu: {
            itemBorderRadius: 10,
            itemHeight: 44,
            itemMarginInline: 10,
          },
        },
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <AppStateProvider>
            <App />
          </AppStateProvider>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
);

