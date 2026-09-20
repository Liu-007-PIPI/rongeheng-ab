import { useEffect, useState } from 'react';
import { SimBanner } from './components/ui';
import { BaselinePage } from './pages/BaselinePage';
import { CodePage } from './pages/CodePage';
import { ConsentPage } from './pages/ConsentPage';
import { DonePage } from './pages/DonePage';
import { SCENARIOS } from './config/scenarios';
import { ScenarioScreen } from './scenario/ScenarioScreen';
import { ExperimentProvider, useExperiment } from './state/experiment';
import AdminApp from './admin/AdminApp';

/** 管理端入口。用 hash 路由，静态托管不需要任何服务端改写规则。 */
const ADMIN_HASH = '#/admin';

function useIsAdminRoute(): boolean {
  const [isAdmin, setIsAdmin] = useState(() => window.location.hash === ADMIN_HASH);
  useEffect(() => {
    const onChange = () => setIsAdmin(window.location.hash === ADMIN_HASH);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return isAdmin;
}

function ParticipantRouter() {
  const { step, participant, session, currentScenarioId, currentIndex } = useExperiment();

  switch (step) {
    case 'loading':
      return <p className="muted" style={{ paddingTop: 40 }}>正在载入…</p>;
    case 'consent':
      return <ConsentPage />;
    case 'code':
      return <CodePage />;
    case 'baseline':
      return <BaselinePage />;
    case 'scenario':
      if (!participant || !session || !currentScenarioId) return <CodePage />;
      return (
        <ScenarioScreen
          key={currentScenarioId}
          scenario={SCENARIOS[currentScenarioId]}
          variant={participant.variant}
          position={currentIndex + 1}
          total={session.scenario_order.length}
        />
      );
    case 'done':
      return <DonePage />;
  }
}

export default function App() {
  const isAdmin = useIsAdminRoute();

  if (isAdmin) return <AdminApp />;

  return (
    <ExperimentProvider>
      <div className="app">
        <SimBanner />
        <ParticipantRouter />
      </div>
    </ExperimentProvider>
  );
}
