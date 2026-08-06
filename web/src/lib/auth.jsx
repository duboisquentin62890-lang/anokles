import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [keys, setKeys] = useState([]);
  const [discordOauth, setDiscordOauth] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const token = localStorage.getItem('tkr_token');
    if (!token) {
      setUser(null);
      setKeys([]);
      setLoading(false);
      return;
    }
    try {
      const data = await api('/api/auth/me');
      setUser(data.user);
      setKeys(data.keys || []);
      setDiscordOauth(Boolean(data.discord_oauth));
    } catch {
      localStorage.removeItem('tkr_token');
      setUser(null);
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function login(username, password) {
    const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    localStorage.setItem('tkr_token', data.token);
    setUser(data.user);
    await refresh();
    return data;
  }

  async function register(payload) {
    const data = await api('/api/auth/register', { method: 'POST', body: payload });
    localStorage.setItem('tkr_token', data.token);
    setUser(data.user);
    await refresh();
    return data;
  }

  function logout() {
    localStorage.removeItem('tkr_token');
    setUser(null);
    setKeys([]);
  }

  return (
    <AuthContext.Provider value={{ user, keys, discordOauth, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
