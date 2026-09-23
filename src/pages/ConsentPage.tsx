import { useState } from 'react';
import { CONSENT_POINTS, CONSENT_VERSION } from '../config/experiment';
import { Screen } from '../components/ui';
import { useExperiment } from '../state/experiment';

export function ConsentPage() {
  const { agreeConsent } = useExperiment();
  const [agreed, setAgreed] = useState(false);

  return (
    <Screen
      title="开始之前，先说清楚几件事"
      lede="看完下面几条，你同意了我们才开始。"
    >
      <div className="card">
        <ul className="bullets">
          {CONSENT_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>

      <div className="card card--flat">
        <label className="consent-check">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>上面几条我看过了，也看懂了，我愿意参加。</span>
        </label>
      </div>

      <p className="muted">说明版本：{CONSENT_VERSION}</p>

      <div className="actions">
        <button type="button" className="btn" disabled={!agreed} onClick={agreeConsent}>
          同意并继续
        </button>
      </div>
    </Screen>
  );
}
