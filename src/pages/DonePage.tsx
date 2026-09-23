import { Screen } from '../components/ui';
import { REQUIRE_ACCESS_CODE } from '../config/experiment';
import { useExperiment } from '../state/experiment';

/**
 * 完成页只说明"已收到"和撤回方式。
 * 不展示研究假设、不回顾参与者的选择、不给出任何"正确答案"或评价。
 *
 * 开放模式下这一页还承担一个必须的功能：把自动生成的撤回码交给参与者。
 * 没有预先发放的匿名码，如果这里不显示，参与者就永远无法要求删除自己的数据，
 * 而《个人信息保护法》第十五条、第四十七条要求撤回与删除必须是可行的。
 */
export function DonePage() {
  const { participant, restart, busy } = useExperiment();
  const code = participant?.access_code_label;

  return (
    <Screen title="已完成，谢谢你的参与">
      <div className="card">
        <p style={{ marginTop: 0 }}>三道题都交上来了，我们收到了。</p>
        <p style={{ marginBottom: 0 }}>
          刚才页面上的钱、商品、价格和分期都是编出来的，不会产生任何真实的交易或费用。
        </p>
      </div>

      <div className="card card--flat">
        <p style={{ marginTop: 0 }}>
          {REQUIRE_ACCESS_CODE
            ? '如果以后不想让我们用你这份答案：'
            : '这是你的撤回码，先截个图或者记下来：'}
        </p>

        {!REQUIRE_ACCESS_CODE && code ? (
          <p className="withdraw-code" aria-label="撤回码">
            {code}
          </p>
        ) : null}

        <p style={{ marginBottom: 0 }}>
          在我们开始分析数据之前，把
          {REQUIRE_ACCESS_CODE && code ? <strong> {code} </strong> : '这串码'}
          发给负责人，我们就把它对应的记录全部删掉，以后也不会再用。
          {!REQUIRE_ACCESS_CODE ? '离开这一页，这串码就找不回来了。' : null}
        </p>
      </div>

      {!REQUIRE_ACCESS_CODE ? (
        <div className="actions">
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={restart}>
            {busy ? '准备中…' : '换一个人，再填一份'}
          </button>
          <p className="actions-note">
            这台手机/电脑要递给下一个人填，就点上面这个按钮。
            你刚才这份已经存好了，不会被冲掉，但这一页的撤回码不会再出现了。
          </p>
        </div>
      ) : (
        <p className="muted">可以关掉这个页面了。</p>
      )}
    </Screen>
  );
}
