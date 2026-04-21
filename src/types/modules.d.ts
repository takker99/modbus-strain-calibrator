declare module 'react-plotly.js';
declare module 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs' {
  export function loadPyodide(options?: { indexURL?: string }): Promise<{
    setInterruptBuffer: (buffer: Uint8Array) => void;
    runPythonAsync: (code: string) => Promise<unknown>;
    globals: {
      set: (name: string, value: unknown) => void;
    };
  }>;
}
