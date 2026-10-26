import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Workspace-level display preferences.
 *
 * These are UI/reporting settings, not campaign config — they live on the
 * client and persist to localStorage. When the api lands, they move to
 * `workspaces.settings` and this provider hydrates from `GET /api/settings`.
 */
export interface Preferences {
  /**
   * Reply rate (percent) at or above which a campaign is highlighted as
   * healthy. Cold email lives around 2–6%, so 4% is a sensible starting line.
   */
  replyRateThreshold: number;
}

const DEFAULTS: Preferences = {
  replyRateThreshold: 4,
};

const STORAGE_KEY = "mailrung.preferences";

interface PreferencesContextValue {
  prefs: Preferences;
  setPrefs: (patch: Partial<Preferences>) => void;
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readStored(): Preferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    const threshold = Number(parsed.replyRateThreshold);
    return {
      replyRateThreshold:
        Number.isFinite(threshold) && threshold > 0 && threshold <= 100
          ? threshold
          : DEFAULTS.replyRateThreshold,
    };
  } catch {
    return DEFAULTS;
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Preferences>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Private mode / quota — preferences simply don't persist.
    }
  }, [prefs]);

  const setPrefs = useCallback((patch: Partial<Preferences>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => setState(DEFAULTS), []);

  const value = useMemo<PreferencesContextValue>(
    () => ({ prefs, setPrefs, reset }),
    [prefs, setPrefs, reset],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error("usePreferences must be used inside <PreferencesProvider>");
  }
  return ctx;
}
