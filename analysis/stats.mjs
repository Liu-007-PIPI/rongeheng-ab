/**
 * 统计方法。全部自己实现，不引第三方库，便于核对每一步。
 *
 * 方法选择依据《融e衡项目Claude交接文档》10.3：
 * - 小样本组间比较用参与者层面的置换检验和 Mann-Whitney U
 * - 绝对差的 95% 置信区间用参与者层面的 bootstrap
 * - "至少一次高风险"的人数比较用 Fisher 精确检验
 *
 * 置换与 bootstrap 使用固定种子，任何人重跑都得到同一组数字。
 */

/* ────────────────── 可复现随机数 ────────────────── */

/** mulberry32：小而快的确定性伪随机数发生器。同一种子必得同一序列。 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ────────────────── 描述统计 ────────────────── */

export function mean(xs) {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** 线性插值分位数，与 numpy / R type 7 一致。 */
export function quantile(xs, p) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (pos - lo) * (s[hi] - s[lo]);
}

export const median = (xs) => quantile(xs, 0.5);

/** 样本标准差（n−1 分母）。 */
export function sd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
}

/* ────────────────── 置换检验 ────────────────── */

/**
 * 参与者层面的双侧置换检验。
 *
 * 原假设：分组标签与个人高风险比例无关。做法是把 A/B 标签在全部参与者之间反复打乱，
 * 每次重算组间均值差，看实际观察到的差值在这些"随机差值"里有多极端。
 *
 * 用 Monte Carlo 而不是穷举：C(38,19) ≈ 1.7×10^10 种分法，枚举不现实。
 * p 值按 (超过观察值的次数 + 1) / (重复次数 + 1) 计算，这个 +1 是标准做法，
 * 保证 p 永远大于 0，不会给出"p = 0"这种不诚实的结果。
 */
export function permutationTest(groupA, groupB, iterations = 100000, seed = 20260920) {
  const observed = mean(groupB) - mean(groupA);
  const pooled = [...groupA, ...groupB];
  const nA = groupA.length;
  const rng = makeRng(seed);

  let extreme = 0;
  for (let i = 0; i < iterations; i += 1) {
    // Fisher–Yates 就地打乱
    const shuffled = [...pooled];
    for (let j = shuffled.length - 1; j > 0; j -= 1) {
      const k = Math.floor(rng() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const diff = mean(shuffled.slice(nA)) - mean(shuffled.slice(0, nA));
    if (Math.abs(diff) >= Math.abs(observed) - 1e-12) extreme += 1;
  }

  return {
    observed,
    p_value: (extreme + 1) / (iterations + 1),
    iterations,
  };
}

/* ────────────────── Mann-Whitney U ────────────────── */

/** 处理并列的秩次：并列值取平均秩。 */
function rankWithTies(values) {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  const tieGroups = [];

  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j += 1;
    const avgRank = (i + j) / 2 + 1; // 秩从 1 开始
    for (let k = i; k <= j; k += 1) ranks[indexed[k].i] = avgRank;
    if (j > i) tieGroups.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, tieGroups };
}

/**
 * Mann-Whitney U 检验，带并列校正的正态近似。
 *
 * 注意：本实验的个人高风险比例只能取 0、1/3、2/3、1 四个值，并列极多，
 * 所以必须用并列校正，否则 p 值会偏小。样本量小时正态近似本身也有局限，
 * 因此结论应以置换检验为主，本检验作为对照。
 */
export function mannWhitneyU(groupA, groupB) {
  const nA = groupA.length;
  const nB = groupB.length;
  const all = [...groupA, ...groupB];
  const { ranks, tieGroups } = rankWithTies(all);

  const rankSumA = ranks.slice(0, nA).reduce((a, b) => a + b, 0);
  const uA = rankSumA - (nA * (nA + 1)) / 2;
  const uB = nA * nB - uA;
  const u = Math.min(uA, uB);

  const meanU = (nA * nB) / 2;
  const n = nA + nB;
  const tieCorrection = tieGroups.reduce((acc, t) => acc + (t ** 3 - t), 0);
  const varU =
    ((nA * nB) / 12) * (n + 1 - tieCorrection / (n * (n - 1)));

  if (varU <= 0) return { u, p_value: 1, note: '方差为零，无法近似' };

  // 连续性校正
  const z = (Math.abs(u - meanU) - 0.5) / Math.sqrt(varU);
  return { u, u_a: uA, u_b: uB, z, p_value: 2 * (1 - normalCdf(Math.abs(z))) };
}

/** 标准正态分布累积函数，用 Abramowitz-Stegun 近似，精度约 1e-7。 */
export function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

/* ────────────────── Bootstrap 置信区间 ────────────────── */

/**
 * 参与者层面的 bootstrap，百分位法 95% 置信区间。
 * 两组各自有放回重抽同样人数，重算均值差，取 2.5% 与 97.5% 分位。
 */
export function bootstrapDiffCI(groupA, groupB, iterations = 10000, seed = 20260921) {
  const rng = makeRng(seed);
  const diffs = [];

  for (let i = 0; i < iterations; i += 1) {
    let sumA = 0;
    for (let k = 0; k < groupA.length; k += 1) sumA += groupA[Math.floor(rng() * groupA.length)];
    let sumB = 0;
    for (let k = 0; k < groupB.length; k += 1) sumB += groupB[Math.floor(rng() * groupB.length)];
    diffs.push(sumB / groupB.length - sumA / groupA.length);
  }

  return {
    lower: quantile(diffs, 0.025),
    upper: quantile(diffs, 0.975),
    iterations,
  };
}

/** 单组均值的 bootstrap 百分位置信区间。 */
export function bootstrapMeanCI(xs, iterations = 10000, seed = 20260922) {
  const rng = makeRng(seed);
  const means = [];
  for (let i = 0; i < iterations; i += 1) {
    let sum = 0;
    for (let k = 0; k < xs.length; k += 1) sum += xs[Math.floor(rng() * xs.length)];
    means.push(sum / xs.length);
  }
  return { lower: quantile(means, 0.025), upper: quantile(means, 0.975) };
}

/* ────────────────── Fisher 精确检验 ────────────────── */

function logFactorial(n) {
  let acc = 0;
  for (let i = 2; i <= n; i += 1) acc += Math.log(i);
  return acc;
}

/** 2×2 表某一格局的超几何概率（取对数再还原，避免阶乘溢出）。 */
function hypergeomProb(a, b, c, d) {
  const n = a + b + c + d;
  const logP =
    logFactorial(a + b) +
    logFactorial(c + d) +
    logFactorial(a + c) +
    logFactorial(b + d) -
    logFactorial(n) -
    logFactorial(a) -
    logFactorial(b) -
    logFactorial(c) -
    logFactorial(d);
  return Math.exp(logP);
}

/**
 * Fisher 精确检验，双侧。
 * 表格布局：
 *        事件发生   未发生
 *   A 组    a         b
 *   B 组    c         d
 * 双侧 p = 所有概率不超过观察表概率的格局之和。
 */
export function fisherExact(a, b, c, d) {
  const observed = hypergeomProb(a, b, c, d);
  const rowA = a + b;
  const rowB = c + d;
  const colEvent = a + c;
  const n = rowA + rowB;

  let p = 0;
  const lo = Math.max(0, colEvent - rowB);
  const hi = Math.min(rowA, colEvent);
  for (let x = lo; x <= hi; x += 1) {
    const prob = hypergeomProb(x, rowA - x, colEvent - x, rowB - (colEvent - x));
    if (prob <= observed * (1 + 1e-9)) p += prob;
  }
  return { p_value: Math.min(1, p), n };
}

/** 比例差的 Wilson 区间（单组比例用），小样本下比正态近似稳。 */
export function wilsonInterval(successes, total, z = 1.959963985) {
  if (total === 0) return { lower: null, upper: null };
  const phat = successes / total;
  const denom = 1 + (z * z) / total;
  const center = (phat + (z * z) / (2 * total)) / denom;
  const half =
    (z * Math.sqrt((phat * (1 - phat)) / total + (z * z) / (4 * total * total))) / denom;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}
