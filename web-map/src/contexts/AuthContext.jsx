import { createContext, useContext, useState, useEffect } from 'react';
import PocketBase from 'pocketbase';

const pb = new PocketBase(import.meta.env.VITE_API_URL);

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pb.authStore.loadFromCookie('pb_auth');
    if (pb.authStore.isValid) {
      setUser(pb.authStore.model);
    }
    setLoading(false);

    const unsub = pb.authStore.onChange((token, model) => {
      setUser(model);
    });

    return unsub;
  }, []);

  const login = async (email, password) => {
    const authData = await pb.collection('users').authWithPassword(email, password);
    pb.authStore.exportToCookie({ httpOnly: false, secure: true, sameSite: 'Strict' });
    return authData;
  };

  const logout = () => {
    pb.authStore.clear();
    document.cookie = 'pb_auth=; Max-Age=0; path=/';
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
