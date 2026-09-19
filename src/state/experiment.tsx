import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ALL_SCENARIO_IDS } from '../config/scenarios';
import { APP_VERSION, CONSENT_VERSION } from '../config/experiment';
import { lookupCode } from '../config/accessCodes';
import { shuffle, uuid } from '../lib/random';
import {
  createBackend,
  forgetCurrentCode,
  recallCurrentCode,
  rememberCurrentCode,
} from '../lib/storage';
import type { DataBackend } from '../lib/storage';
import type {
  BaselineAnswers,
  DecisionRecord,
  EventName,
  ParticipantRecord,
  ScenarioId,
  SessionRecord,
} from '../lib/types';

export type Step = 'loading' | 'consent' | 'code' | 'baseline' | 'scenario' | 'done';

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
  codeError: CodeError;
  busy: boolean;
}

interface ExperimentApi extends ExperimentState {
  backend: DataBackend;
  agreeConsent: () => void;
  submitCode: (input: string) => Promise<void>;
  submitBaseline: (answers: BaselineAnswers) => Promise<void>;
  submitDecision: (decision: Omit<DecisionRecord, 'decision_id' | 'session_id' | 'participant_id'>) => Promise<void>;
  logEvent: (name: EventName, scenarioId: ScenarioId | null, metadata?: Record<string, string | number | boolean | null>) => void;
  restart: () => void;
}

const Ctx = createContext<ExperimentApi | null>(null);

/** 已同意知情说明的本地标记，仅用于刷新后不再重复弹出同意页。 */
const CONSENT_KEY = 'rongeheng_ab_consent_v1';

export function ExperimentProvider({ children }: { children: ReactNode }) {
  const backendRef = useRef<DataBackend | null>(null);
  if (!backendRef.current) backendRef.current = createBackend();
  const backend = backendRef.current;

  const [state, setState] = useState<ExperimentState>({
    step: 'loading',
    participant: null,
    session: null,
    decisions: [],
    currentIndex: 0,
    currentScenarioId: null,
    codeError: null,
    busy: false,
  });

  // 刷新恢复：若本地记着一个未完成的匿名码，直接回到它的进度，不新建参与者记录
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const code = recallCurrentCode();
      const consented = (() => {
        try {
          return localStorage.getItem(CONSENT_KEY) === CONSENT_VERSION;
        } catch {
          return false;
        }
      })();

      if (!code) {
        if (!cancelled) setState((s) => ({ ...s, step: consented ? 'code' : 'consent' }));
        return;
      }

      try {
        const progress = await backend.findProgress(code);
        if (cancelled) return;
        if (!progress) {
          setState((s) => ({ ...s, step: consented ? 'code' : 'consent' }));
          return;
        }
        const { participant, session, decisions } = progress;
        const done = decisions.length;
        setState((s) => ({
          ...s,
          step: session.completion_status === 'completed' || done >= session.scenario_order.length ? 'done' : 'scenario',
          participant,
          session,
          decisions,
          currentIndex: done,
          currentScenarioId: session.scenario_order[done] ?? null,
        }));
      } catch {
        if (!cancelled) setState((s) => ({ ...s, step: consented ? 'code' : 'consent' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend]);

  const logEvent = useCallback(
    (name: EventName, scenarioId: ScenarioId | null, metadata: Record<string, string | number | boolean | null> = {}) => {
      const participant = state.participant;
      const session = state.session;
      if (!participant || !session) return;
      void backend
        .logEvent({
          event_id: uuid(),
          session_id: session.session_id,
          participant_id: participant.participant_id,
          scenario_id: scenarioId,
          event_name: name,
          event_ts: new Date().toISOString(),
          metadata,
        })
        .catch(() => {
          /* 事件日志失败不阻断作答，主结果以 decisions 表为准 */
        });
    },
    [backend, state.participant, state.session],
  );

  const agreeConsent = useCallback(() => {
    try {
      localStorage.setItem(CONSENT_KEY, CONSENT_VERSION);
    } catch {
      /* 隐私模式下无法记住，仅影响刷新体验 */
    }
    setState((s) => ({ ...s, step: 'code' }));
  }, []);

  const submitCode = useCallback(
    async (input: string) => {
      setState((s) => ({ ...s, busy: true, codeError: null }));
      const row = lookupCode(input);
      if (!row) {
        setState((s) => ({ ...s, busy: false, codeError: 'not_found' }));
        return;
      }
      try {
        const status = await backend.getCodeStatus(row.code_label);
        if (status === 'withdrawn') {
          setState((s) => ({ ...s, busy: false, codeError: 'withdrawn' }));
          return;
        }
        if (status === 'completed') {
          setState((s) => ({ ...s, busy: false, codeError: 'completed' }));
          return;
        }

        const progress = await backend.findProgress(row.code_label);
        if (progress) {
          // 同一匿名码已开始过：恢复原会话，不创建第二个参与者
          rememberCurrentCode(row.code_label);
          const done = progress.decisions.length;
          setState((s) => ({
            ...s,
            busy: false,
            codeError: null,
            participant: progress.participant,
            session: progress.session,
            decisions: progress.decisions,
            currentIndex: done,
            currentScenarioId: progress.session.scenario_order[done] ?? null,
            step: done >= progress.session.scenario_order.length ? 'done' : 'scenario',
          }));
          return;
        }

        // 新参与者：分组来自匿名码登记表，页面不解析编号字符串
        const participant: ParticipantRecord = {
          participant_id: uuid(),
          access_code_label: row.code_label,
          variant: row.assigned_variant,
          code_type: row.code_type,
          consent_version: CONSENT_VERSION,
          consent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          baseline: {
            age_group: '',
            role_status: '',
            disposable_funds_band: '',
            installment_experience: '',
            recent_large_purchase: null,
          },
        };
        rememberCurrentCode(row.code_label);
        setState((s) => ({
          ...s,
          busy: false,
          codeError: null,
          participant,
          step: 'baseline',
        }));
      } catch {
        setState((s) => ({ ...s, busy: false, codeError: 'failed' }));
      }
    },
    [backend],
  );

  const submitBaseline = useCallback(
    async (answers: BaselineAnswers) => {
      const participant = state.participant;
      if (!participant) return;
      setState((s) => ({ ...s, busy: true }));
      const filled: ParticipantRecord = { ...participant, baseline: answers };
      const order = shuffle(ALL_SCENARIO_IDS);
      const session: SessionRecord = {
        session_id: uuid(),
        participant_id: participant.participant_id,
        variant: participant.variant,
        scenario_order: order,
        started_at: new Date().toISOString(),
        completed_at: null,
        total_duration_ms: null,
        completion_status: 'in_progress',
        app_version: APP_VERSION,
      };
      try {
        await backend.createParticipant(filled);
        await backend.createSession(session);
        setState((s) => ({
          ...s,
          busy: false,
          participant: filled,
          session,
          currentIndex: 0,
          currentScenarioId: order[0],
          step: 'scenario',
        }));
      } catch {
        // 写入失败时停在原页，不显示"已成功"
        setState((s) => ({ ...s, busy: false, codeError: 'failed' }));
      }
    },
    [backend, state.participant],
  );

  const submitDecision = useCallback(
    async (partial: Omit<DecisionRecord, 'decision_id' | 'session_id' | 'participant_id'>) => {
      const participant = state.participant;
      const session = state.session;
      if (!participant || !session) return;
      setState((s) => ({ ...s, busy: true }));
      const record: DecisionRecord = {
        ...partial,
        decision_id: uuid(),
        session_id: session.session_id,
        participant_id: participant.participant_id,
      };
      try {
        await backend.saveDecision(record);
        const nextIndex = state.currentIndex + 1;
        const finished = nextIndex >= session.scenario_order.length;
        if (finished) {
          const startedAt = new Date(session.started_at).getTime();
          await backend.completeSession(
            session.session_id,
            new Date().toISOString(),
            Date.now() - startedAt,
          );
          forgetCurrentCode();
        }
        setState((s) => ({
          ...s,
          busy: false,
          decisions: [...s.decisions, record],
          currentIndex: nextIndex,
          currentScenarioId: finished ? null : session.scenario_order[nextIndex],
          step: finished ? 'done' : 'scenario',
        }));
      } catch {
        setState((s) => ({ ...s, busy: false }));
        throw new Error('提交失败');
      }
    },
    [backend, state.participant, state.session, state.currentIndex],
  );

  const restart = useCallback(() => {
    forgetCurrentCode();
    setState({
      step: 'code',
      participant: null,
      session: null,
      decisions: [],
      currentIndex: 0,
      currentScenarioId: null,
      codeError: null,
      busy: false,
    });
  }, []);

  const api = useMemo<ExperimentApi>(
    () => ({ ...state, backend, agreeConsent, submitCode, submitBaseline, submitDecision, logEvent, restart }),
    [state, backend, agreeConsent, submitCode, submitBaseline, submitDecision, logEvent, restart],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useExperiment(): ExperimentApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useExperiment 必须在 ExperimentProvider 内使用');
  return ctx;
}
