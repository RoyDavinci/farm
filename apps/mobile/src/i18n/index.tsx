import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { dictionaries, english, languages, type Key, type Language } from './translations';

export { languages, type Language };
const STORAGE_KEY = 'fm-language';

async function load(): Promise<Language | null> {
  try {
    const v =
      Platform.OS === 'web'
        ? window.localStorage.getItem(STORAGE_KEY)
        : await SecureStore.getItemAsync(STORAGE_KEY);
    return languages.some((l) => l.code === v) ? (v as Language) : null;
  } catch {
    return null;
  }
}
async function save(language: Language) {
  try {
    if (Platform.OS === 'web') window.localStorage.setItem(STORAGE_KEY, language);
    else await SecureStore.setItemAsync(STORAGE_KEY, language);
  } catch {}
}

export function translate(
  language: Language,
  key: Key,
  vars: Record<string, string | number> = {},
) {
  const text = dictionaries[language][key] ?? english[key];
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

interface I18n {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
}
const I18nContext = createContext<I18n>({
  language: 'en',
  setLanguage: () => {},
  t: (key, vars) => translate('en', key, vars),
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setState] = useState<Language>('en');
  useEffect(() => {
    void load().then((saved) => saved && setState(saved));
  }, []);
  const setLanguage = useCallback((next: Language) => {
    setState(next);
    void save(next);
  }, []);
  const t = useCallback(
    (key: Key, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  );
  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>{children}</I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
