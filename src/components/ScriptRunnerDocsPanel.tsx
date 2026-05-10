import { SlidePanel } from './SlidePanel';

type ScriptRunnerDocsPanelProps = {
  open: boolean;
  onClose: () => void;
};

const API_DOCS = [
  { name: 'get_ai_raw(ch)', desc: 'Read raw AI value for channel ch (0-15).' },
  { name: 'get_ai_raw_all()', desc: 'Read all raw AI values as a list of 16 floats.' },
  { name: 'get_ai_phy(ch)', desc: 'Read calibrated AI value for channel ch (0-15).' },
  { name: 'get_ai_phy_all()', desc: 'Read all calibrated AI values as a list of 16 floats.' },
  { name: 'set_ao(ch, data)', desc: 'Write AO voltage in V (internally clamped to 0-10V).' },
  { name: 'set_ao_all(data)', desc: 'Write all AO channels from a list of 8 values.' },
  { name: 'await asyncio.sleep(s)', desc: 'Non-blocking sleep. Do NOT use time.sleep().' },
];

export function ScriptRunnerDocsPanel({ open, onClose }: ScriptRunnerDocsPanelProps) {
  return (
    <SlidePanel open={open} onClose={onClose} title="Script Runner API" maxWidth="max-w-xl">
      <div className="p-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Available APIs
          </h3>
          <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
            {API_DOCS.map((api) => (
              <li key={api.name}>
                <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  {api.name}
                </code>
                <span className="ml-2">{api.desc}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SlidePanel>
  );
}
