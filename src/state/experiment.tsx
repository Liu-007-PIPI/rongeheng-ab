import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { APP_VERSION, CONSENT_VERSION, REQUIRE_ACCESS_CODE } from '../config/experiment';
import { createBackend } from '../lib/storage';
import type { DataBackend, DecisionInput, Progress } from '../lib/storage';
import type { BaselineAnswers, DecisionRecord, EventName, ParticipantRecord, ScenarioId, SessionRecord } from '../lib/types';

export type Step = 'loading' | 'consent' | 'code' | 'baseline' | 'scenario' | 'attention' | 'done';

/** 注意力检查插在第几个情境之后。放中间，前后都有情境，不容易被当成流程尾巴敷衍过去。 */
export const ATTENTION_CHECK_AFTER = 2;

export type CodeError =
  | null
  | 'not_found'
  | 'completed'
  | 'withdrawn'
  | 'in_use_elsewhere'
  | 'failed';

interface ExperimentState {
  step: Step;
  participant: ParticipantRecord | null;
  session: SessionRecord | null;
  decisions: DecisionRecord[];
  /** 当前情境在 scenario_order 中的位置，从 0 开始 */
  currentIndex: number;
  currentScenarioId: ScenarioId | null;
  /** 已验证但尚未绑定的匿名码，等基线填完才真正建记录 */
  pendingCode: string | null;
  codeError: CodeError;
  /**
   * 后端返回的原始错误文字。页面必须把它显示出来——
   * 静默失败会让人以为"按钮坏了"，排查时也看不到任何线索。
   */
  errorMessage: string | null;
  busy: boolean;
}

interface ExperimentApi extends ExperimentState {
  backend: DataBackend;
  agreeConsent: () => void;
  submitCode: (input: string) => Promise<void>;
  submitBaseline: (answers: BaselineAnswers) => Promise<void>;
  submitDecision: (input: DecisionInput) => Promise<void>;
  submitAttentionCheck: (passed: boolean) => Promise<void>;
  logEvent: (
    name: EventName,
    scenarioId: ScenarioId | null,
    metadata?: Record<string, string | number | boolean | null>,
  ) => void;
  restart: () => Promise<void>;
}

const Ctx = createContext<ExperimentApi | null>(null);

/** 已同意知情说明的本地标记，仅用于刷新后不再重复弹出同意页。 */
const CONSENT_KEY = 'rongeheng_ab_consent_v1';

function hasConsented(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === CONSENT_VERSION;
  } catch {
    return false;
  }
}

const INITIAL: ExperimentState = {
  step: 'loading',
  participant: null,
  session: null,
  decisions: [],
  currentIndex: 0,
  currentScenarioId: null,
  pendingCode: null,
  errorMessage: null,
  codeError: null,
  busy: false,
};

/**
 * 把一份进度落成界面状态。
 * 刷新或换设备续答时也要能正确落回注意力检查那一步，否则这道题会被绕过去。
 */
function fromProgress(progress: Progress): Partial<ExperimentState> {
  const done = progress.decisions.length;
  const finished =
    progress.session.completion_status === 'completed' ||
    done >= progress.session.scenario_order.length;
  const needsAttention =
    !finished &&
    done === ATTENTION_CHECK_AFTER &&
    progress.participant.attention_check_passed === null;
  return {
    participant: progress.participant,
    session: progress.session,
    decisions: progress.decisions,
    currentIndex: done,
    currentScenarioId: finished ? null : progress.session.scenario_order[done],
    step: finished ? 'done' : needsAttention ? 'attention' : 'scenario',
    codeError: null,
    errorMessage: null,
  };
}

export function ExperimentProvider({ children }: { children: ReactNode }) {
  const backendRef = useRef<DataBackend | null>(null);
  if (!backendRef.current) backendRef.current = createBackend();
  const backend = backendRef.current;

  const [state, setState] = useState<ExperimentState>(INITIAL);

  // 刷新恢复：有未完成的作答就直接回到原进度，不新建参与者记录
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const progress = await backend.findMyProgress();
        if (cancelled) return;
        if (progress) {
          setState((s) => ({ ...s, ...fromProgress(progress), busy: false }));
          return;
        }
      } catch {
        /* 读不到就按新访客处理 */
      }
      if (!cancelled) {
        const afterConsent = REQUIRE_ACCESS_CODE ? 'code' : 'baseline';
        setState((s) => ({ ...s, step: hasConsented() ? afterConsent : 'consent' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend]);

  const logEvent = useCallback(
    (
      name: EventName,
      scenarioId: ScenarioId | null,
      metadata: Record<string, string | number | boolean | null> = {},
    ) => {
      if (!state.participant || !state.session) return;
      // 事件日志失败不阻断作答，主结果以 decisions 表为准
      void backend.logEvent(name, scenarioId, metadata).catch(() => {});
    },
    [backend, state.participant, state.session],
  );

  const agreeConsent = useCallback(() => {
    try {
      localStorage.setItem(CONSENT_KEY, CONSENT_VERSION);
    } catch {
      /* 隐私模式下无法记住，仅影响刷新体验 */
    }
    // 开放模式没有匿名码这一步，同意之后直接进基线
    setState((s) => ({ ...s, step: REQUIRE_ACCESS_CODE ? 'code' : 'baseline' }));
  }, []);

  const submitCode = useCallback(
    async (input: string) => {
      const label = input.trim().toUpperCase();
      setState((s) => ({ ...s, busy: true, codeError: null }));

      let status: Awaited<ReturnType<DataBackend['peekCode']>>;
      try {
        status = await backend.peekCode(label);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setState((s) => ({
          ...s,
          busy: false,
          codeError: message.includes('invalid_code') ? 'not_found' : 'failed',
          errorMessage: message.includes('invalid_code') ? null : message,
        }));
        return;
      }

      if (status === 'withdrawn' || status === 'completed') {
        setState((s) => ({ ...s, busy: false, codeError: status as CodeError }));
        return;
      }

      if (status === 'started') {
        // 这个码已经开始过：本人回来就恢复，换了设备则拒绝（一码一人）
        try {
          const progress = await backend.findProgress(label);
          if (progress) {
            setState((s) => ({ ...s, ...fromProgress(progress), busy: false }));
          } else {
            setState((s) => ({ ...s, busy: false, codeError: 'in_use_elsewhere' }));
          }
        } catch {
          setState((s) => ({ ...s, busy: false, codeError: 'failed' }));
        }
        return;
      }

      // unused：先记住码，等基线填完再真正绑定
      setState((s) => ({ ...s, busy: false, codeError: null, pendingCode: label, step: 'baseline' }));
    },
    [backend],
  );

  const submitBaseline = useCallback(
    async (answers: BaselineAnswers) => {
      const code = state.pendingCode;
      // 定向模式必须先有已验证的匿名码；开放模式没有码，直接开场
      if (REQUIRE_ACCESS_CODE && !code) return;
      setState((s) => ({ ...s, busy: true, codeError: null, errorMessage: null }));
      try {
        const progress = code
          ? await backend.startSession(code, answers, CONSENT_VERSION, APP_VERSION)
          : await backend.startOpenSession(answers, CONSENT_VERSION, APP_VERSION);
        setState((s) => ({ ...s, ...fromProgress(progress), busy: false }));
      } catch (e) {
        // 写入失败时停在原页，不显示"已成功"，并把原始错误显示给用户
        const message = e instanceof Error ? e.message : String(e);
        const bound = message.includes('code_bound_elsewhere');
        setState((s) => ({
          ...s,
          busy: false,
          codeError: bound ? 'in_use_elsewhere' : 'failed',
          errorMessage: message,
          step: bound ? 'code' : s.step,
        }));
      }
    },
    [backend, state.pendingCode],
  );

  const submitDecision = useCallback(
    async (input: DecisionInput) => {
      const session = state.session;
      if (!session) return;
      setState((s) => ({ ...s, busy: true }));
      try {
        const record = await backend.saveDecision(input);
        setState((s) => {
          // 幂等：同一情境重复提交拿回的是同一条，不能重复追加
          const decisions = s.decisions.some((d) => d.decision_id === record.decision_id)
            ? s.decisions
            : [...s.decisions, record];
          const nextIndex = decisions.length;
          const finished = nextIndex >= session.scenario_order.length;
          const needsAttention =
            !finished &&
            nextIndex === ATTENTION_CHECK_AFTER &&
            s.participant?.attention_check_passed == null;
          return {
            ...s,
            busy: false,
            decisions,
            currentIndex: nextIndex,
            currentScenarioId: finished ? null : session.scenario_order[nextIndex],
            step: finished ? 'done' : needsAttention ? 'attention' : 'scenario',
          };
        });
      } catch {
        setState((s) => ({ ...s, busy: false }));
        throw new Error('提交失败');
      }
    },
    [backend, state.session],
  );

  /**
   * 提交注意力检查结果并进入最后一个情境。
   * 通过与否都照常继续——当场把人拦下来会让参与者知道自己"答错了"，
   * 进而改变后续情境里的作答行为。排除发生在分析阶段，按预注册的规则执行。
   */
  const submitAttentionCheck = useCallback(
    async (passed: boolean) => {
      const session = state.session;
      if (!session) return;
      setState((s) => ({ ...s, busy: true, errorMessage: null }));
      try {
        await backend.saveAttentionCheck(passed);
        logEvent('attention_check_answered', null, { passed });
        setState((s) => ({
          ...s,
          busy: false,
          participant: s.participant
            ? { ...s.participant, attention_check_passed: passed }
            : s.participant,
          currentScenarioId: session.scenario_order[s.currentIndex] ?? null,
          step: 'scenario',
        }));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, busy: false, errorMessage: message }));
      }
    },
    [backend, state.session, logEvent],
  );

  /**
   * 在同一台设备上再作答一份。
   *
   * 会换一个全新的身份，上一份已提交的作答留在库里不受影响，
   * 但这台浏览器之后读不回它了——撤回码必须在完成页交给参与者。
   */
  const restart = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, errorMessage: null }));
    try {
      await backend.beginNewSubmission();
      setState({
        ...INITIAL,
        // 同意页已经读过，不必重复；开放模式直接进基线
        step: REQUIRE_ACCESS_CODE ? 'code' : 'baseline',
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, busy: false, errorMessage: message }));
    }
  }, [backend]);

  const api = useMemo<ExperimentApi>(
    () => ({
      ...state,
      backend,
      agreeConsent,
      submitCode,
      submitBaseline,
      submitDecision,
      submitAttentionCheck,
      logEvent,
      restart,
    }),
    [state, backend, agreeConsent, submitCode, submitBaseline, submitDecision, submitAttentionCheck, logEvent, restart],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useExperiment(): ExperimentApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useExperiment 必须在 ExperimentProvider 内使用');
  return ctx;
}
