/** งานวันนี้ — same markup as legacy workflow-ui.js home(). */
import { useNavigate } from 'react-router';
import { workflowTasks, type WorkflowTask } from '@/domain';
import { roleName } from '../lib/format';
import { useShop } from '../state';
import { PageHeader } from '../ui';

export function useFlow() {
  const { shopId } = useShop();
  const navigate = useNavigate();
  return (page: string, id = '', action = '') => {
    const q = new URLSearchParams();
    if (id) q.set('id', id);
    if (action) q.set('action', action);
    navigate(`/s/${shopId}/${page}${q.size ? '?' + q : ''}`);
    window.scrollTo(0, 0);
  };
}

export function HomePage() {
  const { state, me } = useShop();
  const flow = useFlow();
  const tasks = workflowTasks(state, me.role);
  const actionable = tasks.filter((t) => t.can);
  const waiting = tasks.filter((t) => !t.can);
  const link = (page: string, label: string) => (
    <button className="secondary" type="button" onClick={() => flow(page)}>
      {label}
    </button>
  );
  const card = (t: WorkflowTask) => (
    <article key={t.key} className={`task-card ${t.can ? '' : 'waiting'}`}>
      <span className={`chip ${t.can ? 'review' : 'off'}`}>{t.status}</span>
      <h3>{t.title}</h3>
      <p>{t.done}</p>
      <small>ทำต่อโดย {t.who}</small>
      {t.can ? (
        <button className="primary" type="button" onClick={() => flow(t.page, t.id, t.action)}>
          ทำต่อ →
        </button>
      ) : (
        <span className="task-wait">รอบทบาทที่ระบุทำขั้นถัดไป</span>
      )}
    </article>
  );

  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE"
        title="งานวันนี้"
        sub="งานค้างทั้งหมดตามบทบาท ไม่ได้จำกัดเฉพาะรายการที่สร้างวันนี้"
      />
      <div className="today-intro">
        <div>
          <span className="eyebrow">{roleName(me.role)}</span>
          <h2>วันนี้ เริ่มจากงานที่ทำต่อได้</h2>
          <p>ข้อมูลร้านล่าสุด · ไม่มีการกำหนดความเร่งด่วนอัตโนมัติ</p>
        </div>
        <div className="today-count">
          <strong>{actionable.length}</strong> งานที่ทำต่อได้
        </div>
      </div>
      <div className="quick-actions">
        {link('counting', 'นับสต็อก')}
        {link('receiving', 'รับสินค้า')}
        {link('expenses', 'บันทึกค่าใช้จ่าย')}
        {link('dashboard', 'ดูรายงาน')}
      </div>
      <h2 className="section-title">ทำต่อได้ ({actionable.length})</h2>
      <div className="task-grid">
        {actionable.length ? (
          actionable.map(card)
        ) : (
          <section className="panel empty">
            <strong>ไม่มีงานค้างสำหรับบทบาทนี้</strong>เริ่มจากนับสต็อก
            หรือเปิดรายงานเพื่อตรวจข้อมูลปัจจุบัน
          </section>
        )}
      </div>
      {waiting.length > 0 && (
        <>
          <h2 className="section-title">รอส่งต่อ ({waiting.length})</h2>
          <div className="task-grid">{waiting.map(card)}</div>
        </>
      )}
    </>
  );
}
