/**
 * 数据写入层。
 *
 * 页面只依赖 DataBackend 这个接口，不直接碰存储实现。当前阶段提供 localStorage 实现，
 * 让参与者端可以离线跑通全流程；接入 Supabase 时新增一个 SupabaseBackend 并在
 * createBackend() 里切换即可，页面代码不需要改动。
 *
 * 注意：localStorage 实现只用于开发与预演，**不能**用于正式数据采集——数据留在参与者
 * 自己的浏览器里，不满足交接文档"集中保存"的要求。
 */
import type {
  CodeStatus,
  DecisionRecord,
  EventRecord,
  ParticipantRecord,
  SessionRecord,
} from './types';

export interface StoredData {
  participants: ParticipantRecord[];
  sessions: SessionRecord[];
  decisions: DecisionRecord[];
  events: EventRecord[];
  code_status: Record<string, CodeStatus>;
}

export interface DataBackend {
  readonly kind: 'local' | 'supabase';
  /** 匿名码当前状态。unused 以外的状态由页面决定是恢复进度还是拒绝进入。 */
  getCodeStatus(codeLabel: string): Promise<CodeStatus>;
  /** 返回该匿名码已有的参与者与会话，用于刷新后恢复同一未完成会话。 */
  findProgress(
    codeLabel: string,
  ): Promise<{ participant: ParticipantRecord; session: SessionRecord; decisions: DecisionRecord[] } | null>;
  createParticipant(participant: ParticipantRecord): Promise<void>;
  createSession(session: SessionRecord): Promise<void>;
  /** 对 session_id + scenario_id 幂等：重复提交同一情境不会产生第二条记录。 */
  saveDecision(decision: DecisionRecord): Promise<void>;
  completeSession(sessionId: string, completedAt: string, totalDurationMs: number): Promise<void>;
  logEvent(event: EventRecord): Promise<void>;
  /** 仅供本地调试与数据自检使用，正式后台导出由管理员端负责。 */
  dump(): Promise<StoredData>;
  reset(): Promise<void>;
}

const STORAGE_KEY = 'rongeheng_ab_data_v1';

const EMPTY: StoredData = {
  participants: [],
  sessions: [],
  decisions: [],
  events: [],
  code_status: {},
};

function read(): StoredData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(EMPTY);
    return { ...structuredClone(EMPTY), ...(JSON.parse(raw) as Partial<StoredData>) };
  } catch {
    return structuredClone(EMPTY);
  }
}

function write(data: StoredData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

class LocalBackend implements DataBackend {
  readonly kind = 'local' as const;

  async getCodeStatus(codeLabel: string): Promise<CodeStatus> {
    return read().code_status[codeLabel] ?? 'unused';
  }

  async findProgress(codeLabel: string) {
    const data = read();
    const participant = data.participants.find((p) => p.access_code_label === codeLabel);
    if (!participant) return null;
    const session = data.sessions.find((s) => s.participant_id === participant.participant_id);
    if (!session) return null;
    const decisions = data.decisions.filter((d) => d.session_id === session.session_id);
    return { participant, session, decisions };
  }

  async createParticipant(participant: ParticipantRecord): Promise<void> {
    const data = read();
    // 一码一人：同一匿名码不得生成第二个参与者记录
    if (data.participants.some((p) => p.access_code_label === participant.access_code_label)) {
      throw new Error('该匿名码已存在参与者记录');
    }
    data.participants.push(participant);
    data.code_status[participant.access_code_label] = 'started';
    write(data);
  }

  async createSession(session: SessionRecord): Promise<void> {
    const data = read();
    if (data.sessions.some((s) => s.participant_id === session.participant_id)) return;
    data.sessions.push(session);
    write(data);
  }

  async saveDecision(decision: DecisionRecord): Promise<void> {
    const data = read();
    const exists = data.decisions.some(
      (d) => d.session_id === decision.session_id && d.scenario_id === decision.scenario_id,
    );
    if (exists) return; // 唯一约束：每个情境只能最终提交一次
    data.decisions.push(decision);
    write(data);
  }

  async completeSession(sessionId: string, completedAt: string, totalDurationMs: number): Promise<void> {
    const data = read();
    const session = data.sessions.find((s) => s.session_id === sessionId);
    if (!session) throw new Error('会话不存在');
    session.completed_at = completedAt;
    session.total_duration_ms = totalDurationMs;
    session.completion_status = 'completed';
    const participant = data.participants.find((p) => p.participant_id === session.participant_id);
    if (participant) data.code_status[participant.access_code_label] = 'completed';
    write(data);
  }

  async logEvent(event: EventRecord): Promise<void> {
    const data = read();
    data.events.push(event);
    write(data);
  }

  async dump(): Promise<StoredData> {
    return read();
  }

  async reset(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function createBackend(): DataBackend {
  const configured = import.meta.env.VITE_DATA_BACKEND ?? 'local';
  if (configured === 'supabase') {
    // 占位：接入 Supabase 时在此返回 SupabaseBackend。
    // 在实现完成前直接抛错，避免误以为数据已经集中保存。
    throw new Error(
      'VITE_DATA_BACKEND=supabase 但 Supabase 数据通道尚未实现。正式采集前必须先完成该实现。',
    );
  }
  return new LocalBackend();
}

/** 会话恢复指针：记录当前浏览器正在进行的匿名码。 */
const CURRENT_CODE_KEY = 'rongeheng_ab_current_code_v1';

export function rememberCurrentCode(codeLabel: string): void {
  try {
    localStorage.setItem(CURRENT_CODE_KEY, codeLabel);
  } catch {
    /* 隐私模式下写入失败时，仅影响刷新恢复，不影响本次作答 */
  }
}

export function recallCurrentCode(): string | null {
  try {
    return localStorage.getItem(CURRENT_CODE_KEY);
  } catch {
    return null;
  }
}

export function forgetCurrentCode(): void {
  try {
    localStorage.removeItem(CURRENT_CODE_KEY);
  } catch {
    /* 同上 */
  }
}
