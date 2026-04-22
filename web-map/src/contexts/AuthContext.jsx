/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import PocketBase from 'pocketbase';

const pb = new PocketBase(import.meta.env.VITE_API_URL);
const MOCK_AUTH_ENABLED = import.meta.env.VITE_MOCK_AUTH === 'true';
const MOCK_USER = {
  id: 'mock-auth-user',
  email: 'qa@local.test',
  name: 'QA Mock User',
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Initialize with the current auth store state right away
  const [user, setUser] = useState(MOCK_AUTH_ENABLED ? MOCK_USER : (pb.authStore.isValid ? pb.authStore.model : null));
  const [loading, setLoading] = useState(MOCK_AUTH_ENABLED ? false : !pb.authStore.isValid);

  useEffect(() => {
    if (MOCK_AUTH_ENABLED) {
      setUser(MOCK_USER);
      setLoading(false);
      return undefined;
    }

    let isMounted = true;

    const checkAuth = async () => {
      try {
        if (pb.authStore.isValid) {
          // This silently refreshes the session with the server
          await pb.collection('users').authRefresh();
          if (isMounted) setUser(pb.authStore.model);
        } else {
          if (isMounted) setUser(null);
        }
      } catch (err) {
        // If refresh fails (e.g., token expired or invalidated on server), log out
        console.warn('Auth refresh failed:', err);
        pb.authStore.clear();
        if (isMounted) setUser(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    checkAuth();

    const unsub = pb.authStore.onChange((token, model) => {
      if (isMounted) setUser(model);
    });

    return () => {
      isMounted = false;
      unsub();
    };
  }, []);

  const login = async (email, password) => {
    if (MOCK_AUTH_ENABLED) {
      setUser({ ...MOCK_USER, email: email || MOCK_USER.email });
      return { record: MOCK_USER, token: 'mock-auth-token' };
    }
    const authData = await pb.collection('users').authWithPassword(email, password);
    // Token automatically saved to localStorage by PocketBase
    return authData;
  };

  const logout = () => {
    if (MOCK_AUTH_ENABLED) {
      setUser(MOCK_USER);
      return;
    }
    pb.authStore.clear(); // Clears localStorage
    setUser(null);
  };


  return (
    <AuthContext.Provider value={{ user, login, logout, loading, pb }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
