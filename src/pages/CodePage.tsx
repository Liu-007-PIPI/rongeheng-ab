import { useState } from 'react';
import { Screen } from '../components/ui';
import { useExperiment } from '../state/experiment';
import type { CodeError } from '../state/experiment';

/** 错误提示不泄露分组，也不透露该码属于预试还是正式。 */
const MESSAGES: Record<Exclude<CodeError, null>, string> = {
  not_found: '这个匿名码无法使用，请核对后重新输入，或联系发码给你的同学。',
  completed: '这个匿名码已经完成过实验，不能再次作答。',
  withdrawn: '这个匿名码已被撤回，不能再次作答。',
  in_use_elsewhere: '这个匿名码正在另一台设备上作答，请在原设备继续。',
  failed: '暂时无法验证，请检查网络后重试。',
};

export function CodePage() {
  const { submitCode, codeError, errorMessage, busy } = useExperiment();
  const [value, setValue] = useState('');

  return (
    <Screen
      title="输入匿名码"
      lede="请输入项目负责人发给你的匿名码。这个码不包含你的个人信息，只用来保证每人作答一次。"
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
        中途刷新或不小心关掉页面，用同一个匿名码可以接着上次的进度继续，不会重新开始。
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
