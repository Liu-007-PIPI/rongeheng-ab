import { useState } from 'react';
import { CONSENT_POINTS, CONSENT_VERSION } from '../config/experiment';
import { Screen } from '../components/ui';
import { useExperiment } from '../state/experiment';

export function ConsentPage() {
  const { agreeConsent } = useExperiment();
  const [agreed, setAgreed] = useState(false);

  return (
    <Screen
      title="知情同意"
      lede="请先阅读以下说明。只有在你同意之后，才会进入实验。"
    >
      <div className="card">
        <ul className="bullets">
          {CONSENT_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>

      <div className="card card--flat">
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={{ marginTop: 3, width: 18, height: 18, flex: '0 0 auto' }}
          />
          <span>我已阅读并理解以上说明，自愿参加本次实验。</span>
        </label>
      </div>

      <p className="muted">知情同意版本：{CONSENT_VERSION}</p>

      <div className="actions">
        <button type="button" className="btn" disabled={!agreed} onClick={agreeConsent}>
          同意并继续
        </button>
      </div>
    </Screen>
  );
}
