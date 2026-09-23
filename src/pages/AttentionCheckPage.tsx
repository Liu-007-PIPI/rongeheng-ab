import { useEffect, useState } from 'react';
import { ChipGroup, Screen } from '../components/ui';
import { useExperiment } from '../state/experiment';

/**
 * 注意力检查（指令式作答题 / instructed-response item）。
 *
 * 第二轮新增，用于识别没有认真阅读、随手乱点的作答。放在第 2 个情境之后，
 * 前后各有情境，不在开头也不在结尾，避免被当成流程的一部分敷衍带过。
 *
 * 题目内容刻意与实验主题无关：如果拿"刚才那屏的最低余额是多少"来问，
 * 等于提示参与者应该关注什么，会污染后续情境的行为。
 *
 * 预注册的处理方式：主分析排除未通过者，另做一次含全部参与者的敏感性分析，
 * 两套结果都报告。排除规则在收数据之前就已写死，不得事后调整。
 */

const OPTIONS = [
  { value: 'red', label: '红色' },
  { value: 'blue', label: '蓝色' },
  { value: 'green', label: '绿色' },
  { value: 'yellow', label: '黄色' },
];

const CORRECT = 'green';

export function AttentionCheckPage() {
  const { submitAttentionCheck, busy, errorMessage, logEvent } = useExperiment();
  const [value, setValue] = useState('');

  useEffect(() => {
    logEvent('attention_check_shown', null, {});
    // 只在进入本页时记一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen
      title="一道小题"
      lede="这题跟买东西没关系，只是想看看你有没有在认真读题。怎么选都不影响你前面交的答案。"
    >
      <fieldset className="field">
        <legend>请把这句话读完再选：下面四个选项里，请选「绿色」。</legend>
        <ChipGroup
          name="注意力检查"
          options={OPTIONS}
          value={value}
          onChange={setValue}
        />
      </fieldset>

      {errorMessage ? (
        <p className="form-note">
          没交上去，过一会儿再点一次。要是一直这样，把下面这行字发给负责人：
          <br />
          <code>{errorMessage}</code>
        </p>
      ) : null}

      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={value === '' || busy}
          onClick={() => submitAttentionCheck(value === CORRECT)}
        >
          {busy ? '提交中…' : '继续'}
        </button>
        <p className="actions-note">选完接着做最后一题。</p>
      </div>
    </Screen>
  );
}
