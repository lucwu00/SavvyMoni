import { useState } from 'react';
import { LuDownload, LuRotateCcw, LuUpload } from 'react-icons/lu';
import { CountrySelect } from '../App';
import { LANGUAGE_INFO, type Lang } from '../ui/i18n';
import { exportWorkbook } from '../import/samples';
import { useNavigate, useStore } from '../state/store';
import { Callout, Card, CardHead, ConfirmButton, PageHead } from '../ui/components';
import { saveFile, XLSX_MIME } from '../ui/download';

export function SettingsPage() {
  const { state, dispatch, notify, persistent, market, today } = useStore();
  const go = useNavigate();
  const [name, setName] = useState(state.profile.displayName);

  return (
    <div className="page">
      <PageHead title="Settings & data" sub="Your name, country and language, the assistant, and full control over the data on this device." />

      <Card>
        <CardHead title="You" />
        <div className="form-grid">
          <label className="field">
            <span>Name SavvyMoni uses (optional)</span>
            <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => dispatch({ type: 'UPDATE_PROFILE', patch: { displayName: name.trim() } })} data-testid="profile-name" />
          </label>
          <CountrySelect testId="country-select-settings" />
          <label className="field">
            <span>Language</span>
            <select className="input" value={state.settings.language} data-testid="language-select" onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { language: e.target.value as Lang } })}>
              {market.languages.map((l) => (
                <option key={l.code} value={l.code} lang={LANGUAGE_INFO[l.code].html}>
                  {l.label}
                </option>
              ))}
            </select>
            <small>Each country offers its own languages. The start page, menus and cash book are translated; draft translations need native-speaker review.</small>
          </label>
          <label className="check" style={{ alignSelf: 'center' }}>
            <input type="checkbox" checked={state.settings.simpleMode} data-testid="simple-mode" onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { simpleMode: e.target.checked } })} />
            Simple mode: bigger text and fewer pages
          </label>
        </div>
        <p className="xsmall muted" style={{ marginTop: 10 }}>
          Each country keeps its own records in its own currency. Switching country never converts amounts; a country you have not set up starts empty.
        </p>
      </Card>

      <div className="grid grid-2">
        <Card>
          <CardHead title="Your records" sub="Keep a copy, edit it in Excel or Google Sheets, and import it again any time." />
          <div className="row">
            <button
              className="btn"
              data-testid="export-xlsx"
              onClick={async () => {
                const r = await saveFile(`SavvyMoni-${market.code}-${today}.xlsx`, exportWorkbook(state), XLSX_MIME);
                if (r === 'failed') notify('Download is not available here');
              }}
            >
              <LuDownload /> Download as Excel
            </button>
            <button
              className="btn ghost"
              onClick={async () => {
                const r = await saveFile(`SavvyMoni-${market.code}-${today}.json`, JSON.stringify(state, null, 2), 'application/json');
                if (r === 'failed') notify('Download is not available here');
              }}
            >
              <LuDownload /> Raw data (JSON)
            </button>
            <button className="btn ghost" onClick={() => go('integrations')}>
              <LuUpload /> Import more
            </button>
          </div>
        </Card>
        <Card>
          <CardHead title="Start again" />
          <div className="stack">
            <p className="small ink2">Deletes every record on this device, in every country, and returns to setup. Download a copy first if you want to keep it.</p>
            <div className="row">
              <ConfirmButton
                className="btn danger"
                icon={<LuRotateCcw />}
                label="Delete everything"
                confirmLabel="Yes, delete all my data"
                testId="reset-all"
                onConfirm={() => {
                  dispatch({ type: 'RESET' });
                  go('overview');
                }}
              />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card>
          <CardHead title="AI assistant" />
          <div className="stack small ink2">
            {state.settings.aiConsentAt ? (
              <>
                <p>You agreed on {state.settings.aiConsentAt.slice(0, 10)} that your questions, and the parts of your records the assistant looks up to answer them, may be sent to Anthropic, whose Claude model powers SavvyMoni’s AI.</p>
                <div>
                  <button className="btn sm" data-testid="ai-revoke" onClick={() => (dispatch({ type: 'UPDATE_SETTINGS', patch: { aiConsentAt: undefined } }), notify('Assistant switched off'))}>
                    Switch the assistant off
                  </button>
                </div>
              </>
            ) : (
              <p>Off. Nothing is sent anywhere. Open the assistant page to read what would be shared before switching it on.</p>
            )}
          </div>
        </Card>
        <Card>
          <CardHead title="Reminders" />
          <label className="check">
            <input type="checkbox" checked={state.settings.remindersEnabled} onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { remindersEnabled: e.target.checked } })} />
            Show my next check-in date on the overview
          </label>
          <p className="xsmall muted" style={{ marginTop: 8 }}>
            Optional, and never nagging: no streaks, no penalties for missed weeks. Reminders show in the app only; no notifications are sent.
          </p>
        </Card>
      </div>

      <Card>
        <CardHead title="Privacy" />
        <ul className="small ink2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
          <li>{persistent ? 'Records are saved in this browser’s local storage, on this device only.' : 'Browser storage is blocked here, so changes last only until you close this page.'} Imported files are read on the device and never uploaded.</li>
          <li>The only thing that ever leaves the device is what SavvyMoni’s AI sends to Anthropic (Claude) when you ask it something, and only after you switch it on.</li>
          <li>SavvyMoni never asks for bank passwords, {market.code === 'SG' ? 'Singpass credentials, NRIC numbers' : 'national ID numbers'}, card security codes or health records. Do not put them in imported files.</li>
          <li>Local storage is not encrypted. A production version would need consent, encryption, access controls and retention rules that meet the {market.dataProtectionLaw} (see ARCHITECTURE.md).</li>
        </ul>
      </Card>

      <Callout tone="neutral">
        SavvyMoni is a hackathon prototype for the ASEAN Financial Health Challenge 2026 (team Savvymoni3s). It does not move money, is not a bank or financial adviser, and has not been validated with real users yet.
      </Callout>
    </div>
  );
}
