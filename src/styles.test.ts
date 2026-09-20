/**
 * 视觉系统的协议守卫。
 *
 * 交接文档 4.2：B 版不能通过颜色诱导参与者选择"暂不购买"。
 * 深色视觉系统里定义了 --risk / --success 两个语义色，它们可以用在固定参照线上，
 * 但不能用来给"这个选择是否低于应急储备"的判定结果着色。
 * 这条测试锁住这一点——要做产品演示版时会红，届时请确认不是拿它跑正式实验。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const raw = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8');
/** 去掉注释后再检查——注释里会写"要改成什么"，那是说明，不是生效的样式。 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

describe('防诱导上色规则', () => {
  it('判定结果使用主文字色，不使用风险色或成功色', () => {
    expect(css).toMatch(/--verdict-risk-ink:\s*var\(--text-primary\)/);
    expect(css).toMatch(/--verdict-safe-ink:\s*var\(--text-primary\)/);
  });

  it('风险色只定义一次', () => {
    const declarations = css.match(/^\s*--risk:\s*#e57373;/gm) ?? [];
    expect(declarations).toHaveLength(1);
  });

  it('参与者端任何选择器都不使用风险色，只有管理端可以', () => {
    // 逐条规则检查：用到 var(--risk) 的，选择器必须是 .admin 开头的后台样式。
    // 后台是内部工具，参与者永远看不到，在那里标红不影响实验刺激。
    const offenders: string[] = [];
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!body.includes('var(--risk)')) continue;
      if (!selector.includes('.admin')) offenders.push(selector.trim());
    }
    expect(offenders).toEqual([]);
  });

  it('选项卡片没有按选项写死的差异化配色', () => {
    expect(css).not.toMatch(/\.option--(not-now|recommended|warning|danger)/);
  });
});

describe('响应式约束', () => {
  it('没有会在 375px 竖屏撑破布局的固定宽度', () => {
    // 只允许 max-width，不允许在布局容器上写死 width: <数字>px
    const widths = css.match(/[^-]width:\s*(\d{3,})px/g) ?? [];
    expect(widths).toHaveLength(0);
  });

  it('页面容器限制了最大宽度并保留左右留白', () => {
    expect(css).toMatch(/\.app\s*\{[^}]*max-width:\s*480px/);
    expect(css).toMatch(/--gutter:\s*16px/);
  });
});
