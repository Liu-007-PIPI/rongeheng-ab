import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 关键信息曝光追踪。
 *
 * 第一轮用"是否点开折叠层"衡量信息触达，结果只有 12.28%—29.82%。第二轮改为默认展开后，
 * 没有可点的东西了，必须换一种测量方式：用 IntersectionObserver 记录目标区块
 * 在视口内的累计停留时长，超过阈值才算一次有效曝光。
 *
 * 这比"像素出现在屏幕上"严格（要求停留），但仍弱于"读懂了"——
 * 后者由注意力检查题另行把关。两者不可互相替代，预注册中分别定义。
 *
 * 不可见时暂停计时；页面切到后台（visibilitychange）同样暂停，
 * 否则挂着标签页不看也会被记成曝光。
 */
export function useExposure(thresholdMs = 2000) {
  // 必须用回调 ref：观测目标可能晚于本 hook 挂载才出现在 DOM 里，
  // 普通 useRef 会让 effect 在 ref.current 还是 null 时就跑完，观察器再也挂不上去。
  const [node, setNode] = useState<HTMLElement | null>(null);
  const accumulatedRef = useRef(0);
  const enteredAtRef = useRef<number | null>(null);
  const [exposed, setExposed] = useState(false);
  const exposedRef = useRef(false);

  /** 结算当前这段可见时长，并在跨过阈值时置位。 */
  const settle = useCallback(() => {
    if (enteredAtRef.current === null) return;
    accumulatedRef.current += Date.now() - enteredAtRef.current;
    enteredAtRef.current = null;
    if (!exposedRef.current && accumulatedRef.current >= thresholdMs) {
      exposedRef.current = true;
      setExposed(true);
    }
  }, [thresholdMs]);

  useEffect(() => {
    if (!node) return;

    // jsdom 与部分旧浏览器没有 IntersectionObserver。
    // 拿不到观测能力时保持 exposed=false，宁可低估也不虚报。
    if (typeof IntersectionObserver === 'undefined') return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // 选项区在手机上比一屏还高，要求"一半面积可见"会永远达不到，
          // 故只要有四分之一进入视口就开始计时，真正的门槛交给停留时长。
          if (e.isIntersecting && e.intersectionRatio >= 0.25) {
            if (enteredAtRef.current === null) enteredAtRef.current = Date.now();
          } else {
            settle();
          }
        }
      },
      { threshold: [0, 0.25, 0.5, 1] },
    );
    io.observe(node);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') settle();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // 阈值是累计时长，需要一个定时器在持续可见时触发状态更新
    const timer = window.setInterval(() => {
      if (enteredAtRef.current === null || exposedRef.current) return;
      const live = accumulatedRef.current + (Date.now() - enteredAtRef.current);
      if (live >= thresholdMs) {
        exposedRef.current = true;
        setExposed(true);
      }
    }, 250);

    return () => {
      settle();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [node, settle, thresholdMs]);

  /** 提交时调用，拿到最终的累计毫秒数。 */
  const totalMs = useCallback(() => {
    const live = enteredAtRef.current === null ? 0 : Date.now() - enteredAtRef.current;
    return accumulatedRef.current + live;
  }, []);

  /** 切换情境时重置。 */
  const reset = useCallback(() => {
    accumulatedRef.current = 0;
    enteredAtRef.current = null;
    exposedRef.current = false;
    setExposed(false);
  }, []);

  return { ref: setNode, exposed, totalMs, reset };
}
