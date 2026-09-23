import { useState } from 'react';
import { Screen } from '../components/ui';
import { useExperiment } from '../state/experiment';
import type { CodeError } from '../state/experiment';

/** 错误提示不泄露分组，也不透露该码属于预试还是正式。 */
const MESSAGES: Record<Exclude<CodeError, null>, string> = {
  not_found: '这个码无法使用，再核对一下，或者问一下发码给你的同学。',
  completed: '这个码已经完成过实验了，不能再填一次。',
  withdrawn: '这个码已经撤回了，不能再填。',
  in_use_elsewhere: '这个码正在另一台设备上填，请回原来那台接着填。',
  failed: '暂时验不了，检查一下网络再试。',
};

export function CodePage() {
  const { submitCode, codeError, errorMessage, busy } = useExperiment();
  const [value, setValue] = useState('');

  return (
    <Screen
      title="输入匿名码"
      lede="填一下负责人发给你的那串码。这串码里没有你的任何个人信息，只是用来保证一个人只填一次。"
    >
      <input
        className="code-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="例如 A001"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        aria-label="匿名码"
      />

      {codeError ? (
        <p className="form-note">
          {MESSAGES[codeError]}
          {errorMessage ? (
            <>
              <br />
              <code>{errorMessage}</code>
            </>
          ) : null}
        </p>
      ) : null}

      <p className="muted" style={{ marginTop: 14 }}>
        中途刷新，或者不小心关掉了页面，用同一串码进来还能接着上次的地方填，不用从头来。
      </p>

      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={value.trim().length === 0 || busy}
          onClick={() => submitCode(value)}
        >
          {busy ? '验证中…' : '开始'}
        </button>
      </div>
    </Screen>
  );
}
