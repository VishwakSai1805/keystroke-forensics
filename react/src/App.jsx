import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { store, applyVisualSettings } from '@client/store.js';
import { createApi } from '@client/api.js';
import { createAnalytics } from '@client/analytics.js';
import AnalyticsWorker from '@client/analytics.worker.js?worker';
import { TestView } from './views/TestView.jsx';
import { ReportView } from './views/ReportView.jsx';
import { HistoryView } from './views/HistoryView.jsx';
import { BoardsView } from './views/BoardsView.jsx';
import { SettingsView } from './views/SettingsView.jsx';
import { ReplayView } from './views/ReplayView.jsx';

/* global __KF_CONFIG__ */
const api = createApi(__KF_CONFIG__);
const analytics = createAnalytics(() => new AnalyticsWorker());

const NAV = [
  ['', 'Test'],
  ['report', 'Report'],
  ['history', 'History'],
  ['boards', 'Boards'],
  ['settings', 'Settings'],
];

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const settings = useSyncExternalStore(store.subscribe, store.get);
  const [mode, setMode] = useState('detecting');
  const hash = useHash();
  const [route, param] = hash.replace(/^#\/?/, '').split('/');
  const navigate = (h) => (location.hash = h);
  useEffect(() => applyVisualSettings(settings), [settings]);
  useEffect(() => {
    api.init().then(setMode);
  }, []);
  const view = useMemo(() => {
    if (mode === 'detecting') return <p className="empty">Connecting...</p>;
    switch (route) {
      case 'report':
        return <ReportView id={param} settings={settings} />;
      case 'history':
        return <HistoryView />;
      case 'boards':
        return <BoardsView api={api} />;
      case 'settings':
        return <SettingsView settings={settings} setSettings={store.set} />;
      case 'replay':
        return <ReplayView id={param} />;
      default:
        return <TestView api={api} analytics={analytics} settings={settings} setSettings={store.set} navigate={navigate} />;
    }
  }, [route, param, settings, mode]);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" href="#/">
          <i className="lamp" aria-hidden="true" />
          <b>KEYSTROKE FORENSICS</b>
          <span>react build</span>
        </a>
        <nav className="nav" aria-label="Primary">
          {NAV.map(([r, label]) => (
            <a key={r} href={`#/${r}`} aria-current={(route || '') === r ? 'page' : undefined}>
              {label}
            </a>
          ))}
          <a href="/">Vanilla app</a>
        </nav>
        <span className="status-pill" data-state={mode === 'offline' ? 'offline' : 'online'}>
          {mode === 'supabase' ? 'online' : mode === 'server' ? 'online' : mode}
        </span>
      </header>
      <main id="main">{view}</main>
      <footer className="footer">
        <span>React 18 front-end over the same /core engine as the vanilla app. No trackers.</span>
      </footer>
    </div>
  );
}
