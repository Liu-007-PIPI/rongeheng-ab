import { Screen } from '../components/ui';
import { useExperiment } from '../state/experiment';

/**
 * 完成页只说明"已收到"和撤回方式。
 * 不展示研究假设、不回顾参与者的选择、不给出任何"正确答案"或评价。
 */
export function DonePage() {
  const { participant } = useExperiment();

  return (
    <Screen title="已完成，谢谢你的参与">
      <div className="card">
        <p style={{ marginTop: 0 }}>你的三个情境已全部提交，我们已经收到。</p>
        <p style={{ marginBottom: 0 }}>
          本次页面中的账户、商品、价格和分期信息都是实验模拟，不会产生任何真实交易或费用。
        </p>
      </div>

      <div className="card card--flat">
        <p style={{ marginTop: 0 }}>如果你想撤回这次作答：</p>
        <p style={{ marginBottom: 0 }}>
          在数据截止前，把你的匿名码
          {participant ? <strong> {participant.access_code_label} </strong> : ' '}
          发给项目负责人，我们会删除这个匿名码对应的全部记录，并不再用于任何分析。
        </p>
      </div>

      <p className="muted">现在可以关闭这个页面了。</p>
    </Screen>
  );
}
