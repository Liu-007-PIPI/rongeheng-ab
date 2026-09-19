import { SimBanner } from './components/ui';
import { BaselinePage } from './pages/BaselinePage';
import { CodePage } from './pages/CodePage';
import { ConsentPage } from './pages/ConsentPage';
import { DonePage } from './pages/DonePage';
import { SCENARIOS } from './config/scenarios';
import { ScenarioScreen } from './scenario/ScenarioScreen';
import { ExperimentProvider, useExperiment } from './state/experiment';

function Router() {
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
  return (
    <ExperimentProvider>
      <div className="app">
        <SimBanner />
        <Router />
      </div>
    </ExperimentProvider>
  );
}
