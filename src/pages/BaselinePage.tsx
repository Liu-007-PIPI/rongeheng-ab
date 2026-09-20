import { useState } from 'react';
import { BASELINE_FIELDS, EMPTY_BASELINE } from '../config/experiment';
import { ChipGroup, Screen } from '../components/ui';
import { useExperiment } from '../state/experiment';
import type { BaselineAnswers } from '../lib/types';

export function BaselinePage() {
  const { submitBaseline, busy, errorMessage } = useExperiment();
  const [answers, setAnswers] = useState<BaselineAnswers>(EMPTY_BASELINE);

  function valueOf(key: keyof BaselineAnswers): string {
    const v = answers[key];
    if (v === null) return '';
    return typeof v === 'boolean' ? String(v) : v;
  }

  function setValue(key: keyof BaselineAnswers, value: string) {
    setAnswers((prev) => ({
      ...prev,
      [key]: key === 'recent_large_purchase' ? value === 'true' : value,
    }));
  }

  const complete = BASELINE_FIELDS.every((f) => valueOf(f.key) !== '');

  return (
    <Screen
      title="几个基本情况"
      lede="这些问题只用于描述参与者整体构成，不会用来识别你本人。"
    >
      {BASELINE_FIELDS.map((field) => (
        <fieldset className="field" key={field.key}>
          <legend>{field.label}</legend>
          <ChipGroup
            name={field.label}
            options={field.options}
            value={valueOf(field.key)}
            onChange={(v) => setValue(field.key, v)}
          />
        </fieldset>
      ))}

      {errorMessage ? (
        <p className="form-note">
          没能开始实验，请稍后重试。如果一直这样，把下面这行发给项目负责人：
          <br />
          <code>{errorMessage}</code>
        </p>
      ) : null}

      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={!complete || busy}
          onClick={() => submitBaseline(answers)}
        >
          {busy ? '提交中…' : '进入实验'}
        </button>
      </div>
    </Screen>
  );
}
