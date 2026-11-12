import '@ant-design/v5-patch-for-react-19';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { ConfigProvider, App as AntApp } from 'antd';
import enIN from 'antd/locale/en_GB';
import 'antd/dist/reset.css';
import './index.css';
import App from './App';
import { store } from './redux/store';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <ConfigProvider
        locale={enIN}
        theme={{
          token: {
            colorPrimary: '#059669',
            colorLink: '#047857',
            colorWarning: '#d97706',
            borderRadius: 8,
            fontFamily: 'Poppins, system-ui, sans-serif',
            colorText: '#0f1f17',
          },
          components: { Layout: { siderBg: '#ffffff', headerBg: '#ffffff' }, Menu: { itemSelectedBg: '#e7f6ef', itemSelectedColor: '#047857', itemBorderRadius: 8, subMenuItemBg: '#ffffff' } },
        }}
      >
        <AntApp>
          <App />
        </AntApp>
      </ConfigProvider>
    </Provider>
  </StrictMode>
);
