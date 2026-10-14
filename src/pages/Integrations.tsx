import { useRef, useState } from 'react';
import { LuLock, LuTrash2, LuUpload } from 'react-icons/lu';
import { CATEGORY_LABELS, PROVIDERS, STATUS_HELP, STATUS_LABELS, type ProviderCategory, type ProviderMeta } from '../connectors/providers';
import { formatDate } from '../domain/dates';
import type { ConnectionStatus } from '../domain/types';
import { useNavigate, useStore } from '../state/store';
import { Card, CardHead, ConfirmButton, PageHead, Pill } from '../ui/components';
import { AllTemplates, ImportPanel } from './ImportFlow';

const STATUS_TONE: Record<ConnectionStatus, 'good' | 'info' | 'neutral' | 'warning'> = {
  'real-api': 'good',
  'user-import': 'neutral',
  simulated: 'info',
  planned: 'warning',
  unavailable: 'neutral',
};
const SHOWN_STATUSES: ConnectionStatus[] = ['real-api', 'user-import', 'planned', 'unavailable'];

const LOCAL_STATUS: Record<string, ConnectionStatus> = { 'user-import': 'user-import', planned: 'planned', unavailable: 'unavailable', manual: 'user-import' };

function StatusLegend() {
  return (
    <Card>
      <CardHead title="What each status means" sub="No live provider connection exists in this prototype. Data comes from files you import or entries you type." />
      <div className="grid grid-2">
        {SHOWN_STATUSES.map((st) => (
          <div key={st} className="row" style={{ alignItems: 'flex-start' }}>
            <Pill tone={STATUS_TONE[st]}>{STATUS_LABELS[st]}</Pill>
            <span className="small ink2">{STATUS_HELP[st]}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function YourData() {
  const { state, dispatch, notify } = useStore();
  const imported = state.transactions.filter((t) => t.source === 'imported');
  const manual = state.transactions.filter((t) => t.source === 'user').length;
  const last = state.connectors.spreadsheet?.lastSync;
  return (
    <Card>
      <CardHead title="Your data on this device" />
      <div className="stack small ink2">
        <p data-testid="data-counts">
          {imported.length} imported transaction{imported.length === 1 ? '' : 's'}
          {last ? ` (last import ${formatDate(last.slice(0, 10), true)})` : ''} and {manual} entered by hand.
        </p>
        <p>
          <LuLock aria-hidden style={{ verticalAlign: '-2px' }} /> Everything stays in this browser’s local storage. Files are read on the device and never uploaded. Local storage is not encrypted, so avoid using a
          shared computer for real records.
        </p>
        {imported.length ? (
          <div>
            <ConfirmButton
              className="btn danger"
              label="Delete imported transactions"
              confirmLabel="Delete imported data"
              icon={<LuTrash2 />}
              onConfirm={() => (dispatch({ type: 'DELETE_IMPORTED' }), notify('Imported transactions deleted'))}
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function Integrations() {
  const { state, market } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const openImport = () => {
    setOpen(true);
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  return (
    <div className="page">
      <PageHead
        title="Import & integrations"
        sub={
          state.marketCode === 'SG'
            ? 'Bring in your own records from the services you already use. Every provider shows its real status: nothing is shown as connected to a live account.'
            : `Bank connections are optional. In ${market.name} SavvyMoni works fully from the cash book or a spreadsheet; nothing here is connected to a live account.`
        }
        right={
          !open ? (
            <button className="btn primary" onClick={openImport} data-testid="open-import">
              <LuUpload /> Import a spreadsheet
            </button>
          ) : null
        }
      />
      <div ref={ref}>{open ? <ImportPanel onClose={() => setOpen(false)} /> : null}</div>
      <Card>
        <CardHead title="Spreadsheet templates" />
        <AllTemplates />
      </Card>
      <YourData />
      <StatusLegend />
      {state.marketCode === 'SG' ? <SgProviders onImport={openImport} /> : <LocalProviders onImport={openImport} />}
    </div>
  );
}

function LocalProviders({ onImport }: { onImport: () => void }) {
  const { market } = useStore();
  const go = useNavigate();
  return (
    <div className="grid grid-2" data-testid="local-providers">
      {market.paymentProviders.map((p) => (
        <Card key={p.name}>
          <div className="stack-sm">
            <h3>{p.name}</h3>
            <div>
              <Pill tone={STATUS_TONE[LOCAL_STATUS[p.status]]}>{p.status === 'manual' ? 'Manual entry (cash book)' : STATUS_LABELS[LOCAL_STATUS[p.status]]}</Pill>
            </div>
            <p className="xsmall muted">
              {p.status === 'manual'
                ? 'Write down cash in and out. Works with no bank account and no internet.'
                : p.status === 'user-import'
                  ? 'Download your statement or history as CSV or Excel and import it. Nothing is fetched from the provider.'
                  : p.status === 'planned'
                    ? 'Would need a partnership with the provider. Until then, add amounts in the cash book or the template.'
                    : 'Payment rail only. There is no consumer history access, so payments are recorded through the cash book or a statement.'}
            </p>
            {p.status === 'manual' ? (
              <div>
                <button className="btn sm primary" onClick={() => go('cashbook')}>
                  Open cash book
                </button>
              </div>
            ) : p.status === 'user-import' ? (
              <div>
                <button className="btn sm" onClick={onImport}>
                  <LuUpload /> Import file
                </button>
              </div>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

function SgProviders({ onImport }: { onImport: () => void }) {
  const groups = Object.keys(CATEGORY_LABELS) as ProviderCategory[];
  return (
    <>
      {groups.map((g) => (
        <section key={g} className="stack">
          <h2>{CATEGORY_LABELS[g]}</h2>
          <div className="grid grid-3">
            {PROVIDERS.filter((p) => p.category === g).map((p) => (
              <ProviderCard key={p.id} p={p} onImport={onImport} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function ProviderCard({ p, onImport }: { p: ProviderMeta; onImport: () => void }) {
  const go = useNavigate();
  const fileImport = p.formats.includes('csv') || p.formats.includes('xlsx');
  return (
    <Card data-testid={`provider-${p.id}`}>
      <div className="stack-sm">
        <h3>{p.name}</h3>
        <div>
          <Pill tone={STATUS_TONE[p.status]}>{STATUS_LABELS[p.status]}</Pill>
        </div>
        <p className="small ink2">{p.contributes}</p>
        <p className="xsmall muted">{p.note}</p>
        {p.status === 'user-import' ? (
          <div className="row" style={{ marginTop: 6 }}>
            {fileImport ? (
              <button className="btn sm" onClick={onImport} data-testid={`import-${p.id}`}>
                <LuUpload /> Import file
              </button>
            ) : null}
            {p.formats.includes('manual') ? (
              <button className="btn sm ghost" onClick={() => go(p.category === 'healthcare' ? 'insights' : 'finances')}>
                Enter manually
              </button>
            ) : null}
          </div>
        ) : (
          <p className="xsmall" style={{ marginTop: 6, fontWeight: 600 }}>
            {p.status === 'planned' ? 'Not available yet: needs a provider partnership.' : 'No connection is possible or planned.'}
          </p>
        )}
      </div>
    </Card>
  );
}
