import { VoltageMode, VOLTAGE_MODES } from '../types';

type VoltageConfigPanelProps = {
  open: boolean;
  onClose: () => void;
  voltageConfig: VoltageMode[];
  onVoltageConfigChange: (config: VoltageMode[]) => void;
};

export function VoltageConfigPanel({
  open,
  onClose,
  voltageConfig,
  onVoltageConfigChange,
}: VoltageConfigPanelProps) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-md transform bg-white shadow-2xl transition-transform duration-300 dark:bg-slate-900 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div>
              <h2 className="text-xl font-bold text-blue-600 dark:text-blue-400">
                Voltage Config
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                AI Channel Display Mode
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:border-blue-400 hover:text-blue-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-blue-400 dark:hover:text-blue-400"
              aria-label="Close voltage config panel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-2">
              {voltageConfig.map((mode, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                >
                  <span className="w-12 shrink-0 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    CH {idx.toString().padStart(2, '0')}
                  </span>
                  <select
                    value={mode}
                    onChange={(e) => {
                      const next = [...voltageConfig];
                      next[idx] = e.target.value as VoltageMode;
                      onVoltageConfigChange(next);
                    }}
                    className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  >
                    {VOLTAGE_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
