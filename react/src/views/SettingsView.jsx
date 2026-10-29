import { THEMES } from '@core/gamification.js';
import { LAYOUT_NAMES } from '@core/layouts.js';
import { SOUND_PACKS } from '@client/sound.js';

const Select = ({ id, label, value, options, onChange }) => (
  <div className="field">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  </div>
);
const Toggle = ({ id, label, checked, onChange }) => (
  <label className="toggle">
    <input id={id} type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} /> <span>{label}</span>
  </label>
);

export function SettingsView({ settings, setSettings }) {
  const set = (k) => (v) => setSettings({ [k]: v });
  return (
    <section className="view active">
      <div className="page-head">
        <div>
          <h2 id="settings-title">Settings</h2>
          <p>Shared with the vanilla front-end. Biometrics, duels, lessons and the AI coach live in the vanilla app.</p>
        </div>
        <a className="btn" href="/">
          Open vanilla app
        </a>
      </div>
      <div className="cards">
        <div className="card">
          <h3>Appearance</h3>
          <Select id="theme" label="Theme" value={settings.theme} options={[['auto', 'Follow system'], ...THEMES.map((t) => [t.id, t.label])]} onChange={set('theme')} />
          <Select
            id="contrast"
            label="Contrast"
            value={settings.contrast}
            options={[
              ['normal', 'Normal'],
              ['high', 'High contrast'],
            ]}
            onChange={set('contrast')}
          />
          <Select
            id="font"
            label="Typing font"
            value={settings.font}
            options={[
              ['mono', 'IBM Plex Mono'],
              ['dyslexic', 'OpenDyslexic'],
            ]}
            onChange={set('font')}
          />
          <Select
            id="size"
            label="Text size"
            value={settings.size}
            options={[
              ['s', 'Small'],
              ['m', 'Medium'],
              ['l', 'Large'],
              ['xl', 'Extra large'],
            ]}
            onChange={set('size')}
          />
          <Select
            id="motion"
            label="Motion"
            value={settings.motion}
            options={[
              ['system', 'Follow system'],
              ['reduce', 'Reduce'],
              ['full', 'Full'],
            ]}
            onChange={set('motion')}
          />
        </div>
        <div className="card">
          <h3>Typing</h3>
          <Select id="layout" label="Layout" value={settings.layout} options={LAYOUT_NAMES.map((n) => [n, n])} onChange={set('layout')} />
          <Select id="sound" label="Sound pack" value={settings.sound} options={SOUND_PACKS.map((p) => [p, p])} onChange={set('sound')} />
          <Toggle id="haptics" label="Vibrate on errors" checked={settings.haptics} onChange={set('haptics')} />
          <Toggle id="showKeyboard" label="Show keyboard heatmap" checked={settings.showKeyboard} onChange={set('showKeyboard')} />
          <Toggle id="coachFingers" label="Finger coach" checked={settings.coachFingers} onChange={set('coachFingers')} />
          <Toggle id="keepLogs" label="Keep keystroke logs (replay, ghost)" checked={settings.keepLogs} onChange={set('keepLogs')} />
        </div>
      </div>
    </section>
  );
}
