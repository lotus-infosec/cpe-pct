import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthGate } from './routes/auth';
import { Layout } from './components/layout';
import { Dashboard } from './routes/dashboard';
import { Certifications } from './routes/certifications';
import { Activities } from './routes/activities';
import { FanoutPage } from './routes/fanout';
import { CyclePage } from './routes/cycle';
import { ImportPage } from './routes/import';
import { AddEvidencePage } from './components/evidence';
import { NotificationsPage, SettingsPage } from './routes/notifications';
import { BackupPage, ExportsPage } from './routes/exports';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="certifications" element={<Certifications />} />
              <Route path="activities" element={<Activities />} />
              <Route path="activities/:id" element={<FanoutPage />} />
              <Route path="cycles/:id" element={<CyclePage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="evidence" element={<AddEvidencePage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="exports" element={<ExportsPage />} />
              <Route path="backup" element={<BackupPage />} />
              <Route path="*" element={<Dashboard />} />
            </Route>
          </Routes>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
